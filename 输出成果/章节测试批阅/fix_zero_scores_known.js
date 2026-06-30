const { chromium } = require('playwright');
const { configurePage, getTimeoutConfig, withRetries, withTaskFuse } = require('./browser_timeout_config');
const { login, TARGET_CLASSES, makeMarkUrl } = require('./chaoxing_helpers');
const { KNOWN_CHAPTER_TESTS } = require('./chapter_tests_config');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

const BASE_ORIGIN = 'https://mooc2-ans.chaoxing.com';
const TIMEOUTS = getTimeoutConfig();
const START_CHAPTER = process.env.START_CHAPTER || '';
const START_CLASS = process.env.START_CLASS || '';

function isZeroScore(value) {
  return /^0(?:\\.0+)?$/.test(String(value || '').trim());
}

async function waitForReviewList(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || '';
    return document.querySelectorAll('ul.dataBody_td').length > 0 || bodyText.includes('暂无数据') || /已交\\s*\\d+/.test(bodyText);
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
    const match = pageText.match(/共\\s*(\\d+)\\s*页/);
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
    const selectors = [
      '.mark_item1',
      '.questionLi',
      '.markBox',
      '.mark_box',
      '.markCon',
      '.answerCon',
      '.answer',
      '.ZyTop',
    ];

    const containers = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((node, index, arr) => arr.indexOf(node) === index);

    const scopedNodes = containers.length ? containers : [document.body];
    const images = scopedNodes.flatMap((node) => Array.from(node.querySelectorAll('img')));
    const attachments = scopedNodes.flatMap((node) => Array.from(node.querySelectorAll('a[href]')));
    const textBlocks = scopedNodes.map((node) => (node.innerText || '').trim()).filter(Boolean);

    const imageCount = images.filter((img) => {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      return /ananas|download|image|upload|attachment/i.test(src) || /截图|图片|image/i.test(alt);
    }).length;

    const attachmentCount = attachments.filter((a) => {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').trim();
      return /ananas|download|attachment|preview/i.test(href) || /附件|下载|预览/.test(text);
    }).length;

    const codeBlockCount = scopedNodes.reduce((sum, node) => {
      return sum + node.querySelectorAll('pre, code, .hljs, .CodeMirror').length;
    }, 0);

    const meaningfulText = textBlocks
      .map((text) => text
        .replace(/提交|保存并继续|批阅|得分|总分|评分|正确答案|学生答案/g, ' ')
        .replace(/\s+/g, ' ')
        .trim())
      .find((text) => text.length >= 12) || '';

    return {
      imageCount,
      attachmentCount,
      codeBlockCount,
      meaningfulTextLength: meaningfulText.length,
      hasContent: imageCount > 0 || attachmentCount > 0 || codeBlockCount > 0 || meaningfulText.length >= 12,
    };
  });
}

async function collectZeroRowsForChapter(page, clazz, chapterTest) {
  await page.goto(makeMarkUrl(clazz.id, chapterTest.chapterId, chapterTest.workLibraryId), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.navigationTimeout,
  });
  await waitForReviewList(page);

  const body = await page.locator('body').innerText();
  if (/已交\\s*0/.test(body) || body.includes('暂无数据')) {
    return { listUrl: page.url(), totalPages: 1, rows: [] };
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
      .filter((row) => row.reviewUrl && isZeroScore(row.score))
      .map((row) => ({ ...row, page: currentPage })));
  }

  return { listUrl, totalPages, rows };
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

async function fixZeroRowsForChapter(page, clazz, chapterTest) {
  const { listUrl, totalPages, rows } = await collectZeroRowsForChapter(page, clazz, chapterTest);
  const fixed = [];
  const skipped = [];

  for (const row of rows) {
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

    if (!evidence.hasContent) {
      skipped.push({
        class: clazz.label,
        chapter: chapterTest.num,
        title: chapterTest.title,
        name: row.name,
        studentNo: row.studentNo,
        previousScore: row.score,
        reason: 'empty-or-no-content',
      });
      await reopenListPage(page, listUrl, row.page);
      continue;
    }

    await withRetries(
      () => withTaskFuse(async () => {
        await setTotalScoreAndSubmit(page, '100');
      }, TIMEOUTS.taskFuseTimeout, `修正0分 ${clazz.label}-${row.name}`),
      TIMEOUTS.retryTimes,
      `修正0分 ${clazz.label}-${row.name}`
    );

    fixed.push({
      class: clazz.label,
      chapter: chapterTest.num,
      title: chapterTest.title,
      name: row.name,
      studentNo: row.studentNo,
      previousScore: row.score,
      newScore: '100',
    });

    await reopenListPage(page, listUrl, row.page);
  }

  return { totalPages, zeroCount: rows.length, fixed, skipped };
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

      const chapterTests = START_CHAPTER
        ? KNOWN_CHAPTER_TESTS.filter((item) => item.num >= START_CHAPTER)
        : KNOWN_CHAPTER_TESTS;

      const affected = [];
      for (const chapterTest of chapterTests) {
        console.log(`PROCESS_CHAPTER ${chapterTest.num} ${chapterTest.title}`);
        const startClassIndex = TARGET_CLASSES.findIndex((item) => item.label === START_CLASS);
        const classes = START_CLASS && chapterTest.num === START_CHAPTER && startClassIndex >= 0
          ? TARGET_CLASSES.slice(startClassIndex)
          : TARGET_CLASSES;
        for (const clazz of classes) {
          console.log(`PROCESS_CLASS ${clazz.label}`);
          const result = await fixZeroRowsForChapter(page, clazz, chapterTest);
          console.log(JSON.stringify({
            class: clazz.label,
            chapter: chapterTest.num,
            title: chapterTest.title,
            zeroCount: result.zeroCount,
            fixedCount: result.fixed.length,
            skippedCount: result.skipped.length,
          }));
          affected.push(...result.fixed);
        }
      }

      console.log('AFFECTED_STUDENTS');
      console.log(JSON.stringify(affected, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
