const { chromium } = require('playwright');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
        try { await agree.check({ force: true }); } catch {}
      }
      await page.locator('button:has-text("登录")').click();
      await page.waitForLoadState('networkidle');

      await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/work/library/review-work?courseid=0&clazzid=0&workId=0&workAnswerId=0&groupId=0&from=&sort=0&order=0&status=0&pages=1&size=20&topicid=0&backurl=', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForLoadState('networkidle');

      console.log('review-url:', page.url());
      console.log('title:', await page.title());
      console.log((await page.locator('body').innerText()).slice(0, 4000));
      console.log('img-count:', await page.locator('img').count());
      console.log('img-srcs:', await page.locator('img').evaluateAll((els) => els.map((el, i) => ({
        i,
        src: el.getAttribute('src'),
        alt: el.getAttribute('alt'),
        cls: el.className
      })).slice(0, 20)));
      console.log('body-html-slice:', (await page.locator('body').innerHTML()).slice(0, 8000));
      console.log('input-values:', await page.locator('input').evaluateAll((els) => els.map(el => ({
        type: el.type,
        value: el.value,
        placeholder: el.placeholder
      }))));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
