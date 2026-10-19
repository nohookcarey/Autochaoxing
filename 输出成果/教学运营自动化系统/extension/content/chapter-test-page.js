(() => {
  const core = globalThis.LearningTongChapterTestScan;
  if (!core) return;

  const requestTimeout = 18000;

  function chapterContext() {
    const bodyText = document.body?.innerText || "";
    const params = new URLSearchParams(location.search);
    const classMap = [...document.querySelectorAll("li.inShow[data^='cls_']")]
      .map((element) => ({ name: core.normalize(element.innerText), id: String(element.getAttribute("data") || "").replace(/^cls_/, "") }))
      .filter((item) => item.name && /^\d+$/.test(item.id));
    return {
      title: document.title,
      path: location.pathname,
      bodyText,
      chapterRole: /\/mycourse\/tchcourse/.test(location.pathname)
        && bodyText.includes("编辑章节")
        && bodyText.includes("章节进度")
        && classMap.length > 0,
      courseId: params.get("courseid") || params.get("courseId") || "",
      cpi: params.get("cpi") || "",
      classMap,
    };
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetch(url, { credentials: "include", signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  async function scanTarget(context, target) {
    try {
      const markHtml = await fetchText(core.makeMarkUrl({
        origin: location.origin,
        courseId: context.courseId,
        clazzId: target.classId,
        cpi: context.cpi,
        chapterId: target.chapterId,
        workLibraryId: target.workLibraryId,
      }));
      const shell = core.parseMarkShell(markHtml);
      if (!shell.ok) return { ok: false, reason: `${target.className} ${target.num}：${shell.reason}` };

      let pending = 0;
      let first = null;
      for (let page = 1; page <= (first?.totalPages || 1); page += 1) {
        const listHtml = await fetchText(core.makePendingListUrl({
          origin: location.origin,
          courseId: context.courseId,
          clazzId: target.classId,
          cpi: context.cpi,
          workId: shell.workId,
          page,
        }));
        const parsed = core.parsePendingList(listHtml);
        if (!parsed.ok) return { ok: false, reason: `${target.className} ${target.num}：${parsed.reason}` };
        if (!first) first = parsed;
        pending += parsed.pending;
      }
      return { ok: true, className: target.className, num: target.num, title: target.title, pending };
    } catch (error) {
      const message = error?.name === "AbortError" ? "请求超时" : core.normalize(error?.message || error);
      return { ok: false, reason: `${target.className} ${target.num}：${message}` };
    }
  }

  async function runPool(items, worker, concurrency = 3) {
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
    return results;
  }

  async function scanChapterTests(profile) {
    const context = chapterContext();
    if (!context.chapterRole || !/^\d+$/.test(context.courseId) || !/^\d+$/.test(context.cpi)) {
      return { acquisitionState: "未获取", reason: "当前 iframe 不是可核验的教师端章节页。" };
    }
    const classByName = new Map(context.classMap.map((item) => [core.normalize(item.name), item.id]));
    const missingClasses = profile.classNames.filter((name) => !classByName.has(core.normalize(name)));
    if (missingClasses.length) {
      return { acquisitionState: "未获取", reason: `章节页未找到目标班级：${missingClasses.join("、")}。` };
    }
    const targets = profile.tests.flatMap((test) => profile.classNames.map((className) => ({
      ...test,
      className,
      classId: classByName.get(core.normalize(className)),
    })));
    const results = await runPool(targets, (target) => scanTarget(context, target), 3);
    return core.aggregateTargetResults(results, targets.length);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-chapter-test-frame") {
      sendResponse(chapterContext());
      return undefined;
    }
    if (message?.type === "scan-chapter-tests") {
      scanChapterTests(message.profile).then(sendResponse);
      return true;
    }
    return undefined;
  });
})();
