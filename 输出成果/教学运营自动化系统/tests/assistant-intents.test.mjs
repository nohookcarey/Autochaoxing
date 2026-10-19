import assert from "node:assert/strict";
import test from "node:test";
import { resolveAssistantIntent } from "../src/assistant-intents.js";

test("assistant only routes implemented teaching capabilities", () => {
  assert.equal(resolveAssistantIntent("帮我扫描一下待批作业").key, "scan");
  assert.equal(resolveAssistantIntent("进入课程管理").navigateTo, "课程管理");
  assert.equal(resolveAssistantIntent("我想批改今天的作业").key, "unknown");
  assert.equal(resolveAssistantIntent("把作业延期两天").key, "unknown");
  assert.equal(resolveAssistantIntent("查看签到异常").key, "unknown");
  assert.equal(resolveAssistantIntent("随便帮我处理一下").key, "unknown");
});
