import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanDemo, previewDeadline, suggestionDemo, saveTeacherDraft } from "../src/demo-workflow-core.js";
test("demo states never turn unread pages into empty results",()=>{
 assert.equal(scanDemo("演示班 A","missing").state,"未获取");
 assert.equal(scanDemo("演示班 A","missing").rows.length,0);
 assert.equal(scanDemo("演示班 B","empty").state,"确认无待批");
 assert.equal(scanDemo("演示班 B","normal").rows[0][0],"演示班 B");
});
test("demo deadline needs exact title, full time and excludes other class",()=>{
 assert.equal(previewDeadline("演示班 A","提示词","2026-09-20 23:59","old").valid,false);
 assert.equal(previewDeadline("演示班 A","提示词练习","明天","old").valid,false);
 const plan=previewDeadline("演示班 A","提示词练习","2026-09-20 23:59","old");
 assert.equal(plan.untouched,"演示班 B");assert.equal(plan.original,"old");
});
test("preset suggestion and teacher draft remain local simulation",()=>{
 assert.equal(suggestionDemo().score,7);
 assert.equal(saveTeacherDraft("11","反馈").valid,false);
 assert.equal(saveTeacherDraft("8","").valid,false);
 assert.equal(saveTeacherDraft("8","已说明对象，修订背景项").state.includes("未提交平台"),true);
});
test("expanded walkthrough is demo-only and has no request interfaces",()=>{
 const app=readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
 const demo=readFileSync(new URL("../src/DemoWalkthrough.jsx",import.meta.url),"utf8");
 assert.match(app,/if \(demoMode && walkthroughOpen && activeNav === "教学任务"\)/);
 assert.equal(/\bfetch\s*\(|XMLHttpRequest|chrome\.runtime/.test(demo),false);
 assert.match(demo,/未调用模型/);
});
