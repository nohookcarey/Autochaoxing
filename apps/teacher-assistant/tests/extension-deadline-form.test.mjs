import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {}, Date };
vm.runInNewContext(readFileSync(new URL("../extension/content/deadline-update-core.js", import.meta.url), "utf8"), context);
context.globalThis.LearningTongDeadlineUpdate = context.LearningTongDeadlineUpdate || context.globalThis.LearningTongDeadlineUpdate;
vm.runInNewContext(readFileSync(new URL("../extension/popup/deadline-form.js", import.meta.url), "utf8"), context);
const form = context.globalThis.LearningTongDeadlineForm;

const profile = { name: "示例课程", classNames: ["智能1班", "智能2班"] };

test("deadline form builds an exact request from allowlisted fields", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(form.buildRequest(profile, "智能1班", "单元作业", "2026-09-08T20:30"))),
    { ok: true, courseName: "示例课程", className: "智能1班", title: "单元作业", nextEndTime: "2026-09-08 20:30:00" },
  );
});

test("deadline form rejects a class outside the active course scope", () => {
  const result = form.buildRequest(profile, "其他班", "单元作业", "2026-09-08T20:30");
  assert.equal(result.ok, false);
  assert.match(result.reason, /班级白名单/);
});

test("deadline form requires title and a complete valid datetime", () => {
  assert.equal(form.buildRequest(profile, "智能1班", "", "2026-09-08T20:30").ok, false);
  assert.equal(form.buildRequest(profile, "智能1班", "单元作业", "2026-02-30T20:30").ok, false);
});
