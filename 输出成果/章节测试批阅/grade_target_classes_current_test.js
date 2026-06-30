const { chromium } = require('playwright');
const { configurePage, getTimeoutConfig, withRetries, withTaskFuse } = require('./browser_timeout_config');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

const LOGIN_URL = 'https://passport2.chaoxing.com/login?fid=12&refer=http%3A%2F%2Fi.chaoxing.com%2Fbase%3Fvflag%3Dtrue%26fid%3D%26backUrl%3D&space=2';
const COURSE_ID = '260169647';
const CPI = '488262137';
const CHAPTER_ID = '1173054653';
const WORK_LIBRARY_ID = 'df222f30cb6f4a3992bdcd97ee64d3b4';
const TARGET_CLASSES = [
  { label: '人工智能3班', id: '141396990' },
  { label: '人工智能4班', id: '141396996' },
  { label: '人工智能6班', id: '141397008' },
];
const TIMEOUTS = getTimeoutConfig();

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="手机号/超星号"]', (process.env.XTX_USERNAME || ''));
  await page.fill('input[placeholder="学习通密码"]', (process.env.XTX_PASSWORD || ''));
  const agree = page.locator('input[type="checkbox"]').first();
  if (await agree.count()) {
    try { await agree.check({ force: true }); } catch {}
  }
  await page.locator('button:has-text("登录")').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
}

function makeMarkUrl(clazzid) {
  return `https://mooc2-ans.chaoxing.com/mooc2-ans/work/mark?courseid=${COURSE_ID}&clazzid=${clazzid}&cpi=${CPI}&id=&submit=true&evaluation=0&from=&ceyan=1&chapterid=${CHAPTER_ID}&workLibraryid=${WORK_LIBRARY_ID}&prePageSize=0&prePageNum=0&noBack=false&topicid=0&backurl=&attachmentWorkId=`;
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
        actionText: viewLink?.textContent.trim() || '',
      };
    });
  });
}

async function waitForReviewList(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || '';
    return (
      document.querySelectorAll('ul.dataBody_td').length > 0 ||
      bodyText.includes('暂无数据') ||
      /已交\s*\d+/.test(bodyText)
    );
  }, { timeout: TIMEOUTS.actionTimeout });
  await page.waitForTimeout(800);
}

async function submitCurrentReview(page) {
  const answerImageCount = await page.locator('.mark_item1 img[src*="ananas.chaoxing.com"]').count();
  const score = answerImageCount > 0 ? '100' : '0';

  await page.evaluate((newScore) => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
    const visible = inputs.filter((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    const totalInput = visible.find((el) => !el.placeholder);
    if (!totalInput) throw new Error('total input not found');
    totalInput.focus();
    totalInput.value = newScore;
    totalInput.dispatchEvent(new Event('input', { bubbles: true }));
    totalInput.dispatchEvent(new Event('change', { bubbles: true }));
    totalInput.blur();
  }, score);

  await page.locator('a.btnBlue[onclick*="markAction(1)"]').click();
  await page.waitForTimeout(800);
  const confirmBtn = page.getByText('保存并继续', { exact: true });
  if (await confirmBtn.count()) {
    await confirmBtn.click();
  }
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  return { score, answerImageCount };
}

async function processClass(page, clazz) {
  await page.goto(makeMarkUrl(clazz.id), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.navigationTimeout,
  });
  await waitForReviewList(page);
  const body = await page.locator('body').innerText();
  if (/已交\s*0/.test(body) || body.includes('暂无数据')) {
    return { class: clazz.label, pending: 0, graded: 0, details: [] };
  }

  const initialRows = await getRows(page);
  const pendingRows = initialRows.filter((row) => row.status.includes('待批'));
  const details = [];

  for (const row of pendingRows) {
    const absoluteUrl = row.reviewUrl.startsWith('http') ? row.reviewUrl : `https://mooc2-ans.chaoxing.com${row.reviewUrl}`;
    const result = await withRetries(
      () => withTaskFuse(async () => {
        await page.goto(absoluteUrl, {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUTS.navigationTimeout,
        });
        await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
        await page.waitForTimeout(1000);
        const reviewResult = await submitCurrentReview(page);
        await page.waitForTimeout(1200);
        return reviewResult;
      }, TIMEOUTS.taskFuseTimeout, `批阅 ${clazz.label}-${row.name}`),
      TIMEOUTS.retryTimes,
      `批阅 ${clazz.label}-${row.name}`
    );
    details.push({ name: row.name, ...result });
  }

  return { class: clazz.label, pending: pendingRows.length, graded: details.length, details };
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

      const summary = [];
      for (const clazz of TARGET_CLASSES) {
        const result = await processClass(page, clazz);
        summary.push(result);
        console.log(JSON.stringify(result));
      }

      console.log('FINAL');
      console.log(JSON.stringify(summary, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
