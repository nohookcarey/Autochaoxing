function getTimeoutConfig() {
  return {
    actionTimeout: 15000,
    navigationTimeout: 45000,
    retryTimes: 2,
  };
}

function configurePage(page) {
  const config = getTimeoutConfig();
  page.setDefaultTimeout(config.actionTimeout);
  page.setDefaultNavigationTimeout(config.navigationTimeout);
  return config;
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

async function setScoreOnly(page, score) {
  await page.locator(".questionScore").fill(String(score));
  await page.locator("#tmpscore").fill(String(score));
}

async function collectListAssignments(page, targetClasses = []) {
  const targetClassSet = new Set(targetClasses);
  const pageNumbers = [];
  const pagerItems = page.locator("#page li");
  const pagerCount = await pagerItems.count();
  for (let i = 0; i < pagerCount; i += 1) {
    const text = (await pagerItems.nth(i).innerText().catch(() => "")).trim();
    if (/^\d+$/.test(text)) pageNumbers.push(text);
  }
  if (!pageNumbers.length) pageNumbers.push("1");

  const seen = new Set();
  const results = [];

  for (const pageNumber of pageNumbers) {
    const button = page.locator("#page li").filter({ hasText: pageNumber }).first();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(1000);
    }

    const items = page.locator("[id^=work]");
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      const itemId = await item.getAttribute("id");
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);

      const text = (await item.innerText()).replace(/\s+/g, " ").trim();
      const classMatch = text.match(/汽车智能\d班/);
      const className = classMatch ? classMatch[0] : "";
      if (targetClassSet.size && !targetClassSet.has(className)) continue;

      const title =
        (await item.locator("h2").first().innerText().catch(() => "")) || text;
      const reviewHref =
        (await item
          .locator("a")
          .filter({ hasText: "批阅" })
          .first()
          .getAttribute("href")
          .catch(() => "")) || "";

      results.push({
        page: pageNumber,
        itemId,
        title: title.trim(),
        className,
        reviewHref,
        text,
      });
    }
  }

  return results;
}

async function collectReviewRows(page) {
  return await page.evaluate(() => {
    return [...document.querySelectorAll("ul.dataBody_td")].map((row) => {
      const cells = [...row.querySelectorAll(":scope > li")];
      const actionLink = row.querySelector("a.cz_py");
      return {
        rowId: row.id || "",
        name: row.querySelector(".py_name")?.textContent?.trim() || "",
        studentNo: cells[2]?.textContent?.replace(/\s+/g, " ").trim() || "",
        submitTime: cells[3]?.textContent?.replace(/\s+/g, " ").trim() || "",
        status: cells[5]?.textContent?.replace(/\s+/g, " ").trim() || "",
        reviewer: cells[6]?.textContent?.replace(/\s+/g, " ").trim() || "",
        score: row.querySelector("input.scoreInput")?.value || "",
        actionData: actionLink?.getAttribute("data") || "",
      };
    });
  });
}

async function gradeOneJob(page, job) {
  const timeouts = configurePage(page);
  const url = String(job.actionData || "").startsWith("http")
    ? job.actionData
    : `https://mooc2-ans.chaoxing.com${job.actionData || ""}`;

  await withRetries(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeouts.navigationTimeout });
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#workAnswerId").waitFor({ state: "attached", timeout: timeouts.actionTimeout });
  }, timeouts.retryTimes, `打开批阅页 ${job.name || job.actionData || ""}`);

  const info = await page.evaluate(() => ({
    studentName: document.querySelector("#stuRealName")?.value || "",
    answerId: document.querySelector("#workAnswerId")?.value || "",
    workTitle: document.querySelector("#_title")?.value || "",
    className: (document.body.innerText.match(/汽车智能\d班/) || [""])[0],
  }));

  if (job.className && info.className && info.className !== job.className) {
    return { ...job, info, status: "skip_class_mismatch" };
  }
  if (job.title && info.workTitle && !normalizeTitle(info.workTitle).includes(normalizeTitle(job.title))) {
    return { ...job, info, status: "skip_title_mismatch" };
  }

  await setScoreOnly(page, job.score);
  await page.locator("a.btnBlue").filter({ hasText: "提交" }).click();
  await page.waitForTimeout(1200);

  const body = await page.locator("body").innerText().catch(() => "");
  const saved = body.includes("批阅成功") || page.url().includes("/work/mark?");
  return {
    ...job,
    studentName: info.studentName,
    savedAnswerId: info.answerId,
    status: saved ? "saved" : "unknown",
  };
}

module.exports = {
  buildReviewUrl,
  collectListAssignments,
  collectReviewRows,
  configurePage,
  getTimeoutConfig,
  gradeOneJob,
  normalizeTitle,
  setScoreOnly,
  withRetries,
};
