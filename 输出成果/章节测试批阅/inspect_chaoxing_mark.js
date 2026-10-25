const { chromium } = require('playwright');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });
  const browserGuard = createBrowserDisconnectGuard(browser);
  try {
    await browserGuard.run(async () => {
      const page = await browser.newPage();

      await page.goto('https://passport2.chaoxing.com/login?fid=12&refer=http%3A%2F%2Fi.chaoxing.com%2Fbase%3Fvflag%3Dtrue%26fid%3D%26backUrl%3D&space=2', {
        waitUntil: 'domcontentloaded',
      });

      await page.fill('input[placeholder="手机号/超星号"]', (process.env.XTX_USERNAME || ''));
      await page.fill('input[placeholder="学习通密码"]', (process.env.XTX_PASSWORD || ''));
      const agree = page.locator('input[type="checkbox"]').first();
      if (await agree.count()) {
        try {
          await agree.check({ force: true });
        } catch {}
      }
      await page.locator('button:has-text("登录")').click();
      await page.waitForTimeout(5000);
      console.log('after-login-url:', page.url());
      console.log('after-login-title:', await page.title());

      await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/work/mark?courseid=&clazzid=&id=&cpi=&groupId=0&from=&sort=0&order=0&status=0&pages=1&size=20&topicid=0&backurl=', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');
      console.log('mark-url:', page.url());

      const classTexts = await page.locator('text=/人工智能\\d班/').allTextContents();
      console.log('classTexts:', classTexts);

      const bodyText = await page.locator('body').innerText();
      console.log(bodyText.slice(0, 3000));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
