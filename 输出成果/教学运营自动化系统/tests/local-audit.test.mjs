import assert from "node:assert/strict";
import test from "node:test";
import { RUN_RECORD_STORE_KEY, loadRunRecords, prependRunRecord } from "../src/local-audit.js";

test("local audit retains only safe record fields and restores valid records", () => {
  const storage = new Map();
  storage.set(RUN_RECORD_STORE_KEY, JSON.stringify([{ id: "1", taskName: "扫描待批作业", courseName: "演示课程", classNames: ["演示班"], state: "未获取", detail: "未启动网关\n请检查", createdAt: "2026/8/22" }, { courseName: "缺少必要字段" }]));
  const records = loadRunRecords({ getItem: (key) => storage.get(key) });
  assert.equal(records.length, 1);
  assert.equal(records[0].detail, "未启动网关 请检查");
  assert.deepEqual(prependRunRecord(records, { id: "2", taskName: "核验", courseName: "演示课程", classNames: [], state: "需人工登录" }).map((record) => record.id), ["2", "1"]);
});
