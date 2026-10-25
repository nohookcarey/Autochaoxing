async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page.goto:.*closed/i.test(message);
  };

  try {
  const ENV =
    typeof globalThis !== "undefined" && globalThis.process && globalThis.process.env
      ? globalThis.process.env
      : {};
  const CONFIG = {
    courseWorkListUrl:
      ENV.XTX_DEADLINE_COURSE_WORK_LIST_URL ||
      "https://mooc2-ans.chaoxing.com/mooc2-ans/work/list?courseid=&selectClassid=0&cpi=&v=0",
    targetClasses: [],
  };

  function parseDeadline(text) {
    const match = text.match(/作答时间[:：]?\s*([^\n]+)/);
    return match ? match[1].trim() : "";
  }

  function absoluteUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, "https://mooc2-ans.chaoxing.com").toString();
    } catch {
      return href;
    }
  }

  const targetSet = new Set(CONFIG.targetClasses);

  async function ensureWorkListPage() {
    const hasWorkItems = await page.locator("[id^=work]").count().catch(() => 0);
    const onWorkList = page.url().includes("/mooc2-ans/work/list");
    if (!onWorkList || !hasWorkItems) {
      await page.goto(CONFIG.courseWorkListUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    }
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[id^=work]").length > 0 ||
        (document.body?.innerText || "").includes("暂无数据"),
      { timeout: 10000 }
    );
    await page.waitForTimeout(1200);
  }

  await ensureWorkListPage();

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

  async function collectCurrentPage(pageNumber) {
    const items = page.locator("[id^=work]");
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      const itemId = await item.getAttribute("id");
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);

      const text = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const title = (text.match(/^(.+?) 作答时间/)?.[1] || text).trim();
      const classMatch = text.match(/[\u4e00-\u9fa5A-Za-z0-9]+班/);
      const className = classMatch ? classMatch[0] : "";
      if (!className) continue;
      if (targetSet.size && !targetSet.has(className)) continue;

      const modifyLink = item.locator("a").filter({ hasText: /修改设置|修改|编辑/ }).first();
      const modifyHref = (await modifyLink.count()) ? (await modifyLink.getAttribute("href").catch(() => "")) : "";

      results.push({
        page: pageNumber,
        itemId,
        title,
        className,
        deadlineText: parseDeadline(text),
        modifyHref: absoluteUrl(modifyHref || ""),
        rawText: text,
      });
    }
  }

  for (const pageNumber of pageNumbers) {
    const button = page.locator("#page li").filter({ hasText: pageNumber }).first();
    if (await button.count()) {
      await button.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    await collectCurrentPage(pageNumber);
  }

  return {
    scannedPages: pageNumbers,
    targetAssignments: results,
    classSummary: [...new Set(results.map((item) => item.className))].map((className) => ({
      className,
      assignmentCount: results.filter((item) => item.className === className).length,
    })),
  };
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