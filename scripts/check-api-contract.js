const fs = require("node:fs");
const path = require("node:path");

const roots = [
  "src/app",
  "src/renderer",
  "docs",
  "README.md",
  "launcher.config.json",
  "launcher.config.schema.json",
];
const forbidden = [
  { label: "/api/v2", pattern: /\/api\/v2\b/ },
  { label: "/v1", pattern: /\/v1\b/ },
  { label: "/v2", pattern: /\/v2\b/ },
  { label: "API_URL", pattern: /\bAPI_URL\b/ },
  { label: "DIRECTORY_ENABLED", pattern: /\bDIRECTORY_ENABLED\b/ },
  { label: "apiBasePath", pattern: /\bapiBasePath\b/ },
  { label: "scopedOrLegacy", pattern: /\bscopedOrLegacy\b/ },
  { label: "X-Session", pattern: /\bx-session\b/i },
];
const sourceExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".ts",
]);

function filesAt(value) {
  const stat = fs.statSync(value);
  if (stat.isFile()) return [value];
  return fs
    .readdirSync(value, { withFileTypes: true })
    .flatMap((entry) => filesAt(path.join(value, entry.name)));
}

const violations = roots
  .flatMap(filesAt)
  .filter((file) => sourceExtensions.has(path.extname(file)))
  .flatMap((file) => {
    const content = fs.readFileSync(file, "utf8");
    return forbidden
      .filter(({ pattern }) => pattern.test(content))
      .map(({ label }) => `${file}: contains forbidden HTTP route ${label}`);
  });

if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Active Launcher sources use only the unversioned /api contract.",
  );
}
