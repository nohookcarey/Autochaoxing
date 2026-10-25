async (page) => {
  if (globalThis.process?.env?.XTX_ENABLE_LEGACY_WRITES !== "reviewed") throw new Error("旧版写入入口默认停用；请先审查脚本并明确配置本次范围，推荐使用教师扩展。");
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page.goto:.*closed/i.test(message);
  };

  try {
  function parseTimeout(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  const TIMEOUTS = {
    actionTimeout: parseTimeout(process.env.ACTION_TIMEOUT, 15000),
    navigationTimeout: parseTimeout(process.env.NAVIGATION_TIMEOUT, 45000),
    taskFuseTimeout: parseTimeout(process.env.TASK_FUSE_TIMEOUT, 120000),
    retryTimes: parseTimeout(process.env.RETRY_TIMES, 2),
  };

  page.setDefaultTimeout(TIMEOUTS.actionTimeout);
  page.setDefaultNavigationTimeout(TIMEOUTS.navigationTimeout);

  // 修改这里的参数后执行。本脚本适用于已经登录学习通的浏览器会话。
  const CONFIG = {
    courseId: "",
    cpi: "",
    classId: "",
    workId: "",
    expectedClassName: "3班",
    expectedTitleIncludes: "",
    scoringRuleNote: "",
    score: 93,
    answerIds: [
      // 在这里填入 workAnswerId，例如：
      // "55315472",
      // "55315497",
    ],
  };

  async function withTaskFuse(task, timeoutMs, label) {
    let timer = null;
    try {
      return await Promise.race([
        task(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} 超时，已熔断（${timeoutMs}ms）`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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

  async function setScoreOnly(score) {
    await page.locator(".questionScore").fill(String(score));
    await page.locator("#tmpscore").fill(String(score));
  }

  if (!String(CONFIG.scoringRuleNote || "").trim()) {
    throw new Error("请先填写 CONFIG.scoringRuleNote，记录本次已确认的评分准则后再运行。");
  }

  const results = [];
  for (const answerId of CONFIG.answerIds) {
    const url = buildReviewUrl({
      courseId: CONFIG.courseId,
      classId: CONFIG.classId,
      workId: CONFIG.workId,
      answerId,
      cpi: CONFIG.cpi,
    });

    await withRetries(
      () =>
        withTaskFuse(async () => {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: TIMEOUTS.navigationTimeout,
          });
          await page.waitForLoadState("domcontentloaded");
          await page.locator("#workAnswerId").waitFor({
            state: "attached",
            timeout: TIMEOUTS.actionTimeout,
          });
        }, TIMEOUTS.taskFuseTimeout, `打开批阅页 ${answerId}`),
      TIMEOUTS.retryTimes,
      `打开批阅页 ${answerId}`
    );

    const info = await page.evaluate(() => ({
      studentName: document.querySelector("#stuRealName")?.value || "",
      className: document.querySelector("#className")?.value || "",
      workTitle: document.querySelector("#_title")?.value || "",
      answerId: document.querySelector("#workAnswerId")?.value || "",
    }));

    if (String(info.answerId) !== String(answerId)) {
      results.push({ answerId, info, status: "skip_answer_mismatch" });
      continue;
    }
    if (CONFIG.expectedClassName && info.className !== CONFIG.expectedClassName) {
      results.push({ answerId, info, status: "skip_class_mismatch" });
      continue;
    }
    if (CONFIG.expectedTitleIncludes && !info.workTitle.includes(CONFIG.expectedTitleIncludes)) {
      results.push({ answerId, info, status: "skip_title_mismatch" });
      continue;
    }

    await withRetries(
      () =>
        withTaskFuse(async () => {
          await setScoreOnly(CONFIG.score);
          await page.locator("a.btnBlue").filter({ hasText: "提交" }).click();
          await page.waitForTimeout(900);
        }, TIMEOUTS.taskFuseTimeout, `提交批阅 ${answerId}`),
      TIMEOUTS.retryTimes,
      `提交批阅 ${answerId}`
    );

    const body = await page.locator("body").innerText().catch(() => "");
    results.push({
      answerId,
      studentName: info.studentName,
      className: info.className,
      scoringRuleNote: CONFIG.scoringRuleNote,
      status: body.includes("批阅成功") || page.url().includes("/work/mark?") ? "saved" : "unknown",
    });
  }

  return results;
  } catch (error) {
    if (isBrowserClosedError(error)) {
      return {
        safeExit: true,
        status: 'manual_browser_exit',
        message: '浏览器已手动关闭，脚本已安全退出。',
      };
    }
    throw error;
  }
}