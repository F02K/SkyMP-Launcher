import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function validSkyrim(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "SkyrimSE.exe")) &&
    fs.existsSync(path.join(candidate, "Data"))
  );
}

function steamLibraries(vdf: string): string[] {
  if (!fs.existsSync(vdf)) return [];
  const text = fs.readFileSync(vdf, "utf8");
  return [...text.matchAll(/"path"\s+"([^"]+)"/g)].map((match) =>
    match[1]!.replace(/\\\\/g, "\\"),
  );
}

export async function detectSkyrim(): Promise<string> {
  const roots = new Set<string>();
  for (const envName of ["ProgramFiles(x86)", "ProgramFiles"]) {
    const root = process.env[envName];
    if (root) roots.add(path.join(root, "Steam"));
  }
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("reg.exe", [
        "query",
        "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
        "/v",
        "InstallPath",
      ]);
      const match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/);
      if (match?.[1]) roots.add(match[1].trim());
    } catch {
      /* Steam may not be installed */
    }
  }
  for (const root of [...roots]) {
    const libraries = [
      root,
      ...steamLibraries(path.join(root, "steamapps", "libraryfolders.vdf")),
    ];
    for (const library of libraries) {
      const candidate = path.join(
        library,
        "steamapps",
        "common",
        "Skyrim Special Edition",
      );
      if (validSkyrim(candidate)) return candidate;
    }
  }
  return "";
}

export function validateSkyrim(candidate: string): boolean {
  return validSkyrim(candidate);
}
