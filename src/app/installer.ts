import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import type { BackendApi } from "./backend.js";
import type { SettingsService } from "./settings.js";
import type { AppLogger } from "./logger.js";
import type { ClientManifest, InstallState, PreflightReport } from "./types.js";
import {
  pathInside,
  safeRelativePath,
  sha256File,
  verifyManifestSignature,
} from "./manifest.js";

const REQUIRED_LEGACY = [
  "Data/Platform/Plugins/skymp5-client.js",
  "Data/SKSE/Plugins/SkyrimPlatform.dll",
  "Data/SKSE/Plugins/MpClientPlugin.dll",
];

export class InstallerService {
  private controller: AbortController | null = null;
  private state: InstallState = { phase: "idle", message: "" };
  constructor(
    private options: {
      backend: BackendApi;
      settings: SettingsService;
      publicKey: string;
      maxBytes: number;
      downloadsDir: string;
      emit: (state: InstallState) => void;
      log: AppLogger;
    },
  ) {}

  getState() {
    return { ...this.state };
  }
  private setState(patch: InstallState) {
    this.state = patch;
    this.options.emit(this.getState());
  }
  cancel() {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }

  private installedManifest(key: string): ClientManifest | null {
    const all = this.options.settings.store.get("installedManifests") as Record<
      string,
      ClientManifest
    >;
    return all[key] || null;
  }
  private saveInstalledManifest(key: string, manifest: ClientManifest) {
    const all = this.options.settings.store.get("installedManifests") as Record<
      string,
      ClientManifest
    >;
    this.options.settings.store.set("installedManifests", {
      ...all,
      [key]: manifest,
    });
  }

  async validateFiles(
    root: string,
    manifest: ClientManifest,
  ): Promise<string[]> {
    const invalid: string[] = [];
    for (const file of manifest.files) {
      const target = pathInside(root, file.path);
      try {
        const stat = await fs.promises.stat(target);
        if (
          !stat.isFile() ||
          stat.size !== file.size ||
          (await sha256File(target)) !== file.sha256.toLowerCase()
        )
          invalid.push(file.path);
      } catch {
        invalid.push(file.path);
      }
    }
    return invalid;
  }

  async preflight(): Promise<PreflightReport> {
    this.setState({ phase: "preflight", message: "Checking installation…" });
    const settings = this.options.settings;
    const server = settings.activeServer();
    const root = settings.store.get("skyrimPath");
    const checks: PreflightReport["checks"] = [];
    if (!root || !fs.existsSync(path.join(root, "SkyrimSE.exe")))
      checks.push({
        id: "skyrim",
        status: "error",
        message: "Skyrim Special Edition was not found.",
      });
    else
      checks.push({
        id: "skyrim",
        status: "ok",
        message: "Skyrim installation found.",
      });
    if (!fs.existsSync(path.join(root || "", "skse64_loader.exe")))
      checks.push({
        id: "skse",
        status: "error",
        message: "SKSE loader is missing.",
      });
    else
      checks.push({ id: "skse", status: "ok", message: "SKSE is installed." });
    if (!server)
      checks.push({
        id: "server",
        status: "error",
        message: "No game server is selected.",
      });
    else
      checks.push({
        id: "server",
        status: "ok",
        message: `Server ${server.name} selected.`,
      });
    if (!settings.getSession())
      checks.push({
        id: "auth",
        status: "error",
        message: "Discord login is required.",
      });
    else
      checks.push({
        id: "auth",
        status: "ok",
        message: "Discord session is available.",
      });

    let manifest: ClientManifest | null = null;
    let offline = false;
    if (server) {
      try {
        manifest = await this.options.backend.manifest(server.key);
        if (!verifyManifestSignature(manifest, this.options.publicKey))
          throw new Error("Client manifest signature is invalid.");
        if (manifest.serverKey !== server.key)
          throw new Error("Client manifest belongs to a different server.");
      } catch (error) {
        manifest = this.installedManifest(server.key);
        offline = true;
        checks.push({
          id: "backend",
          status: manifest ? "warning" : "error",
          message: manifest
            ? "Backend unavailable; using the last verified manifest."
            : `Signed client manifest unavailable: ${(error as Error).message}`,
        });
      }
    }

    if (manifest && root) {
      const invalid = await this.validateFiles(root, manifest);
      checks.push(
        invalid.length
          ? {
              id: "files",
              status: offline ? "error" : "repairable",
              message: `${invalid.length} managed file(s) need repair.`,
            }
          : {
              id: "files",
              status: "ok",
              message: "All managed files are verified.",
            },
      );
    } else if (root) {
      const legacyMissing = REQUIRED_LEGACY.filter(
        (item) => !fs.existsSync(pathInside(root, item)),
      );
      checks.push({
        id: "files",
        status: legacyMissing.length ? "error" : "repairable",
        message: legacyMissing.length
          ? "Client files are not installed."
          : "Legacy installation must be verified once.",
      });
    }
    const repairable =
      !offline && checks.some((check) => check.status === "repairable");
    const ready = !checks.some(
      (check) => check.status === "error" || check.status === "repairable",
    );
    const report = {
      ready,
      repairable,
      downloadBytes: manifest?.archive.size || 0,
      offline,
      checks,
    };
    this.setState({
      phase: ready ? "complete" : "idle",
      message: ready ? "Installation is ready." : "Preflight found problems.",
    });
    return report;
  }

  async repair(): Promise<void> {
    if (this.controller)
      throw new Error("Another installation is already running.");
    const server = this.options.settings.activeServer();
    const root = this.options.settings.store.get("skyrimPath");
    if (!server || !root)
      throw new Error("Skyrim path and server are required.");
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const manifest = await this.options.backend.manifest(server.key, signal);
      if (!verifyManifestSignature(manifest, this.options.publicKey))
        throw new Error("Client manifest signature is invalid.");
      if (manifest.serverKey !== server.key)
        throw new Error("Client manifest server mismatch.");
      if (manifest.archive.size > this.options.maxBytes)
        throw new Error("Client package exceeds configured size limit.");
      if (
        new Set(
          manifest.files.map((file) =>
            safeRelativePath(file.path).toLowerCase(),
          ),
        ).size !== manifest.files.length
      )
        throw new Error("Client manifest contains duplicate file paths.");
      await fs.promises.mkdir(this.options.downloadsDir, { recursive: true });
      const part = path.join(
        this.options.downloadsDir,
        `${server.key}-${manifest.version}.zip.part`,
      );
      await this.download(
        this.options.backend.clientDownloadUrl(server.key),
        part,
        manifest,
        signal,
      );
      this.setState({
        phase: "verifying",
        message: "Verifying signed package…",
        canCancel: true,
      });
      if ((await sha256File(part)) !== manifest.archive.sha256.toLowerCase())
        throw new Error(
          "Downloaded package hash does not match the signed manifest.",
        );
      await this.stageAndCommit(part, root, manifest, signal);
      this.saveInstalledManifest(server.key, manifest);
      await fs.promises.rm(part, { force: true });
      this.setState({
        phase: "complete",
        message: "Client files installed and verified.",
      });
    } catch (error) {
      if (signal.aborted)
        this.setState({
          phase: "cancelled",
          message: "Installation cancelled.",
          canRetry: true,
        });
      else
        this.setState({
          phase: "error",
          message: (error as Error).message,
          canRetry: true,
        });
      throw error;
    } finally {
      this.controller = null;
    }
  }

  private async download(
    url: string,
    filename: string,
    manifest: ClientManifest,
    signal: AbortSignal,
    redirects = 0,
  ): Promise<void> {
    if (redirects > 4) throw new Error("Too many download redirects.");
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")
    )
      throw new Error("Client downloads require HTTPS.");
    const existing = fs.existsSync(filename)
      ? (await fs.promises.stat(filename)).size
      : 0;
    if (existing > manifest.archive.size)
      await fs.promises.truncate(filename, 0);
    const offset = existing > manifest.archive.size ? 0 : existing;
    if (offset === manifest.archive.size) {
      this.setState({
        phase: "downloading",
        message: "Using completed cached download…",
        receivedBytes: offset,
        totalBytes: manifest.archive.size,
        percent: 100,
        canCancel: true,
      });
      return;
    }
    const headers: Record<string, string> = offset
      ? { Range: `bytes=${offset}-` }
      : {};
    if (offset && manifest.archive.etag)
      headers["If-Range"] = manifest.archive.etag;
    this.setState({
      phase: "downloading",
      message: "Downloading client package…",
      receivedBytes: offset,
      totalBytes: manifest.archive.size,
      percent: Math.round((offset / manifest.archive.size) * 100),
      canCancel: true,
    });
    await new Promise<void>((resolve, reject) => {
      const transport = parsed.protocol === "https:" ? https : http;
      const request = transport.get(
        parsed,
        { headers, signal },
        async (response) => {
          if (
            response.statusCode &&
            [301, 302, 303, 307, 308].includes(response.statusCode)
          ) {
            response.resume();
            const location = response.headers.location;
            if (!location)
              return reject(new Error("Download redirect has no location."));
            try {
              await this.download(
                new URL(location, parsed).href,
                filename,
                manifest,
                signal,
                redirects + 1,
              );
              resolve();
            } catch (error) {
              reject(error);
            }
            return;
          }
          if (response.statusCode !== 200 && response.statusCode !== 206) {
            response.resume();
            return reject(
              new Error(`Download failed with HTTP ${response.statusCode}.`),
            );
          }
          if (
            manifest.archive.etag &&
            response.headers.etag &&
            response.headers.etag !== manifest.archive.etag
          ) {
            response.resume();
            return reject(
              new Error("Download ETag does not match the signed manifest."),
            );
          }
          const append = offset > 0 && response.statusCode === 206;
          let received = append ? offset : 0;
          const output = fs.createWriteStream(filename, {
            flags: append ? "a" : "w",
          });
          response.on("data", (chunk) => {
            received += chunk.length;
            if (
              received > manifest.archive.size ||
              received > this.options.maxBytes
            )
              request.destroy(new Error("Download exceeds signed size."));
            else
              this.setState({
                phase: "downloading",
                message: "Downloading client package…",
                receivedBytes: received,
                totalBytes: manifest.archive.size,
                percent: Math.min(
                  100,
                  Math.round((received / manifest.archive.size) * 100),
                ),
                canCancel: true,
              });
          });
          try {
            await pipeline(response, output, { signal });
            if (received !== manifest.archive.size)
              throw new Error("Downloaded package size is incomplete.");
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      );
      request.on("error", reject);
      request.setTimeout(60_000, () =>
        request.destroy(new Error("Download timed out.")),
      );
    });
  }

  private async stageAndCommit(
    archive: string,
    root: string,
    manifest: ClientManifest,
    signal: AbortSignal,
  ) {
    const id = `${Date.now()}-${process.pid}`;
    const stage = path.join(root, `.frostfall-stage-${id}`);
    const backup = path.join(root, `.frostfall-backup-${id}`);
    const committed: string[] = [];
    await fs.promises.mkdir(stage, { recursive: true });
    await fs.promises.mkdir(backup, { recursive: true });
    try {
      this.setState({
        phase: "staging",
        message: "Extracting to secure staging area…",
        canCancel: true,
      });
      const zip = new AdmZip(archive);
      const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
      const expected = new Set(
        manifest.files.map((file) => safeRelativePath(file.path)),
      );
      for (const entry of entries) {
        if (signal.aborted) throw new Error("Cancelled");
        const mode = (entry.header.attr >>> 16) & 0o170000;
        if (mode === 0o120000)
          throw new Error(
            `Symbolic links are not allowed in client packages: ${entry.entryName}`,
          );
        const relative = safeRelativePath(entry.entryName);
        if (!expected.has(relative))
          throw new Error(`Archive contains unsigned file: ${relative}`);
        const target = pathInside(stage, relative);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, entry.getData(), { flag: "wx" });
      }
      for (const file of manifest.files) {
        const target = pathInside(stage, file.path);
        const stat = await fs.promises.stat(target);
        if (
          stat.size !== file.size ||
          (await sha256File(target)) !== file.sha256.toLowerCase()
        )
          throw new Error(`Staged file verification failed: ${file.path}`);
      }
      this.setState({
        phase: "committing",
        message: "Applying verified files…",
        canCancel: false,
      });
      for (const file of manifest.files) {
        const target = pathInside(root, file.path);
        const source = pathInside(stage, file.path);
        const saved = pathInside(backup, file.path);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) {
          await fs.promises.mkdir(path.dirname(saved), { recursive: true });
          await fs.promises.rename(target, saved);
        }
        await fs.promises.rename(source, target);
        committed.push(file.path);
      }
      const previous = this.installedManifest(manifest.serverKey);
      if (previous)
        for (const old of previous.files)
          if (!expected.has(safeRelativePath(old.path))) {
            const target = pathInside(root, old.path);
            if (fs.existsSync(target)) {
              const saved = pathInside(backup, old.path);
              await fs.promises.mkdir(path.dirname(saved), { recursive: true });
              await fs.promises.rename(target, saved);
            }
          }
    } catch (error) {
      this.setState({
        phase: "rolling-back",
        message: "Restoring previous installation…",
        canCancel: false,
      });
      for (const relative of committed.reverse())
        await fs.promises.rm(pathInside(root, relative), { force: true });
      if (fs.existsSync(backup))
        for (const file of walkFiles(backup)) {
          const relative = path.relative(backup, file);
          const target = pathInside(root, relative);
          await fs.promises.mkdir(path.dirname(target), { recursive: true });
          await fs.promises.rename(file, target);
        }
      throw error;
    } finally {
      await fs.promises.rm(stage, { recursive: true, force: true });
      await fs.promises.rm(backup, { recursive: true, force: true });
    }
  }
}

function walkFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(filename));
    else if (entry.isFile()) result.push(filename);
  }
  return result;
}
