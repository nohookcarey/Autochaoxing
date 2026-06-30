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
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const browserGuard = createBrowserDisconnectGuard(browser);
  try {
    await browserGuard.run(async () => {
      const page = await browser.newPage();
      await login(page);
      await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/work/library/review-work?courseid=0&clazzid=0&workId=0&workAnswerId=0&groupId=0&from=&sort=0&order=0&status=0&pages=1&size=20&topicid=0', { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
        const visible = inputs.filter((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });
        const totalInput = visible.find((el) => !el.placeholder);
        totalInput.value = '0';
        totalInput.dispatchEvent(new Event('input', { bubbles: true }));
        totalInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
      console.log('before', page.url(), await page.title());
      await page.locator('a.btnBlue[onclick*="markAction(1)"]').click();
      await page.waitForTimeout(1000);
      if (await page.getByText('保存并继续', { exact: true }).count()) {
        await page.getByText('保存并继续', { exact: true }).click();
      }
      await page.waitForTimeout(5000);
      console.log('after', page.url(), await page.title());
      console.log((await page.locator('body').innerText()).slice(0, 2000));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
