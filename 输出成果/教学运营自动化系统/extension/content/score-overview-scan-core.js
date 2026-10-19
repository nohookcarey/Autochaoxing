(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function numberAfter(text, label) {
    const source = normalize(text);
    const index = source.indexOf(label);
    if (index < 0) return undefined;
    const match = source.slice(index + label.length, index + label.length + 48).match(/([\d,.]+)/);
    return match ? Number(match[1].replaceAll(",", "")) : undefined;
  }

  function parseSummary(text, classNames = []) {
    const source = normalize(text);
    const headerEnd = source.indexOf("一键导出");
    const header = source.slice(0, headerEnd > 0 ? headerEnd : 180);
    const allowedClasses = classNames.map(normalize).filter(Boolean);
    const activeClass = allowedClasses.find((name) => header.includes(name));
    const averageScore = numberAfter(source, "综合成绩平均分");
    const excellentCount = numberAfter(source, "100≥学生成绩≥80");
    const passCount = numberAfter(source, "80>学生成绩≥60");
    const lowScoreCount = numberAfter(source, "60>学生成绩≥0");
    const values = [averageScore, excellentCount, passCount, lowScoreCount];
    return {
      activeClass,
      averageScore,
      excellentCount,
      passCount,
      lowScoreCount,
      studentCount: values.slice(1).every(Number.isFinite) ? excellentCount + passCount + lowScoreCount : undefined,
      complete: Boolean(activeClass) && values.every(Number.isFinite),
    };
  }

  function aggregate(inspections, profile = {}) {
    const snapshots = (inspections || []).map((item) => item?.snapshot).filter(Boolean);
    const expectedCourse = normalize(profile.courseName);
    const classNames = Array.isArray(profile.classNames) ? profile.classNames.map(normalize).filter(Boolean) : [];
    const courseContext = Boolean(expectedCourse) && snapshots.some((snapshot) => normalize(`${snapshot.title || ""} ${snapshot.courseLabel || ""}`).includes(expectedCourse));
    const scoreFrame = snapshots.find((snapshot) => snapshot.scoreRole);
    if (!courseContext) return { acquisitionState: "未获取", reason: `当前页面未核验到课程“${expectedCourse || "未命名课程"}”。` };
    if (!scoreFrame) return { acquisitionState: "未获取", reason: "请先在当前课程点击“统计 → 学生成绩”，等待成绩页显示后再读取。" };
    if (!classNames.includes(normalize(scoreFrame.summary?.activeClass))) return { acquisitionState: "未获取", reason: "当前成绩页班级不在已保存的班级白名单中。" };
    if (!scoreFrame.summary?.complete) return { acquisitionState: "未获取", reason: "成绩页已打开，但平均分或分数段人数尚未完整加载。" };
    return {
      acquisitionState: "采集到",
      reason: `已核验成绩页和班级白名单，仅返回“${scoreFrame.summary.activeClass}”的平均分与分数段汇总；未读取或返回学生姓名、学号和个人成绩。`,
      summary: scoreFrame.summary,
      signals: { courseContext: true, scoreRole: true, classScopeVerified: true, aggregateOnly: true },
    };
  }

  function parseStudentTable(rows) {
    if (!Array.isArray(rows) || !rows.length) return { students: [], complete: false, reason: "成绩页未返回学生表格。" };
    let headerIndex = -1;
    let header = null;
    for (let i = 0; i < rows.length; i += 1) {
      const texts = (rows[i] || []).map(normalize);
      if (texts.some((text) => /姓名/.test(text)) && texts.some((text) => /学号|工号/.test(text))) {
        header = texts;
        headerIndex = i;
        break;
      }
    }
    if (!header) return { students: [], complete: false, reason: "未在成绩页找到含“姓名/学号”表头的学生表格。" };
    const nameIndex = header.findIndex((text) => /姓名/.test(text));
    const idIndex = header.findIndex((text) => /学号|工号/.test(text));
    let scoreIndex = header.findIndex((text) => /综合成绩|总成绩|总评成绩/.test(text));
    if (scoreIndex < 0) scoreIndex = header.findIndex((text) => /期末成绩|最终成绩/.test(text));
    if (scoreIndex < 0) scoreIndex = header.findIndex((text) => /成绩|分数/.test(text) && !/平均|平时/.test(text));
    if (scoreIndex < 0) return { students: [], complete: false, reason: "未在成绩表头中找到成绩列。" };

    const students = [];
    const seen = new Set();
    for (let i = 0; i < rows.length; i += 1) {
      if (i === headerIndex) continue;
      const cells = (rows[i] || []).map(normalize);
      const name = cells[nameIndex];
      const username = cells[idIndex];
      const rawScore = String(cells[scoreIndex] || "");
      const score = Number(rawScore);
      if (!name || !/^[\u4e00-\u9fa5·]{2,10}$/.test(name)) continue;
      if (!/^\d{6,}$/.test(username)) continue;
      if (!Number.isFinite(score) || score < 0 || score > 1000) continue;
      const key = `${username}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      students.push({ name, username, score });
    }
    return {
      students,
      complete: students.length > 0,
      reason: students.length ? `已读取 ${students.length} 名学生的综合成绩。` : "成绩表格存在但未解析到有效学生行。",
    };
  }

  globalThis.LearningTongScoreOverviewScan = { aggregate, normalize, numberAfter, parseSummary, parseStudentTable };
})();
