(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  function aggregate(inspections, courseName) {
    const snapshots = (inspections || []).map((item) => item?.snapshot).filter(Boolean);
    const expectedCourse = normalize(courseName);
    const courseContext = Boolean(expectedCourse) && snapshots.some((snapshot) => normalize(`${snapshot.title || ""} ${snapshot.courseLabel || ""}`).includes(expectedCourse));
    const chapterFrame = snapshots.find((snapshot) => snapshot.chapterRole);
    if (!courseContext) return { acquisitionState: "未获取", reason: `当前页面未核验到课程“${expectedCourse || "未命名课程"}”。` };
    if (!chapterFrame) return { acquisitionState: "未获取", reason: "请先在当前课程点击“章节”，等待章节目录显示后再检查。" };
    const summary = chapterFrame.summary;
    if (!summary?.chapterCount || !summary?.sectionCount || summary.chapters?.length !== summary.chapterCount) return { acquisitionState: "未获取", reason: "章节页已打开，但章节结构尚未完整加载。" };
    return { acquisitionState: "采集到", reason: `已核验课程章节页，读取 ${summary.chapterCount} 个一级章节、${summary.sectionCount} 个小节和 ${summary.taskPointCount} 个任务点；未修改章节内容。`, summary, signals: { courseContext: true, chapterRole: true, structureOnly: true } };
  }
  globalThis.LearningTongChapterStructureScan = { aggregate, normalize };
})();
