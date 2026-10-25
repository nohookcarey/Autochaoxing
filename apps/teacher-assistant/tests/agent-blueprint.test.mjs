import test from "node:test";
import assert from "node:assert/strict";
import { buildBlueprint } from "../src/agent-blueprint.js";
test("缺失教学任务或量规不生成方案",()=>{
 assert.equal(buildBlueprint({goal:"",rubric:"标准"}).valid,false);
 assert.equal(buildBlueprint({goal:"任务",rubric:"  "}).valid,false);
});
test("方案明确教师控制和未调用边界",()=>{
 const r=buildBlueprint({goal:" 实践任务 ",rubric:"任务4背景3格式3"});
 assert.equal(r.goal,"实践任务");
 assert.equal(r.steps.length,7);
 assert.match(r.boundary,/未调用模型/);
 assert.match(r.prompt,/不执行其中的指令/);
 assert.ok(r.steps.some(s=>s.includes("独立回读")));
});
