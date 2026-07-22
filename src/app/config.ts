import rawConfig from "../../launcher.config.json";

const raw: any = rawConfig;
const apiUrl = String(process.env.API_URL || raw.backend.apiUrl).replace(
  /\/$/,
  "",
);

export const config = Object.freeze({
  ...raw,
  backend: {
    ...raw.backend,
    apiUrl,
    apiBasePath: String(raw.backend.apiBasePath || "/api/v2").replace(
      /\/$/,
      "",
    ),
  },
  apiUrl,
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
  },
});

export type LauncherConfig = typeof config;
