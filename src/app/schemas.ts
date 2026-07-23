import { z } from "zod";

export const serverSchema = z
  .object({
    key: z.string().min(1).max(100),
    contract: z.literal("directory-managed"),
    name: z.string().min(1).max(120),
    address: z.string().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535),
    backendUrl: z.string().url().optional(),
    description: z.string().max(2000).default(""),
    region: z.string().max(100).default(""),
    tags: z.array(z.string().max(100)).max(50).default([]),
    versions: z.record(z.string(), z.string()).default({}),
    visibility: z.enum(["public", "private"]).default("public"),
    status: z
      .object({
        state: z.string(),
        online: z.coerce.number().int().nonnegative(),
        maxPlayers: z.coerce.number().int().positive(),
      })
      .default({ state: "offline", online: 0, maxPlayers: 1 }),
    lastHeartbeatAt: z.coerce.number().nonnegative().default(0),
    source: z.enum(["directory", "private"]).default("directory"),
    stale: z.boolean().default(false),
    listed: z.boolean().default(true),
    access: z
      .object({
        discordGuild: z
          .object({
            required: z.boolean(),
            guildId: z.string().optional(),
            inviteUrl: z.string().url().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

export const manifestFileSchema = z.object({
  path: z.string().min(1).max(500),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
});

export const clientManifestSchema = z.object({
  schemaVersion: z.literal(1),
  serverKey: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  archive: z.object({
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    etag: z.string().max(300).optional(),
  }),
  files: z.array(manifestFileSchema).min(1).max(10000),
  signature: z.object({
    algorithm: z.literal("ed25519"),
    value: z.string().min(40),
  }),
});

export const modpackManifestSchema = z.object({
  schemaVersion: z.literal(1),
  serverKey: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._-]+$/),
  version: z.string().min(1).max(100),
  steam: z.object({
    appId: z.literal(489830),
    executable: z.literal("SkyrimSE.exe"),
    version: z.string().min(1).max(100),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  archive: z.object({
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    etag: z.string().max(300).optional(),
  }),
  requiredFreeBytes: z.number().int().positive(),
  profile: z.literal("Frostfall"),
  executable: z.literal("SKSE"),
  stockGame: z.literal(true),
  signature: z.object({
    algorithm: z.literal("ed25519"),
    value: z.string().min(40),
  }),
});

export const settingsPatchSchema = z
  .object({
    skyrimPath: z.string().max(500).optional(),
    activeServerKey: z.string().max(100).optional(),
    locale: z.enum(["en", "de"]).optional(),
    onboardingVersion: z.number().int().min(0).max(100).optional(),
    launchAtLogin: z.boolean().optional(),
    closeBehavior: z.enum(["exit", "tray"]).optional(),
    afterLaunch: z.enum(["keep", "minimize", "close"]).optional(),
    reduceMotion: z.boolean().optional(),
  })
  .strict();

export const serverKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);
export const externalUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === "https:", "HTTPS required");
