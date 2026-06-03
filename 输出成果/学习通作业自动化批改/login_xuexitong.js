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
      ENV.XTX_COURSE_WORK_LIST_URL || "",
  };
  const CONFIG_LOGIN_URL =
    "https://passport2.chaoxing.com/login?fid=&refer=" + encodeURIComponent(CONFIG.courseWorkListUrl);

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

  async function ensureCourseList() {
    if (!page.url().includes("/mooc2-ans/work/list")) {
      await gotoCourseList();
    }
    await page.waitForTimeout(1200);
  }

  await gotoCourseList();
  const needsLogin = await onLoginPage();

  let reusedSession = !needsLogin;
  if (needsLogin) {
    if (!CONFIG.username || !CONFIG.password) {
      throw new Error("当前未复用到已登录会话。请填写 CONFIG.username 和 CONFIG.password 后重试。");
    }

    await page.goto(CONFIG_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.getByPlaceholder("手机号/超星号").fill(CONFIG.username);
    await page.getByPlaceholder("学习通密码").fill(CONFIG.password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
    await ensureCourseList();
    reusedSession = false;
  }

  await ensureCourseList();

  return {
    reusedSession,
    url: page.url(),
    title: await page.title(),
    bodySample: (await page.locator("body").innerText())
      .replace(/\s+/g, " ")
      .slice(0, 300),
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