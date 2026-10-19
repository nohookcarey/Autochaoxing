import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const source = resolve(process.cwd(), "extension");
const target = resolve(process.env.EXTENSION_RELEASE_DIR || `release/教学运营助手-浏览器扩展-v${JSON.parse(await readFile(join(source, "manifest.json"), "utf8")).version}`);

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true, force: true, filter: (path) => basename(path) !== ".DS_Store" });
await writeFile(join(target, "chapter-test-profiles.local.js"), "globalThis.LearningTongChapterTestProfiles = [];\n", "utf8");
await writeFile(join(target, "attendance-profiles.local.js"), "globalThis.LearningTongAttendanceProfiles = [];\n", "utf8");
await writeFile(join(target, "README.md"), await readFile(join(source, "README.md"), "utf8"), "utf8");

async function filesUnder(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.name !== ".DS_Store");
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}

const forbidden = [
  /courseid=\d+/i,
  /clazzid=\d+/i,
  /\bcpi=\d+/i,
  /\b\d{12,}\b/,
  /cookie\s*[:=]/i,
  /password\s*[:=]/i,
];
for (const file of await filesUnder(target)) {
  if (!/\.(?:js|json|html|css|md)$/i.test(file)) continue;
  if (file.startsWith("vendor/") || file.includes("/vendor/")) continue; // 公开第三方库（SheetJS/PDFJS），其内置数值非用户数据。
  const text = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) throw new Error(`脱敏发布检查失败：${basename(file)} 命中 ${pattern}`);
  }
}

console.log(`脱敏扩展发布包已生成：${target}`);
