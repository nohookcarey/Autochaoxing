import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const sourceDir = resolve(process.cwd(), "extension");
const releaseDir = resolve(process.env.EXTENSION_RELEASE_DIR || process.argv[2] || "");

if (!process.env.EXTENSION_RELEASE_DIR && !process.argv[2]) {
  throw new Error("请通过 EXTENSION_RELEASE_DIR 或第一个参数指定脱敏发布包目录");
}

const sanitizedProfiles = new Map([
  ["chapter-test-profiles.local.js", "globalThis.LearningTongChapterTestProfiles = [];\n"],
  ["attendance-profiles.local.js", "globalThis.LearningTongAttendanceProfiles = [];\n"],
]);

const forbiddenPatterns = [
  /courseid=\d+/i,
  /clazzid=\d+/i,
  /\bcpi=\d+/i,
  /\b\d{12,}\b/,
  /cookie\s*[:=]/i,
  /password\s*[:=]/i,
];

async function listFiles(directory, root = directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.name !== ".DS_Store");
  const paths = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listFiles(fullPath, root));
    else paths.push(relative(root, fullPath).split(sep).join("/"));
  }
  return paths.sort();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const sourceFiles = await listFiles(sourceDir);
const releaseFiles = await listFiles(releaseDir);
const expectedReleaseFiles = [...new Set([...sourceFiles, "README.md"])].sort();

const missingFiles = expectedReleaseFiles.filter((file) => !releaseFiles.includes(file));
const unexpectedFiles = releaseFiles.filter((file) => !expectedReleaseFiles.includes(file));
const hashMismatches = [];
const privacyMatches = [];

for (const file of sourceFiles) {
  const releaseBuffer = await readFile(join(releaseDir, file));
  if (sanitizedProfiles.has(file)) {
    const expected = sanitizedProfiles.get(file);
    if (releaseBuffer.toString("utf8") !== expected) hashMismatches.push(file);
    continue;
  }
  const sourceBuffer = await readFile(join(sourceDir, file));
  if (sha256(sourceBuffer) !== sha256(releaseBuffer)) hashMismatches.push(file);
}

for (const file of releaseFiles) {
  if (!/\.(?:js|json|html|css|md)$/i.test(file)) continue;
  if (file.startsWith("vendor/")) continue; // 公开第三方库（SheetJS/PDFJS），其内置数值非用户数据，仍保留哈希一致性校验。
  const content = await readFile(join(releaseDir, file), "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) privacyMatches.push(`${file}: ${pattern}`);
  }
}

const sourceManifest = JSON.parse(await readFile(join(sourceDir, "manifest.json"), "utf8"));
const releaseManifest = JSON.parse(await readFile(join(releaseDir, "manifest.json"), "utf8"));
const versionMatches = sourceManifest.version === releaseManifest.version;
const passed = !missingFiles.length
  && !unexpectedFiles.length
  && !hashMismatches.length
  && !privacyMatches.length
  && versionMatches;

const result = {
  passed,
  version: releaseManifest.version,
  sourceFileCount: sourceFiles.length,
  releaseFileCount: releaseFiles.length,
  identicalSourceFiles: sourceFiles.length - sanitizedProfiles.size - hashMismatches.length,
  sanitizedProfileCount: sanitizedProfiles.size,
  missingFiles,
  unexpectedFiles,
  hashMismatches,
  privacyMatches,
  versionMatches,
};

console.log(JSON.stringify(result, null, 2));
if (!passed) process.exitCode = 1;
