async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page.goto:.*closed/i.test(message);
  };

  try {
  const CONFIG = {
    targetClasses: [],
  };

  function parsePending(text) {
    const match = text.match(/(\d+)待批/);
    return match ? Number(match[1]) : 0;
  }

  function parseSubmitted(text) {
    const match = text.match(/(\d+)\s*已交/);
    return match ? Number(match[1]) : 0;
  }

  function parseWorkListId(url) {
    const fallback = String(url || "").match(/id=(\d+)/)?.[1] || "";
    try {
      const parsed = new URL(url, "https://mooc2-ans.chaoxing.com");
      return parsed.searchParams.get("id") || fallback;
    } catch {
      return fallback;
    }
  }

  const targetClassSet = new Set(CONFIG.targetClasses);
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

      const text = (await item.innerText()).replace(/\s+/g, " ").trim();
      const classMatch = CONFIG.targetClasses.find((className) => text.includes(className));
      const className = classMatch || "";
      if (!targetClassSet.has(className)) continue;

      const title =
        (await item.locator("h2").first().innerText().catch(() => "")) ||
        text;
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
        pending: parsePending(text),
        submitted: parseSubmitted(text),
        workListId: parseWorkListId(reviewHref),
        reviewHref,
        text,
      });
    }
  }

  for (const pageNumber of pageNumbers) {
    const button = page.locator("#page li").filter({ hasText: pageNumber }).first();
    if (await button.count()) {
      await button.click();
      await page.waitForTimeout(1200);
    }
    await collectCurrentPage(pageNumber);
  }

  return {
    scannedPages: pageNumbers,
    allAssignments: results,
    pendingAssignments: results.filter((item) => item.pending > 0),
    classSummary: [...targetClassSet].map((className) => {
      const items = results.filter((item) => item.className === className);
      return {
        className,
        pendingTotal: items.reduce((sum, item) => sum + item.pending, 0),
        assignmentCount: items.length,
      };
    }),
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
