import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { BackendApi } from "./backend.js";
import { InstallerBridge, type BridgeEvent } from "./bridge.js";
import type { AppLogger } from "./logger.js";
import { sha256File, verifyManifestSignature } from "./manifest.js";
import type { SettingsService } from "./settings.js";
import type {
  InstallState,
  ModpackManifest,
  ModpackStatus,
  NexusStatus,
  PreflightReport,
} from "./types.js";

type ToolPin = { version: string; url: string; sha256: string };
type Receipt = {
  version: string;
  archiveSha256: string;
  root: string;
  verifiedAt: string;
};

export function suggestedModpackRoot(skyrimPath: string, serverKey: string) {
  const drive = path.parse(path.resolve(skyrimPath)).root;
  return path.join(drive, "Frostfall", "servers", serverKey);
}

export function assertManagedRoot(
  root: string,
  skyrimPath: string,
  serverKey: string,
) {
  if (!root || !path.isAbsolute(root))
    throw new Error("Modpack location must be an absolute local path.");
  if (!/^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\"))
    throw new Error("Modpack location must be on a local Windows drive.");
  if (root.length > 180) throw new Error("Modpack location is too long.");
  const normalized = path.resolve(root);
  const game = path.resolve(skyrimPath);
  const lower = normalized.toLowerCase();
  if (
    lower === game.toLowerCase() ||
    lower.startsWith(`${game.toLowerCase()}${path.sep}`)
  )
    throw new Error(
      "The managed modpack must not be inside the Steam game folder.",
    );
  if (
    /^[a-z]:\\(?:windows|program files(?: \(x86\))?)(?:\\|$)/i.test(normalized)
  )
    throw new Error(
      "The managed modpack cannot be placed in a system directory.",
    );
  if (
    !new RegExp(`(?:^|[\\\\/])${escapeRegex(serverKey)}$`, "i").test(normalized)
  )
    throw new Error("The server folder must end with the server key.");
  return normalized;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ModpackService {
  private controller: AbortController | null = null;
  private bridge: InstallerBridge | null = null;
  private nexus: NexusStatus | undefined;

  constructor(
    private options: {
      enabled: boolean;
      backend: () => BackendApi;
      settings: SettingsService;
      publicKey: string;
      bridge: ToolPin;
      wabbajack: ToolPin;
      maxArchiveBytes: number;
      toolsDir: string;
      cacheDir: string;
      emit: (state: InstallState) => void;
      openAuth: (url: string) => Promise<void>;
      manualDownload: (
        event: BridgeEvent,
        signal: AbortSignal,
      ) => Promise<string>;
      log: AppLogger;
    },
  ) {}

  root() {
    const server = this.options.settings.activeServer();
    const skyrim = this.options.settings.store.get("skyrimPath");
    if (!server || !skyrim) return "";
    const configured = this.options.settings.modpackPath(server.key);
    return configured || suggestedModpackRoot(skyrim, server.key);
  }

  runtimeRoot() {
    const root = this.root();
    return root ? path.join(root, "mods", "Frostfall Runtime") : "";
  }

  private receipt(key: string): Receipt | null {
    const receipts = this.options.settings.store.get(
      "modpackReceipts",
    ) as Record<string, Receipt>;
    return receipts[key] || null;
  }

  private saveReceipt(key: string, receipt: Receipt) {
    const receipts = this.options.settings.store.get("modpackReceipts");
    this.options.settings.store.set("modpackReceipts", {
      ...receipts,
      [key]: receipt,
    });
  }

  private validateManifest(manifest: ModpackManifest, key: string) {
    if (!verifyManifestSignature(manifest, this.options.publicKey))
      throw new Error("Modpack manifest signature is invalid.");
    if (manifest.serverKey !== key)
      throw new Error("Modpack manifest belongs to a different server.");
    if (manifest.archive.size > this.options.maxArchiveBytes)
      throw new Error("Modpack archive exceeds the launcher size limit.");
  }

  async status(): Promise<ModpackStatus> {
    const server = this.options.settings.activeServer();
    const root = this.root();
    const receipt = server ? this.receipt(server.key) : null;
    let availableVersion: string | undefined;
    try {
      if (server)
        availableVersion = (
          await this.options.backend().modpackManifest(server.key)
        ).version;
    } catch {
      /* reflected by preflight */
    }
    return {
      configured: this.options.enabled,
      installed: Boolean(
        receipt && fs.existsSync(path.join(root, "ModOrganizer.exe")),
      ),
      currentVersion: receipt?.version,
      availableVersion,
      root,
      nexus: this.nexus,
    };
  }

  async preflight(): Promise<PreflightReport> {
    const checks: PreflightReport["checks"] = [];
    const server = this.options.settings.activeServer();
    const skyrim = this.options.settings.store.get("skyrimPath");
    if (!this.options.enabled)
      checks.push({
        id: "modpack-config",
        status: "error",
        message: "MO2 modpack support is not enabled in this launcher build.",
      });
    if (process.platform !== "win32")
      checks.push({
        id: "platform",
        status: "error",
        message: "MO2 gameplay is supported on Windows 10/11 only.",
      });
    if (!server || !skyrim) {
      checks.push({
        id: "modpack",
        status: "error",
        message: "Skyrim path and server are required.",
      });
      return this.report(checks, 0, false);
    }

    let manifest: ModpackManifest;
    try {
      manifest = await this.options.backend().modpackManifest(server.key);
      this.validateManifest(manifest, server.key);
      checks.push({
        id: "modpack-manifest",
        status: "ok",
        message: `Signed modpack ${manifest.version} is published.`,
      });
    } catch (error) {
      checks.push({
        id: "modpack-manifest",
        status: "error",
        message: `Current signed modpack is unavailable: ${(error as Error).message}`,
      });
      return this.report(checks, 0, true);
    }

    const gameExe = path.join(skyrim, manifest.steam.executable);
    const gameHash = fs.existsSync(gameExe) ? await sha256File(gameExe) : "";
    checks.push(
      gameHash === manifest.steam.sha256.toLowerCase()
        ? {
            id: "steam-build",
            status: "ok",
            message: `Steam build ${manifest.steam.version} verified.`,
          }
        : {
            id: "steam-build",
            status: "error",
            message: `Skyrim build does not match required version ${manifest.steam.version}.`,
          },
    );

    const root = assertManagedRoot(this.root(), skyrim, server.key);
    const receipt = this.receipt(server.key);
    if (
      !receipt ||
      receipt.version !== manifest.version ||
      receipt.archiveSha256 !== manifest.archive.sha256 ||
      path.resolve(receipt.root) !== root
    ) {
      checks.push({
        id: "modpack-version",
        status: "repairable",
        message: receipt
          ? `Modpack ${manifest.version} is a required update.`
          : "The server modpack is not installed.",
      });
      return this.report(checks, manifest.archive.size, false);
    }
    for (const required of [
      "ModOrganizer.exe",
      path.join("profiles", manifest.profile, "modlist.txt"),
      path.join("profiles", manifest.profile, "plugins.txt"),
      path.join("profiles", manifest.profile, "loadorder.txt"),
    ])
      if (!fs.existsSync(path.join(root, required)))
        checks.push({
          id: "modpack-files",
          status: "repairable",
          message: `Managed MO2 file is missing: ${required}`,
        });

    if (!checks.some((check) => check.status === "repairable")) {
      try {
        const result = await this.getBridge().verify({
          modlist: this.modlistPath(server.key, manifest.version),
          output: root,
          profile: manifest.profile,
          executable: manifest.executable,
          strict: true,
        });
        checks.push(
          result.valid
            ? {
                id: "modpack-integrity",
                status: "ok",
                message:
                  "MO2 profile, load order, Stock Game and deterministic files are verified.",
              }
            : {
                id: "modpack-integrity",
                status: "repairable",
                message:
                  result.problems?.[0] || "Managed modpack files were changed.",
              },
        );
      } catch (error) {
        checks.push({
          id: "modpack-integrity",
          status: "repairable",
          message: `Modpack verification failed: ${(error as Error).message}`,
        });
      }
    }
    return this.report(checks, manifest.archive.size, false);
  }

  private report(
    checks: PreflightReport["checks"],
    downloadBytes: number,
    offline: boolean,
  ) {
    const repairable =
      !offline && checks.some((check) => check.status === "repairable");
    return {
      ready: !checks.some(
        (check) => check.status === "error" || check.status === "repairable",
      ),
      repairable,
      downloadBytes,
      offline,
      checks,
    };
  }

  async login() {
    await this.ensureTools(new AbortController().signal);
    this.nexus = await this.getBridge().authLogin();
    return this.nexus;
  }

  async install() {
    if (this.controller)
      throw new Error("Another modpack operation is running.");
    const server = this.options.settings.activeServer();
    const skyrim = this.options.settings.store.get("skyrimPath");
    if (!server || !skyrim)
      throw new Error("Skyrim path and server are required.");
    const root = assertManagedRoot(this.root(), skyrim, server.key);
    this.options.settings.setModpackPath(server.key, root);
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const manifest = await this.options
        .backend()
        .modpackManifest(server.key, signal);
      this.validateManifest(manifest, server.key);
      await this.ensureFreeSpace(root, manifest.requiredFreeBytes);
      await this.ensureTools(signal);
      const modlist = this.modlistPath(server.key, manifest.version);
      await fs.promises.mkdir(path.dirname(modlist), { recursive: true });
      await this.download(
        this.options.backend().modpackDownloadUrl(server.key),
        modlist,
        manifest.archive,
        signal,
      );
      this.options.emit({
        phase: "verifying",
        message: "Verifying signed Wabbajack modlist…",
        canCancel: true,
      });
      if ((await sha256File(modlist)) !== manifest.archive.sha256.toLowerCase())
        throw new Error(
          "Downloaded Wabbajack hash does not match the signed manifest.",
        );
      this.options.emit({
        phase: "authenticating",
        message: "Checking Nexus account…",
        canCancel: true,
      });
      this.nexus = await this.getBridge().authStatus();
      if (!this.nexus.authenticated)
        this.nexus = await this.getBridge().authLogin();
      this.options.emit({
        phase: "installing-modpack",
        message: this.nexus.premium
          ? "Installing automatically with Nexus Premium…"
          : "Installing with guided Nexus downloads…",
        canCancel: true,
      });
      await this.getBridge().install({
        modlist,
        output: root,
        downloads: path.join(this.options.cacheDir, "nexus"),
        game: skyrim,
        profile: manifest.profile,
        executable: manifest.executable,
        stockGame: true,
      });
      const verified = await this.getBridge().verify({
        modlist,
        output: root,
        profile: manifest.profile,
        executable: manifest.executable,
        strict: true,
      });
      if (!verified.valid)
        throw new Error(
          verified.problems?.join("; ") ||
            "Installed modpack did not pass verification.",
        );
      this.saveReceipt(server.key, {
        version: manifest.version,
        archiveSha256: manifest.archive.sha256,
        root,
        verifiedAt: new Date().toISOString(),
      });
      this.options.emit({
        phase: "complete",
        message: "MO2 modpack installed and verified.",
      });
    } catch (error) {
      this.options.emit({
        phase: signal.aborted ? "cancelled" : "error",
        message: signal.aborted
          ? "Modpack installation cancelled."
          : (error as Error).message,
        canRetry: true,
      });
      throw error;
    } finally {
      this.controller = null;
    }
  }

  async cancel() {
    if (!this.controller) return false;
    this.controller.abort();
    await this.bridge?.cancel().catch(() => false);
    return true;
  }

  close() {
    this.bridge?.close();
    this.bridge = null;
  }

  private modlistPath(key: string, version: string) {
    return path.join(
      this.options.cacheDir,
      "modlists",
      `${key}-${version}.wabbajack`,
    );
  }
  private bridgePath() {
    return path.join(
      this.options.toolsDir,
      `bridge-${this.options.bridge.version}.exe`,
    );
  }
  private wabbajackPath() {
    return path.join(
      this.options.toolsDir,
      `wabbajack-${this.options.wabbajack.version}.exe`,
    );
  }
  private getBridge() {
    return (this.bridge ||= new InstallerBridge(
      this.bridgePath(),
      this.wabbajackPath(),
      async (event) => {
        if (event.event === "progress")
          this.options.emit({
            phase: "installing-modpack",
            message: event.message || "Installing modpack…",
            percent: event.percent,
            canCancel: true,
          });
        if (event.event === "premiumStatus" && event.result)
          this.nexus = event.result as NexusStatus;
        if (event.event === "authRequired" && event.url) {
          const target = new URL(event.url);
          if (
            target.protocol !== "https:" ||
            !(
              target.hostname === "nexusmods.com" ||
              target.hostname.endsWith(".nexusmods.com")
            )
          )
            throw new Error(
              "Bridge supplied an invalid Nexus authentication URL.",
            );
          await this.options.openAuth(target.href);
        }
        if (event.event === "manualDownload") {
          this.options.emit({
            phase: "manual-download",
            message:
              event.message ||
              `Download ${event.fileName || "the next Nexus file"}.`,
            canCancel: true,
          });
          const file = await this.options.manualDownload(
            event,
            this.controller?.signal || new AbortController().signal,
          );
          await this.bridge!.respondToManualDownload(event.id || "", file);
        }
      },
    ));
  }

  private async ensureTools(signal: AbortSignal) {
    await fs.promises.mkdir(this.options.toolsDir, { recursive: true });
    for (const [pin, target] of [
      [this.options.bridge, this.bridgePath()],
      [this.options.wabbajack, this.wabbajackPath()],
    ] as const) {
      if (!/^[a-f0-9]{64}$/i.test(pin.sha256))
        throw new Error(`${pin.version} tool SHA-256 is not configured.`);
      if (
        !fs.existsSync(target) ||
        (await sha256File(target)) !== pin.sha256.toLowerCase()
      ) {
        await this.download(
          pin.url,
          `${target}.part`,
          { size: 1024 * 1024 * 1024, sha256: pin.sha256 },
          signal,
          false,
        );
        if ((await sha256File(`${target}.part`)) !== pin.sha256.toLowerCase())
          throw new Error(
            `Pinned tool ${pin.version} failed SHA-256 verification.`,
          );
        await fs.promises.rm(target, { force: true });
        await fs.promises.rename(`${target}.part`, target);
      }
    }
  }

  private async ensureFreeSpace(root: string, required: number) {
    const probe = fs.existsSync(root) ? root : path.parse(root).root;
    const stats = await fs.promises.statfs(probe);
    if (Number(stats.bavail) * Number(stats.bsize) < required)
      throw new Error(
        `Not enough free space. ${Math.ceil(required / 1024 ** 3)} GiB are required.`,
      );
  }

  private async download(
    url: string,
    filename: string,
    artifact: { size: number; sha256: string; etag?: string },
    signal: AbortSignal,
    exactSize = true,
    redirects = 0,
  ): Promise<void> {
    if (redirects > 5) throw new Error("Too many download redirects.");
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")
    )
      throw new Error("Downloads require HTTPS.");
    await fs.promises.mkdir(path.dirname(filename), { recursive: true });
    const existing = fs.existsSync(filename)
      ? (await fs.promises.stat(filename)).size
      : 0;
    if (
      exactSize &&
      existing === artifact.size &&
      (await sha256File(filename)) === artifact.sha256.toLowerCase()
    )
      return;
    const offset = exactSize && existing < artifact.size ? existing : 0;
    const headers: Record<string, string> = offset
      ? { Range: `bytes=${offset}-` }
      : {};
    if (offset && artifact.etag) headers["If-Range"] = artifact.etag;
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
            if (!response.headers.location)
              return reject(new Error("Download redirect has no location."));
            return this.download(
              new URL(response.headers.location, parsed).href,
              filename,
              artifact,
              signal,
              exactSize,
              redirects + 1,
            ).then(resolve, reject);
          }
          if (response.statusCode !== 200 && response.statusCode !== 206) {
            response.resume();
            return reject(
              new Error(`Download failed with HTTP ${response.statusCode}.`),
            );
          }
          if (
            artifact.etag &&
            response.headers.etag &&
            artifact.etag !== response.headers.etag
          ) {
            response.resume();
            return reject(
              new Error("Download ETag does not match the signed manifest."),
            );
          }
          const append = offset > 0 && response.statusCode === 206;
          let received = append ? offset : 0;
          response.on("data", (chunk) => {
            received += chunk.length;
            if (
              received > artifact.size ||
              received > this.options.maxArchiveBytes
            )
              request.destroy(
                new Error("Download exceeds its configured size limit."),
              );
            else
              this.options.emit({
                phase: "downloading",
                message: "Downloading modpack files…",
                receivedBytes: received,
                totalBytes: exactSize ? artifact.size : undefined,
                percent: exactSize
                  ? Math.round((received / artifact.size) * 100)
                  : undefined,
                canCancel: true,
              });
          });
          try {
            await pipeline(
              response,
              fs.createWriteStream(filename, { flags: append ? "a" : "w" }),
              { signal },
            );
            if (exactSize && received !== artifact.size)
              throw new Error("Downloaded file size is incomplete.");
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
}
