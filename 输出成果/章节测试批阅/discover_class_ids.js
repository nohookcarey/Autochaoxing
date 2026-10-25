const { chromium } = require('playwright');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

async function login(page) {
  await page.goto('https://passport2.chaoxing.com/login?fid=12&refer=http%3A%2F%2Fi.chaoxing.com%2Fbase%3Fvflag%3Dtrue%26fid%3D%26backUrl%3D&space=2', { waitUntil: 'domcontentloaded' });
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
      await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/work/mark?courseid=&clazzid=&id=&cpi=&groupId=0&from=&sort=0&order=0&status=0&pages=1&size=20&topicid=0&backurl=', { waitUntil: 'networkidle' });

      const labels = ['人工智能1班', '人工智能2班', '人工智能3班', '人工智能4班', '人工智能5班', '人工智能6班'];
      const mapping = {};

      for (const label of labels) {
        await page.locator(`text=${labels[0]}`).first().click().catch(() => {});
        await page.waitForTimeout(300);
        const options = page.locator(`text=${label}`);
        const count = await options.count();
        if (!count) {
          mapping[label] = { error: 'option not found' };
          continue;
        }
        await options.last().click();
        await page.waitForLoadState('networkidle');
        mapping[label] = { url: page.url() };
      }

      console.log(JSON.stringify(mapping, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
