const { chromium } = require('playwright');
const { configurePage, getTimeoutConfig, withRetries, withTaskFuse } = require('./browser_timeout_config');
const { login, discoverChapterTests, makeMarkUrl, TARGET_CLASSES } = require('./chaoxing_helpers');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

const BASE_ORIGIN = 'https://mooc2-ans.chaoxing.com';
const TIMEOUTS = getTimeoutConfig();
const FORCE_SCORE = String(process.env.FORCE_SCORE || '0');
const TARGETS = JSON.parse(process.env.TARGETS_JSON || '[]');

function buildTargetMap() {
  const map = new Map();
  for (const item of TARGETS) {
    const key = `${item.class}|${item.chapter}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(String(item.studentNo).trim());
  }
  return map;
}

async function waitForReviewList(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || '';
    return document.querySelectorAll('ul.dataBody_td').length > 0 || bodyText.includes('暂无数据') || /已交\s*\d+/.test(bodyText);
  }, { timeout: TIMEOUTS.actionTimeout });
  await page.waitForTimeout(800);
}

async function getRows(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('ul.dataBody_td')).map((row) => {
      const cells = Array.from(row.querySelectorAll('li')).map((li) => li.textContent.trim());
      const scoreInput = row.querySelector('input.scoreInput');
      const viewLink = Array.from(row.querySelectorAll('a')).find((a) => /批阅|查看/.test(a.textContent.trim()));
      return {
        id: row.id,
        name: row.querySelector('.py_name')?.textContent.trim() || '',
        studentNo: cells[2] || '',
        status: cells[5] || '',
        score: scoreInput ? scoreInput.value.trim() : '',
        reviewUrl: viewLink?.getAttribute('data') || '',
      };
    });
  });
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

async function setTotalScoreAndSubmit(page, newScore) {
  await page.evaluate((score) => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
    const visible = inputs.filter((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    const totalInput = visible.find((el) => !el.placeholder);
    if (!totalInput) throw new Error('total input not found');
    totalInput.focus();
    totalInput.value = score;
    totalInput.dispatchEvent(new Event('input', { bubbles: true }));
    totalInput.dispatchEvent(new Event('change', { bubbles: true }));
    totalInput.blur();
  }, newScore);

  await page.locator('a.btnBlue[onclick*="markAction(1)"]').click();
  await page.waitForTimeout(800);
  const confirmBtn = page.getByText('保存并继续', { exact: true });
  if (await confirmBtn.count()) await confirmBtn.click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

async function reopenListPage(page, listUrl, pageNum) {
  const returnUrl = new URL(listUrl);
  returnUrl.searchParams.set('pageNum', String(pageNum));
  returnUrl.searchParams.set('pages', String(pageNum));
  await withRetries(
    () => page.goto(returnUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.navigationTimeout,
    }),
    TIMEOUTS.retryTimes,
    `返回列表 ${pageNum}`
  );
  await waitForReviewList(page);
}

async function collectRowsForChapter(page, clazz, chapterTest, targetStudentNos) {
  await page.goto(makeMarkUrl(clazz.id, chapterTest.chapterId, chapterTest.workLibraryId), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.navigationTimeout,
  });
  await waitForReviewList(page);

  const body = await page.locator('body').innerText();
  if (/已交\s*0/.test(body) || body.includes('暂无数据')) {
    return { listUrl: page.url(), rows: [] };
  }

  const listUrl = page.url();
  const totalPages = await getTotalPages(page);
  const rows = [];

  for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
    if (currentPage > 1) {
      const pageUrl = new URL(listUrl);
      pageUrl.searchParams.set('pageNum', String(currentPage));
      pageUrl.searchParams.set('pages', String(currentPage));
      await page.goto(pageUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationTimeout,
      });
      await waitForReviewList(page);
    }

    const pageRows = await getRows(page);
    rows.push(...pageRows
      .filter((row) => targetStudentNos.has(String(row.studentNo).trim()))
      .filter((row) => row.reviewUrl)
      .map((row) => ({ ...row, page: currentPage })));
  }

  return { listUrl, rows };
}

async function forceRowScore(page, listUrl, clazz, chapterTest, row) {
  const absoluteUrl = row.reviewUrl.startsWith('http') ? row.reviewUrl : `${BASE_ORIGIN}${row.reviewUrl}`;
  await withRetries(
    () => withTaskFuse(async () => {
      await page.goto(absoluteUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationTimeout,
      });
      await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
      await page.waitForTimeout(1000);
      await setTotalScoreAndSubmit(page, FORCE_SCORE);
    }, TIMEOUTS.taskFuseTimeout, `改分 ${clazz.label}-${row.name}`),
    TIMEOUTS.retryTimes,
    `改分 ${clazz.label}-${row.name}`
  );
  await reopenListPage(page, listUrl, row.page);
  return {
    class: clazz.label,
    chapter: chapterTest.num,
    title: chapterTest.title,
    name: row.name,
    studentNo: row.studentNo,
    previousScore: row.score,
    forcedScore: FORCE_SCORE,
  };
}

async function main() {
  const targetMap = buildTargetMap();
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
      const chapterByNum = new Map(chapterTests.map((item) => [item.num, item]));
      const classByLabel = new Map(TARGET_CLASSES.map((item) => [item.label, item]));
      const results = [];

      for (const [key, studentNos] of targetMap.entries()) {
        const [classLabel, chapterNum] = key.split('|');
        const clazz = classByLabel.get(classLabel);
        const chapterTest = chapterByNum.get(chapterNum);
        if (!clazz || !chapterTest) continue;
        const { listUrl, rows } = await collectRowsForChapter(page, clazz, chapterTest, studentNos);
        for (const row of rows) {
          const result = await forceRowScore(page, listUrl, clazz, chapterTest, row);
          results.push(result);
          console.log(JSON.stringify(result));
        }
      }

      console.log('FORCED_RESULTS');
      console.log(JSON.stringify(results, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
