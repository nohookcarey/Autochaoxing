(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const integer = (value, fallback = 0) => {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ""), "text/html");
  }

  function isLoginPage(documentNode) {
    const text = normalize(documentNode.body?.innerText || documentNode.body?.textContent);
    return Boolean(documentNode.querySelector('input[placeholder*="手机号"], input[placeholder*="超星号"], input[type="password"]'))
      || (text.includes("用户登录") && text.includes("忘记密码"));
  }

  function inputValue(documentNode, id) {
    return normalize(documentNode.querySelector(`#${id}`)?.value || documentNode.querySelector(`#${id}`)?.getAttribute("value"));
  }

  function parseMarkShell(html) {
    const documentNode = parseHtml(html);
    if (isLoginPage(documentNode)) return { ok: false, reason: "登录状态已失效" };
    const workId = inputValue(documentNode, "workid");
    const courseId = inputValue(documentNode, "courseid");
    const clazzId = inputValue(documentNode, "clazzid");
    if (!/^\d+$/.test(workId) || !/^\d+$/.test(courseId) || !/^\d+$/.test(clazzId)) {
      return { ok: false, reason: "批阅页未返回可核验的作业标识" };
    }
    return {
      ok: true,
      workId,
      courseId,
      clazzId,
      submitted: integer(inputValue(documentNode, "submitCount")),
      unsubmitted: integer(inputValue(documentNode, "unSubmitCount")),
    };
  }

  function parsePendingList(html) {
    const documentNode = parseHtml(html);
    if (isLoginPage(documentNode)) return { ok: false, reason: "登录状态已失效" };
    const rows = [...documentNode.querySelectorAll("ul.dataBody_td")];
    const text = normalize(documentNode.body?.innerText || documentNode.body?.textContent);
    const totalPages = Math.max(1, integer(inputValue(documentNode, "totalPage"), 1));
    if (!rows.length && !text.includes("暂无数据")) {
      return { ok: false, reason: "待批列表结构不可识别" };
    }
    return { ok: true, pending: rows.length, totalPages };
  }

  function makeMarkUrl({ origin, courseId, clazzId, cpi, chapterId, workLibraryId }) {
    const url = new URL("/mooc2-ans/work/mark", origin);
    url.search = new URLSearchParams({
      courseid: courseId,
      clazzid: clazzId,
      cpi,
      id: "",
      submit: "true",
      evaluation: "0",
      from: "",
      ceyan: "1",
      chapterid: chapterId,
      workLibraryid: workLibraryId,
      prePageSize: "0",
      prePageNum: "0",
      noBack: "false",
      topicid: "0",
      backurl: "",
      attachmentWorkId: "",
    }).toString();
    return url.href;
  }

  function makePendingListUrl({ origin, courseId, clazzId, cpi, workId, page = 1, size = 100 }) {
    const url = new URL("/mooc2-ans/work/mark-list", origin);
    url.search = new URLSearchParams({
      courseid: courseId,
      clazzid: clazzId,
      workid: workId,
      submit: "true",
      status: "3",
      groupId: "0",
      cpi,
      evaluation: "0",
      sort: "0",
      order: "0",
      unEval: "false",
      search: "",
      from: "",
      topicid: "0",
      pages: String(page),
      size: String(size),
    }).toString();
    return url.href;
  }

  function aggregateTargetResults(results, expectedCount) {
    if (!Array.isArray(results) || results.length !== expectedCount || results.some((item) => !item?.ok)) {
      const failed = results?.find((item) => !item?.ok);
      return { acquisitionState: "未获取", reason: failed?.reason || "章节测试扫描未完整覆盖目标范围。" };
    }
    const pendingTotal = results.reduce((total, item) => total + item.pending, 0);
    const classMap = new Map();
    results.forEach((item) => {
      const summary = classMap.get(item.className) || { className: item.className, pendingTotal: 0, testCount: 0, pendingTests: [] };
      summary.testCount += 1;
      summary.pendingTotal += item.pending;
      if (item.pending > 0) summary.pendingTests.push({ num: item.num, title: item.title, pending: item.pending });
      classMap.set(item.className, summary);
    });
    return {
      acquisitionState: pendingTotal > 0 ? "采集到" : "确认无数据",
      reason: pendingTotal > 0
        ? `已完成 ${results.length} 个“班级×测试”目标的只读扫描，共发现 ${pendingTotal} 项待批。`
        : `已完成 ${results.length} 个“班级×测试”目标的只读扫描，目标范围确认无待批。`,
      pendingTotal,
      scannedTargets: results.length,
      classSummary: [...classMap.values()],
    };
  }

  globalThis.LearningTongChapterTestScan = {
    aggregateTargetResults,
    makeMarkUrl,
    makePendingListUrl,
    normalize,
    parseMarkShell,
    parsePendingList,
  };
})();
