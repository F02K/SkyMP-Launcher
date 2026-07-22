import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { InstallerService } from "../../src/app/installer.js";
import { canonicalize, manifestPayload } from "../../src/app/manifest.js";
import type { ClientManifest } from "../../src/app/types.js";

test("repair resumes a partial package and installs verified files", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "frostfall-installer-"));
  const root = path.join(temp, "game");
  const downloads = path.join(temp, "downloads");
  fs.mkdirSync(root);
  fs.mkdirSync(downloads);
  const zip = new AdmZip();
  zip.addFile("Data/example.txt", Buffer.from("verified content"));
  const archive = zip.toBuffer();
  const archiveHash = crypto.createHash("sha256").update(archive).digest("hex");
  const fileHash = crypto
    .createHash("sha256")
    .update("verified content")
    .digest("hex");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const manifest: ClientManifest = {
    schemaVersion: 1,
    serverKey: "eu",
    version: "2.0.0",
    archive: { size: archive.length, sha256: archiveHash, etag: "test" },
    files: [{ path: "Data/example.txt", size: 16, sha256: fileHash }],
    signature: { algorithm: "ed25519", value: "" },
  };
  manifest.signature.value = crypto
    .sign(
      null,
      Buffer.from(canonicalize(manifestPayload(manifest))),
      privateKey,
    )
    .toString("base64");
  let range = "";
  const server = http.createServer((req, res) => {
    range = String(req.headers.range || "");
    const offset = range ? Number(range.match(/bytes=(\d+)/)?.[1] || 0) : 0;
    res.statusCode = offset ? 206 : 200;
    res.setHeader("content-length", archive.length - offset);
    res.end(archive.subarray(offset));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(
    path.join(downloads, "eu-2.0.0.zip.part"),
    archive.subarray(0, 10),
  );
  const data: any = { skyrimPath: root, installedManifests: {} };
  const store = {
    get: (key: string) => data[key],
    set: (key: string, value: any) => {
      data[key] = value;
    },
  };
  const settings: any = {
    store,
    activeServer: () => ({
      key: "eu",
      name: "EU",
      address: "localhost",
      port: 1,
    }),
  };
  const backend: any = {
    manifest: async () => manifest,
    clientDownloadUrl: () =>
      `http://127.0.0.1:${(server.address() as any).port}/client.zip`,
  };
  const installer = new InstallerService({
    backend,
    settings,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    maxBytes: 1024 * 1024,
    downloadsDir: downloads,
    emit: () => {},
    log: { error() {}, warn() {}, info() {} } as any,
  });
  try {
    await installer.repair();
    assert.equal(range, "bytes=10-");
    assert.equal(
      fs.readFileSync(path.join(root, "Data", "example.txt"), "utf8"),
      "verified content",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("a failed commit restores every replaced file", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "frostfall-rollback-"));
  const root = path.join(temp, "game");
  fs.mkdirSync(path.join(root, "Data"), { recursive: true });
  fs.writeFileSync(path.join(root, "Data", "a.txt"), "old-a");
  fs.writeFileSync(path.join(root, "Data", "b.txt"), "old-b");
  const zip = new AdmZip();
  zip.addFile("Data/a.txt", Buffer.from("new-a"));
  zip.addFile("Data/b.txt", Buffer.from("new-b"));
  const archive = path.join(temp, "client.zip");
  zip.writeZip(archive);
  const hash = (value: string) =>
    crypto.createHash("sha256").update(value).digest("hex");
  const manifest: ClientManifest = {
    schemaVersion: 1,
    serverKey: "eu",
    version: "2",
    archive: { size: fs.statSync(archive).size, sha256: "0".repeat(64) },
    files: [
      { path: "Data/a.txt", size: 5, sha256: hash("new-a") },
      { path: "Data/b.txt", size: 5, sha256: hash("new-b") },
    ],
    signature: { algorithm: "ed25519", value: "unused" },
  };
  const data: any = { installedManifests: {} };
  const settings: any = {
    store: {
      get: (key: string) => data[key],
      set: (key: string, value: any) => (data[key] = value),
    },
  };
  const installer = new InstallerService({
    backend: {} as any,
    settings,
    publicKey: "",
    maxBytes: 1024,
    downloadsDir: temp,
    emit: () => {},
    log: {} as any,
  });
  const originalRename = fs.promises.rename;
  let stageMoves = 0;
  (fs.promises as any).rename = async (source: string, target: string) => {
    if (source.includes(".frostfall-stage-")) {
      stageMoves++;
      if (stageMoves === 2) throw new Error("simulated commit failure");
    }
    return originalRename(source, target);
  };
  try {
    await assert.rejects(
      () =>
        (installer as any).stageAndCommit(
          archive,
          root,
          manifest,
          new AbortController().signal,
        ),
      /simulated/,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "Data", "a.txt"), "utf8"),
      "old-a",
    );
    assert.equal(
      fs.readFileSync(path.join(root, "Data", "b.txt"), "utf8"),
      "old-b",
    );
  } finally {
    (fs.promises as any).rename = originalRename;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
