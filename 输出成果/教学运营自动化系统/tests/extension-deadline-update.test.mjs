import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../extension/content/deadline-update-core.js", import.meta.url), "utf8"), context);
const core = context.globalThis.LearningTongDeadlineUpdate;
const profile = { courseName: "示例课程", classNames: ["智能1班", "智能2班"] };

test("deadline command requires exact class, quoted title, and full datetime", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(core.parseCommand("把智能1班的作业《单元练习》截止时间改为 2026-09-01 20:00", profile))),
    { ok: true, courseName: "示例课程", className: "智能1班", title: "单元练习", nextEndTime: "2026-09-01 20:00:00" },
  );
  assert.equal(core.parseCommand("把作业截止时间改为明天", profile).ok, false);
  assert.equal(core.parseCommand("把智能1班的单元练习截止时间改为 2026-09-01 20:00", profile).ok, false);
  assert.equal(core.parseCommand("把智能1班的作业《单元练习》截止时间改为 2026-09-01 20:00", { name: "扩展课程", classNames: ["智能1班"] }).courseName, "扩展课程");
});

test("deadline target must be uniquely editable", () => {
  const rows = [
    { title: "单元练习", text: "单元练习 智能1班", modifyId: "a", page: "1" },
    { title: "单元练习", text: "单元练习 智能2班", modifyId: "b", page: "2" },
  ];
  assert.equal(core.findUniqueTarget(rows, { title: "单元练习", className: "智能1班" }).target.modifyId, "a");
  assert.equal(core.findUniqueTarget([...rows, rows[0]], { title: "单元练习", className: "智能1班" }).ok, false);
  assert.equal(core.findUniqueTarget(rows, { title: "不存在", className: "智能1班" }).ok, false);
});

test("deadline readback compares the list display at minute precision", () => {
  assert.equal(core.deadlineDisplayMatches("06-01 08:00至 09-01 20:00", "2026-09-01 20:00:00"), true);
  assert.equal(core.deadlineDisplayMatches("06-01 08:00至 09-02 20:00", "2026-09-01 20:00:00"), false);
});
