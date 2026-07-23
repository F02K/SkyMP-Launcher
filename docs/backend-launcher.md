# Launcher managed-backend contract

The launcher accepts an operator backend URL only from a signed SkyMP Directory
descriptor whose contract is `directory-managed`. It appends the fixed `/api`
root and uses these authenticated-as-needed, server-scoped routes:

| Route                                        | Response                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /launcher/servers/:key`                 | Server metadata and session-aware `allowed` state                                     |
| `GET /launcher/servers/:key/status`          | Online state and player count                                                         |
| `GET /launcher/servers/:key/news`            | `{ items: NewsItem[] }`; items may have an HTTPS `url`                                |
| `GET /launcher/servers/:key/mods`            | `{ items: ModItem[] }`; version, source, required, enabled, Nexus/Collection metadata |
| `GET /launcher/servers/:key/metrics`         | Server metrics                                                                        |
| `GET /launcher/servers/:key/client/manifest` | Signed manifest described below                                                       |
| `GET /launcher/servers/:key/client/download` | ZIP archive with Range and ETag support                                               |
| `POST /auth/directory/exchange`              | Exchange a signed, server-bound Directory play grant for a local session              |

The server detail response reports `authentication: "directory-discord"` and
only advertises capabilities whose modules successfully started and registered
their standard endpoint. Launcher sessions are sent as `Authorization: Bearer
<session>`. Unscoped routes, alternate API roots, redirects, and compatibility
fallbacks are not supported.

## Signed client manifest

```json
{
  "schemaVersion": 1,
  "serverKey": "default",
  "version": "2026.07.22",
  "archive": {
    "size": 123456,
    "sha256": "64 lowercase hex characters",
    "etag": "release-2026.07.22"
  },
  "files": [
    {
      "path": "Data/Platform/Plugins/example.dll",
      "size": 1234,
      "sha256": "64 lowercase hex characters"
    }
  ],
  "signature": { "algorithm": "ed25519", "value": "base64 signature" }
}
```

Sign the UTF-8 bytes of the manifest after removing `signature` and serializing
objects with keys in ascending ordinal order, no insignificant whitespace, JSON
array order preserved, and standard JSON primitive encoding. The release-only
private Ed25519 key must stay outside the web server. Configure its PEM public
key as `security.clientManifestPublicKey` in the launcher.

The ZIP must contain exactly the listed regular files. Directory entries are
optional; absolute paths, parent traversal, symbolic links, duplicate paths and
unlisted files are rejected. The download response must use the signed ETag,
support `Range: bytes=N-`, return 206 for a valid continuation, and expose an
accurate content length.
