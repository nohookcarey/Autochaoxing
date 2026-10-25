const { chromium } = require('playwright');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

const LOGIN_URL = 'https://passport2.chaoxing.com/login?fid=12&refer=http%3A%2F%2Fi.chaoxing.com%2Fbase%3Fvflag%3Dtrue%26fid%3D%26backUrl%3D&space=2';
const COURSE_URL = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch?courseid=&clazzid=&cpi=&enc=a8d9fd2f3f8e5cf245d2a37de329e574&t=1779126525125&pageHeader=2&v=2&hideHead=0&perspectiveType=';

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.fill('input[placeholder="手机号/超星号"]', (process.env.XTX_USERNAME || ''));
  await page.fill('input[placeholder="学习通密码"]', (process.env.XTX_PASSWORD || ''));
  const agree = page.locator('input[type="checkbox"]').first();
  if (await agree.count()) {
    try { await agree.check({ force: true }); } catch {}
  }
  await page.locator('button:has-text("登录")').click();
  await page.waitForLoadState('networkidle');
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const browserGuard = createBrowserDisconnectGuard(browser);
  try {
    await browserGuard.run(async () => {
      const page = await browser.newPage();
      await login(page);
      await page.goto(COURSE_URL, { waitUntil: 'networkidle' });
      const frames = page.frames().map((f) => ({ url: f.url(), name: f.name() }));
      console.log(JSON.stringify(frames, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
