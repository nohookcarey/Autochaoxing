const DEFAULT_TIMEOUTS = {
  navigationTimeout: Number(process.env.NAVIGATION_TIMEOUT_MS || 45000),
  actionTimeout: Number(process.env.ACTION_TIMEOUT_MS || 15000),
  taskFuseTimeout: Number(process.env.TASK_FUSE_TIMEOUT_MS || 90000),
  retryTimes: Number(process.env.RETRY_TIMES || 2),
};

function getTimeoutConfig() {
  return { ...DEFAULT_TIMEOUTS };
}

function configurePage(page) {
  const timeouts = getTimeoutConfig();
  page.setDefaultTimeout(timeouts.actionTimeout);
  page.setDefaultNavigationTimeout(timeouts.navigationTimeout);
}

async function withRetries(task, retryTimes, label) {
  let lastError;
  const totalAttempts = Math.max(Number(retryTimes) || 0, 0) + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= totalAttempts) break;
      console.warn(`RETRY ${label} ${attempt}/${totalAttempts - 1}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

async function withTaskFuse(task, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`任务超时: ${label}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  configurePage,
  getTimeoutConfig,
  withRetries,
  withTaskFuse,
};
