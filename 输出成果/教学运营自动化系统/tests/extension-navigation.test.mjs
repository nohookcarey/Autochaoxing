import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../extension/content/navigation-core.js", import.meta.url), "utf8"), context);
const navigation = context.globalThis.LearningTongNavigation;

test("teacher module labels stay exact and limited", () => {
  assert.equal(navigation.moduleLabel("assignment"), "作业");
  assert.equal(navigation.moduleLabel("chapter"), "章节");
  assert.equal(navigation.moduleLabel("statistics"), "统计");
  assert.equal(navigation.moduleLabel("score"), "学生成绩");
  assert.equal(navigation.moduleLabel("unknown"), "");
  assert.equal(navigation.normalize("\u200b班级活动"), "班级活动");
});

test("course-shell role only accepts the teacher course shell", () => {
  assert.equal(navigation.courseShellRole("/mooc2-ans/mycourse/tch"), true);
  assert.equal(navigation.courseShellRole("/mooc2-ans/work/list"), false);
  assert.equal(navigation.courseShellRole("/mycourse/studentcourse"), false);
});

test("statistics navigation requires host path and visible labels together", () => {
  assert.equal(navigation.statisticsShellRole("stat2-ans.chaoxing.com", "/stat2-vue/base-data", "基础数据 学生成绩"), true);
  assert.equal(navigation.statisticsShellRole("stat2-ans.chaoxing.com", "/stat2-vue/base-data", "基础数据"), false);
  assert.equal(navigation.statisticsShellRole("example.invalid", "/stat2-vue/base-data", "基础数据 学生成绩"), false);
  assert.equal(navigation.statisticsShellRole("stat2-ans.chaoxing.com", "/stat2-vue/stat", "基础数据 学生成绩"), false);
});

test("teacher navigation recognizes JavaScript pseudo-links before activation", () => {
  assert.equal(navigation.javascriptHref("javascript:void(0);"), true);
  assert.equal(navigation.javascriptHref(" JAVASCRIPT: openModule()"), true);
  assert.equal(navigation.javascriptHref("/mooc2-ans/work/list"), false);
  assert.equal(navigation.javascriptHref(undefined), false);
});

test("teacher navigation neutralizes JavaScript pseudo-links while preserving site click handlers", () => {
  let listener;
  let clickedHref;
  let response;
  const attributes = new Map([["href", "javascript:void(0);"]]);
  const control = {
    innerText: "作业",
    textContent: "作业",
    matches: () => false,
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    click: () => { clickedHref = attributes.get("href"); },
  };
  const pageContext = {
    globalThis: { LearningTongNavigation: navigation },
    document: {
      body: { innerText: "章节 作业 统计" },
      querySelectorAll: () => [control],
    },
    location: { hostname: "mooc2-ans.chaoxing.com", pathname: "/mooc2-ans/mycourse/tch" },
    chrome: { runtime: { onMessage: { addListener: (value) => { listener = value; } } } },
    setTimeout: (callback) => callback(),
  };
  vm.runInNewContext(readFileSync(new URL("../extension/content/navigation-page.js", import.meta.url), "utf8"), pageContext);
  listener({ type: "navigate-teacher-module", module: "assignment" }, {}, (value) => { response = value; });
  assert.equal(response.started, true);
  assert.equal(clickedHref, "#");
  assert.equal(attributes.get("href"), "javascript:void(0);");
});

test("background keeps navigation gated and waits for the destination role", () => {
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  for (const expected of [
    "resolveCourseShellTab",
    "resolveCourseRoleTab",
    "resolveAttendanceTab",
    "waitForAttendanceTarget",
    "authenticationAwareFailure",
    "resolveTaskTab",
    "sendWithScriptFallback",
    "inspectableChaoxingFrame",
    "chrome.scripting.executeScript",
    "inspect-teacher-navigation",
    "navigate-teacher-module",
    "navigate-statistics-submodule",
    "waitForInspection",
  ]) assert.ok(background.includes(expected), expected);
  assert.match(background, /navigateTeacherModule\(tabId, "assignment"\)/);
  assert.match(background, /navigateTeacherModule\(tabId, "chapter"\)/);
  assert.match(background, /navigateTeacherModule\(tabId, "statistics"\)/);
  assert.match(background, /navigateStatisticsSubmodule\(tabId, "score"\)/);
  assert.match(background, /statisticsReady = navigationFrames\.some/);
  assert.match(background, /"scan-active-assignment-page": "assignment"/);
  assert.match(background, /"scan-active-chapter-tests": "chapter"/);
  assert.match(background, /"scan-active-score-overview": "statistics"/);
  assert.match(background, /resolveCourseRoleTab\(courseName, sender\)/);
  assert.match(background, /navigateTeacherModule\(tabId, "attendance"\)/);
  assert.match(background, /acquisitionState: "需人工登录"/);
});
