async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page.goto:.*closed/i.test(message);
  };

  try {
  await page.goto(
    "https://passport2.chaoxing.com/login?fid=&refer=https://mooc2-ans.chaoxing.com/mooc2-ans/tch/index",
    { waitUntil: "domcontentloaded", timeout: 45000 }
  );

  const username = process.env.XTX_USERNAME || "";
  const password = process.env.XTX_PASSWORD || "";
  if (!username || !password) {
    throw new Error("请通过 XTX_USERNAME 和 XTX_PASSWORD 环境变量提供学习通账号信息。");
  }
  await page.getByPlaceholder("手机号/超星号").fill(username);
  await page.getByPlaceholder("学习通密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  return {
    url: page.url(),
    title: await page.title(),
    bodySample: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300),
  };
  } catch (error) {
    if (isBrowserClosedError(error)) {
      return {
        safeExit: true,
        status: 'manual_browser_exit',
        message: '浏览器已手动关闭，脚本已安全退出。',
      };
    }
    throw error;
  }
}
