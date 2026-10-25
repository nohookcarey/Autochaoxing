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
  makeMarkUrl,
} = require('./chaoxing_helpers');

async function waitForReviewList(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body');
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || '';
    return document.querySelectorAll('ul.dataBody_td').length > 0 || bodyText.includes('暂无数据') || /已交\s*\d+/.test(bodyText);
  });
  await page.waitForTimeout(800);
}

async function getRows(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('ul.dataBody_td')).map((row) => {
    const cells = Array.from(row.querySelectorAll('li')).map((li) => li.textContent.trim());
    return {
      name: row.querySelector('.py_name')?.textContent.trim() || '',
      studentNo: cells[2] || '',
      status: cells[5] || '',
      score: row.querySelector('input.scoreInput')?.value.trim() || '',
    };
  }));
}

async function getTotalPages(page) {
  const raw = await page.evaluate(() => {
    const pagerInput = document.querySelector('#totalPage');
    if (pagerInput && 'value' in pagerInput) return pagerInput.value;
    const pageText = document.body?.innerText || '';
    const match = pageText.match(/共\s*(\d+)\s*页/);
    return match ? match[1] : '';
  });
  const total = Number(String(raw).trim());
  return Number.isFinite(total) && total > 0 ? total : 1;
}

async function main() {
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

      const chapterTests = await discoverChapterTests(page);
      const summary = [];

      for (const chapterTest of chapterTests) {
        for (const clazz of TARGET_CLASSES) {
          await page.goto(makeMarkUrl(clazz.id, chapterTest.chapterId, chapterTest.workLibraryId), {
            waitUntil: 'domcontentloaded',
          });
          await waitForReviewList(page);

          const body = await page.locator('body').innerText();
          if (/已交\s*0/.test(body) || body.includes('暂无数据')) {
            const result = {
              class: clazz.label,
              chapter: chapterTest.num,
              title: chapterTest.title,
              totalPages: 1,
              pending: 0,
              pendingStudents: [],
            };
            summary.push(result);
            console.log(JSON.stringify(result));
            continue;
          }

          const listUrl = page.url();
          const totalPages = await getTotalPages(page);
          const pendingStudents = [];

          for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
            if (currentPage > 1) {
              const pageUrl = new URL(listUrl);
              pageUrl.searchParams.set('pageNum', String(currentPage));
              pageUrl.searchParams.set('pages', String(currentPage));
              await page.goto(pageUrl.toString(), { waitUntil: 'domcontentloaded' });
              await waitForReviewList(page);
            }

            const rows = await getRows(page);
            pendingStudents.push(...rows
              .filter((row) => row.status.includes('待批'))
              .map((row) => ({ ...row, page: currentPage })));
          }

          const result = {
            class: clazz.label,
            chapter: chapterTest.num,
            title: chapterTest.title,
            totalPages,
            pending: pendingStudents.length,
            pendingStudents,
          };
          summary.push(result);
          console.log(JSON.stringify(result));
        }
      }

      const totals = summary.reduce((acc, item) => {
        acc.pending += item.pending || 0;
        return acc;
      }, { pending: 0 });

      console.log('FINAL_AUDIT');
      console.log(JSON.stringify(summary, null, 2));
      console.log('FINAL_TOTALS');
      console.log(JSON.stringify(totals, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
