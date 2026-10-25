import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPublicRepository } from "./verify-public-repository.mjs";

test("public guard covers inactive/config/encoded identifiers and never echoes private values", async () => {
  const root = await mkdtemp(join(tmpdir(), "public-guard-"));
  try {
    await mkdir(join(root, "legacy"));
    await writeFile(join(root, "legacy", "old.js.dataless"), 'const scope = {courseId: "' + "765".repeat(3) + '"};');
    await writeFile(join(root, "link.md"), "https://example.invalid/?back=course%3FworkAnswerId%3D" + "654".repeat(3));
    await writeFile(join(root, "secret.js"), 'const key = "ghp_' + "A".repeat(36) + '";');
    await writeFile(join(root, ".env.example"), "XTX_USERNAME=\nXTX_PASSWORD=\n");
    const r = await verifyPublicRepository(root);
    assert.equal(r.passed, false);
    for (const rule of ["platform-config-binding", "platform-url-binding", "credential"]) assert.ok(r.issues.some(i => i.rule === rule));
    assert.equal(JSON.stringify(r).includes("765".repeat(3)), false);
    assert.equal(r.issues.some(i => i.path === ".env.example"), false);
    await writeFile(join(root, "legacy", "old.js.dataless"), 'const scope = {courseId: "", cpi: ""};');
    await rm(join(root, "link.md")); await rm(join(root, "secret.js"));
    assert.equal((await verifyPublicRepository(root)).passed, true);
    await writeFile(join(root, "config.local.json"), "{}");
    await writeFile(join(root, "chapter-test-profiles.local 2.js"), "[]");
    assert.equal((await verifyPublicRepository(root)).issues.filter(i => i.rule === "private-file").length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
