# MO2 modpack backend and bridge contract

## Server endpoints

The selected operator backend exposes these server-scoped endpoints below its
fixed `/api` root:

| Method | Path                                      | Requirements                                                    |
| ------ | ----------------------------------------- | --------------------------------------------------------------- |
| `GET`  | `/launcher/servers/:key/modpack/manifest` | JSON, no redirects, current required version                    |
| `GET`  | `/launcher/servers/:key/modpack/download` | `.wabbajack`, `Range`, `If-Range`, `ETag`, exact content length |

The manifest is canonical-JSON signed with the launcher-pinned Ed25519 key:

```json
{
  "schemaVersion": 1,
  "serverKey": "frostfall",
  "version": "2026.07.1",
  "steam": {
    "appId": 489830,
    "executable": "SkyrimSE.exe",
    "version": "1.6.1170.0",
    "sha256": "64 lowercase hex characters"
  },
  "archive": {
    "size": 123456,
    "sha256": "64 lowercase hex characters",
    "etag": "optional immutable ETag"
  },
  "requiredFreeBytes": 214748364800,
  "profile": "Frostfall",
  "executable": "SKSE",
  "stockGame": true,
  "signature": { "algorithm": "ed25519", "value": "base64 signature" }
}
```

The signature covers every property except `signature`, using recursively
sorted object keys and compact JSON. A manifest cannot choose an installer or
an executable on the client. `/mods` is display-only and must be generated from
the published MO2 profile.

## GPL installer bridge

The separately distributed bridge is pinned in `launcher.config.json`, is
started with `--wabbajack <pinned-executable>`, and exchanges one JSON object per
line on stdin/stdout. Every command has a launcher-generated `id`; terminal
events repeat that `id`.

Commands: `auth.status`, `auth.login`, `inspect`, `install`, `verify`, `cancel`,
and `manualDownload.complete`. Events: `progress`, `manualDownload`,
`authRequired`, `premiumStatus`, `complete`, and `error`.

`verify` must validate Wabbajack's deterministic output set, `modlist.txt`,
`plugins.txt`, `loadorder.txt`, the `Frostfall` executable configuration and the
Stock Game binaries. Saves, logs, downloads, runtime session files and the
contents of `mods/Frostfall Runtime` are excluded. It returns:

```json
{ "id": "7", "event": "complete", "result": { "valid": true, "problems": [] } }
```

For a free Nexus account the bridge emits `manualDownload` with `url`,
`fileName`, `size`, and Wabbajack `sha256`. The launcher accepts HTTPS Nexus
pages only, controls the download destination, validates size and hash, and
then sends `manualDownload.complete`. OAuth tokens never cross this protocol;
the bridge uses Wabbajack/Windows credential storage.
