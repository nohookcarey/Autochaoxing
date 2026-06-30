const { chromium } = require('playwright');
const { configurePage } = require('./browser_timeout_config');
const {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  handleScriptError,
} = require('./graceful_browser_exit');
const {
  discoverChapterTests,
  login,
} = require('./chaoxing_helpers');

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

      const chapterTests = await discoverChapterTests(page);
      console.log('DISCOVERED_CHAPTER_TESTS');
      console.log(JSON.stringify(chapterTests, null, 2));
    });
  } finally {
    await closeBrowserQuietly(browser);
  }
}

main().catch(handleScriptError);
