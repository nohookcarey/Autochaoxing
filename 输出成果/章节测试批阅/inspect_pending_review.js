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
      const url = 'https://mooc2-ans.chaoxing.com/mooc2-ans/work/library/review-work?courseid=&clazzid=&workId=&workAnswerId=&groupId=0&from=&sort=0&order=0&status=0&pages=1&size=20&topicid=0';
      await page.goto(url, { waitUntil: 'networkidle' });
      const visibleInputs = await page.locator('input').evaluateAll((els) => els.map((el, i) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        return { i, type: el.type, value: el.value, placeholder: el.placeholder, visible };
      }).filter(x => x.visible));
      console.log(JSON.stringify(visibleInputs, null, 2));
      console.log((await page.locator('body').innerText()).slice(0, 2500));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
