(() => {
  const core = globalThis.LearningTongNavigation;
  if (!core) return;

  function visible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findControl(label) {
    const candidates = [...document.querySelectorAll("a, button, [role='button'], li")].filter(visible);
    const exact = candidates.find((element) => core.normalize(element.innerText || element.textContent) === label);
    if (!exact) return undefined;
    if (exact.matches("li")) return exact.querySelector("a, button, [role='button']") || exact;
    return exact;
  }

  function activateControl(control) {
    const href = control.getAttribute?.("href");
    const neutralizeHref = core.javascriptHref(href);
    if (neutralizeHref) control.setAttribute("href", "#");
    try {
      control.click();
    } finally {
      if (neutralizeHref) control.setAttribute("href", href);
    }
  }

  function snapshotNavigation() {
    const bodyText = document.body?.innerText || "";
    return {
      path: location.pathname,
      courseShellRole: core.courseShellRole(location.pathname),
      statisticsShellRole: core.statisticsShellRole(location.hostname, location.pathname, bodyText),
      availableModules: Object.keys({ assignment: 1, chapter: 1, statistics: 1, attendance: 1, score: 1 }).filter((module) => Boolean(findControl(core.moduleLabel(module)))),
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-teacher-navigation") {
      sendResponse(snapshotNavigation());
      return undefined;
    }
    if (message?.type === "navigate-teacher-module") {
      if (!core.courseShellRole(location.pathname)) { sendResponse({ started: false, reason: "当前 frame 不是教师课程主页。" }); return undefined; }
      const label = core.moduleLabel(message.module);
      const control = findControl(label);
      if (!label || !control) { sendResponse({ started: false, reason: `课程主页未找到“${label || message.module}”入口。` }); return undefined; }
      sendResponse({ started: true, module: message.module });
      setTimeout(() => activateControl(control), 0);
      return undefined;
    }
    if (message?.type === "navigate-statistics-submodule") {
      const bodyText = document.body?.innerText || "";
      if (!core.statisticsShellRole(location.hostname, location.pathname, bodyText)) { sendResponse({ started: false, reason: "当前 frame 不是课程统计主页。" }); return undefined; }
      const label = core.moduleLabel(message.module);
      const control = findControl(label);
      if (!label || !control) { sendResponse({ started: false, reason: `统计页未找到“${label || message.module}”入口。` }); return undefined; }
      sendResponse({ started: true, module: message.module });
      setTimeout(() => activateControl(control), 0);
      return undefined;
    }
    return undefined;
  });
})();
