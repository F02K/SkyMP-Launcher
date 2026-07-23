import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { decodeBridgeLine } from "../../src/app/bridge.js";
import {
  canonicalize,
  manifestPayload,
  verifyManifestSignature,
} from "../../src/app/manifest.js";
import {
  assertManagedRoot,
  suggestedModpackRoot,
} from "../../src/app/modpack.js";
import { modpackManifestSchema } from "../../src/app/schemas.js";
import type { ModpackManifest } from "../../src/app/types.js";

function createManifest() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const manifest: ModpackManifest = {
    schemaVersion: 1,
    serverKey: "eu",
    version: "2026.07.1",
    steam: {
      appId: 489830,
      executable: "SkyrimSE.exe",
      version: "1.6.1170.0",
      sha256: "a".repeat(64),
    },
    archive: { size: 123, sha256: "b".repeat(64), etag: "immutable" },
    requiredFreeBytes: 456,
    profile: "Frostfall",
    executable: "SKSE",
    stockGame: true,
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

test("modpack manifests lock the server, Steam build and MO2 entry point", () => {
  const { manifest, publicKey } = createManifest();
  assert.deepEqual(modpackManifestSchema.parse(manifest), manifest);
  assert.equal(verifyManifestSignature(manifest, publicKey), true);
  manifest.profile = "Frostfall";
  manifest.steam.sha256 = "c".repeat(64);
  assert.equal(verifyManifestSignature(manifest, publicKey), false);
  assert.throws(
    () =>
      modpackManifestSchema.parse({ ...manifest, executable: "arbitrary.exe" }),
    /Invalid input/,
  );
});

test("managed locations stay outside Steam and end in the server key", () => {
  const skyrim = "D:\\SteamLibrary\\steamapps\\common\\Skyrim Special Edition";
  assert.equal(
    suggestedModpackRoot(skyrim, "eu"),
    path.join("D:\\", "Frostfall", "servers", "eu"),
  );
  assert.equal(
    assertManagedRoot("D:\\Frostfall\\servers\\eu", skyrim, "eu"),
    path.resolve("D:\\Frostfall\\servers\\eu"),
  );
  assert.throws(
    () => assertManagedRoot(`${skyrim}\\eu`, skyrim, "eu"),
    /Steam/,
  );
  assert.throws(
    () => assertManagedRoot("D:\\Frostfall\\servers\\other", skyrim, "eu"),
    /server key/,
  );
  assert.throws(() => assertManagedRoot("..\\eu", skyrim, "eu"), /absolute/);
});

test("bridge JSONL accepts only the documented event set", () => {
  assert.deepEqual(
    decodeBridgeLine('{"id":"1","event":"progress","percent":50}'),
    {
      id: "1",
      event: "progress",
      percent: 50,
    },
  );
  assert.throws(() => decodeBridgeLine('{"event":"shell"}'), /Unknown/);
  assert.throws(() => decodeBridgeLine("not json"));
});
