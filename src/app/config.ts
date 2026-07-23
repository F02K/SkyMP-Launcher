import rawConfig from "../../launcher.config.json";

const raw: any = rawConfig;
const directoryUrl = String(
  process.env.DIRECTORY_URL ||
    raw.directory?.url ||
    "https://skyservers.online",
).replace(/\/$/, "");
const directoryPublicKey = String(
  process.env.DIRECTORY_PUBLIC_KEY || raw.directory?.publicKey || "",
);

export const config = Object.freeze({
  ...raw,
  directory: {
    url: directoryUrl,
    publicKey: directoryPublicKey,
    filters: { ...(raw.directory?.filters || {}) },
  },
  public: {
    app: { ...raw.app },
    links: { ...raw.links },
    branding: {
      emblem: raw.branding.emblem,
      tagline: raw.branding.tagline,
      background: raw.branding.background,
    },
    updates: { provider: raw.updates.provider },
    behavior: { defaultLocale: raw.behavior.defaultLocale },
    modpack: {
      enabled: Boolean(raw.modpack?.enabled),
      wabbajackVersion: String(raw.modpack?.wabbajack?.version || ""),
    },
  },
});

export type LauncherConfig = typeof config;
