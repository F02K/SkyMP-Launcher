# SkyMP Launcher

A customizable Electron launcher template for SkyMP multiplayer servers. It
handles server discovery, Discord authentication, SkyMP client files, optional
server-bound portable MO2 modpacks, SKSE startup, and automatic launcher updates.

The launcher uses signed client manifests, resumable transactional repairs,
server-scoped dashboards, encrypted credentials, first-run onboarding,
English/German UI, keyboard accessibility, local diagnostics, and a
TypeScript/esbuild application architecture.

The repository runs with a neutral SkyMP identity by default. Operators should
change one configuration file and replace the assets before publishing their
own build.

## Requirements

- Node.js 22 or newer
- A compatible SkyMP Directory and managed operator backend
- Windows 10/11 for the supported Skyrim/MO2 gameplay path

```powershell
npm install
npm start
```

Use `npm run dev` to load `.env`, open DevTools, and disable automatic launcher
updates. Self-hosted builds can override the mandatory Directory:

```env
DIRECTORY_URL=http://localhost:4000
DIRECTORY_PUBLIC_KEY=BASE64_SPKI_PUBLIC_KEY
```

The launcher uses the official SkyMP Directory at `https://skyservers.online`
by default. Every catalog or private-join response is verified with its pinned
Ed25519 key before a server address or operator backend URL is accepted:

```json
{
  "directory": {
    "url": "https://skyservers.online",
    "publicKey": "BASE64_SPKI_PUBLIC_KEY",
    "filters": { "region": "eu-central" }
  }
}
```

Self-hosted builds must replace both `directory.url` and `directory.publicKey`.
For local deployments the same values can be supplied as `DIRECTORY_URL` and
`DIRECTORY_PUBLIC_KEY`. Direct backend discovery is intentionally unsupported.
`skymp://join/<code>` links add a signed private Directory result to the local
server list.

Portable MO2 support is fail-closed until the separately released GPL bridge
and Wabbajack artifacts are pinned. Set `modpack.enabled` to `true` only after
filling both non-zero SHA-256 values in `launcher.config.json`. Wabbajack is
locked to `4.2.1.4`; a server manifest cannot override either executable.
The complete backend and JSONL bridge contract is documented in
[`docs/modpack-backend-contract.md`](docs/modpack-backend-contract.md).

## Customize a fork

Edit `launcher.config.json`:

```json
{
  "app": {
    "appId": "com.example.my-skymp-launcher",
    "productName": "My Server Launcher",
    "shortName": "My Server",
    "description": "Launcher for My Server"
  },
  "directory": {
    "url": "https://directory.example.com",
    "publicKey": "BASE64_SPKI_PUBLIC_KEY",
    "filters": {}
  },
  "links": {
    "website": "https://example.com",
    "discord": "https://discord.gg/example",
    "news": "https://example.com/news"
  },
  "branding": {
    "emblem": "M",
    "tagline": "SkyMP Multiplayer",
    "background": "assets/background.gif",
    "icons": {
      "windows": "assets/icon.ico",
      "linux": "assets/icon.png",
      "mac": "assets/icon.png"
    }
  },
  "updates": {
    "provider": "generic",
    "url": "https://api.example.com/launcher-updates",
    "checkIntervalMinutes": 240
  },
  "security": {
    "clientManifestPublicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
    "externalHosts": ["example.com", "www.nexusmods.com"]
  },
  "behavior": {
    "defaultLocale": "en",
    "maxClientPackageBytes": 2147483648
  }
}
```

`appId` is the permanent identity of an installed application. Do not change it
after releasing a fork, or users will receive a separate installation and a new
settings directory. Forks should never reuse the default app ID.

Replace `assets/background.gif`, `assets/icon.ico`, and `assets/icon.png` with
your branding, keeping the configured paths valid. Empty website or Discord
links are hidden automatically. Run `npm run validate:config` before building.

Replace the example manifest key with the public half of the operator's
Ed25519 release key. Keep the private key only in the backend release
environment. See [`docs/backend-launcher.md`](docs/backend-launcher.md)
for the complete backend contract.

## Launcher updates

Installed NSIS and AppImage builds check at startup and every four hours. A new
version downloads in the background, reports progress in the footer, and is
installed either through **Restart to update** or when the launcher normally
quits. Development builds and Linux DEB packages do not self-update.

### Generic HTTPS/backend provider

The default configuration reads updates from:

```text
https://api.frostfall.online/launcher-updates
```

Set `updates.provider` to `generic` and `updates.url` to the public directory
that contains the generated installer/AppImage and metadata files. With the
companion backend, publish a completed launcher `dist` directory using:

```powershell
npm run publish-launcher -- E:\path\to\Frostfall-Launcher\dist
```

Run this command in the backend repository. It validates `latest.yml`,
`latest-linux.yml`, referenced files, and SHA-512 hashes before atomically
replacing the public feed.

### Public GitHub Releases provider

For public repositories, configure:

```json
{
  "updates": {
    "provider": "github",
    "owner": "your-account",
    "repo": "your-launcher",
    "checkIntervalMinutes": 240
  }
}
```

The release validator rejects a GitHub update repository that differs from the
repository running the build. Releases in private GitHub repositories are not
publicly downloadable; use a generic public backend feed instead of embedding a
GitHub token in the client. Set the provider to `disabled` when a build should
not check for updates.

## Build and release

```powershell
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run validate:config
npm run build:win
npm run build:linux
```

Windows produces an NSIS installer and `latest.yml`. Linux produces AppImage,
DEB, and `latest-linux.yml`. The AppImage self-updates; DEB upgrades remain the
responsibility of the package manager.

Pushing a tag matching the package version creates a non-draft GitHub Release:

```powershell
npm version 1.2.0
git push --follow-tags
```

The workflow validates the configuration, runs tests, builds both platforms,
and attaches installers, blockmaps, and update metadata. Standard
`electron-builder` signing environment variables can be provided through CI
secrets for production code signing.

## Backend contract

The launcher discovers servers exclusively through the pinned Directory. After
validating a signed `directory-managed` descriptor, it uses the operator
backend's fixed `/api` root:

| Method | Path                                          | Purpose                         |
| ------ | --------------------------------------------- | ------------------------------- |
| GET    | `/api/launcher/servers/:key/status`           | Online state and player count   |
| GET    | `/api/launcher/servers/:key`                  | Auth, lock, and server metadata |
| GET    | `/api/launcher/servers/:key/news`             | Optional news cards             |
| GET    | `/api/launcher/servers/:key/mods`             | Optional published mod list     |
| GET    | `/api/launcher/servers/:key/metrics`          | Optional server statistics      |
| GET    | `/api/launcher/servers/:key/client/manifest`  | Signed client manifest          |
| GET    | `/api/launcher/servers/:key/client/download`  | Resumable client bundle         |
| GET    | `/api/launcher/servers/:key/modpack/manifest` | Signed required MO2 modpack     |
| GET    | `/api/launcher/servers/:key/modpack/download` | Resumable `.wabbajack` file     |
| POST   | `/api/auth/directory/exchange`                | Exchange a Directory play grant |
| GET    | `/launcher-updates/*`                         | Generic launcher update feed    |

Global Discord login and play grants use the Directory. There are no aliases,
redirects, direct-backend catalog routes, or compatibility fallbacks.

## Project structure

```text
launcher.config.json       Identity, Directory key, branding, updates
electron-builder.config.js Packaging and update-provider configuration
scripts/                   Build and configuration validation
src/app/                   Active Launcher 2 TypeScript application
src/app/modpack.ts         Managed MO2/Wabbajack installation and verification
src/renderer/              HTML and CSS presentation
test/app/                  Launcher application unit tests
test/*.test.js             Configuration validation tests
e2e/                       Playwright Electron and accessibility tests
docs/                      Backend contract documentation
assets/                    Replaceable background and icons
```

The launcher remains deliberately SkyMP-specific: required client paths, SKSE,
Skyrim Special Edition, and managed MO2 behavior are shared template functionality,
while project identity and distribution are configurable.
