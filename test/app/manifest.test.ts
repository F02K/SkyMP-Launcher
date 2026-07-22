import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  canonicalize,
  manifestPayload,
  pathInside,
  safeRelativePath,
  verifyManifestSignature,
} from "../../src/app/manifest.js";
import type { ClientManifest } from "../../src/app/types.js";
import { settingsPatchSchema } from "../../src/app/schemas.js";

function signedManifest(): { manifest: ClientManifest; publicKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const manifest: ClientManifest = {
    schemaVersion: 1,
    serverKey: "default",
    version: "2.0.0",
    archive: { size: 3, sha256: "a".repeat(64) },
    files: [{ path: "Data/example.txt", size: 3, sha256: "b".repeat(64) }],
    signature: { algorithm: "ed25519", value: "" },
  };
  manifest.signature.value = crypto
    .sign(
      null,
      Buffer.from(canonicalize(manifestPayload(manifest))),
      privateKey,
    )
    .toString("base64");
  return {
    manifest,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

test("signed manifests use deterministic canonical JSON", () => {
  const { manifest, publicKey } = signedManifest();
  assert.equal(verifyManifestSignature(manifest, publicKey), true);
  manifest.files[0]!.size++;
  assert.equal(verifyManifestSignature(manifest, publicKey), false);
});

test("archive paths cannot escape the installation root", () => {
  assert.equal(safeRelativePath("Data/Plugins/a.dll"), "Data/Plugins/a.dll");
  assert.throws(() => safeRelativePath("../outside.dll"), /escapes/);
  assert.throws(() => safeRelativePath("C:\\outside.dll"), /Unsafe/);
  assert.throws(() => pathInside("C:\\Game", "..\\outside.dll"), /escapes/);
});

test("renderer settings payloads cannot contain secrets", () => {
  assert.throws(() => settingsPatchSchema.parse({ gameSession: "secret" }));
  assert.throws(() => settingsPatchSchema.parse({ nexusApiKey: "secret" }));
  assert.deepEqual(
    settingsPatchSchema.parse({ locale: "de", reduceMotion: true }),
    {
      locale: "de",
      reduceMotion: true,
    },
  );
});
