throw new Error("历史定向写入脚本已停用。请使用教师扩展重新扫描、确认评分卡并审核提交。");
const { chromium } = require('playwright');
const { configurePage, getTimeoutConfig, withRetries, withTaskFuse } = require('./browser_timeout_config');
const { login, TARGET_CLASSES, makeMarkUrl, discoverChapterTests } = require('./chaoxing_helpers');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

const BASE_ORIGIN = 'https://mooc2-ans.chaoxing.com';
const TIMEOUTS = getTimeoutConfig();
const START_CHAPTER = process.env.START_CHAPTER || '';
const END_CHAPTER = process.env.END_CHAPTER || '';
const START_CLASS = process.env.START_CLASS || '';
const ONLY_CLASS = process.env.ONLY_CLASS || '';
const REBACK_REASON = process.env.REBACK_REASON || '未见代码图片，请补充后重新提交';
const ONLY_PENDING = process.env.ONLY_PENDING !== 'false';
const TARGET_STUDENT_NOS = String(process.env.TARGET_STUDENT_NOS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function compareChapterNum(left, right) {
  const leftParts = String(left || '').split('.').map((item) => Number(item) || 0);
  const rightParts = String(right || '').split('.').map((item) => Number(item) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function filterChapterTests(chapterTests) {
  return chapterTests
    .slice()
    .sort((a, b) => compareChapterNum(a.num, b.num))
    .filter((item) => !START_CHAPTER || compareChapterNum(item.num, START_CHAPTER) >= 0)
    .filter((item) => !END_CHAPTER || compareChapterNum(item.num, END_CHAPTER) <= 0);
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
  if (await confirmBtn.count()) {
    await confirmBtn.click();
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

async function inspectSubmissionEvidence(page) {
  return page.evaluate(() => {
    const answerRoots = [
      ...document.querySelectorAll(
        '.mark_answer_key, .studentAns, .stuAnswerWords, .stuAnswerCkeditor, .stuAnswer2 .mark_fill.colorDeep'
      ),
    ];
    const nodes = answerRoots.length ? answerRoots : [document.body];
    const images = nodes.flatMap((node) => Array.from(node.querySelectorAll('img')));
    const answerImages = images.filter((img) => {
      const src = img.getAttribute('src') || '';
      return /ananas|download|image|upload|attachment/i.test(src) && !/\/mooc2-ans\/images\//i.test(src);
    });
    return {
      answerImageCount: answerImages.length,
      hasImage: answerImages.length > 0,
    };
  });
}

async function reopenListPage(page, listUrl, pageNum) {
  const returnUrl = new URL(listUrl);
  returnUrl.searchParams.set('pageNum', String(pageNum));
  returnUrl.searchParams.set('pages', String(pageNum));
  try {
    await withRetries(
      () => page.goto(returnUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationTimeout,
      }),
      TIMEOUTS.retryTimes,
      `返回列表 ${pageNum}`
    );
  } catch (error) {
    if (!String(error && error.message).includes('interrupted by another navigation')) {
      throw error;
    }
    await page.waitForTimeout(1500);
  }
  await waitForReviewList(page);
}

async function sendBackCurrentReview(page, reason) {
  await page.evaluate((text) => {
    if (typeof window.reBack !== 'function') throw new Error('reBack not found');
    window.reBack(text);
  }, reason);
  await page.waitForTimeout(2000);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
}

async function collectRowsForChapter(page, clazz, chapterTest) {
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
      .filter((row) => TARGET_STUDENT_NOS.length === 0 || TARGET_STUDENT_NOS.includes(String(row.studentNo).trim()))
      .filter((row) => !ONLY_PENDING || String(row.status || '').includes('待批'))
      .filter((row) => row.reviewUrl)
      .map((row) => ({ ...row, page: currentPage })));
  }

  return { listUrl, rows };
}

async function processRow(page, listUrl, clazz, chapterTest, row) {
  const absoluteUrl = row.reviewUrl.startsWith('http') ? row.reviewUrl : `${BASE_ORIGIN}${row.reviewUrl}`;
  const evidence = await withRetries(
    () => withTaskFuse(async () => {
      await page.goto(absoluteUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationTimeout,
      });
      await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
      await page.waitForTimeout(1000);
      return inspectSubmissionEvidence(page);
    }, TIMEOUTS.taskFuseTimeout, `检查作答 ${clazz.label}-${row.name}`),
    TIMEOUTS.retryTimes,
    `检查作答 ${clazz.label}-${row.name}`
  );

  if (evidence.hasImage) {
    return {
      action: 'grade-100-with-image',
      class: clazz.label,
      chapter: chapterTest.num,
      title: chapterTest.title,
      name: row.name,
      studentNo: row.studentNo,
      previousScore: row.score,
      score: '100',
    };
  }

  await withRetries(
    () => withTaskFuse(async () => {
      await sendBackCurrentReview(page, REBACK_REASON);
    }, TIMEOUTS.taskFuseTimeout, `打回 ${clazz.label}-${row.name}`),
    TIMEOUTS.retryTimes,
    `打回 ${clazz.label}-${row.name}`
  );

  return {
    action: 'reback',
    class: clazz.label,
    chapter: chapterTest.num,
    title: chapterTest.title,
    name: row.name,
    studentNo: row.studentNo,
    previousScore: row.score,
    reason: REBACK_REASON,
  };
}

async function processClassChapter(page, clazz, chapterTest) {
  const { listUrl, rows } = await collectRowsForChapter(page, clazz, chapterTest);
  const handled = [];
  for (const row of rows) {
    const result = await processRow(page, listUrl, clazz, chapterTest, row);
    if (result.action === 'grade-100-with-image') {
      await withRetries(
        () => withTaskFuse(async () => {
          await setTotalScoreAndSubmit(page, '100');
        }, TIMEOUTS.taskFuseTimeout, `提交100分 ${clazz.label}-${row.name}`),
        TIMEOUTS.retryTimes,
        `提交100分 ${clazz.label}-${row.name}`
      );
      await reopenListPage(page, listUrl, row.page);
    }
    handled.push(result);
  }
  return handled;
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
      console.log('LOGIN_OK');

      const discoveredChapterTests = await discoverChapterTests(page);
      const chapterTests = filterChapterTests(discoveredChapterTests);
      console.log('DISCOVERED_CHAPTERS');
      console.log(JSON.stringify(chapterTests.map((item) => ({
        num: item.num,
        title: item.title,
        taskNum: item.taskNum,
      })), null, 2));

      const summary = [];
      for (const chapterTest of chapterTests) {
        console.log(`PROCESS_CHAPTER ${chapterTest.num} ${chapterTest.title}`);
        let classes = TARGET_CLASSES;
        if (ONLY_CLASS) {
          classes = TARGET_CLASSES.filter((item) => item.label === ONLY_CLASS);
        } else {
          const startClassIndex = TARGET_CLASSES.findIndex((item) => item.label === START_CLASS);
          classes = START_CLASS && chapterTest.num === START_CHAPTER && startClassIndex >= 0
            ? TARGET_CLASSES.slice(startClassIndex)
            : TARGET_CLASSES;
        }
        for (const clazz of classes) {
          console.log(`PROCESS_CLASS ${clazz.label}`);
          const handled = await processClassChapter(page, clazz, chapterTest);
          const stats = handled.reduce((acc, item) => {
            acc.total += 1;
            acc[item.action] = (acc[item.action] || 0) + 1;
            return acc;
          }, { total: 0, 'grade-100-with-image': 0, reback: 0 });
          console.log(JSON.stringify({
            class: clazz.label,
            chapter: chapterTest.num,
            title: chapterTest.title,
            totalRows: stats.total,
            grade100Count: stats['grade-100-with-image'],
            rebackCount: stats.reback,
          }));
          summary.push(...handled);
        }
      }

      console.log('HANDLED_RESULTS');
      console.log(JSON.stringify(summary, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
