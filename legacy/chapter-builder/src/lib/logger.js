import fs from "node:fs";
import path from "node:path";

function timestamp() {
  return new Date().toISOString();
}

function writeLine(stream, level, message, meta) {
  const entry = {
    time: timestamp(),
    level,
    message,
    ...meta
  };

  stream.write(`${JSON.stringify(entry, null, 0)}\n`);
}

export function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const filePath = path.join(logDir, `run-${Date.now()}.log`);
  const stream = fs.createWriteStream(filePath, { flags: "a" });

  return {
    filePath,
    info(message, meta = {}) {
      console.log(`[INFO] ${message}`);
      writeLine(stream, "info", message, meta);
    },
    warn(message, meta = {}) {
      console.warn(`[WARN] ${message}`);
      writeLine(stream, "warn", message, meta);
    },
    error(message, meta = {}) {
      console.error(`[ERROR] ${message}`);
      writeLine(stream, "error", message, meta);
    }
  };
}
