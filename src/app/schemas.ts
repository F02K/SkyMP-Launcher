import { z } from "zod";

export const serverSchema = z
  .object({
    key: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    address: z.string().min(1).max(255),
    port: z.coerce.number().int().min(1).max(65535),
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

export const settingsPatchSchema = z
  .object({
    skyrimPath: z.string().max(500).optional(),
    activeServerKey: z.string().max(100).optional(),
    vortexPath: z.string().max(500).optional(),
    vortexEnabled: z.boolean().optional(),
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
