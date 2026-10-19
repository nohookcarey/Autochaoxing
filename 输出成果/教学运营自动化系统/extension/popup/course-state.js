(() => {
  function courseList(courses) {
    return Array.isArray(courses) ? courses : [];
  }

  function activeCourses(courses) {
    return courseList(courses).filter((course) => course?.archived !== true);
  }

  function archivedCourses(courses) {
    return courseList(courses).filter((course) => course?.archived === true);
  }

  function archiveCourse(courses, courseId) {
    const active = activeCourses(courses);
    const target = active.find((course) => course.id === courseId);
    if (!target) return { ok: false, reason: "当前课程不在可归档列表中。", courses: courseList(courses) };
    if (active.length <= 1) return { ok: false, reason: "至少保留一门当前课程。", courses: courseList(courses) };
    const nextActive = active.find((course) => course.id !== courseId);
    return {
      ok: true,
      courses: courseList(courses).map((course) => course.id === courseId ? { ...course, archived: true } : course),
      nextActiveId: nextActive.id,
    };
  }

  function restoreCourse(courses, courseId) {
    const target = archivedCourses(courses).find((course) => course.id === courseId);
    if (!target) return { ok: false, reason: "未找到该归档课程。", courses: courseList(courses) };
    return {
      ok: true,
      courses: courseList(courses).map((course) => course.id === courseId ? { ...course, archived: false } : course),
      restoredCourseId: courseId,
    };
  }

  function deleteCourse(courses, courseId) {
    const list = courseList(courses);
    const target = list.find((course) => course.id === courseId);
    if (!target) return { ok: false, reason: "未找到该课程。", courses: list };
    if (target.archived !== true) return { ok: false, reason: "仅已归档课程可删除；当前课程请先归档。", courses: list };
    return {
      ok: true,
      courses: list.filter((course) => course.id !== courseId),
      deletedCourseId: courseId,
    };
  }

  globalThis.LearningTongCourseState = Object.freeze({ activeCourses, archivedCourses, archiveCourse, restoreCourse, deleteCourse });
})();
