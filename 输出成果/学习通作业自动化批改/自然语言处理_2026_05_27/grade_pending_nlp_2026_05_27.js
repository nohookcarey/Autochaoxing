async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page.goto:.*closed/i.test(message);
  };

  try {
  const TIMEOUTS = {
    actionTimeout: 15000,
    navigationTimeout: 45000,
  };

  page.setDefaultTimeout(TIMEOUTS.actionTimeout);
  page.setDefaultNavigationTimeout(TIMEOUTS.navigationTimeout);

  const ASSIGNMENTS = [
    {
      courseId: "0",
      cpi: "0",
      workListId: "0",
      expectedClassName: "人工智能3班",
      expectedTitleIncludes: "关键词提取计算作业",
      mode: "keyword",
    },
    {
      courseId: "0",
      cpi: "0",
      workListId: "0",
      expectedClassName: "人工智能4班",
      expectedTitleIncludes: "关键词提取计算作业",
      mode: "keyword",
    },
    {
      courseId: "0",
      cpi: "0",
      workListId: "0",
      expectedClassName: "人工智能6班",
      expectedTitleIncludes: "关键词提取计算作业",
      mode: "keyword",
    },
    {
      courseId: "0",
      cpi: "0",
      workListId: "0",
      expectedClassName: "人工智能3班",
      expectedTitleIncludes: "第五章-复习题",
      mode: "bio_review",
    },
    {
      courseId: "0",
      cpi: "0",
      workListId: "0",
      expectedClassName: "人工智能6班",
      expectedTitleIncludes: "第五章-复习题",
      mode: "bio_review",
    },
    {
      courseId: "0",
      cpi: "0",
      workListId: "0",
      expectedClassName: "人工智能3班",
      expectedTitleIncludes: "任务一",
      mode: "task1",
    },
    {
      courseId: "0",
      cpi: "0",
      workListId: "0",
      expectedClassName: "人工智能6班",
      expectedTitleIncludes: "任务一",
      mode: "task1",
    },
  ];

  function buildMarkUrl(config) {
    return (
      "https://mooc2-ans.chaoxing.com/mooc2-ans/work/mark" +
      `?courseid=${config.courseId}` +
      `&clazzid=0&id=${config.workListId}&cpi=${config.cpi}` +
      "&evaluation=0&from=&v=0&prePageNum=1&prePageSize=12&topicid=0"
    );
  }

  function normalize(text) {
    return (text || "").replace(/\s+/g, "").replace(/[，。；：、,.]/g, "").trim();
  }

  function extractBetween(bodyText, start, end) {
    const startIndex = bodyText.indexOf(start);
    if (startIndex < 0) return "";
    const afterStart = bodyText.slice(startIndex + start.length);
    const endIndex = end ? afterStart.indexOf(end) : -1;
    return (endIndex >= 0 ? afterStart.slice(0, endIndex) : afterStart).trim();
  }

  function scoreKeyword(answerText) {
    const answer = (answerText || "").trim();
    if (!answer) {
      return {
        questionScore: 60,
        totalScore: 60,
        reason: "有效作答不足，需补充完整计算过程和结果。",
      };
    }

    const hasTf = /TF/i.test(answer);
    const hasIdf = /IDF|IDG/i.test(answer);
    const hasProduct = /TF-?IDF|TF-?IDG/i.test(answer);
    const hasNumber = /\d/.test(answer);

    if (hasTf && hasIdf && hasProduct && hasNumber) {
      return {
        questionScore: 95,
        totalScore: 95,
        reason: "关键词提取计算较完整，过程较清晰。",
      };
    }

    if (answer.length >= 20) {
      return {
        questionScore: 85,
        totalScore: 85,
        reason: "已体现基本思路，但关键步骤和结果仍需补全。",
      };
    }

    return {
      questionScore: 70,
      totalScore: 70,
      reason: "内容较简略，需补充计算过程和关键结果。",
    };
  }

  function scoreBioReview(answerText, correctText, objectiveScore) {
    const answer = normalize(answerText);
    const correct = normalize(correctText.replace(/^【参考答案】/, ""));

    let subjective = 0;
    let reason = "主观标注部分未完成。";

    if (!answer) {
      subjective = 0;
    } else if (answer === correct) {
      subjective = 4.4;
      reason = "BIO 标注作答正确。";
    } else if (/B-|I-|O/.test(answerText) && answer.length >= Math.floor(correct.length * 0.6)) {
      subjective = 3.0;
      reason = "BIO 标注基本完成，仍需核对个别标注细节。";
    } else {
      subjective = 1.5;
      reason = "仅完成部分 BIO 标注，需加强实体边界和类别判断。";
    }

    const total = Number((objectiveScore + subjective).toFixed(1));
    return {
      questionScore: subjective,
      totalScore: total,
      reason,
    };
  }

  function scoreTask1(answerText) {
    const answer = (answerText || "").trim();
    if (!answer) {
      return {
        questionScore: 60,
        totalScore: 60,
        reason: "内容明显不完整，需补充三问的主要要点。",
      };
    }

    const length = answer.length;
    const hasThreeParts =
      /1/.test(answer) && /2/.test(answer) && /3/.test(answer) ||
      /一/.test(answer) && /二/.test(answer) && /三/.test(answer);
    const hasExample = /例如|比如|例子|语音助手|小爱同学/.test(answer);
    const hasChallenges = /模糊|新词|语境|歧义/.test(answer);

    if (hasThreeParts && hasExample && hasChallenges && length >= 60) {
      return {
        questionScore: 93,
        totalScore: 93,
        reason: "三问覆盖较完整，能够体现对基础概念的理解。",
      };
    }

    if ((hasThreeParts || length >= 50) && length >= 35) {
      return {
        questionScore: 88,
        totalScore: 88,
        reason: "主要内容基本达到要求，仍可补充细节并优化表述。",
      };
    }

    return {
      questionScore: 75,
      totalScore: 75,
      reason: "内容还不够完整，需继续补充要点并加强表达。"
    };
  }

  async function waitForReviewList() {
    await page.waitForLoadState("domcontentloaded");
    await page.waitForSelector("body", { timeout: TIMEOUTS.actionTimeout });
    await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || "";
      return document.querySelectorAll("ul.dataBody_td").length > 0 || bodyText.includes("暂无数据");
    }, { timeout: TIMEOUTS.actionTimeout });
    await page.waitForTimeout(800);
  }

  async function getTotalPages() {
    const raw = await page.evaluate(() => {
      const pagerInput = document.querySelector("#totalPage");
      if (pagerInput && "value" in pagerInput) return pagerInput.value;
      const pageText = document.body?.innerText || "";
      const match = pageText.match(/共\s*(\d+)\s*页/);
      return match ? match[1] : "1";
    });
    const total = Number(String(raw).trim());
    return Number.isFinite(total) && total > 0 ? total : 1;
  }

  async function collectPendingRows() {
    const totalPages = await getTotalPages();
    const rows = [];

    for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
      if (currentPage > 1) {
        const pageButton = page.locator("#page li").filter({ hasText: String(currentPage) });
        if (await pageButton.count()) {
          await pageButton.first().click();
          await waitForReviewList();
        }
      }

      const currentRows = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("ul.dataBody_td"))
          .map((row) => {
            const text = row.innerText.replace(/\s+/g, " ").trim();
            const reviewLink = Array.from(row.querySelectorAll("a")).find((a) =>
              ["批阅", "查看"].includes(a.textContent.trim())
            );
            return {
              answerId: row.id,
              text,
              reviewPath: reviewLink?.getAttribute("data") || "",
            };
          })
          .filter((row) => /待批阅|重做待批阅/.test(row.text) && row.reviewPath);
      });

      rows.push(...currentRows);
    }

    return rows;
  }

  async function setScoreOnly(questionScore, totalScore) {
    await page.locator(".questionScore").fill(String(questionScore));
    await page.locator("#tmpscore").fill(String(totalScore));
  }

  async function gradeOne(config, row) {
    const reviewUrl = `https://mooc2-ans.chaoxing.com${row.reviewPath}`;
    await page.goto(reviewUrl, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.navigationTimeout,
    });
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#workAnswerId").waitFor({
      state: "attached",
      timeout: TIMEOUTS.actionTimeout,
    });

    const info = await page.evaluate(() => {
      const bodyText = document.body.innerText.replace(/\s+/g, " ").trim();
      const objectiveMatch = bodyText.match(/客观题得分：([0-9.]+)分/);
      return {
        answerId: document.querySelector("#workAnswerId")?.value || "",
        studentName: document.querySelector("#stuRealName")?.value || "",
        workTitle: document.querySelector("#_title")?.value || "",
        className: bodyText.match(/人工智能[346]班/)?.[0] || "",
        bodyText,
        objectiveScore: objectiveMatch ? Number(objectiveMatch[1]) : 0,
      };
    });

    info.answerText = extractBetween(info.bodyText, "学生答案：", "正确答案：");
    info.correctText = extractBetween(info.bodyText, "正确答案：", "评分");

    if (String(info.answerId) !== String(row.answerId)) {
      return { answerId: row.answerId, studentName: info.studentName, status: "skip_answer_mismatch" };
    }
    if (config.expectedClassName && info.className !== config.expectedClassName) {
      return { answerId: row.answerId, studentName: info.studentName, status: "skip_class_mismatch" };
    }
    if (config.expectedTitleIncludes && !info.workTitle.includes(config.expectedTitleIncludes)) {
      return { answerId: row.answerId, studentName: info.studentName, status: "skip_title_mismatch" };
    }

    let scoring;
    if (config.mode === "keyword") {
      scoring = scoreKeyword(info.answerText);
    } else if (config.mode === "bio_review") {
      scoring = scoreBioReview(info.answerText, info.correctText, info.objectiveScore);
    } else {
      scoring = scoreTask1(info.answerText);
    }

    await setScoreOnly(scoring.questionScore, scoring.totalScore);
    await page.locator("a.btnBlue").filter({ hasText: "提交" }).click();
    await page.waitForTimeout(1200);

    const body = await page.locator("body").innerText().catch(() => "");
    return {
      answerId: row.answerId,
      studentName: info.studentName,
      score: scoring.totalScore,
      reason: scoring.reason,
      status: body.includes("批阅成功") || page.url().includes("/work/mark?") ? "saved" : "unknown",
    };
  }

  const summary = [];

  for (const config of ASSIGNMENTS) {
    await page.goto(buildMarkUrl(config), {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.navigationTimeout,
    });
    await waitForReviewList();

    const pendingRows = await collectPendingRows();
    const results = [];
    for (const row of pendingRows) {
      try {
        results.push(await gradeOne(config, row));
      } catch (error) {
        results.push({
          answerId: row.answerId,
          status: "error",
          error: String(error.message || error),
        });
      }
    }

    summary.push({
      assignment: config.expectedTitleIncludes,
      className: config.expectedClassName,
      pendingCount: pendingRows.length,
      savedCount: results.filter((item) => item.status === "saved").length,
      skipped: results.filter((item) => item.status !== "saved"),
    });
  }

  return summary;
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