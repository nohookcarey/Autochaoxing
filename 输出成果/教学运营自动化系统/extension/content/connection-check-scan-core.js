(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const roleLabels = {
    courseShell: "课程主页",
    assignment: "普通作业",
    chapter: "章节目录",
    statistics: "课程统计",
    score: "学生成绩",
    attendance: "班级活动",
  };

  function detectCourseName(snapshots, expectedCourse) {
    const matched = snapshots.find((snapshot) => normalize(`${snapshot.title || ""} ${snapshot.courseLabel || ""}`).includes(expectedCourse));
    if (!matched) return undefined;
    return normalize(matched.courseLabel || matched.title || "") || undefined;
  }

  function collectClassNames(snapshots) {
    return [...new Set(snapshots.flatMap((snapshot) => (Array.isArray(snapshot?.classNames) ? snapshot.classNames : []).map(normalize).filter(Boolean)))];
  }

  function aggregate(inspections, courseName) {
    const snapshots = (inspections || []).map((item) => item?.snapshot).filter(Boolean);
    const expectedCourse = normalize(courseName);
    const classNames = collectClassNames(snapshots);
    const courseContext = Boolean(expectedCourse) && snapshots.some((snapshot) => normalize(`${snapshot.title || ""} ${snapshot.courseLabel || ""}`).includes(expectedCourse));
    const detectedCourseName = courseContext ? detectCourseName(snapshots, expectedCourse) : undefined;
    const roles = Object.keys(roleLabels).filter((key) => snapshots.some((snapshot) => snapshot.roles?.[key]));
    const loginPage = snapshots.some((snapshot) => snapshot.loginPage);
    if (loginPage) return { acquisitionState: "需人工登录", reason: "当前标签页显示学习通登录页，请先在可见浏览器完成登录。", roles: [], courseContext };
    if (!courseContext) return { acquisitionState: "未获取", reason: `当前标签页未核验到课程“${expectedCourse || "未命名课程"}”。`, roles, courseContext };
    if (!roles.length) return { acquisitionState: "未获取", reason: "已识别课程名称，但当前页面不是已支持的教师业务页。", roles: [], courseContext, detectedCourseName, classNames };
    return {
      acquisitionState: "采集到",
      reason: `课程与教师页面连接正常；已识别：${roles.map((key) => roleLabels[key]).join("、")}。`,
      roles,
      roleLabels: roles.map((key) => roleLabels[key]),
      courseContext,
      detectedCourseName,
      classNames,
      signals: { courseContext: true, authenticatedTeacherPage: true, recognizedRole: true },
    };
  }

  function findCourseListEntry(inspections, courseName) {
    const expected = normalize(courseName);
    if (!expected) return undefined;
    return (inspections || [])
      .flatMap((item) => item?.snapshot?.courseList || [])
      .find((course) => normalize(course?.name) === expected);
  }

  function findCourseShellSnapshot(snapshots) {
    return snapshots.find((snapshot) => (snapshot.roles?.courseShell || snapshot.roles?.statistics) && normalize(snapshot.courseLabel || snapshot.title || ""));
  }

  globalThis.LearningTongConnectionCheck = { aggregate, normalize, roleLabels, findCourseListEntry, findCourseShellSnapshot };
})();
