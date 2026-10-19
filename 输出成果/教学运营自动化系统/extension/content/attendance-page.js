(() => {
  const core = globalThis.LearningTongAttendanceScan;
  if (!core) return;

  const requestTimeout = 18000;

  function attendanceContext() {
    const params = new URLSearchParams(location.search);
    const bodyText = document.body?.innerText || "";
    const pageRole = core.attendancePageRole(location.hostname, location.pathname, bodyText);
    return {
      title: document.title,
      path: location.pathname,
      bodyText,
      attendanceRole: Boolean(pageRole),
      attendancePageRole: pageRole,
      courseId: params.get("courseId") || "",
      classId: params.get("classId") || "",
      fid: params.get("fid") || "",
    };
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function runPool(items, worker, concurrency = 4) {
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
    return results;
  }

  function endpoint(path, parameters) {
    const url = new URL(path, location.origin);
    url.search = new URLSearchParams(parameters).toString();
    return url.href;
  }

  async function scanAttendance(profile, { withStudents = false } = {}) {
    const context = attendanceContext();
    if (!context.attendanceRole || context.courseId !== profile.courseId) {
      return { acquisitionState: "未获取", reason: "当前页面不是目标课程的教师端班级活动页。" };
    }
    try {
      const classData = await fetchJson(endpoint("/v2/apis/class/getClassList", {
        courseId: profile.courseId,
        isHaveAuth: "1",
        isfiled: "0",
        isNewList: "1",
      }));
      const classes = core.extractClassArray(classData);
      const classByName = new Map(classes.map((item) => [core.normalize(item.name), item]));
      const missing = profile.classNames.filter((name) => !classByName.has(core.normalize(name)));
      if (missing.length) return { acquisitionState: "未获取", reason: `活动页未找到目标班级：${missing.join("、")}。` };

      const classSummary = [];
      const classStudents = [];
      for (const className of profile.classNames) {
        const classInfo = classByName.get(core.normalize(className));
        const activityData = await fetchJson(endpoint("/v2/apis/active/pcActivelist", {
          fid: profile.fid,
          courseId: profile.courseId,
          classId: String(classInfo.id),
          types: "",
          userid: "",
          groupId: "",
          _: String(Date.now()),
        }));
        const activities = core.extractSignActivities(activityData);
        if (!activities.length) {
          classSummary.push(core.summarizeClass({ className, studentCount: Number(classInfo.studentcount || 0), activities: [] }));
          if (withStudents) classStudents.push({ className, students: [] });
          continue;
        }
        const attendanceResults = await runPool(activities, async (activity) => {
          try {
            const data = await fetchJson(endpoint("/widget/sign/pcTeaSignController/getAttendList", {
              activeId: String(activity.activeId),
              appType: "15",
              classId: String(classInfo.id),
              courseId: profile.courseId,
              fid: profile.fid,
            }));
            return data.result === 1 && data.data ? { ok: true, data: data.data } : { ok: false };
          } catch {
            return { ok: false };
          }
        }, 4);
        classSummary.push(core.summarizeClass({
          className,
          studentCount: Number(classInfo.studentcount || 0),
          activities: attendanceResults,
        }));
        if (withStudents) classStudents.push(core.collectClassStudents(className, attendanceResults));
      }
      const payload = core.aggregateClassSummaries(classSummary, profile.classNames.length);
      if (withStudents && payload.acquisitionState !== "未获取") {
        payload.studentRecords = classStudents.flatMap((item) => item.students);
        payload.anomalyStudentCount = payload.studentRecords.filter((student) => student.anomalyCount > 0).length;
      }
      return payload;
    } catch (error) {
      const message = error?.name === "AbortError" ? "请求超时" : core.normalize(error?.message || error);
      return { acquisitionState: "未获取", reason: `签到只读扫描失败：${message}` };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-attendance-frame") {
      sendResponse(attendanceContext());
      return undefined;
    }
    if (message?.type === "scan-attendance-anomalies") {
      scanAttendance(message.profile).then(sendResponse);
      return true;
    }
    if (message?.type === "scan-attendance-students") {
      scanAttendance(message.profile, { withStudents: true }).then(sendResponse);
      return true;
    }
    return undefined;
  });
})();
