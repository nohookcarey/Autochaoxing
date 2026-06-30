export class ManualBrowserExitError extends Error {
  constructor(message = "检测到浏览器已被手动关闭，脚本停止执行。") {
    super(message);
    this.name = "ManualBrowserExitError";
  }
}

export function isBrowserClosedError(error) {
  const message = String(error?.message || error || "");
  return /Target page, context or browser has been closed/i.test(message)
    || /Browser has been closed/i.test(message)
    || /browserType\.launch:.*closed/i.test(message)
    || /page\.goto:.*closed/i.test(message);
}

export function createBrowserDisconnectGuard(browser) {
  let disconnected = false;
  let rejectDisconnect;
  const disconnectPromise = new Promise((_, reject) => {
    rejectDisconnect = reject;
  });

  browser.once("disconnected", () => {
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

export async function closeBrowserQuietly(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch (error) {
    if (!isBrowserClosedError(error)) {
      throw error;
    }
  }
}
