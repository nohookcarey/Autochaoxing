const fs = require('fs');
const path = require('path');
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
const TARGETS = JSON.parse(process.env.TARGETS_JSON || '[]');
const OUTPUT_DIR = process.env.OUTPUT_DIR || '/tmp/xt_target_review_shots';

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
      const viewLink = Array.from(row.querySelectorAll('a')).find((a) => /批阅|查看/.test(a.textContent.trim()));
      return {
        name: row.querySelector('.py_name')?.textContent.trim() || '',
        studentNo: cells[2] || '',
        status: cells[5] || '',
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

async function collectRowsForChapter(page, clazz, chapterTest, targetStudentNos) {
  await page.goto(makeMarkUrl(clazz.id, chapterTest.chapterId, chapterTest.workLibraryId), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.navigationTimeout,
  });
  await waitForReviewList(page);

  const body = await page.locator('body').innerText();
  if (/已交\s*0/.test(body) || body.includes('暂无数据')) {
    return [];
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

  return rows;
}

async function captureReview(page, clazz, chapterTest, row) {
  const absoluteUrl = row.reviewUrl.startsWith('http') ? row.reviewUrl : `${BASE_ORIGIN}${row.reviewUrl}`;
  const safeBase = `${clazz.label}_${chapterTest.num}_${row.studentNo}_${row.name}`.replace(/[\\/:*?"<>|\\s]+/g, '_');
  const shotPath = path.join(OUTPUT_DIR, `${safeBase}.png`);
  const metaPath = path.join(OUTPUT_DIR, `${safeBase}.json`);

  await withRetries(
    () => withTaskFuse(async () => {
      await page.goto(absoluteUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationTimeout,
      });
      await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
      await page.waitForTimeout(1200);
      const answerLocator = page.locator('.mark_answer_key, .studentAns, .stuAnswerWords, .stuAnswerCkeditor, .stuAnswer2').first();
      if (await answerLocator.count()) {
        await answerLocator.screenshot({ path: shotPath });
      } else {
        await page.screenshot({ path: shotPath, fullPage: true });
      }
      const meta = await page.evaluate(() => {
        const roots = [...document.querySelectorAll('.mark_answer_key, .studentAns, .stuAnswerWords, .stuAnswerCkeditor, .stuAnswer2')];
        const imgs = roots.flatMap((node) => Array.from(node.querySelectorAll('img')).map((img) => img.getAttribute('src') || ''));
        return {
          title: document.title,
          answerImageSrcs: imgs,
          bodyTextSnippet: (document.body?.innerText || '').slice(0, 500),
        };
      });
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }, TIMEOUTS.taskFuseTimeout, `截图 ${clazz.label}-${row.name}`),
    TIMEOUTS.retryTimes,
    `截图 ${clazz.label}-${row.name}`
  );

  return {
    class: clazz.label,
    chapter: chapterTest.num,
    name: row.name,
    studentNo: row.studentNo,
    screenshot: shotPath,
    meta: metaPath,
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
        const rows = await collectRowsForChapter(page, clazz, chapterTest, studentNos);
        for (const row of rows) {
          const result = await captureReview(page, clazz, chapterTest, row);
          results.push(result);
          console.log(JSON.stringify(result));
        }
      }

      console.log('CAPTURE_RESULTS');
      console.log(JSON.stringify(results, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
