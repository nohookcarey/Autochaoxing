import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

class Locator {
  constructor(items = []) { this.items = items; }
  async count() { return this.items.length; }
  nth(index) { return new Locator([this.items[index]]); }
  first() { return new Locator(this.items.slice(0, 1)); }
  filter() { return this; }
  locator(selector) { return this.items[0]?.locator?.(selector) ?? new Locator(); }
  async innerText() { return this.items[0]?.text ?? ""; }
  async getAttribute(name) { return this.items[0]?.[name] ?? ""; }
  async click() {}
}

function row(id, text, title) {
  return { id, text, locator: () => new Locator([{ text: title }]), getAttribute: async (name) => name === "id" ? id : "" };
}
function createPage({ body, rows = [] }) {
  return {
    title: async () => "普通作业",
    waitForTimeout: async () => {},
    locator(selector) {
      if (selector === "body") return new Locator([{ text: body }]);
      if (selector === "[id^=work]") return new Locator(rows);
      return new Locator([]);
    },
  };
}

test("assignment scanner keeps pending, missing-class, and empty-list states distinct", async () => {
  const source = readFileSync(resolve(process.cwd(), "automation/scan-assignment-pending.js"), "utf8");
  const scanner = new Function(`return (${source});`)();
  const originalArgv = process.argv;
  async function scan(page, targetClasses) {
    process.argv = ["node", "scanner", "--course-name", "演示课程", "--target-classes", JSON.stringify(targetClasses)];
    return scanner(page);
  }
  try {
    const found = await scan(createPage({ body: "演示课程 普通作业", rows: [row("work1", "演示班 2 待批 4 已交", "任务一")] }), ["演示班"]);
    assert.equal(found.gateStatus, "PASS");
    assert.equal(found.acquisitionState, "采集到");
    assert.equal(found.pendingAssignments[0].pending, 2);

    const missingClass = await scan(createPage({ body: "演示课程 普通作业", rows: [row("work2", "其他班 0 待批 3 已交", "任务二")] }), ["演示班"]);
    assert.equal(missingClass.gateStatus, "BLOCKED");
    assert.equal(missingClass.acquisitionState, "未获取");

    const emptyList = await scan(createPage({ body: "演示课程 普通作业 暂无作业" }), ["演示班"]);
    assert.equal(emptyList.gateStatus, "BLOCKED");
    assert.equal(emptyList.acquisitionState, "未获取");
  } finally {
    process.argv = originalArgv;
  }
});
