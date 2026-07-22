# SkyMP Launcher

A customizable Electron launcher template for SkyMP multiplayer servers. It
handles server discovery, Discord authentication, SkyMP client files, optional
Vortex integration, SKSE startup, and automatic launcher updates.

The repository runs with a neutral SkyMP identity by default. Operators should
change one configuration file and replace the assets before publishing their
own build.

## Requirements

- Node.js 22 or newer
- A compatible launcher backend, such as
  [Frostfall-Backend](https://github.com/F02K/Frostfall-Backend)
- Windows for the supported Skyrim/Vortex gameplay path

```powershell
npm install
npm start
```

Use `npm run dev` to load `.env`, open DevTools, and disable automatic launcher
updates. `API_URL` remains available as a local override:

```env
API_URL=http://localhost:4000
```

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
  "backend": { "apiUrl": "https://api.example.com" },
  "links": {
    "website": "https://example.com",
    "discord": "https://discord.gg/example"
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
  }
}
```

`appId` is the permanent identity of an installed application. Do not change it
after releasing a fork, or users will receive a separate installation and a new
settings directory. Forks should never reuse the default app ID.

Replace `assets/background.gif`, `assets/icon.ico`, and `assets/icon.png` with
your branding, keeping the configured paths valid. Empty website or Discord
links are hidden automatically. Run `npm run validate:config` before building.

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

The launcher uses a central API client rooted at the configurable `backend.apiBasePath` (default `/api/v2`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v2/launcher/servers` | Server list |
| GET | `/api/v2/launcher/status` | Online state and player count |
| GET | `/api/v2/launcher/servers/default` | Auth, lock, and server metadata |
| GET | `/api/v2/launcher/news` | News cards |
| GET | `/api/v2/launcher/mods` | Backend/Nexus mod list |
| GET | `/api/v2/launcher/metrics` | Server statistics |
| GET | `/api/v2/launcher/client/version` | SkyMP client-file version |
| GET | `/api/v2/launcher/client/download` | SkyMP client-file bundle |
| GET | `/api/v2/auth/discord/*` | Discord login flow |
| GET | `/launcher-updates/*` | Generic launcher update feed |

`/api/version` remains a compatibility endpoint for Launcher 1.1.1 and older.
It is not used by the new updater.

## Project structure

```text
launcher.config.json       Project identity, branding, backend, updates
electron-builder.config.js Packaging and update-provider configuration
scripts/                   Configuration/release validation
src/main.js                Electron window, IPC, auth, install, launch
src/updater.js             Automatic updater state machine
src/preload.js             Context-isolated renderer bridge
src/vortex.js              Vortex detection and profile integration
src/renderer/              HTML, CSS, and renderer behavior
test/                      Node unit tests
assets/                    Replaceable background and icons
```

The launcher remains deliberately SkyMP-specific: required client paths, SKSE,
Skyrim Special Edition, and Vortex behavior are shared template functionality,
while project identity and distribution are configurable.
