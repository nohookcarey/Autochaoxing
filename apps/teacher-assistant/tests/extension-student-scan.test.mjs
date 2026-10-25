import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadFile(context, relativePath) {
  vm.runInNewContext(readFileSync(new URL(relativePath, import.meta.url), "utf8"), context);
}

function createStudentScanHarness({ tabs, framesByTab, frameResponses }) {
  const chrome = {
    runtime: { lastError: undefined, onMessage: { listeners: [], addListener(fn) { this.listeners.push(fn); } }, sendMessage: () => Promise.resolve() },
    storage: { local: { data: {}, async get(key) { return this.data[key] !== undefined ? { [key]: this.data[key] } : {}; }, async set(entry) { Object.assign(this.data, entry); } } },
    scripting: { async executeScript() {} },
    tabs: {
      query(query, callback) { callback(tabs); },
      get(tabId, callback) { callback(tabs.find((tab) => tab.id === tabId)); },
      sendMessage(tabId, message, options, callback) {
        const responder = frameResponses[message?.type];
        if (responder) { callback(responder(message, options)); return; }
        callback(undefined);
      },
      create(options, callback) { callback({ id: 99 }); },
      remove(tabId, callback) { callback?.(); },
      update(tabId, properties, callback) { callback?.(); },
    },
    webNavigation: { getAllFrames({ tabId }, callback) { callback(framesByTab[tabId] || [{ frameId: 0, url: "" }]); } },
  };
  const context = {
    AbortController,
    URL,
    URLSearchParams,
    atob,
    btoa,
    chrome,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    globalThis: undefined,
    importScripts() {},
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  loadFile(context, "../extension/background-utils.js");
  loadFile(context, "../extension/content/connection-check-scan-core.js");
  loadFile(context, "../extension/content/assignment-scan-core.js");
  loadFile(context, "../extension/content/attendance-scan-core.js");
  // Explicit synthetic data: never depend on a developer's private course configuration.
  context.LearningTongAttendanceProfiles = [{ courseName:"自然语言处理",courseId:"fixture-course",fid:"fixture-school",classNames:["人工智能3班"] }];
  loadFile(context, "../extension/content/score-overview-scan-core.js");
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  vm.runInNewContext(`${background}\nglobalThis.__test = { sendRuntimeMessage: (message) => new Promise((resolve) => { for (const listener of chrome.runtime.onMessage.listeners) { let answered = false; const keepOpen = listener(message, {}, (value) => { answered = true; resolve(value); }); if (answered || keepOpen !== true) break; } }) };`, context);
  return { api: context.__test };
}

test("scan-active-attendance-students returns per-student anomaly records from the attendance frame", async () => {
  const harness = createStudentScanHarness({
    tabs: [{ id: 5, windowId: 1, url: "https://mobilelearn.chaoxing.com/page/active/activeList?courseId=fixture-course", title: "活动列表", lastAccessed: 100 }],
    framesByTab: { 5: [{ frameId: 7, url: "https://mobilelearn.chaoxing.com/page/active/activeList" }] },
    frameResponses: {
      "inspect-attendance-frame": () => ({ attendanceRole: true, attendancePageRole: "active-list", courseId: "fixture-course", classId: "1", fid: "fixture-school" }),
      "scan-attendance-students": () => ({
        acquisitionState: "采集到",
        reason: "已完整核验 2 个签到活动，共发现 1 条异常记录。",
        signActivityCount: 2,
        anomalyStudentCount: 1,
        studentRecords: [{ name: "张三", username: "202401010001", className: "人工智能3班", anomalyCount: 1, anomalySummary: "迟到×1" }],
      }),
    },
  });
  const response = await harness.api.sendRuntimeMessage({ type: "scan-active-attendance-students", courseName: "自然语言处理" });
  assert.equal(response.acquisitionState, "采集到");
  assert.match(response.reason, /已核验课程配置与活动页/);
  assert.equal(response.studentRecords.length, 1);
  assert.equal(response.studentRecords[0].name, "张三");
  assert.equal(response.signals.studentRecordsInMemory, true);
});

test("scan-active-attendance-students rejects courses without an attendance profile", async () => {
  const harness = createStudentScanHarness({
    tabs: [{ id: 5, windowId: 1, url: "https://i.chaoxing.com/mycourse/tch", title: "其他课程", lastAccessed: 100 }],
    framesByTab: { 5: [{ frameId: 0, url: "" }] },
    frameResponses: {},
  });
  const response = await harness.api.sendRuntimeMessage({ type: "scan-active-attendance-students", courseName: "未配置课程" });
  assert.equal(response.acquisitionState, "未获取");
  assert.match(response.reason, /尚未接入签到异常只读配置|请先打开已登录/);
});

test("scan-active-score-students returns per-student scores from the score frame", async () => {
  const harness = createStudentScanHarness({
    tabs: [{ id: 5, windowId: 1, url: "https://stat2-ans.chaoxing.com/score-data/index", title: "学生成绩", lastAccessed: 100 }],
    framesByTab: { 5: [{ frameId: 3, url: "https://stat2-ans.chaoxing.com/score-data/index" }] },
    frameResponses: {
      "inspect-score-overview-frame": () => ({
        title: "自然语言处理-统计",
        path: "/score-data/index",
        courseLabel: "自然语言处理",
        scoreRole: true,
        summary: { activeClass: "人工智能3班", averageScore: 85, excellentCount: 10, passCount: 8, lowScoreCount: 2, studentCount: 20, complete: true },
      }),
      "scan-score-students": () => ({
        acquisitionState: "采集到",
        reason: "已读取当前班级 20 名学生的综合成绩。",
        activeClass: "人工智能3班",
        students: [
          { name: "张三", username: "202401010001", score: 92 },
          { name: "李四", username: "202401010002", score: 67 },
        ],
      }),
      "inspect-connection-frame": () => undefined,
    },
  });
  const response = await harness.api.sendRuntimeMessage({
    type: "scan-active-score-students",
    profile: { courseName: "自然语言处理", classNames: ["人工智能3班"] },
  });
  assert.equal(response.acquisitionState, "采集到");
  assert.equal(response.students.length, 2);
  assert.equal(response.students[0].score, 92);
  assert.equal(response.signals.studentRecordsInMemory, true);
});
