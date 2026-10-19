import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createHarness({ tabs = [], frames = {}, responder, onCreateTab, onRuntimeSend }) {
  const injections = [];
  const removedTabs = [];
  const activatedTabs = [];
  const runtimeMessages = [];
  const runtime = {
    lastError: undefined,
    onMessage: { addListener() {} },
    sendMessage(message) { runtimeMessages.push(message); onRuntimeSend?.(message); return Promise.resolve(); },
  };
  const chrome = {
    runtime,
    scripting: {
      async executeScript(options) { injections.push(options); },
    },
    storage: {
      session: { async set() {}, async get() { return {}; }, async remove() {} },
    },
    tabs: {
      query(query, callback) { callback(tabs.filter((tab) => query.windowId === undefined || tab.windowId === query.windowId)); },
      get(tabId, callback) { callback(tabs.find((tab) => tab.id === tabId)); },
      sendMessage(tabId, message, options, callback) {
        const result = responder?.({ tabId, frameId: options.frameId, message });
        if (result?.missingReceiver) {
          runtime.lastError = { message: "Receiving end does not exist" };
          callback(undefined);
          runtime.lastError = undefined;
          return;
        }
        callback(result?.value);
      },
      create(options, callback) { callback(onCreateTab ? onCreateTab(options) : { id: 99 }); },
      remove(tabId, callback) { removedTabs.push(tabId); callback?.(); },
      update(tabId, properties, callback) { activatedTabs.push({ tabId, properties }); callback?.(); },
    },
    webNavigation: {
      getAllFrames({ tabId }, callback) { callback(frames[tabId] || [{ frameId: 0, url: tabs.find((tab) => tab.id === tabId)?.url || "" }]); },
    },
  };
  const context = {
    AbortController,
    URL,
    URLSearchParams,
    chrome,
    globalThis: undefined,
    importScripts() {},
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL("../extension/background-utils.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/content/connection-check-scan-core.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/content/assignment-scan-core.js", import.meta.url), "utf8"), context);
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  vm.runInNewContext(`${background}\nglobalThis.__navigationTest = { sendWithScriptFallback, resolveCourseRoleTab, authenticationAwareFailure, navigateTeacherModule, navigateStatisticsSubmodule, checkConnection, enterCourseFromCourseList, scanAllAssignmentPages, broadcastProgress };`, context);
  return { api: context.__navigationTest, injections, removedTabs, activatedTabs, runtimeMessages };
}

test("stale Chaoxing frame receives the current scripts once and is retried", async () => {
  let calls = 0;
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://stat2-ans.chaoxing.com/stat2-vue/base-data" }],
    responder() {
      calls += 1;
      return calls === 1 ? { missingReceiver: true } : { value: { statisticsShellRole: true } };
    },
  });
  const result = await harness.api.sendWithScriptFallback(
    1,
    { frameId: 0, url: "https://stat2-ans.chaoxing.com/stat2-vue/base-data" },
    { type: "inspect-teacher-navigation" },
    ["content/navigation-core.js", "content/navigation-page.js"],
  );
  assert.equal(result.statisticsShellRole, true);
  assert.equal(harness.injections.length, 1);
  assert.deepEqual(Array.from(harness.injections[0].files), ["content/navigation-core.js", "content/navigation-page.js"]);
});

test("course-role resolver chooses the matching statistics tab instead of another course", async () => {
  const tabs = [
    { id: 1, windowId: 9, title: "课程乙", url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch", lastAccessed: 20 },
    { id: 2, windowId: 9, title: "课程-统计", url: "https://stat2-ans.chaoxing.com/stat2-vue/stat", lastAccessed: 10 },
  ];
  const harness = createHarness({
    tabs,
    frames: { 1: [{ frameId: 0, url: tabs[0].url }], 2: [{ frameId: 0, url: tabs[1].url }] },
    responder({ tabId }) {
      if (tabId === 1) return { value: { title: "课程乙", roles: { courseShell: true }, loginPage: false } };
      return { value: { title: "课程甲", courseLabel: "课程甲", roles: { statistics: true }, loginPage: false } };
    },
  });
  const result = await harness.api.resolveCourseRoleTab("课程甲", { tab: { windowId: 9 } }, "statistics");
  assert.equal(result.id, 2);
});

test("a failed task plus a visible platform login page returns 需人工登录", async () => {
  const harness = createHarness({
    tabs: [
      { id: 1, windowId: 9, url: "https://mobilelearn.chaoxing.com/page/active/activeList" },
      { id: 2, windowId: 9, url: "https://passport2.chaoxing.com/login" },
    ],
  });
  const result = await harness.api.authenticationAwareFailure(1, "Failed to fetch");
  assert.equal(result.acquisitionState, "需人工登录");
  assert.match(result.reason, /重新认证/);
});

test("a verified teacher shell with a missing module entry returns 页面结构变化", async () => {
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch" }],
    responder({ message }) {
      if (message.type === "inspect-teacher-navigation") return { value: { courseShellRole: true, availableModules: ["chapter"] } };
      if (message.type === "navigate-teacher-module") return { value: { started: false, reason: "课程主页未找到“作业”入口。" } };
      return { value: undefined };
    },
  });
  const result = await harness.api.navigateTeacherModule(1, "assignment");
  assert.equal(result.acquisitionState, "页面结构变化");
  assert.match(result.reason, /未找到“作业”入口/);
});

test("a verified statistics shell with a missing score entry returns 页面结构变化", async () => {
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://stat2-ans.chaoxing.com/stat2-vue/base-data" }],
    responder({ message }) {
      if (message.type === "inspect-teacher-navigation") return { value: { statisticsShellRole: true, availableModules: [] } };
      if (message.type === "navigate-statistics-submodule") return { value: { started: false, reason: "统计页未找到“学生成绩”入口。" } };
      return { value: undefined };
    },
  });
  const result = await harness.api.navigateStatisticsSubmodule(1, "score");
  assert.equal(result.acquisitionState, "页面结构变化");
  assert.match(result.reason, /未找到“学生成绩”入口/);
});

test("connection check auto-enters the course from a visible course list", async () => {
  const createdTabs = [];
  const courseHref = "https://mooc1-1.chaoxing.com/mooc-ans/coursecontroller/isNewCourse?courseId=1001";
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://i.chaoxing.com/base", title: "个人空间", lastAccessed: 10 }],
    frames: { 1: [{ frameId: 0, url: "https://i.chaoxing.com/base" }], 99: [{ frameId: 0, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch" }] },
    responder({ tabId, message }) {
      if (message.type !== "inspect-connection-frame") return { value: undefined };
      if (tabId === 1) return { value: { title: "个人空间", path: "/base", roles: {}, loginPage: false, courseList: [{ name: "自然语言处理", href: courseHref }] } };
      return { value: { title: "自然语言处理", courseLabel: "自然语言处理", path: "/mooc2-ans/mycourse/tch", roles: { courseShell: true }, loginPage: false } };
    },
    onCreateTab(options) { createdTabs.push(options); return { id: 99, windowId: options.windowId }; },
  });
  const result = await harness.api.checkConnection(1, "自然语言处理", { tab: { windowId: 9 } });
  assert.equal(result.acquisitionState, "采集到");
  assert.match(result.reason, /已自动从“我教的课”课程列表进入课程主页/);
  assert.deepEqual(createdTabs.map((options) => ({ url: options.url, active: options.active, windowId: options.windowId })), [{ url: courseHref, active: false, windowId: 9 }]);
  assert.deepEqual(harness.removedTabs, []);
});

test("connection check reports a missing course after loading the course list", async () => {
  const createdTabs = [];
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://i.chaoxing.com/base", title: "个人空间", lastAccessed: 10 }],
    frames: { 1: [{ frameId: 0, url: "https://i.chaoxing.com/base" }], 77: [{ frameId: 0, url: "https://i.chaoxing.com/base" }] },
    responder({ tabId, message }) {
      if (message.type !== "inspect-connection-frame") return { value: undefined };
      const courseList = [{ name: "其他课程", href: "https://mooc1-1.chaoxing.com/mooc-ans/coursecontroller/isNewCourse?courseId=1" }];
      return { value: { title: "个人空间", path: "/base", roles: {}, loginPage: false, courseList } };
    },
    onCreateTab(options) { createdTabs.push(options); return { id: 77, windowId: options.windowId }; },
  });
  const result = await harness.api.checkConnection(1, "自然语言处理", { tab: { windowId: 9 } });
  assert.equal(result.acquisitionState, "未获取");
  assert.match(result.reason, /课程列表中没有找到课程“自然语言处理”/);
  assert.equal(createdTabs[0].url, "https://i.chaoxing.com/");
  assert.deepEqual(harness.removedTabs, [77]);
});

test("connection check surfaces the login page when auto-entry meets an expired session", async () => {
  const harness = createHarness({
    tabs: [],
    frames: { 77: [{ frameId: 0, url: "https://passport2.chaoxing.com/login" }] },
    responder({ message }) {
      if (message.type !== "inspect-connection-frame") return { value: undefined };
      return { value: { title: "用户登录", path: "/login", roles: {}, loginPage: true } };
    },
    onCreateTab(options) { return { id: 77, windowId: options.windowId }; },
  });
  const result = await harness.api.enterCourseFromCourseList("自然语言处理", { tab: { windowId: 9 } });
  assert.equal(result.acquisitionState, "需人工登录");
  assert.match(result.reason, /重新认证/);
  assert.deepEqual(harness.activatedTabs.map((item) => item.tabId), [77]);
});

test("connection check discovers the course and class list when the course name is empty", async () => {
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch", title: "自然语言处理", lastAccessed: 10 }],
    frames: { 1: [{ frameId: 0, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch" }, { frameId: 5, url: "https://mobilelearn.chaoxing.com/page/class/classList" }] },
    responder({ frameId, message }) {
      if (message.type !== "inspect-connection-frame") return { value: undefined };
      if (frameId === 5) return { value: { title: "班级", path: "/page/class/classList", roles: { attendance: true }, loginPage: false, classNames: ["人工智能1班", "人工智能2班"] } };
      return { value: { title: "自然语言处理", courseLabel: "自然语言处理", path: "/mooc2-ans/mycourse/tch", roles: { courseShell: true }, loginPage: false } };
    },
  });
  const result = await harness.api.checkConnection(1, "", { tab: { windowId: 9 } });
  assert.equal(result.acquisitionState, "采集到");
  assert.equal(result.detectedCourseName, "自然语言处理");
  assert.deepEqual(Array.from(result.classNames), ["人工智能1班", "人工智能2班"]);
  assert.match(result.reason, /已自动识别当前课程“自然语言处理”/);
});

test("connection check with an empty course name on the course list suggests filling the course name", async () => {
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://i.chaoxing.com/base", title: "个人空间", lastAccessed: 10 }],
    frames: { 1: [{ frameId: 0, url: "https://i.chaoxing.com/base" }] },
    responder({ message }) {
      if (message.type !== "inspect-connection-frame") return { value: undefined };
      return { value: { title: "个人空间", path: "/base", roles: {}, loginPage: false, courseList: [{ name: "自然语言处理", href: "https://mooc1-1.chaoxing.com/a" }, { name: "其他课程", href: "https://mooc1-1.chaoxing.com/b" }] } };
    },
  });
  const result = await harness.api.checkConnection(1, "", { tab: { windowId: 9 } });
  assert.equal(result.acquisitionState, "未获取");
  assert.match(result.reason, /课程列表（2 门课程）/);
  assert.deepEqual(Array.from(result.discoveredCourses), ["自然语言处理", "其他课程"]);
});

test("assignment scan broadcasts progress while scanning all pages", async () => {
  let currentPage = "1";
  const rowsFor = (page) => page === "1"
    ? [
      { id: "a1", title: "作业一", text: "人工智能1班 已交 30 2 待批", page: "1" },
      { id: "a2", title: "作业二", text: "人工智能2班 已交 28 1 待批", page: "1" },
    ]
    : [
      { id: "a3", title: "作业三", text: "人工智能1班 已交 25 3 待批", page: "2" },
      { id: "a4", title: "作业四", text: "人工智能2班 已交 20 0 待批", page: "2" },
    ];
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/work/list", title: "作业列表" }],
    frames: { 1: [
      { frameId: 0, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch" },
      { frameId: 3, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/work/list" },
    ] },
    responder({ frameId, message }) {
      if (message.type === "navigate-assignment-page") { currentPage = message.page; return { value: { started: true } }; }
      if (message.type !== "inspect-assignment-frame") return { value: undefined };
      if (frameId === 0) return { value: { title: "演示课程", path: "/mooc2-ans/mycourse/tch", bodyText: "演示课程 教师端" } };
      return { value: { title: "作业列表", path: "/mooc2-ans/work/list", currentPage, pageNumbers: ["1", "2"], rows: rowsFor(currentPage), bodyText: "" } };
    },
  });
  const result = await harness.api.scanAllAssignmentPages(1, { courseName: "演示课程", classNames: ["人工智能1班", "人工智能2班"] });
  assert.equal(result.acquisitionState, "采集到");
  assert.equal(result.assignmentTotal, 4);
  assert.deepEqual(result.scannedPages, ["1", "2"]);
  const reasons = harness.runtimeMessages.filter((message) => message.type === "scan-progress").map((message) => message.reason);
  assert.deepEqual(reasons, [
    "正在核验当前标签页的课程上下文与作业列表…",
    "正在扫描作业分页 1（第 1/2 页）…",
    "正在扫描作业分页 2（第 2/2 页）…",
    "正在恢复扫描前的原始分页…",
    "正在汇总各班级待批数量与课程核验结果…",
  ]);
});

test("broadcastProgress swallows missing popup receivers", async () => {
  const harness = createHarness({ tabs: [] });
  await harness.api.broadcastProgress("任意进度");
  assert.deepEqual(harness.runtimeMessages.map((message) => message.reason), ["任意进度"]);
});

test("connection check waits briefly for the class list iframe before responding", async () => {
  let classFrameCalls = 0;
  const harness = createHarness({
    tabs: [{ id: 1, windowId: 9, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch", title: "自然语言处理", lastAccessed: 10 }],
    frames: { 1: [{ frameId: 0, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch" }, { frameId: 5, url: "https://mobilelearn.chaoxing.com/page/class/classList" }] },
    responder({ frameId, message }) {
      if (message.type !== "inspect-connection-frame") return { value: undefined };
      if (frameId === 5) {
        classFrameCalls += 1;
        return classFrameCalls >= 2
          ? { value: { title: "班级", path: "/page/class/classList", roles: { attendance: true }, loginPage: false, classNames: ["人工智能1班"] } }
          : { value: { title: "班级", path: "/page/class/classList", roles: {}, loginPage: false } };
      }
      return { value: { title: "自然语言处理", courseLabel: "自然语言处理", path: "/mooc2-ans/mycourse/tch", roles: { courseShell: true }, loginPage: false } };
    },
  });
  const result = await harness.api.checkConnection(1, "自然语言处理", { tab: { windowId: 9 } });
  assert.equal(result.acquisitionState, "采集到");
  assert.deepEqual(Array.from(result.classNames), ["人工智能1班"]);
});
