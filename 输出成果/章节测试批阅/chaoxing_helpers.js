const { URL } = require('url');
const { KNOWN_CHAPTER_TESTS } = require('./chapter_tests_config');
const {
  getTimeoutConfig,
  withRetries,
  withTaskFuse,
} = require('./browser_timeout_config');
const ENV = process.env || {};

const LOGIN_URL = 'https://passport2.chaoxing.com/login?fid=12&refer=http%3A%2F%2Fi.chaoxing.com%2Fbase%3Fvflag%3Dtrue%26fid%3D%26backUrl%3D&space=2';
const COURSE_ID = ENV.XTX_COURSE_ID || '';
const CPI = ENV.XTX_CPI || '';
const PRIMARY_CLASS_ID = ENV.XTX_PRIMARY_CLASS_ID || '';
const USERNAME = ENV.XTX_USERNAME || '';
const PASSWORD = ENV.XTX_PASSWORD || '';
const BASE_ORIGIN = 'https://mooc2-ans.chaoxing.com';
const DISCOVERY_MAX_MAJOR_CHAPTER = 9;
const TARGET_CLASSES = JSON.parse(ENV.XTX_TARGET_CLASSES_JSON || '[]');
const TIMEOUTS = getTimeoutConfig();

async function login(page) {
  if (!/^\d+$/.test(COURSE_ID) || !/^\d+$/.test(CPI) || !/^\d+$/.test(PRIMARY_CLASS_ID) || !Array.isArray(TARGET_CLASSES) || !TARGET_CLASSES.length || TARGET_CLASSES.some(c => !c.label || !/^\d+$/.test(c.id || ""))) throw new Error("未配置本次课程与班级范围；不会登录或采集。推荐使用教师扩展。");
  if (!USERNAME || !PASSWORD) {
    throw new Error('请通过 XTX_USERNAME 和 XTX_PASSWORD 环境变量提供学习通账号信息。');
  }
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="手机号/超星号"]', USERNAME);
  await page.fill('input[placeholder="学习通密码"]', PASSWORD);
  const agree = page.locator('input[type="checkbox"]').first();
  if (await agree.count()) {
    try {
      await agree.check({ force: true });
    } catch {}
  }
  await page.locator('button:has-text("登录")').click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
}

function makeChapterListUrl() {
  return `https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tchcourselist?temp=${Date.now()}&courseid=${COURSE_ID}&clazzid=${PRIMARY_CLASS_ID}&cpi=${CPI}&searchChapterListByName=&flag=0`;
}

function makeCardsUrl(knowledgeId, taskCount, clazzId = PRIMARY_CLASS_ID) {
  return `https://mooc1.chaoxing.com/knowledge/cards?clazzid=${clazzId}&courseid=${COURSE_ID}&knowledgeid=${knowledgeId}&num=${taskCount}&v=20160407&ut=t&cpi=${CPI}&mooc2=1&isMicroCourse=false`;
}

function makeMarkUrl(clazzid, chapterId, workLibraryId) {
  return `https://mooc2-ans.chaoxing.com/mooc2-ans/work/mark?courseid=${COURSE_ID}&clazzid=${clazzid}&cpi=${CPI}&id=&submit=true&evaluation=0&from=&ceyan=1&chapterid=${chapterId}&workLibraryid=${workLibraryId}&prePageSize=0&prePageNum=0&noBack=false&topicid=0&backurl=&attachmentWorkId=`;
}

async function waitForDiscoveredWorkFrame(page, timeoutMs = 4500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workFrame = page.frames().find((frame) => /selectWorkQuestion/.test(frame.url()));
    if (workFrame) return workFrame;
    await page.waitForTimeout(300);
  }
  return null;
}

async function extractWorkPointInfoFromPage(page) {
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('iframe'));
    for (const frame of frames) {
      const src = frame.getAttribute('src') || '';
      const rawData = frame.getAttribute('data') || '';
      let parsedData = null;
      if (rawData) {
        try {
          parsedData = JSON.parse(rawData);
        } catch {}
      }
      const jobId = parsedData?.jobid || parsedData?._jobid || '';
      const workLibraryId = parsedData?.workid || '';
      const workType = parsedData?.worktype || '';
      if (!workLibraryId && !/modules\/work|api\/work|selectWorkQuestion/.test(src)) {
        continue;
      }
      return {
        frameSrc: src,
        jobId,
        workLibraryId,
        workType,
      };
    }
    return null;
  });
}

async function discoverWorkPoint(page, item, taskNum) {
  const cardsUrl = makeCardsUrl(item.knowledgeId, taskNum);
  try {
    await withTaskFuse(
      () => page.goto(cardsUrl, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationTimeout,
      }),
      TIMEOUTS.taskFuseTimeout,
      `发现章节测验 ${item.title}#${taskNum}`
    );
    await page.waitForTimeout(1200);
  } catch {
    return null;
  }

  const workFrame = await waitForDiscoveredWorkFrame(page);
  if (workFrame) {
    const frameUrl = new URL(workFrame.url());
    const workLibraryId = frameUrl.searchParams.get('workId') || '';
    const chapterId = frameUrl.searchParams.get('chapterId') || item.knowledgeId;
    if (workLibraryId && chapterId) {
      return {
        num: item.num,
        title: item.title,
        taskCount: item.taskCount,
        taskNum,
        knowledgeId: item.knowledgeId,
        chapterId,
        workLibraryId,
        cardsUrl: page.url(),
        frameUrl: workFrame.url(),
        discoverySource: 'selectWorkQuestion-frame',
      };
    }
  }

  const workPoint = await extractWorkPointInfoFromPage(page);
  if (!workPoint?.workLibraryId) {
    return null;
  }

  return {
    num: item.num,
    title: item.title,
    taskCount: item.taskCount,
    taskNum,
    knowledgeId: item.knowledgeId,
    chapterId: item.knowledgeId,
    workLibraryId: workPoint.workLibraryId,
    cardsUrl: page.url(),
    frameUrl: workPoint.frameSrc || '',
    discoverySource: 'task-iframe-data',
  };
}

async function loadChapterItems(page) {
  await page.goto(makeChapterListUrl(), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.navigationTimeout,
  });
  await page.waitForTimeout(2000);
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('.catalog_level li'))
      .map((li) => {
        const input = li.querySelector('input[type="checkbox"]');
        const title = li.querySelector('.clicktitle')?.textContent.replace(/\s+/g, ' ').trim() || '';
        const num = li.querySelector('.catalog_sbar')?.textContent.trim() || '';
        const taskCount = li.querySelector('.catalog_points_yi')?.textContent.trim() || '';
        return { knowledgeId: input?.value || '', num, title, taskCount };
      })
      .filter((item) => item.knowledgeId && item.taskCount);
  });
}

async function discoverChapterTests(page) {
  const items = await loadChapterItems(page);
  const tests = [];
  const liveItemByNum = new Map();

  for (const item of items) {
    liveItemByNum.set(item.num, item);
  }

  const seen = new Set();
  for (const known of KNOWN_CHAPTER_TESTS) {
    const liveItem = liveItemByNum.get(known.num);
    if (!liveItem) continue;

    const key = `${known.chapterId}:${known.workLibraryId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    tests.push({
      ...known,
      knowledgeId: liveItem.knowledgeId,
      taskCount: liveItem.taskCount,
      cardsUrl: makeCardsUrl(liveItem.knowledgeId, known.taskNum),
      frameUrl: '',
      discoverySource: 'known-config',
    });
  }

  for (const item of items) {
    const chapterMatch = String(item.num || '').match(/^(\d+)/);
    const majorChapter = chapterMatch ? Number(chapterMatch[1]) : null;
    if (
      majorChapter !== null &&
      (majorChapter < 2 || majorChapter > DISCOVERY_MAX_MAJOR_CHAPTER)
    ) {
      continue;
    }
    if (liveItemByNum.has(item.num) && KNOWN_CHAPTER_TESTS.some((known) => known.num === item.num)) {
      continue;
    }
    const maxTaskNum = Math.max(Number(item.taskCount) || 1, 8);
    for (let taskNum = 1; taskNum <= maxTaskNum; taskNum += 1) {
      const discovered = await discoverWorkPoint(page, item, taskNum);
      if (!discovered) continue;

      const key = `${discovered.chapterId}:${discovered.workLibraryId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      tests.push(discovered);
      break;
    }
  }

  return tests;
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

function isZeroScore(value) {
  return /^0(?:\.0+)?$/.test(String(value || '').trim());
}

async function submitCurrentReview(page, forcedScore) {
  const answerImageCount = await page.locator('.mark_item1 img[src*="ananas.chaoxing.com"]').count();
  const score = forcedScore ?? (answerImageCount > 0 ? '100' : '0');

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

async function collectZeroScoreRows(page, listUrl) {
  const zeroRows = [];
  const totalPages = await getTotalPages(page);

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

    const rows = await getRows(page);
    zeroRows.push(...rows
      .filter((row) => row.reviewUrl && isZeroScore(row.score))
      .map((row) => ({ ...row, page: currentPage })));
  }

  return { totalPages, zeroRows };
}

async function processClassChapter(page, clazz, chapterTest) {
  await page.goto(makeMarkUrl(clazz.id, chapterTest.chapterId, chapterTest.workLibraryId), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.navigationTimeout,
  });
  await waitForReviewList(page);

  const body = await page.locator('body').innerText();
  if (/已交\s*0/.test(body) || body.includes('暂无数据')) {
    return {
      class: clazz.label,
      chapter: chapterTest.num,
      title: chapterTest.title,
      pending: 0,
      graded: 0,
      details: [],
    };
  }

  const details = [];
  const listUrl = page.url();
  const totalPages = await getTotalPages(page);

  async function reopenListPage(pageNum) {
    const pageUrl = new URL(listUrl);
    pageUrl.searchParams.set('pageNum', String(pageNum));
    pageUrl.searchParams.set('pages', String(pageNum));
    await withRetries(
      () => page.goto(pageUrl.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUTS.navigationTimeout,
      }),
      TIMEOUTS.retryTimes,
      `返回列表 ${clazz.label}-${chapterTest.num}-第${pageNum}页`
    );
    await waitForReviewList(page);
  }

  for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
    if (currentPage > 1) {
      await reopenListPage(currentPage);
    }

    const rows = await getRows(page);
    const pendingRows = rows.filter((row) => row.status.includes('待批'));

    for (const row of pendingRows) {
      if (!row.reviewUrl) continue;
      const absoluteUrl = row.reviewUrl.startsWith('http') ? row.reviewUrl : `${BASE_ORIGIN}${row.reviewUrl}`;
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
      details.push({ name: row.name, page: currentPage, ...result });

      await reopenListPage(currentPage);
    }
  }

  return {
    class: clazz.label,
    chapter: chapterTest.num,
    title: chapterTest.title,
    totalPages,
    pending: details.length,
    graded: details.length,
    details,
  };
}

async function fixZeroScoreRows(page, clazz, chapterTest) {
  await page.goto(makeMarkUrl(clazz.id, chapterTest.chapterId, chapterTest.workLibraryId), {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.navigationTimeout,
  });
  await waitForReviewList(page);

  const body = await page.locator('body').innerText();
  if (/已交\s*0/.test(body) || body.includes('暂无数据')) {
    return {
      class: clazz.label,
      chapter: chapterTest.num,
      title: chapterTest.title,
      totalPages: 1,
      zeroScoreCount: 0,
      fixedCount: 0,
      details: [],
    };
  }

  const listUrl = page.url();
  const { totalPages, zeroRows } = await collectZeroScoreRows(page, listUrl);
  const details = [];

  for (const row of zeroRows) {
    const absoluteUrl = row.reviewUrl.startsWith('http') ? row.reviewUrl : `${BASE_ORIGIN}${row.reviewUrl}`;
    const result = await withRetries(
      () => withTaskFuse(async () => {
        await page.goto(absoluteUrl, {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUTS.navigationTimeout,
        });
        await page.waitForSelector('body', { timeout: TIMEOUTS.actionTimeout });
        await page.waitForTimeout(1000);
        const reviewResult = await submitCurrentReview(page, '100');
        await page.waitForTimeout(1200);
        return reviewResult;
      }, TIMEOUTS.taskFuseTimeout, `修正0分 ${clazz.label}-${row.name}`),
      TIMEOUTS.retryTimes,
      `修正0分 ${clazz.label}-${row.name}`
    );
    details.push({
      name: row.name,
      studentNo: row.studentNo,
      page: row.page,
      previousScore: row.score,
      ...result,
    });

    const returnUrl = new URL(listUrl);
    returnUrl.searchParams.set('pageNum', String(row.page));
    returnUrl.searchParams.set('pages', String(row.page));
    await page.goto(returnUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.navigationTimeout,
    });
    await waitForReviewList(page);
  }

  return {
    class: clazz.label,
    chapter: chapterTest.num,
    title: chapterTest.title,
    totalPages,
    zeroScoreCount: zeroRows.length,
    fixedCount: details.length,
    details,
  };
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

module.exports = {
  COURSE_ID,
  CPI,
  TARGET_CLASSES,
  PRIMARY_CLASS_ID,
  isZeroScore,
  login,
  loadChapterItems,
  discoverChapterTests,
  makeMarkUrl,
  processClassChapter,
  fixZeroScoreRows,
};
