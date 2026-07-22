import log from "electron-log/main.js";
import fs from "node:fs";

const SECRET_PATTERNS = [
  /(x-session|authorization|apikey)(["'\s:=]+)([^\s,"'}]+)/gi,
  /("?(?:session|token|apiKey)"?\s*:\s*")[^"]+/gi,
];

export function redact(value: unknown): string {
  let text =
    value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  for (const pattern of SECRET_PATTERNS)
    text = text.replace(pattern, "$1$2[REDACTED]");
  return text;
}

export function initializeLogger() {
  log.initialize();
  log.transports.file.maxSize = 2 * 1024 * 1024;
  log.transports.file.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
  log.hooks.push((message) => {
    message.data = message.data.map(redact);
    return message;
  });
  try {
    const filename = log.transports.file.getFile().path;
    if (
      fs.existsSync(filename) &&
      fs.statSync(filename).size >= 2 * 1024 * 1024
    ) {
      for (let index = 4; index >= 1; index--) {
        const source = `${filename}.${index}`;
        const target = `${filename}.${index + 1}`;
        if (fs.existsSync(source)) {
          if (index === 4) fs.rmSync(source, { force: true });
          else fs.renameSync(source, target);
        }
      }
      fs.renameSync(filename, `${filename}.1`);
    }
  } catch {
    /* logging must never prevent startup */
  }
  return log;
}

export type AppLogger = ReturnType<typeof initializeLogger>;
