async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page.goto:.*closed/i.test(message);
  };

  try {
  const ENV =
    typeof globalThis !== "undefined" && globalThis.process && globalThis.process.env
      ? globalThis.process.env
      : {};

  const CONFIG = {
    username: ENV.XTX_USERNAME || "",
    password: ENV.XTX_PASSWORD || "",
    courseWorkListUrl:
      ENV.XTX_DEADLINE_COURSE_WORK_LIST_URL ||
      "https://mooc2-ans.chaoxing.com/mooc2-ans/work/list?courseid=&selectClassid=0&cpi=&v=0",
  };
  const LOGIN_URL =
    "https://passport2.chaoxing.com/login?fid=&refer=" + encodeURIComponent(CONFIG.courseWorkListUrl);

  if (!CONFIG.username || !CONFIG.password) {
    throw new Error("请通过 XTX_USERNAME 和 XTX_PASSWORD 环境变量提供学习通账号信息。");
  }

  async function gotoCourseList() {
    await page.goto(CONFIG.courseWorkListUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(1200);
  }

  async function onLoginPage() {
    return await page.evaluate(() => {
      const body = document.body?.innerText || "";
      const hasLoginInputs =
        !!document.querySelector("input[placeholder='手机号/超星号']") ||
        !!document.querySelector("input[placeholder='学习通密码']");
      return (
        location.hostname.includes("passport2.chaoxing.com") ||
        hasLoginInputs ||
        body.includes("学习通密码")
      );
    });
  }

  await gotoCourseList();
  const needsLogin = await onLoginPage();

  let reusedSession = !needsLogin;
  if (needsLogin) {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.getByPlaceholder("手机号/超星号").fill(CONFIG.username);
    await page.getByPlaceholder("学习通密码").fill(CONFIG.password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    await gotoCourseList();
    reusedSession = false;
  }

  return {
    reusedSession,
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
