(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const definitions = [
    ["classCount", "班级数", "个"], ["studentCount", "选课学生数", "人"],
    ["courseActivityCount", "课程活动数", "次"], ["coursePageViews", "课程访问量(pv值)", "次"],
    ["chapterResourceCount", "章节资源总数", "个"], ["materialResourceCount", "资料资源总数", "个"],
    ["questionBankCount", "题库题目总数", "个"], ["createdAssignmentCount", "创建作业", "个"],
    ["publishedAssignmentCount", "发布作业", "次"], ["submittedAssignmentCount", "提交作业", "份"],
    ["createdPaperCount", "创建试卷", "个"], ["publishedExamCount", "发布考试", "次"],
    ["submittedExamCount", "考试提交总数", "份"], ["publishedChapterTestCount", "发布测验数", "个"],
    ["completedChapterTestCount", "完成测验数", "个"],
  ];
  function numberAfter(text, label) {
    const source = normalize(text); let from = 0;
    while (from < source.length) {
      const index = source.indexOf(label, from); if (index < 0) return undefined;
      const preceding = index > 0 ? source[index - 1] : "";
      if (!preceding || /[\s:：,，;；。]/.test(preceding)) {
        const match = source.slice(index + label.length, index + label.length + 48).match(/([\d,]+)/);
        return match ? Number(match[1].replaceAll(",", "")) : undefined;
      }
      from = index + label.length;
    }
    return undefined;
  }
  function section(text, startLabel, endLabel) {
    const source = normalize(text); const start = source.indexOf(startLabel); if (start < 0) return "";
    const end = endLabel ? source.indexOf(endLabel, start + startLabel.length) : -1;
    return source.slice(start, end > start ? end : undefined);
  }
  function parseMetrics(text) {
    const source = normalize(text); const metrics = {};
    for (const [key, label, unit] of definitions.slice(0, 12)) {
      const value = numberAfter(source, label); if (Number.isFinite(value)) metrics[key] = { label, value, unit };
    }
    const submittedExamCount = numberAfter(section(source, "考试", "章节测验"), "提交总数");
    if (Number.isFinite(submittedExamCount)) metrics.submittedExamCount = { label: "考试提交总数", value: submittedExamCount, unit: "份" };
    for (const [key, label, unit] of definitions.slice(13)) {
      const value = numberAfter(source, label); if (Number.isFinite(value)) metrics[key] = { label, value, unit };
    }
    return metrics;
  }
  function aggregate(inspections, courseName) {
    const snapshots = (inspections || []).map((item) => item?.snapshot).filter(Boolean);
    const expectedCourse = normalize(courseName);
    const courseContext = Boolean(expectedCourse) && snapshots.some((snapshot) => normalize(snapshot.bodyText).includes(expectedCourse));
    const statisticsFrames = snapshots.filter((snapshot) => snapshot.statisticsRole);
    const metrics = Object.assign({}, ...statisticsFrames.map((snapshot) => snapshot.metrics || {}));
    const requiredHeader = Number.isFinite(metrics.classCount?.value) && Number.isFinite(metrics.studentCount?.value);
    const requiredDetail = ["chapterResourceCount", "createdAssignmentCount", "publishedChapterTestCount"].some((key) => Number.isFinite(metrics[key]?.value));
    if (!courseContext) return { acquisitionState: "未获取", reason: `当前页面未核验到课程“${expectedCourse || "未命名课程"}”。`, metrics: {} };
    if (!statisticsFrames.length) return { acquisitionState: "未获取", reason: "请先在当前课程点击“统计”，等待课程统计页显示后再读取。", metrics: {} };
    if (!requiredHeader || !requiredDetail) return { acquisitionState: "未获取", reason: "统计页已打开，但课程总览或基础数据尚未完整加载。", metrics };
    return { acquisitionState: "采集到", reason: `已核验课程统计页与基础数据页，读取 ${Object.keys(metrics).length} 项课程聚合指标；未读取学生姓名或个人成绩。`, metricCount: Object.keys(metrics).length, metrics, signals: { courseContext: true, statisticsRole: true, aggregateOnly: true } };
  }
  globalThis.LearningTongCourseOverviewScan = { aggregate, definitions, normalize, numberAfter, parseMetrics, section };
})();
