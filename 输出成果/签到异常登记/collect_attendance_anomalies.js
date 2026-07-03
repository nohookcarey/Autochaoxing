#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.argv[2];
const SUMMARY_PATH_ARG = process.argv[3] || '';

if (!CONFIG_PATH) {
  console.error('用法: node collect_attendance_anomalies.js <config.json> [summary.json]');
  process.exit(1);
}

function loadPlaywright() {
  const candidates = [
    process.env.XTX_PLAYWRIGHT_MODULE_PATH,
    '/Users/careynohook/Documents/Codex/脚本仓库/学习通/章节测试批阅/章节测试批阅脚本_2026-05-19/node_modules/playwright',
    'playwright',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error('未找到 Playwright。可通过 XTX_PLAYWRIGHT_MODULE_PATH 指向已安装模块目录。');
}

const { chromium } = loadPlaywright();

const CHROME_PATH =
  process.env.XTX_CHROME_EXECUTABLE ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TEACH_DATA_URL =
  'https://stat2-ans.chaoxing.com/teach-data/index?courseid=260169647&clazzid=141397001&cpi=488262137&ut=t&pEnc=';
const RAW_STATUS_BY_CODE = {
  '5': '缺勤',
  '7': '病假',
  '8': '事假',
  '9': '迟到',
  '10': '早退',
  '12': '公假',
};
const IGNORE_STATUS_CODES = new Set(['', '1', '2']);

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function getSummaryPath() {
  if (SUMMARY_PATH_ARG) {
    return path.resolve(SUMMARY_PATH_ARG);
  }
  return path.resolve(path.dirname(CONFIG_PATH), 'attendance_anomalies_summary.json');
}

function configurePage(page) {
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
}

async function withRetries(task, retryTimes, label) {
  let lastError;
  const totalAttempts = Math.max(Number(retryTimes) || 0, 0) + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= totalAttempts) {
        break;
      }
      console.warn(`RETRY ${label} ${attempt}/${totalAttempts - 1}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

async function closeBrowserQuietly(browser) {
  if (!browser) {
    return;
  }
  try {
    await browser.close();
  } catch {}
}

async function login(page) {
  const username = normalizeText(process.env.XTX_USERNAME);
  const password = normalizeText(process.env.XTX_PASSWORD);
  if (!username || !password) {
    throw new Error('请通过 XTX_USERNAME 和 XTX_PASSWORD 提供本次运行账号信息。');
  }

  const loginUrl =
    'https://passport2.chaoxing.com/login?fid=12&refer=http%3A%2F%2Fi.chaoxing.com%2Fbase%3Fvflag%3Dtrue%26fid%3D%26backUrl%3D&space=2';
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="手机号/超星号"]', username);
  await page.fill('input[placeholder="学习通密码"]', password);
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

function mapRecord(signstatus, statusText, symbolMap) {
  const rawStatus = normalizeText(statusText) || RAW_STATUS_BY_CODE[String(signstatus || '')] || '';
  if (IGNORE_STATUS_CODES.has(String(signstatus || '')) || rawStatus === '代签' || rawStatus === '已签') {
    return null;
  }
  if (symbolMap[rawStatus]) {
    return { rawStatus, mappedStatus: symbolMap[rawStatus] };
  }
  if (rawStatus.includes('未签到')) {
    return { rawStatus, mappedStatus: symbolMap['未签到'] };
  }
  if (rawStatus.includes('缺勤')) {
    return { rawStatus, mappedStatus: symbolMap['缺勤'] };
  }
  if (rawStatus.includes('旷课')) {
    return { rawStatus, mappedStatus: symbolMap['旷课'] };
  }
  if (rawStatus.includes('迟到')) {
    return { rawStatus, mappedStatus: symbolMap['迟到'] };
  }
  if (rawStatus.includes('早退')) {
    return { rawStatus, mappedStatus: symbolMap['早退'] };
  }
  return null;
}

async function collectGlobals(page) {
  await page.goto(TEACH_DATA_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  return page.evaluate(() => {
    const result = {};
    const keys = ['denc', 'userId', 'clazzId', 'courseId', 'cpi'];
    for (const key of keys) {
      result[key] = window[key] ?? null;
    }
    result.serverHost = window.ServerHost || null;
    return result;
  });
}

async function fetchActiveList(page, globals, classId, courseId) {
  const signStatisticsUrl = `${globals.serverHost.mobileLearnDomain1}/page/sign/signStatistics?classId=${classId}&courseId=${courseId}&cpi=${globals.cpi}&denc=${globals.denc}&duid=${globals.userId}`;
  await withRetries(
    async () => {
      await page.goto(signStatisticsUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
    },
    2,
    `打开班级签到统计 ${classId}`
  );
  const responseText = await page.evaluate(
    async ({ innerCourseId, innerClassId, innerUserId, innerDenc }) => {
      const url = `/v2/apis/signStat/getSignActiveListByClassId?DB_STRATEGY=COURSEID&STRATEGY_PARA=courseId&courseId=${innerCourseId}&classId=${innerClassId}&page=1&pageSize=9999&orderType=0&duid=${innerUserId}&denc=${innerDenc}`;
      const response = await fetch(url, { credentials: 'include' });
      return await response.text();
    },
    {
      innerCourseId: courseId,
      innerClassId: classId,
      innerUserId: globals.userId,
      innerDenc: globals.denc,
    }
  );
  const data = JSON.parse(responseText);
  return Array.isArray(data?.data?.list) ? data.data.list : [];
}

async function collectActivityRecords(page, globals, activity, courseId, classId, cpi) {
  const activityUrl = `${globals.serverHost.mobileLearnDomain1}/page/sign/endSign?courseId=${courseId}&classId=${classId}&activeId=${activity.active_id}&fromtype=stat&tabpage0=1&tabpage1=1&duid=${globals.userId}&denc=${globals.denc}&fanyaFid=&cpi=${cpi}`;
  await withRetries(
    async () => {
      await page.goto(activityUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => {
          const tabs = document.querySelectorAll('.tab-body > .tab-list');
          return (
            tabs.length > 0 &&
            Array.from(tabs).some(
              (tab) => tab.querySelectorAll('li.listLi').length > 0 || /暂无/.test(tab.innerText || '')
            )
          );
        },
        { timeout: 15000 }
      );
      await page.waitForTimeout(1200);
    },
    2,
    `采集签到活动 ${activity.active_id}`
  );

  const records = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.tab-body > .tab-list')).flatMap((tab) => {
      return Array.from(tab.querySelectorAll('li.listLi')).map((li) => {
        const nameNode = li.querySelector('.user-name .txt') || li.querySelector('.user-name');
        const studentNoNode = li.querySelector('.user-id') || li.querySelector('.line-h44');
        const statusNode = li.querySelector('.sta-con .cur') || li.querySelector('.site-sign p:first-child');
        const timeCandidates = Array.from(li.querySelectorAll('.site-sign p, .colorShallow.fs12 span.fr, .colorShallow.fs12 p'));
        const timeText =
          timeCandidates
            .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .pop() || '';
        return {
          name: (nameNode?.textContent || '').replace(/\s+/g, ' ').trim(),
          studentNo: (studentNoNode?.textContent || '').replace(/\s+/g, '').trim(),
          signstatus: li.getAttribute('signstatus') || '',
          statusText: (statusNode?.textContent || '').replace(/\s+/g, ' ').trim(),
          remark: li.getAttribute('remark') || '',
          timeText,
        };
      });
    });
  });

  return records.map((record) => ({
    ...record,
    activityId: String(activity.active_id),
    activityName: normalizeText(activity.name),
    activityStarttime: String(activity.starttime || ''),
    activityEndtime: String(activity.endtime || ''),
  }));
}

function buildClassSummary(classConfig, activities, collectedRecords, symbolMap, maxSlots) {
  const students = new Map();
  const countsByRaw = {};
  const countsByMapped = {};
  let ignoredProxyCount = 0;
  let ignoredNormalCount = 0;

  for (const record of collectedRecords) {
    const signstatus = String(record.signstatus || '');
    if (signstatus === '2') {
      ignoredProxyCount += 1;
      continue;
    }
    if (signstatus === '1') {
      ignoredNormalCount += 1;
      continue;
    }
    const mapped = mapRecord(record.signstatus, record.statusText, symbolMap);
    if (!mapped) {
      continue;
    }
    countsByRaw[mapped.rawStatus] = (countsByRaw[mapped.rawStatus] || 0) + 1;
    countsByMapped[mapped.mappedStatus] = (countsByMapped[mapped.mappedStatus] || 0) + 1;

    if (!students.has(record.studentNo)) {
      students.set(record.studentNo, {
        studentNo: record.studentNo,
        name: record.name,
        className: classConfig.name,
        records: [],
      });
    }
    students.get(record.studentNo).records.push({
      rawStatus: mapped.rawStatus,
      mappedStatus: mapped.mappedStatus,
      activityId: record.activityId,
      activityName: record.activityName,
      activityStarttime: record.activityStarttime,
      activityEndtime: record.activityEndtime,
      timeText: record.timeText,
      sortKey: toTimestamp(record.activityStarttime),
    });
  }

  const studentRecords = Array.from(students.values())
    .map((student) => {
      student.records.sort((a, b) => a.sortKey - b.sortKey || String(a.activityId).localeCompare(String(b.activityId)));
      return {
        studentNo: student.studentNo,
        name: student.name,
        className: student.className,
        totalRecordCount: student.records.length,
        slots: student.records.slice(0, maxSlots).map((item) => item.mappedStatus),
        records: student.records.map(({ sortKey, ...item }) => item),
      };
    })
    .sort((a, b) => a.studentNo.localeCompare(b.studentNo, 'zh-Hans-CN'));

  return {
    name: classConfig.name,
    classId: classConfig.classId,
    sheetPath: classConfig.sheetPath,
    outputPath: classConfig.outputPath,
    activityCount: activities.length,
    studentCountWithAnomalies: studentRecords.length,
    totalAnomalyRecords: studentRecords.reduce((sum, student) => sum + student.totalRecordCount, 0),
    truncatedStudentCount: studentRecords.filter((student) => student.totalRecordCount > maxSlots).length,
    ignoredProxyCount,
    ignoredNormalCount,
    countsByRaw,
    countsByMapped,
    studentRecords,
  };
}

async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const summaryPath = getSummaryPath();
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME_PATH,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = await browser.newPage();
    configurePage(page);

    await login(page);
    const globals = await collectGlobals(page);
    const summary = {
      generatedAt: new Date().toISOString(),
      configPath: path.resolve(CONFIG_PATH),
      globals: {
        userId: globals.userId,
        courseId: globals.courseId,
        cpi: globals.cpi,
        denc: globals.denc,
      },
      classes: [],
    };

    for (const classConfig of config.classes) {
      const activities = await fetchActiveList(page, globals, classConfig.classId, config.course.courseId);
      const sortedActivities = activities.slice().sort((a, b) => toTimestamp(a.starttime) - toTimestamp(b.starttime));
      const collectedRecords = [];
      for (const activity of sortedActivities) {
        const activityRecords = await collectActivityRecords(
          page,
          globals,
          activity,
          config.course.courseId,
          classConfig.classId,
          config.course.cpi
        );
        collectedRecords.push(...activityRecords);
      }
      summary.classes.push(
        buildClassSummary(
          classConfig,
          sortedActivities,
          collectedRecords,
          config.symbolMap,
          Number(config.maxAttendanceSlots) || 18
        )
      );
    }

    ensureDirForFile(summaryPath);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(summaryPath);
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
