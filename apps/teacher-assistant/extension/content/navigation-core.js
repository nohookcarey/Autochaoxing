(() => {
  const normalize = (value) => String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
  const labels = { assignment: "作业", chapter: "章节", statistics: "统计", attendance: "班级活动", score: "学生成绩" };
  const moduleLabel = (module) => labels[module] || "";
  const courseShellRole = (path) => path === "/mooc2-ans/mycourse/tch";
  const statisticsShellRole = (hostname, path, bodyText) => hostname === "stat2-ans.chaoxing.com" && path === "/stat2-vue/base-data" && /基础数据/.test(normalize(bodyText)) && /学生成绩/.test(normalize(bodyText));
  const javascriptHref = (value) => /^javascript\s*:/i.test(String(value || "").trim());
  globalThis.LearningTongNavigation = { normalize, moduleLabel, courseShellRole, statisticsShellRole, javascriptHref };
})();
