async (page) => {
  const readArgument = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : "";
  };
  const courseName = String(readArgument("--course-name") || "").trim();
  let targetClasses = [];
  try {
    const value = JSON.parse(readArgument("--target-classes") || "[]");
    targetClasses = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {}
  if (!courseName || targetClasses.length === 0) {
    return { gateStatus: "BLOCKED", acquisitionState: "未获取", reason: "扫描器缺少已核验的课程名称或班级白名单。" };
  }

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const bodyText = normalize(await page.locator("body").innerText().catch(() => ""));
  const pageTitle = normalize(await page.title().catch(() => ""));
  const workRows = page.locator("[id^=work]");
  const workRowCount = await workRows.count();
  const pagerCount = await page.locator("#page li").count();
  const explicitEmpty = /暂无.{0,8}作业|没有.{0,8}作业|无作业/.test(bodyText);
  const signals = {
    courseContext: bodyText.includes(courseName),
    assignmentContext: /作业/.test(`${pageTitle} ${bodyText}`),
    listEntry: workRowCount > 0 || pagerCount > 0 || explicitEmpty,
  };
  if (!signals.courseContext || !signals.assignmentContext || !signals.listEntry) {
    return {
      gateStatus: "BLOCKED",
      acquisitionState: "未获取",
      reason: "当前页面未同时通过课程、作业页面和列表入口三项核验。",
      signals,
    };
  }
  if (explicitEmpty && workRowCount === 0) {
    return {
      gateStatus: "BLOCKED",
      acquisitionState: "未获取",
      reason: "作业页显示空列表，但尚未证明目标班级筛选已生效，不能据此确认无数据。",
      signals,
      scannedPages: ["1"],
      pendingAssignments: [],
      classSummary: targetClasses.map((className) => ({ className, pendingTotal: 0, assignmentCount: 0 })),
    };
  }

  const pageNumbers = [];
  const pagerItems = page.locator("#page li");
  for (let i = 0; i < pagerCount; i += 1) {
    const text = normalize(await pagerItems.nth(i).innerText().catch(() => ""));
    if (/^\d+$/.test(text)) pageNumbers.push(text);
  }
  if (!pageNumbers.length) pageNumbers.push("1");

  const seen = new Set();
  const assignments = [];
  const parseCount = (pattern, text) => Number(normalize(text).match(pattern)?.[1] || 0);
  async function collectCurrentPage(pageNumber) {
    const rows = page.locator("[id^=work]");
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const rowId = await row.getAttribute("id");
      if (!rowId || seen.has(rowId)) continue;
      seen.add(rowId);
      const text = normalize(await row.innerText().catch(() => ""));
      const className = targetClasses.find((name) => text.includes(name));
      if (!className) continue;
      const title = normalize(await row.locator("h2").first().innerText().catch(() => "")) || "未命名作业";
      assignments.push({
        page: pageNumber,
        title,
        className,
        pending: parseCount(/(\d+)\s*待批/, text),
        submitted: parseCount(/(\d+)\s*已交/, text),
      });
    }
  }

  for (const pageNumber of pageNumbers) {
    const pageButton = page.locator("#page li").filter({ hasText: pageNumber }).first();
    if (await pageButton.count()) {
      await pageButton.click();
      await page.waitForTimeout(800);
    }
    await collectCurrentPage(pageNumber);
  }
  const pendingAssignments = assignments.filter((item) => item.pending > 0);
  const missingClasses = targetClasses.filter((className) => !assignments.some((item) => item.className === className));
  if (missingClasses.length) {
    return {
      gateStatus: "BLOCKED",
      acquisitionState: "未获取",
      reason: `扫描页中未看到目标班级：${missingClasses.join("、")}；不能确认班级筛选与数据范围。`,
      signals,
      scannedPages: pageNumbers,
      pendingAssignments,
      classSummary: targetClasses.map((className) => {
        const items = assignments.filter((item) => item.className === className);
        return { className, pendingTotal: items.reduce((total, item) => total + item.pending, 0), assignmentCount: items.length };
      }),
    };
  }
  return {
    gateStatus: "PASS",
    acquisitionState: pendingAssignments.length ? "采集到" : "确认无数据",
    reason: pendingAssignments.length ? "已完成目标班级的只读分页扫描。" : "已完成目标班级的只读分页扫描，未发现待批作业。",
    signals,
    scannedPages: pageNumbers,
    pendingAssignments,
    classSummary: targetClasses.map((className) => {
      const items = assignments.filter((item) => item.className === className);
      return { className, pendingTotal: items.reduce((total, item) => total + item.pending, 0), assignmentCount: items.length };
    }),
  };
}
