async (page) => {
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
  };

  page.setDefaultTimeout(TIMEOUTS.actionTimeout);
  page.setDefaultNavigationTimeout(TIMEOUTS.navigationTimeout);

  const TARGET_CLASSES = ["3班", "4班", "6班"];
  const PAGE_NUMBERS = ["1", "2", "3", "4", "5"];

  async function collectItems() {
    return await page.locator("body").evaluate(() => {
      return [...document.querySelectorAll("[id^=work]")]
        .map((item) => ({
          id: item.id,
          text: item.innerText.replace(/\s+/g, " ").trim(),
        }))
        .filter((item) => /^work\d+/.test(item.id));
    });
  }

  const all = [];
  for (const pageNumber of PAGE_NUMBERS) {
    const pageButton = page.locator("#page li").filter({ hasText: pageNumber });
    if (await pageButton.count()) {
      await pageButton.first().click();
      await page.waitForTimeout(900);
      all.push(...(await collectItems()));
    }
  }

  const seen = new Set();
  const unique = all.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  const targetItems = unique.filter((item) =>
    TARGET_CLASSES.some((className) => item.text.includes(className))
  );
  const targetPending = targetItems.filter((item) => /[1-9]\d*待批/.test(item.text));

  return {
    targetPending,
    summary: targetItems.map((item) => ({
      id: item.id,
      title: item.text.match(/^(.+?) 作答时间/)?.[1] || item.text,
      pending: item.text.match(/\d+待批/)?.[0] || "无待批",
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