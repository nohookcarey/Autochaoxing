import { mkdir, readFile, readdir, writeFile, lstat, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { publicationPatterns } from "./verify-publication.mjs";

const profiles = new Map([
  ["chapter-test-profiles.local.js", "globalThis.LearningTongChapterTestProfiles = [];\n"],
  ["attendance-profiles.local.js", "globalThis.LearningTongAttendanceProfiles = [];\n"],
]);

export async function buildExtensionRelease(root, target) {
  root = resolve(root); target = resolve(target);
  const source = await realpath(join(root, "extension"));
  if (target === source || target.startsWith(source + sep)) throw new Error("发布目录必须独立于扩展源码。");
  const { files } = JSON.parse(await readFile(join(root, "config/extension-release-files.json"), "utf8"));
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw new Error("扩展发布白名单无效。");
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length) throw new Error("发布目标必须为空目录，防止残留文件混入；不会覆盖旧包。");
  for (const file of files) {
    if (typeof file !== "string" || !/^[A-Za-z0-9_./-]+$/.test(file) || file.split("/").includes("..") || file.startsWith("/")) throw new Error("扩展白名单路径无效。");
    const input = join(source, file);
    const canonical = await realpath(input);
    if (!canonical.startsWith(source + sep) || !(await lstat(input)).isFile()) throw new Error("扩展资源必须为源码内的常规文件。");
    const bytes = profiles.has(file) ? Buffer.from(profiles.get(file)) : await readFile(input);
    if (!file.startsWith("vendor/")) for (const [rule, pattern] of publicationPatterns) {
      if (pattern.test(bytes.toString("utf8"))) throw new Error(`扩展发布检查失败：${file} (${rule})`);
    }
    await mkdir(resolve(target, file, ".."), { recursive: true });
    await writeFile(join(target, file), bytes);
  }
  return { fileCount: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const version = JSON.parse(await readFile("extension/manifest.json", "utf8")).version;
  const target = resolve(process.env.EXTENSION_RELEASE_DIR || `release/教学运营助手-浏览器扩展-v${version}`);
  const result = await buildExtensionRelease(process.cwd(), target);
  console.log(JSON.stringify({ ...result, target }));
}
