async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || "");
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page\.goto:.*closed/i.test(message);
  };

  try {
  const CONFIG = {
    // 每次执行前必须明确填写本次评分口径。
    scoringRuleNote: "",
    jobs: [],
    // 兼容旧用法：当 jobs 为空时，可填写下列字段 + answerIds 自动组装。
    courseId: "",
    cpi: "",
    classId: "",
    workId: "",
    expectedClassName: "",
    expectedTitleIncludes: "",
    score: 0,
    answerIds: [],
  };

  function normalizeTitle(value) {
    return String(value || "")
      .replace(/[：:]/g, "")
      .replace(/[（）()]/g, "")
      .replace(/[-—]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function buildReviewUrl({ courseId, classId, workId, answerId, cpi }) {
    const params = new URLSearchParams({
      courseid: courseId,
      clazzid: classId,
      workId,
      workAnswerId: answerId,
      groupId: "0",
      from: "",
      sort: "0",
      order: "0",
      status: "0",
      pages: "1",
      size: "20",
      topicid: "0",
      backurl: "",
    });
    if (cpi) params.set("cpi", cpi);
    return `https://mooc2-ans.chaoxing.com/mooc2-ans/work/library/review-work?${params.toString()}`;
  }

  function buildJobsFromLegacyConfig() {
    return (CONFIG.answerIds || []).map((answerId) => ({
      title: CONFIG.expectedTitleIncludes || "",
      className: CONFIG.expectedClassName || "",
      score: CONFIG.score,
      actionData: buildReviewUrl({
        courseId: CONFIG.courseId,
        classId: CONFIG.classId,
        workId: CONFIG.workId,
        answerId,
        cpi: CONFIG.cpi,
      }),
    }));
  }

  async function withRetries(task, retryTimes, label) {
    let lastError = null;
    for (let attempt = 0; attempt <= retryTimes; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (attempt === retryTimes) break;
      }
    }
    lastError.message = `${label} 失败：${lastError.message}`;
    throw lastError;
  }

  async function setScoreOnly(score) {
    await page.locator(".questionScore").fill(String(score));
    await page.locator("#tmpscore").fill(String(score));
  }

  if (!String(CONFIG.scoringRuleNote || "").trim()) {
    throw new Error("请先填写 CONFIG.scoringRuleNote，记录本次已确认的评分准则后再运行。");
  }

  const jobs = Array.isArray(CONFIG.jobs) && CONFIG.jobs.length
    ? CONFIG.jobs
    : buildJobsFromLegacyConfig();

  if (!jobs.length) {
    throw new Error("没有可执行的 jobs。请填写 CONFIG.jobs，或填写旧版 answerIds 参数。");
  }

  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);

  const results = [];
  for (const job of jobs) {
    const url = String(job.actionData || "").startsWith("http")
      ? job.actionData
      : `https://mooc2-ans.chaoxing.com${job.actionData || ""}`;

    try {
      await withRetries(async () => {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await page.waitForLoadState("domcontentloaded");
        await page.locator("#workAnswerId").waitFor({
          state: "attached",
          timeout: 15000,
        });
      }, 2, `打开批阅页 ${job.name || job.actionData || ""}`);

      const info = await page.evaluate(() => ({
        studentName: document.querySelector("#stuRealName")?.value || "",
        answerId: document.querySelector("#workAnswerId")?.value || "",
        workTitle: document.querySelector("#_title")?.value || "",
        className: (document.body.innerText.match(/汽车智能\d班/) || [""])[0],
      }));

      if (job.className && info.className && info.className !== job.className) {
        results.push({ ...job, info, status: "skip_class_mismatch" });
        continue;
      }
      if (
        job.title &&
        info.workTitle &&
        !normalizeTitle(info.workTitle).includes(normalizeTitle(job.title))
      ) {
        results.push({ ...job, info, status: "skip_title_mismatch" });
        continue;
      }

      await withRetries(async () => {
        await setScoreOnly(job.score);
        await page.locator("a.btnBlue").filter({ hasText: "提交" }).click();
        await page.waitForTimeout(1200);
      }, 2, `提交批阅 ${info.studentName || job.name || ""}`);

      const body = await page.locator("body").innerText().catch(() => "");
      const saved = body.includes("批阅成功") || page.url().includes("/work/mark?");
      results.push({
        ...job,
        studentName: info.studentName,
        studentNo: job.studentNo || "",
        savedAnswerId: info.answerId,
        scoringRuleNote: CONFIG.scoringRuleNote,
        status: saved ? "saved" : "unknown",
      });
    } catch (error) {
      results.push({
        ...job,
        scoringRuleNote: CONFIG.scoringRuleNote,
        status: "error",
        error: String(error),
      });
    }
  }

  const scoreTable = results
    .filter((item) => item.status === "saved")
    .map((item) => ({
      className: item.className || "",
      title: item.title || "",
      studentName: item.studentName || item.name || "",
      studentNo: item.studentNo || "",
      score: item.score,
    }));

  return {
    scoringRuleNote: CONFIG.scoringRuleNote,
    results,
    scoreTable,
  };
  } catch (error) {
    if (isBrowserClosedError(error)) {
      return {
        safeExit: true,
        status: "manual_browser_exit",
        message: "浏览器已手动关闭，脚本已安全退出。",
      };
    }
    throw error;
  }
}
