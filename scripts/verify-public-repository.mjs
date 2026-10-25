import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Report paths and rule names only: never echo the matched private value.
export const publicRules = [
  ["personal-path", /\/Users\/[^/\s<>$"'`]+\/|[A-Z]:\\Users\\[^\\\s<>%"']+\\/i],
  ["platform-url-binding", /(?:[?&]|%26|%3[fF])(?:courseid|clazzid|classid|cpi|workid|workanswerid|knowledgeid|chapterid|worklibraryid|uid|puid|userid|id)(?:=|%3[dD])(?:\d{5,}|[a-f\d]{32})\b/i],
  ["platform-config-binding", /\b(?:course_?id|clazz_?id|class_?id|work_?list_?id|work_?id|work_?answer_?id|knowledge_?id|chapter_?id|work_?library_?id|answer_?id|student_?id|teacher_?id|cpi|puid|uid)["'`\s]*(?::|=|\|\|)[\s"'`]*(?:\d{5,}|[a-f\d]{32})\b/i],
  ["credential", /\b(?:gh[opusr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{25,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b/],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const privateFile = /(?:^|\/)(?:\.env(?:\..*)?|auth\.json|storage-state\.json|state\.json|[^/]+\.(?:pem|key)|[^/]+\.local\.json|[^/]+ 2\.[^/]+|\.backup-[^/]*)(?:$|\/)/;
const skipped = new Set([".git", "node_modules", "dist", "release", "coverage"]);

export async function verifyPublicRepository(directory, { gitInventory = false } = {}) {
  const root = resolve(directory), issues = [];
  const verifiedVendor = new Set();
  const modulePath = "输出成果/教学运营自动化系统/";
  try {
    const integrity = JSON.parse(await readFile(join(root, modulePath, "config/vendor-integrity.json"), "utf8"));
    for (const item of integrity.files) {
      if (!/^extension\/vendor\/(?:pdfjs|xlsx)\/[A-Za-z0-9._/-]+$/.test(item.path) || item.path.includes("..")) throw new Error("invalid vendor path");
      const path = modulePath + item.path;
      const digest = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
      if (digest === item.sha256) verifiedVendor.add(path); else issues.push({ path, rule: "vendor-sha256" });
    }
  } catch (error) { if (error.code !== "ENOENT") issues.push({ path: modulePath + "config/vendor-integrity.json", rule: "vendor-integrity" }); }
  let paths = [];
  if (gitInventory) paths = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  else {
    async function walk(dir) {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (skipped.has(e.name)) continue;
        const path = join(dir, e.name);
        if (e.isDirectory()) await walk(path); else paths.push(relative(root, path).replaceAll("\\", "/"));
      }
    }
    await walk(root);
  }
  paths = [...new Set(paths)].sort();
  for (const path of paths) {
    if (path === ".git") continue; // A Git worktree pointer contains a private local path; never enters an archive.
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) { issues.push({ path, rule: "symlink" }); continue; }
    if (privateFile.test(path) && !path.endsWith("/.env.example") && path !== ".env.example") issues.push({ path, rule: "private-file" });
    const bytes = await readFile(join(root, path));
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    for (const [rule, pattern] of publicRules) {
      // Fixed third-party bytes contain public bug-tracker IDs; credentials are still checked.
      if (verifiedVendor.has(path) && rule.startsWith("platform-")) continue;
      if (pattern.test(content)) issues.push({ path, rule });
    }
  }
  return { passed: issues.length === 0, fileCount: paths.length, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const snapshot = process.argv[2];
  const result = await verifyPublicRepository(snapshot || process.cwd(), { gitInventory: !snapshot });
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
