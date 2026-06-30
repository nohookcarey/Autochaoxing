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
      "https://mooc2-ans.chaoxing.com/mooc2-ans/work/list?courseid=260169647&selectClassid=0&cpi=488262137&v=0",
    targetDate: "2026-06-03",
    keepOriginalTime: true,
    expectedTitle: "",
    expectedClassName: "",
    syncAnswerDeadlinePicker: true,
    saveButtonText: "保存",
  };

  function replaceDatePart(value, nextDate) {
    if (!value) return "";
    const normalized = value.trim().replace(/\//g, "-");
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(\s+\d{2}:\d{2}(:\d{2})?)?$/);
    if (!match) return normalized;
    const timePart = match[2] || "";
    return `${nextDate}${timePart}`;
  }

  async function readValue(selector) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) return "";
    return (await locator.inputValue().catch(() => "")) || (await locator.getAttribute("value").catch(() => "")) || "";
  }

  async function setValue(selector, value) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) return false;
    await locator.evaluate((node, nextValue) => {
      node.removeAttribute("readonly");
      node.value = nextValue;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    }, value);
    return true;
  }

  async function ensureUpdateFormPage() {
    const hasEditField =
      (await page.locator("#endTime, input[name='endTime']").count().catch(() => 0)) > 0;
    if (hasEditField) return;

    await page.goto(CONFIG.courseWorkListUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[id^=work]").length > 0 ||
        (document.body?.innerText || "").includes("暂无数据"),
      { timeout: 10000 }
    );
    await page.waitForTimeout(1200);

    const pageNumbers = [];
    const pagerItems = page.locator("#page li");
    const pagerCount = await pagerItems.count();
    for (let i = 0; i < pagerCount; i += 1) {
      const text = (await pagerItems.nth(i).innerText().catch(() => "")).trim();
      if (/^\d+$/.test(text)) pageNumbers.push(text);
    }
    if (!pageNumbers.length) pageNumbers.push("1");

    for (const pageNumber of pageNumbers) {
      const pageButton = page.locator("#page li").filter({ hasText: pageNumber }).first();
      if (await pageButton.count()) {
        await pageButton.click().catch(() => {});
        await page.waitForTimeout(1200);
      }

      const items = page.locator("[id^=work]");
      const count = await items.count();
      for (let i = 0; i < count; i += 1) {
        const item = items.nth(i);
        const text = (await item.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (CONFIG.expectedTitle && !text.includes(CONFIG.expectedTitle)) continue;
        if (CONFIG.expectedClassName && !text.includes(CONFIG.expectedClassName)) continue;

        const modifyLink = item.locator("a").filter({ hasText: /修改设置|修改|编辑/ }).first();
        if (!(await modifyLink.count())) continue;
        await modifyLink.click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1500);
        return;
      }
    }

    throw new Error("未找到匹配的作业修改入口，请检查 expectedTitle 和 expectedClassName");
  }

  await ensureUpdateFormPage();

  const before = {
    title: (await page.locator("h1, h2, .mark_title, .homeworkTitle").first().innerText().catch(() => "")).trim(),
    classText: (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " "),
    endTime: await readValue("#endTime, input[name='endTime']"),
    answerDeadlinePicker: await readValue("#answerDeadlinePicker, input[name='answerDeadlinePicker']"),
  };

  if (CONFIG.expectedTitle && before.title && !before.title.includes(CONFIG.expectedTitle)) {
    throw new Error(`标题不匹配: ${before.title}`);
  }
  if (CONFIG.expectedClassName && before.classText && !before.classText.includes(CONFIG.expectedClassName)) {
    throw new Error(`班级不匹配: ${CONFIG.expectedClassName}`);
  }

  const nextEndTime = replaceDatePart(before.endTime, CONFIG.targetDate);
  const nextAnswerDeadline = CONFIG.syncAnswerDeadlinePicker
    ? replaceDatePart(before.answerDeadlinePicker || before.endTime, CONFIG.targetDate)
    : before.answerDeadlinePicker;

  const changed = {
    endTime: await setValue("#endTime, input[name='endTime']", nextEndTime),
    answerDeadlinePicker: CONFIG.syncAnswerDeadlinePicker
      ? await setValue("#answerDeadlinePicker, input[name='answerDeadlinePicker']", nextAnswerDeadline)
      : false,
  };

  const saveButton = page.locator("button, a").filter({ hasText: CONFIG.saveButtonText }).first();
  if (await saveButton.count()) {
    await saveButton.click();
    await page.waitForTimeout(1500);
  }

  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1200);

  const after = {
    endTime: await readValue("#endTime, input[name='endTime']"),
    answerDeadlinePicker: await readValue("#answerDeadlinePicker, input[name='answerDeadlinePicker']"),
  };

  return {
    before,
    changed,
    targetDate: CONFIG.targetDate,
    expectedEndTime: nextEndTime,
    expectedAnswerDeadline: nextAnswerDeadline,
    after,
    passed:
      (!nextEndTime || after.endTime === nextEndTime) &&
      (!CONFIG.syncAnswerDeadlinePicker || !nextAnswerDeadline || after.answerDeadlinePicker === nextAnswerDeadline),
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