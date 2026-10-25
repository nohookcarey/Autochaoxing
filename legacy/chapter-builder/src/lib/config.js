import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readCliArgs(args) {
  const options = {
    dryRun: false,
    inputPath: "./data/chapters.json"
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (current === "--input") {
      options.inputPath = args[index + 1];
      index += 1;
    }
  }

  return options;
}

function assertRequired(value, label) {
  if (!value) {
    throw new Error(`缺少必要配置：${label}`);
  }
}

export function loadConfig(args) {
  const cli = readCliArgs(args);
  const cwd = process.cwd();
  const storageStatePath = process.env.XTX_STORAGE_STATE_PATH || "./storage/state.json";
  const screenshotDir = process.env.XTX_SCREENSHOT_DIR || "./logs/screenshots";
  const logDir = process.env.XTX_LOG_DIR || "./logs";

  assertRequired(process.env.XTX_USERNAME, "XTX_USERNAME");
  assertRequired(process.env.XTX_PASSWORD, "XTX_PASSWORD");
  assertRequired(process.env.XTX_COURSE_NAME, "XTX_COURSE_NAME");

  const config = {
    baseUrl: process.env.XTX_BASE_URL || "https://mooc1.chaoxing.com",
    loginUrl: process.env.XTX_LOGIN_URL || "https://passport2.chaoxing.com/login",
    username: process.env.XTX_USERNAME,
    password: process.env.XTX_PASSWORD,
    courseName: process.env.XTX_COURSE_NAME,
    headless: parseBoolean(process.env.XTX_HEADLESS, false),
    slowMo: parseNumber(process.env.XTX_SLOW_MO, 0),
    timeoutMs: parseNumber(process.env.XTX_TIMEOUT_MS, 10000),
    storageStatePath: path.resolve(cwd, storageStatePath),
    inputPath: path.resolve(cwd, cli.inputPath),
    dryRun: cli.dryRun,
    paths: {
      cwd,
      screenshotDir: path.resolve(cwd, screenshotDir),
      logDir: path.resolve(cwd, logDir)
    }
  };

  fs.mkdirSync(path.dirname(config.storageStatePath), { recursive: true });
  fs.mkdirSync(config.paths.screenshotDir, { recursive: true });
  fs.mkdirSync(config.paths.logDir, { recursive: true });

  return config;
}
