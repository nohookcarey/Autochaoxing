import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const node = process.execPath;
const gateway = spawn(node, ["server/start-gateway.mjs"], { cwd: root, stdio: "inherit" });
const vite = spawn(node, [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "4173", "--strictPort"], { cwd: root, stdio: "inherit" });
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  gateway.kill("SIGTERM");
  vite.kill("SIGTERM");
  process.exit(code);
}

gateway.on("exit", (code) => { if (!stopping) stop(code ?? 1); });
vite.on("exit", (code) => { if (!stopping) stop(code ?? 1); });
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
