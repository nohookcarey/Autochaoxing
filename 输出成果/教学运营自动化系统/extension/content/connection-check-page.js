(() => {
  const core = globalThis.LearningTongConnectionCheck;
  if (!core) return;

  function collectCourseList() {
    const cards = [...document.querySelectorAll("li.course[courseid]")];
    if (!cards.length) return undefined;
    const courses = [];
    for (const card of cards) {
      const anchor = card.querySelector("h3 a[href]");
      if (!anchor?.href) continue;
      const nameNode = card.querySelector("h3 a span.course-name") || anchor;
      const rawName = nameNode?.getAttribute?.("title") || nameNode?.textContent || anchor.textContent || "";
      const name = core.normalize(String(rawName).split("\n")[0]);
      if (!name) continue;
      courses.push({ name, href: anchor.href });
    }
    return courses.length ? courses : undefined;
  }

  function collectClassNames() {
    const cards = [...document.querySelectorAll("li.class-list[classid]")];
    if (!cards.length) return undefined;
    const names = [];
    for (const card of cards) {
      const nameNode = card.querySelector("span.clazzName");
      const rawName = card.getAttribute("classname") || nameNode?.textContent || "";
      const name = core.normalize(String(rawName).split("\n")[0]);
      if (name) names.push(name);
    }
    return names.length ? [...new Set(names)] : undefined;
  }

  function snapshotConnection() {
    const path = location.pathname;
    const bodyPrefix = (document.body?.innerText || "").slice(0, 300);
    const loginPage = /用户登录|扫码登录|忘记密码/.test(bodyPrefix) || /\/login/.test(path);
    const roles = {
      courseShell: path === "/mooc2-ans/mycourse/tch",
      assignment: path === "/mooc2-ans/work/list",
      chapter: path === "/mooc2-ans/mycourse/tchcourse",
      statistics: /^\/stat2-vue\/(stat|base-data)/.test(path),
      score: path === "/score-data/index",
      attendance: /\/page\/(active\/activeList|class\/classList)/.test(path),
    };
    let courseLabel = "";
    if (roles.courseShell) courseLabel = document.title;
    else if (roles.statistics) courseLabel = (document.body?.innerText || "").split(/\n+/).map(core.normalize).find(Boolean) || "";
    return { title: document.title, path, courseLabel, roles, loginPage, courseList: collectCourseList(), classNames: collectClassNames() };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-connection-frame") {
      sendResponse(snapshotConnection());
      return undefined;
    }
    return undefined;
  });
})();
