import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../extension/popup/course-state.js", import.meta.url), "utf8"), context);
const courseState = context.globalThis.LearningTongCourseState;

const courses = [
  { id: "active-a", name: "课程 A", classNames: ["A 班"] },
  { id: "active-b", name: "课程 B", classNames: ["B 班"], archived: false },
  { id: "archived-c", name: "课程 C", classNames: ["C 班"], archived: true },
];

test("legacy courses without archived field remain active", () => {
  assert.deepEqual(Array.from(courseState.activeCourses(courses), (course) => course.id), ["active-a", "active-b"]);
  assert.deepEqual(Array.from(courseState.archivedCourses(courses), (course) => course.id), ["archived-c"]);
});

test("archive keeps course data and selects another active course", () => {
  const outcome = courseState.archiveCourse(courses, "active-a");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.nextActiveId, "active-b");
  assert.equal(outcome.courses.find((course) => course.id === "active-a").archived, true);
  assert.deepEqual(Array.from(outcome.courses.find((course) => course.id === "active-a").classNames), ["A 班"]);
  assert.equal(courses[0].archived, undefined, "pure helper must not mutate source state");
});

test("last active course cannot be archived", () => {
  const outcome = courseState.archiveCourse([{ id: "only", archived: false }, { id: "old", archived: true }], "only");
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /至少保留一门/);
});

test("archived course can be restored without losing scope", () => {
  const outcome = courseState.restoreCourse(courses, "archived-c");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.restoredCourseId, "archived-c");
  const restored = outcome.courses.find((course) => course.id === "archived-c");
  assert.equal(restored.archived, false);
  assert.deepEqual(Array.from(restored.classNames), ["C 班"]);
});

test("archived course can be deleted permanently from the local list", () => {
  const outcome = courseState.deleteCourse(courses, "archived-c");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.deletedCourseId, "archived-c");
  assert.equal(outcome.courses.some((course) => course.id === "archived-c"), false);
  assert.deepEqual(Array.from(outcome.courses, (course) => course.id), ["active-a", "active-b"]);
  assert.equal(courses.length, 3, "pure helper must not mutate source state");
});

test("active course cannot be deleted directly", () => {
  const outcome = courseState.deleteCourse(courses, "active-a");
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /仅已归档课程可删除/);
  assert.deepEqual(Array.from(outcome.courses, (course) => course.id), ["active-a", "active-b", "archived-c"]);
});

test("deleting an unknown course id fails without changes", () => {
  const outcome = courseState.deleteCourse(courses, "missing");
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /未找到该课程/);
  assert.equal(outcome.courses.length, 3);
});
