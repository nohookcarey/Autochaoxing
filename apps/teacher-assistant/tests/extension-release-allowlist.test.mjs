import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExtensionRelease } from "../scripts/build-extension-release.mjs";

test("release whitelist excludes unlisted private copies, sanitizes profiles and refuses stale targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "extension-release-"));
  try {
    await mkdir(join(root, "extension")); await mkdir(join(root, "config"));
    const files = ["main.js", "attendance-profiles.local.js"];
    await writeFile(join(root, "config/extension-release-files.json"), JSON.stringify({ files }));
    await writeFile(join(root, "extension/main.js"), "// example");
    await writeFile(join(root, "extension/attendance-profiles.local.js"), "private config");
    await writeFile(join(root, "extension/attendance-profiles.local 2.js"), "must stay private");
    const target = join(root, "out");
    assert.equal((await buildExtensionRelease(root, target)).fileCount, 2);
    assert.deepEqual((await readdir(target)).sort(), files.sort());
    assert.equal(await readFile(join(target, "attendance-profiles.local.js"), "utf8"), "globalThis.LearningTongAttendanceProfiles = [];\n");
    await assert.rejects(buildExtensionRelease(root, target), /空目录/);
    await writeFile(join(root, "config/extension-release-files.json"), JSON.stringify({ files: ["../outside.js"] }));
    await assert.rejects(buildExtensionRelease(root, join(root, "unsafe")), /白名单路径/);
    if (process.platform !== "win32") {
      await writeFile(join(root, "external.js"), "private");
      await symlink(join(root, "external.js"), join(root, "extension/link.js"));
      await writeFile(join(root, "config/extension-release-files.json"), JSON.stringify({ files: ["link.js"] }));
      await assert.rejects(buildExtensionRelease(root, join(root, "links")), /源码内/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
