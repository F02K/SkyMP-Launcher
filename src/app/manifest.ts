import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ClientManifest, ModpackManifest } from "./types.js";

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

type SignedManifest = ClientManifest | ModpackManifest;

export function manifestPayload(manifest: SignedManifest) {
  const payload: Partial<SignedManifest> = { ...manifest };
  delete payload.signature;
  return payload;
}

export function verifyManifestSignature(
  manifest: SignedManifest,
  publicKey: string,
): boolean {
  try {
    return crypto.verify(
      null,
      Buffer.from(canonicalize(manifestPayload(manifest))),
      publicKey,
      Buffer.from(manifest.signature.value, "base64"),
    );
  } catch {
    return false;
  }
}

export function safeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0")
  )
    throw new Error(`Unsafe archive path: ${value}`);
  const clean = path.posix.normalize(normalized);
  if (clean === ".." || clean.startsWith("../"))
    throw new Error(`Archive path escapes destination: ${value}`);
  return clean;
}

export function pathInside(root: string, relative: string): string {
  const safe = safeRelativePath(relative);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...safe.split("/"));
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  )
    throw new Error(`Path escapes destination: ${relative}`);
  return resolved;
}

export async function sha256File(filename: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(filename);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}
