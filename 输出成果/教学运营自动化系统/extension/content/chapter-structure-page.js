(() => {
  const core = globalThis.LearningTongChapterStructureScan; if (!core) return;
  function parseStructure() {
    const chapters = [...document.querySelectorAll(".chapter_unit")].map((unit) => {
      const titleNode = unit.querySelector(".chapter_Thats_bnt a.clicktitle");
      const rows = [...unit.querySelectorAll(".catalog_sbar")].map((node) => node.closest("li")).filter(Boolean);
      const taskPointCount = rows.reduce((total, row) => total + Number(row.querySelector("[class*='catalog_points']")?.textContent?.trim() || 0), 0);
      return { title: core.normalize(titleNode?.getAttribute("title") || titleNode?.innerText), sectionCount: rows.length, taskPointCount };
    }).filter((item) => item.title);
    const sectionRows = [...document.querySelectorAll(".catalog_sbar")].map((node) => node.closest("li")).filter(Boolean);
    const openCount = sectionRows.filter((row) => core.normalize(row.querySelector(".state_text")?.innerText) === "开放").length;
    return { chapterCount: chapters.length, sectionCount: sectionRows.length, taskPointCount: chapters.reduce((total, item) => total + item.taskPointCount, 0), openCount, closedCount: sectionRows.length - openCount, chapters };
  }
  function snapshotStructure() {
    const chapterRole = location.hostname.endsWith("chaoxing.com") && location.pathname === "/mooc2-ans/mycourse/tchcourse" && Boolean(document.querySelector(".chapter_unit"));
    return { title: document.title, path: location.pathname, courseLabel: location.pathname === "/mooc2-ans/mycourse/tch" ? document.title : "", chapterRole, summary: chapterRole ? parseStructure() : undefined };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-chapter-structure-frame") { sendResponse(snapshotStructure()); return undefined; }
    return undefined;
  });
})();
