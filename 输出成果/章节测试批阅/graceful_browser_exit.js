class ManualBrowserExitError extends Error {
  constructor(message = '检测到浏览器已被手动关闭，脚本停止执行。') {
    super(message);
    this.name = 'ManualBrowserExitError';
  }
}

function isBrowserClosedError(error) {
  const message = String(error?.message || error || '');
  return /Target page, context or browser has been closed/i.test(message)
    || /Browser has been closed/i.test(message)
    || /browserType\.launch:.*closed/i.test(message);
}

function createBrowserDisconnectGuard(browser) {
  let disconnected = false;
  let rejectDisconnect;
  const disconnectPromise = new Promise((_, reject) => {
    rejectDisconnect = reject;
  });

  browser.once('disconnected', () => {
    disconnected = true;
    rejectDisconnect(new ManualBrowserExitError());
  });

  return {
    get disconnected() {
      return disconnected;
    },
    throwIfDisconnected() {
      if (disconnected) {
        throw new ManualBrowserExitError();
      }
    },
    async run(task) {
      this.throwIfDisconnected();
      return Promise.race([
        Promise.resolve().then(task),
        disconnectPromise,
      ]);
    },
  };
}

async function closeBrowserQuietly(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch (error) {
    if (!isBrowserClosedError(error)) {
      throw error;
    }
  }
}

function handleScriptError(error) {
  if (error instanceof ManualBrowserExitError || isBrowserClosedError(error)) {
    console.log('浏览器已手动关闭，脚本已安全退出。');
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
}

module.exports = {
  ManualBrowserExitError,
  createBrowserDisconnectGuard,
  closeBrowserQuietly,
  handleScriptError,
  isBrowserClosedError,
};
