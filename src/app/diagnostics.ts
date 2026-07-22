import { app, dialog } from "electron";
import fs from "node:fs";
import os from "node:os";
import AdmZip from "adm-zip";
import type { SettingsService } from "./settings.js";
import type { AppLogger } from "./logger.js";
import type { PreflightReport } from "./types.js";

export async function exportDiagnostics(
  settings: SettingsService,
  log: AppLogger,
  preflight: PreflightReport | null,
) {
  const result = await dialog.showSaveDialog({
    title: "Export diagnostics",
    defaultPath: `frostfall-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: "ZIP archive", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) return { success: false };
  const zip = new AdmZip();
  const publicSettings = settings.publicSettings();
  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    settings: {
      ...publicSettings,
      skyrimPath: publicSettings.skyrimPath ? "[configured]" : "",
      vortexPath: publicSettings.vortexPath ? "[configured]" : "",
      discordUser: publicSettings.discordUser
        ? { username: "[redacted]" }
        : null,
    },
    preflight,
  };
  zip.addFile("diagnostics.json", Buffer.from(JSON.stringify(report, null, 2)));
  try {
    const logPath = log.transports.file.getFile().path;
    if (fs.existsSync(logPath))
      zip.addLocalFile(logPath, "logs", "launcher.log");
    for (let index = 1; index <= 4; index++) {
      const rotated = `${logPath}.${index}`;
      if (fs.existsSync(rotated))
        zip.addLocalFile(rotated, "logs", `launcher.${index}.log`);
    }
  } catch {
    /* diagnostics still useful without logs */
  }
  zip.writeZip(result.filePath);
  return { success: true, path: result.filePath };
}
