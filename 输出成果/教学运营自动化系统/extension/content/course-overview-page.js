(() => {
  const core = globalThis.LearningTongCourseOverviewScan; if (!core) return;
  function snapshotOverview() {
    const bodyText = document.body?.innerText || "";
    const statisticsRole = location.hostname === "stat2-ans.chaoxing.com" && /^\/stat2-vue\/(stat|base-data)/.test(location.pathname) && /(班级数|学情概览|课程资源建设概览|教学运行概况)/.test(bodyText);
    return { title: document.title, path: location.pathname, bodyText, statisticsRole, metrics: statisticsRole ? core.parseMetrics(bodyText) : {} };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-course-overview-frame") { sendResponse(snapshotOverview()); return undefined; }
    return undefined;
  });
})();
