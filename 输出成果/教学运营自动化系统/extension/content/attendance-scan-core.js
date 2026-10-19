(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const normalStatusCodes = new Set([1, 2, 39331, 39332, 39333, 39334]);
  const statusLabels = new Map([
    [0, "未签到"],
    [5, "缺勤"],
    [7, "病假"],
    [8, "事假"],
    [9, "迟到"],
    [10, "早退"],
    [12, "公假"],
  ]);

  function attendancePageRole(hostname, path, bodyText) {
    if (hostname !== "mobilelearn.chaoxing.com") return "";
    const text = normalize(bodyText);
    if (/\/page\/active\/activeList/.test(path)
      && text.includes("活动类型")
      && text.includes("活动状态")
      && text.includes("添加活动")) return "active-list";
    if (/\/page\/class\/classList/.test(path)
      && text.includes("学生人数")
      && text.includes("活动列表")) return "class-list";
    return "";
  }

  function extractClassArray(data) {
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.classArray)) return data.data.classArray;
    return [];
  }

  function extractSignActivities(data) {
    const list = Array.isArray(data?.data?.activeList) ? data.data.activeList : [];
    return list.filter((item) => Number(item.activeType) === 2 && /签到/.test(normalize(item.title || item.typeTitle)));
  }

  function isValidStudentId(value) {
    return /^\d{12,}$/.test(normalize(value));
  }

  function summarizeClass({ className, studentCount, activities }) {
    const students = new Set();
    const anomalyStudents = new Set();
    const statusCounts = {};
    const unknownStatuses = new Set();
    let anomalyRecordCount = 0;
    let invalidIdentityRows = 0;
    let failedActivityCount = 0;

    for (const activity of activities || []) {
      if (!activity?.ok || !activity.data) {
        failedActivityCount += 1;
        continue;
      }
      for (const [bucketName, rows] of [["yiqianList", activity.data.yiqianList], ["weiqianList", activity.data.weiqianList]]) {
        for (const row of Array.isArray(rows) ? rows : []) {
          const studentId = normalize(row.username);
          if (isValidStudentId(studentId)) students.add(studentId);
          else invalidIdentityRows += 1;
          const code = Number(row.status || 0);
          const label = statusLabels.get(code);
          const isKnownAnomaly = Boolean(label) && (code !== 0 || bucketName === "weiqianList");
          if (isKnownAnomaly) {
            anomalyRecordCount += 1;
            statusCounts[label] = (statusCounts[label] || 0) + 1;
            if (studentId) anomalyStudents.add(studentId);
          } else if (!normalStatusCodes.has(code)) {
            unknownStatuses.add(`${code}@${bucketName}`);
          }
        }
      }
    }

    const collectedStudentCount = students.size;
    const complete = (activities || []).length > 0
      && failedActivityCount === 0
      && unknownStatuses.size === 0
      && invalidIdentityRows === 0
      && collectedStudentCount === studentCount;
    return {
      className,
      studentCount,
      collectedStudentCount,
      signActivityCount: (activities || []).length,
      anomalyStudentCount: anomalyStudents.size,
      anomalyRecordCount,
      statusCounts,
      invalidIdentityRows,
      failedActivityCount,
      unknownStatuses: [...unknownStatuses],
      scopeState: complete ? "已验证" : "未获取",
      complete,
    };
  }

  function collectClassStudents(className, activities) {
    const byStudent = new Map();
    const record = (row, bucketName) => {
      const studentId = normalize(row.username);
      if (!isValidStudentId(studentId)) return;
      const existing = byStudent.get(studentId) || {
        name: normalize(row.name || row.userName || row.realName),
        username: studentId,
        className,
        anomalyCount: 0,
        anomalyDetail: {},
      };
      if (!existing.name) existing.name = normalize(row.name || row.userName || row.realName);
      const code = Number(row.status || 0);
      const label = statusLabels.get(code);
      const isKnownAnomaly = Boolean(label) && (code !== 0 || bucketName === "weiqianList");
      if (isKnownAnomaly) {
        existing.anomalyCount += 1;
        existing.anomalyDetail[label] = (existing.anomalyDetail[label] || 0) + 1;
      }
      byStudent.set(studentId, existing);
    };
    for (const activity of activities || []) {
      if (!activity?.ok || !activity.data) continue;
      for (const [bucketName, rows] of [["yiqianList", activity.data.yiqianList], ["weiqianList", activity.data.weiqianList]]) {
        for (const row of Array.isArray(rows) ? rows : []) record(row, bucketName);
      }
    }
    return {
      className,
      students: [...byStudent.values()].map((student) => ({
        ...student,
        anomalySummary: Object.entries(student.anomalyDetail).map(([label, count]) => `${label}×${count}`).join("、"),
      })),
    };
  }

  function aggregateClassSummaries(classSummary, expectedClassCount) {
    if (!Array.isArray(classSummary) || classSummary.length !== expectedClassCount) {
      return { acquisitionState: "未获取", reason: "签到扫描未完整覆盖目标班级。", classSummary: classSummary || [] };
    }
    const complete = classSummary.every((item) => item.complete);
    const anomalyRecordCount = classSummary.reduce((total, item) => total + item.anomalyRecordCount, 0);
    const signActivityCount = classSummary.reduce((total, item) => total + item.signActivityCount, 0);
    if (!complete) {
      const invalid = classSummary.reduce((total, item) => total + item.invalidIdentityRows, 0);
      const failed = classSummary.reduce((total, item) => total + item.failedActivityCount, 0);
      const unknown = classSummary.flatMap((item) => item.unknownStatuses);
      return {
        acquisitionState: "未获取",
        reason: `已获取 ${signActivityCount} 个签到活动的活动级汇总，但学生级门禁未通过：缺失有效学号 ${invalid} 条，失败活动 ${failed} 个，未知状态 ${unknown.length} 种。本结果不可用于回填。`,
        partialScope: true,
        signActivityCount,
        anomalyRecordCount,
        classSummary,
      };
    }
    return {
      acquisitionState: anomalyRecordCount > 0 ? "采集到" : "确认无数据",
      reason: anomalyRecordCount > 0
        ? `已完整核验 ${signActivityCount} 个签到活动，共发现 ${anomalyRecordCount} 条异常记录。`
        : `已完整核验 ${signActivityCount} 个签到活动，目标范围确认无异常。`,
      signActivityCount,
      anomalyRecordCount,
      classSummary,
    };
  }

  globalThis.LearningTongAttendanceScan = {
    aggregateClassSummaries,
    attendancePageRole,
    collectClassStudents,
    extractClassArray,
    extractSignActivities,
    isValidStudentId,
    normalize,
    summarizeClass,
  };
})();
