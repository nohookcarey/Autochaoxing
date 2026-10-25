const { chromium } = require('playwright');
const { configurePage } = require('./browser_timeout_config');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');
const {
  TARGET_CLASSES,
  discoverChapterTests,
  login,
  processClassChapter,
} = require('./chaoxing_helpers');

async function main() {
  if (process.env.XTX_ENABLE_LEGACY_WRITES !== "reviewed") throw new Error("旧版批阅默认停用，请使用教师扩展或先审查并明确配置本次范围。");
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADLESS === 'true',
  });
  const browserGuard = createBrowserDisconnectGuard(browser);

  try {
    await browserGuard.run(async () => {
      const page = await browser.newPage();
      configurePage(page);

      await login(page);
      console.log('LOGIN_OK');

      const chapterTests = await discoverChapterTests(page);
      console.log('DISCOVERED_CHAPTER_TESTS');
      console.log(JSON.stringify(chapterTests, null, 2));

      const summary = [];
      const scoreTable = [];

      for (const chapterTest of chapterTests) {
        for (const clazz of TARGET_CLASSES) {
          const result = await processClassChapter(page, clazz, chapterTest);
          summary.push(result);
          if (Array.isArray(result.details)) {
            for (const detail of result.details) {
              scoreTable.push({
                class: clazz.label,
                chapter: chapterTest.num,
                title: chapterTest.title,
                name: detail.name,
                score: detail.score,
                answerImageCount: detail.answerImageCount,
              });
            }
          }
          console.log(JSON.stringify({
            class: result.class,
            chapter: result.chapter,
            title: result.title,
            pending: result.pending,
            graded: result.graded,
          }));
        }
      }

      const totals = summary.reduce((acc, item) => {
        acc.pending += Number(item.pending || 0);
        acc.graded += Number(item.graded || 0);
        return acc;
      }, { pending: 0, graded: 0 });

      console.log('FINAL_SUMMARY');
      console.log(JSON.stringify(summary, null, 2));
      console.log('FINAL_TOTALS');
      console.log(JSON.stringify(totals, null, 2));
      console.log('FINAL_SCORE_TABLE');
      console.log(JSON.stringify(scoreTable, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
