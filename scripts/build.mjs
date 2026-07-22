import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("app-dist", { recursive: true, force: true });
await mkdir("app-dist/renderer", { recursive: true });
await mkdir("app-dist/renderer/fonts", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/app/main.ts"],
    outfile: "app-dist/main.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    packages: "external",
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/app/preload.ts"],
    outfile: "app-dist/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
  }),
  build({
    entryPoints: ["src/app/renderer.ts"],
    outfile: "app-dist/renderer/renderer.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome130",
    sourcemap: true,
  }),
]);

await Promise.all([
  cp("src/renderer/index.html", "app-dist/renderer/index.html"),
  cp("src/renderer/styles.css", "app-dist/renderer/styles.css"),
  ...[
    "cinzel-latin-500-normal.woff2",
    "cinzel-latin-600-normal.woff2",
    "cinzel-latin-700-normal.woff2",
  ].map((font) =>
    cp(
      `node_modules/@fontsource/cinzel/files/${font}`,
      `app-dist/renderer/fonts/${font}`,
    ),
  ),
  ...[
    "barlow-condensed-latin-400-normal.woff2",
    "barlow-condensed-latin-500-normal.woff2",
    "barlow-condensed-latin-600-normal.woff2",
    "barlow-condensed-latin-700-normal.woff2",
  ].map((font) =>
    cp(
      `node_modules/@fontsource/barlow-condensed/files/${font}`,
      `app-dist/renderer/fonts/${font}`,
    ),
  ),
]);
