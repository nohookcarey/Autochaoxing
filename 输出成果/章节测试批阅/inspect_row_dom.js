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
      await page.goto('https://mooc2-ans.chaoxing.com/mooc2-ans/work/mark?courseid=260169647&clazzid=141397001&id=53393967&cpi=488262137&groupId=0&from=&sort=0&order=0&status=0&pages=1&size=20&topicid=0&backurl=', { waitUntil: 'networkidle' });

      const info = await page.evaluate(() => {
        const view = Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === '查看');
        if (!view) return null;
        let node = view;
        const chain = [];
        for (let i = 0; i < 6 && node; i += 1) {
          chain.push({
            tag: node.tagName,
            cls: node.className,
            text: (node.textContent || '').trim().slice(0, 300),
            html: node.outerHTML.slice(0, 800),
          });
          node = node.parentElement;
        }
        return chain;
      });
      console.log(JSON.stringify(info, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
