(() => {
  const core = globalThis.LearningTongAssignmentScan;
  if (!core) return;

  function visible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function pageButtons() {
    const selected = [...document.querySelectorAll("#page li, #page a, .pagination li, .pagination a, .page li, .page a")];
    for (const list of document.querySelectorAll("ul")) {
      const children = [...list.children];
      const numeric = children.filter((item) => /^\d+$/.test(core.normalize(item.innerText)) && visible(item));
      if (numeric.length >= 2 && numeric.length >= Math.ceil(children.length / 2)) selected.push(...numeric);
    }
    const byNumber = new Map();
    selected.forEach((element) => {
      const number = core.normalize(element.innerText);
      if (/^\d+$/.test(number) && Number(number) > 0 && Number(number) <= 200 && !byNumber.has(number)) byNumber.set(number, element);
    });
    return [...byNumber.entries()].sort((left, right) => Number(left[0]) - Number(right[0]));
  }

  function rowElements() {
    const oldRows = [...document.querySelectorAll("[id^='work']")].filter(visible);
    const modernRows = [...document.querySelectorAll("li")].filter((row) => visible(row) && row.querySelector("h2") && /待批/.test(core.normalize(row.innerText)) && /批阅/.test(core.normalize(row.innerText)));
    return [...new Map([...oldRows, ...modernRows].map((row, index) => [row.id || `row-${index}-${core.normalize(row.innerText).slice(0, 40)}`, row])).values()];
  }

  function modifyIdOf(row) {
    const link = [...row.querySelectorAll("a")].find((item) => /修改设置|修改|编辑/.test(core.normalize(item.innerText)));
    const source = link?.getAttribute("onclick") || "";
    return core.normalize(source.match(/republish\((['\"]?)([^'\")]+)\1\)/)?.[2]);
  }

  function snapshotCurrentPage() {
    const buttons = pageButtons();
    const currentPage = buttons.find(([, element]) => element.matches(".active, .xl-active, .cur, .current, .on, [aria-current='page']"))?.[0]
      || buttons[0]?.[0]
      || "当前页";
    return {
      title: document.title,
      path: location.pathname,
      bodyText: document.body?.innerText || "",
      pageNumbers: buttons.map(([number]) => number),
      currentPage,
      rows: rowElements().map((row) => ({ id: row.id || "", text: row.innerText || "", title: row.querySelector("h2")?.innerText || "", page: currentPage, modifyId: modifyIdOf(row) })),
    };
  }

  function editorSnapshot() {
    const title = core.normalize(document.querySelector("h1, h2, .mark_title, .homeworkTitle")?.innerText || document.title);
    const bodyText = document.body?.innerText || "";
    const endTime = document.querySelector("#endTime, input[name='endTime']")?.value || "";
    const answerDeadline = document.querySelector("#answerDeadlinePicker, input[name='answerEndTime']")?.value || "";
    return { title, bodyText, path: location.pathname, endTime, answerDeadline, editorRole: /\/work\/rePublishSetting/.test(location.pathname) && Boolean(endTime) };
  }

  function openDeadlineEditor(message) {
    const snapshot = snapshotCurrentPage();
    const row = snapshot.rows.find((item) => core.normalize(item.modifyId) === core.normalize(message.modifyId)
      && core.normalize(item.title) === core.normalize(message.title)
      && core.normalize(item.text).includes(core.normalize(message.className)));
    if (!row) return { started: false, reason: "当前分页未找到唯一目标作业。" };
    const value = (id) => document.querySelector(`#${id}`)?.value || "";
    if (!value("courseid") || !value("cpi")) return { started: false, reason: "作业页缺少课程上下文，已停止。" };
    const url = new URL("/mooc2-ans/work/rePublishSetting", location.origin);
    [["courseid", value("courseid")], ["classid", value("selectClassid") || "0"], ["cpi", value("cpi")], ["id", row.modifyId], ["from", value("from")]].forEach(([key, nextValue]) => url.searchParams.set(key, nextValue));
    setTimeout(() => { location.href = url.toString(); }, 0);
    return { started: true };
  }

  function applyDeadlineUpdate(message) {
    const before = editorSnapshot();
    if (!before.editorRole) return { started: false, reason: "当前页面不是作业发放设置页。" };
    if (core.normalize(before.title) !== core.normalize(message.title) || !core.normalize(before.bodyText).includes(core.normalize(message.className))) {
      return { started: false, reason: "作业标题或班级与确认范围不一致，已停止。" };
    }
    const endTime = document.querySelector("#endTime, input[name='endTime']");
    const answerDeadline = document.querySelector("#answerDeadlinePicker, input[name='answerEndTime']");
    if (!endTime) return { started: false, reason: "未找到截止时间字段，已停止。" };
    const setValue = (element, value) => {
      element.removeAttribute("readonly");
      element.value = value;
      ["input", "change", "blur"].forEach((name) => element.dispatchEvent(new Event(name, { bubbles: true })));
    };
    setValue(endTime, message.nextEndTime);
    if (answerDeadline?.value) setValue(answerDeadline, message.nextEndTime);
    const confirm = [...document.querySelectorAll("button, a, input[type='button'], input[type='submit']")]
      .find((item) => core.normalize(item.innerText || item.value) === "确定" && item.getBoundingClientRect().width > 0);
    if (!confirm) return { started: false, reason: "未找到可见的确定按钮，未提交。" };
    const payload = { started: true, before: { endTime: before.endTime, answerDeadline: before.answerDeadline }, expectedEndTime: message.nextEndTime };
    setTimeout(() => confirm.click(), 0);
    return payload;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-assignment-frame") {
      sendResponse(snapshotCurrentPage());
      return undefined;
    }
    if (message?.type === "navigate-assignment-page") {
      const target = core.normalize(message.page);
      const button = pageButtons().find(([number]) => number === target)?.[1];
      if (!button) {
        sendResponse({ started: false, reason: `未找到分页 ${target}` });
        return undefined;
      }
      sendResponse({ started: true, page: target });
      setTimeout(() => button.click(), 0);
      return undefined;
    }
    if (message?.type === "scan-assignment-page") {
      sendResponse(core.scanSnapshot(snapshotCurrentPage(), message.profile));
      return undefined;
    }
    if (message?.type === "open-assignment-deadline-editor") {
      sendResponse(openDeadlineEditor(message));
      return undefined;
    }
    if (message?.type === "inspect-assignment-deadline-editor") {
      sendResponse(editorSnapshot());
      return undefined;
    }
    if (message?.type === "apply-assignment-deadline-update") {
      sendResponse(applyDeadlineUpdate(message));
      return undefined;
    }
    if (message?.type === "cancel-assignment-deadline-update") {
      if (/\/work\/rePublishSetting/.test(location.pathname)) setTimeout(() => history.back(), 0);
      sendResponse({ cancelled: true });
      return undefined;
    }
    return undefined;
  });
})();
