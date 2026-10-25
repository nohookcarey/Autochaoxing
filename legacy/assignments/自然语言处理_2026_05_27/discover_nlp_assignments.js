async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page\.goto:.*closed/i.test(message);
  };

  try {
  function parseCourseParams() {
    const currentUrl = page.url();
    const query = currentUrl.split("?")[1] || "";
    const params = new Map(
      query
        .split("&")
        .filter(Boolean)
        .map((entry) => {
          const [key, value = ""] = entry.split("=");
          return [decodeURIComponent(key), decodeURIComponent(value)];
        })
    );
    return {
      courseId: params.get("courseid") || "",
      cpi: params.get("cpi") || "",
    };
  }

  const TARGET_CLASSES = ["3班", "4班", "6班"];
  const PAGE_NUMBERS = ["1", "2", "3", "4", "5"];

  async function collectItems() {
    return await page.locator("body").evaluate(() => {
      const targetClasses = ["3班", "4班", "6班"];
      return [...document.querySelectorAll("[id^=work]")]
        .map((item) => {
          const text = item.innerText.replace(/\s+/g, " ").trim();
          const title = text.match(/^(.+?) 作答时间/)?.[1] || text;
          const className = targetClasses.find((name) => text.includes(name)) || "";
          const pending = text.match(/\d+待批/)?.[0] || "无待批";
          const href = item.querySelector("a[href*='workId=']")?.getAttribute("href") || "";
          let classId = "";
          let workId = "";
          let workListId = item.id.replace(/^work/, "");
          try {
            const url = new URL(href, location.origin);
            classId = url.searchParams.get("clazzid") || url.searchParams.get("classId") || "";
            workId = url.searchParams.get("workId") || "";
          } catch (error) {}
          return {
            id: item.id,
            title,
            className,
            pending,
            href,
            classId,
            workId,
            workListId,
            text,
          };
        })
        .filter((item) => item.className);
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
    const key = `${item.id}:${item.className}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const courseParams = parseCourseParams();
  return {
    courseParams,
    items: unique.map((item) => ({
      className: item.className,
      title: item.title,
      pending: item.pending,
      courseId: courseParams.courseId,
      cpi: courseParams.cpi,
      classId: item.classId,
      workId: item.workId,
      workListId: item.workListId,
      href: item.href,
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
