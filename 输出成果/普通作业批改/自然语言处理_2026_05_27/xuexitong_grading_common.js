function parseTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getTimeoutConfig() {
  return {
    actionTimeout: parseTimeout(process.env.ACTION_TIMEOUT, 15000),
    navigationTimeout: parseTimeout(process.env.NAVIGATION_TIMEOUT, 45000),
    taskFuseTimeout: parseTimeout(process.env.TASK_FUSE_TIMEOUT, 120000),
    retryTimes: parseTimeout(process.env.RETRY_TIMES, 2),
  };
}

function configurePage(page) {
  const config = getTimeoutConfig();
  page.setDefaultTimeout(config.actionTimeout);
  page.setDefaultNavigationTimeout(config.navigationTimeout);
  return config;
}

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

async function setScoreAndComment(page, score, comment) {
  await page.locator(".questionScore").fill(String(score));
  await page.locator("#tmpscore").fill(String(score));

  await page.evaluate((text) => {
    document.querySelectorAll(".kark_comment_text").forEach((el) => {
      el.textContent = text;
      el.innerText = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    document
      .querySelectorAll("textarea[id^=answer], textarea[id^=comment]")
      .forEach((el) => {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
  }, comment);
}

async function gradeOneAnswer(page, config, answerId) {
  const timeouts = configurePage(page);
  const url = buildReviewUrl({
    courseId: config.courseId,
    classId: config.classId,
    workId: config.workId,
    answerId,
    cpi: config.cpi,
  });

  await withRetries(
    () =>
      withTaskFuse(async () => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeouts.navigationTimeout });
        await page.waitForLoadState("domcontentloaded");
        await page.locator("#workAnswerId").waitFor({
          state: "attached",
          timeout: timeouts.actionTimeout,
        });
      }, timeouts.taskFuseTimeout, `打开批阅页 ${answerId}`),
    timeouts.retryTimes,
    `打开批阅页 ${answerId}`
  );

  const info = await page.evaluate(() => ({
    studentName: document.querySelector("#stuRealName")?.value || "",
    className: document.querySelector("#className")?.value || "",
    workTitle: document.querySelector("#_title")?.value || "",
    answerId: document.querySelector("#workAnswerId")?.value || "",
  }));

  if (String(info.answerId) !== String(answerId)) {
    return { answerId, info, status: "skip_answer_mismatch" };
  }
  if (config.expectedClassName && info.className !== config.expectedClassName) {
    return { answerId, info, status: "skip_class_mismatch" };
  }
  if (config.expectedTitleIncludes && !info.workTitle.includes(config.expectedTitleIncludes)) {
    return { answerId, info, status: "skip_title_mismatch" };
  }

  await setScoreAndComment(page, config.score, config.comment);
  await page.locator("a.btnBlue").filter({ hasText: "提交" }).click();
  await page.waitForTimeout(config.submitWaitMs || 900);

  const body = await page.locator("body").innerText().catch(() => "");
  const saved = body.includes("批阅成功") || page.url().includes("/work/mark?");
  return {
    answerId,
    studentName: info.studentName,
    className: info.className,
    status: saved ? "saved" : "unknown",
  };
}

async function collectItems(page) {
  return await page.locator("body").evaluate(() => {
    return [...document.querySelectorAll("[id^=work]")]
      .map((item) => ({
        id: item.id,
        text: item.innerText.replace(/\s+/g, " ").trim(),
      }))
      .filter((item) => /^work\d+/.test(item.id));
  });
}

module.exports = {
  buildReviewUrl,
  collectItems,
  configurePage,
  getTimeoutConfig,
  gradeOneAnswer,
  setScoreAndComment,
  withRetries,
  withTaskFuse,
};
