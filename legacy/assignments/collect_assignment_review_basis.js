async (page) => {
  const isBrowserClosedError = (error) => {
    const message = String(error?.message || error || '');
    return /Target page, context or browser has been closed/i.test(message)
      || /Browser has been closed/i.test(message)
      || /page.goto:.*closed/i.test(message);
  };

  try {
  const CONFIG = {
    // 是否为复杂作业采集额外证据样本。
    inspectEvidence: true,
    // 每个分档最多抽样多少个已完成样本进入批阅页查看证据。
    maxCompletedSamplesPerBand: 2,
    // 最多抽样多少个待批样本进入批阅页查看证据。
    maxPendingSamples: 3,
    assignments: [],
  };

  if (!Array.isArray(CONFIG.assignments) || !CONFIG.assignments.length) {
    throw new Error("请先填写 CONFIG.assignments，再执行提取脚本。");
  }

  function scoreHistogram(scores) {
    const map = {};
    for (const score of scores) map[score] = (map[score] || 0) + 1;
    return Object.entries(map)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([score, count]) => ({ score: Number(score), count }));
  }

  function getScoreBand(score) {
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) return "unknown";
    if (numeric >= 95) return "high";
    if (numeric >= 85) return "mid";
    if (numeric >= 70) return "low";
    if (numeric >= 60) return "barely_pass";
    return "fail_or_review";
  }

  function summarizeScoreBands(rows) {
    const bandMap = {
      high: { label: "95-100", count: 0 },
      mid: { label: "85-94", count: 0 },
      low: { label: "70-84", count: 0 },
      barely_pass: { label: "60-69", count: 0 },
      fail_or_review: { label: "60以下", count: 0 },
    };
    for (const row of rows) {
      const band = getScoreBand(row.score);
      if (bandMap[band]) bandMap[band].count += 1;
    }
    return Object.entries(bandMap)
      .map(([key, value]) => ({ band: key, ...value }))
      .filter((item) => item.count > 0);
  }

  function buildCompletedSamples(rows) {
    const grouped = {
      high: [],
      mid: [],
      low: [],
      barely_pass: [],
      fail_or_review: [],
    };
    for (const row of rows) {
      const band = getScoreBand(row.score);
      if (grouped[band]) grouped[band].push(row);
    }
    return Object.entries(grouped).flatMap(([band, items]) =>
      items.slice(0, CONFIG.maxCompletedSamplesPerBand).map((item) => ({
        band,
        rowId: item.rowId,
        name: item.name,
        studentNo: item.studentNo,
        submitTime: item.submitTime,
        score: Number(item.score),
        actionData: item.actionData,
      }))
    );
  }

  async function inspectSubmissionEvidence(actionData) {
    const reviewUrl = String(actionData || "").startsWith("http")
      ? String(actionData)
      : `https://mooc2-ans.chaoxing.com${actionData || ""}`;

    await page.goto(reviewUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(1000);

    return await page.evaluate(() => {
      const text = document.body.innerText || "";
      const normalizedText = text.replace(/\s+/g, " ").trim();
      const attachmentAnchors = [
        ...document.querySelectorAll("a[href*='download'], a[href*='attachment'], a[download]")
      ];
      const mediaNodes = [
        ...document.querySelectorAll("video, audio, iframe, embed")
      ];
      const imageNodes = [
        ...document.querySelectorAll("img")
      ].filter((img) => {
        const src = img.getAttribute("src") || "";
        return src && !/icon|avatar|logo|button/i.test(src);
      });
      const externalLinks = [
        ...document.querySelectorAll("a[href]")
      ].filter((a) => {
        const href = a.getAttribute("href") || "";
        return /^https?:\/\//i.test(href);
      });
      const editorBlocks = [
        ...document.querySelectorAll(".mark_info, .mark_box, .questionCon, .workAnswerCon, .Zy_TItle, .mark_content, .content")
      ];
      const editorText = editorBlocks
        .map((node) => node.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const textLength = editorText.length || normalizedText.length;
      const hasTextContent = textLength >= 80;
      const hasAttachment = attachmentAnchors.length > 0;
      const hasMedia = mediaNodes.length > 0 || imageNodes.length >= 2;
      const hasLink = externalLinks.length > 0;

      let evidenceLevel = "none";
      const positiveSignals = [hasTextContent, hasAttachment, hasMedia, hasLink].filter(Boolean).length;
      if (positiveSignals >= 3) evidenceLevel = "rich";
      else if (positiveSignals >= 2) evidenceLevel = "medium";
      else if (positiveSignals >= 1) evidenceLevel = "basic";

      return {
        reviewUrl: location.href,
        attachmentCount: attachmentAnchors.length,
        mediaCount: mediaNodes.length,
        imageCount: imageNodes.length,
        linkCount: externalLinks.length,
        textLength,
        hasTextContent,
        hasAttachment,
        hasMedia,
        hasLink,
        evidenceLevel,
        previewText: editorText.slice(0, 120),
      };
    });
  }

  const output = [];

  for (const assignment of CONFIG.assignments) {
    await page.goto(assignment.markUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(1200);

    const pageNumbers = [];
    const pagerItems = page.locator("#page li");
    const pagerCount = await pagerItems.count();
    for (let i = 0; i < pagerCount; i += 1) {
      const text = (await pagerItems.nth(i).innerText().catch(() => "")).trim();
      if (/^\d+$/.test(text)) pageNumbers.push(text);
    }
    if (!pageNumbers.length) pageNumbers.push("1");

    const seen = new Set();
    const rows = [];
    let meta = null;

    for (const pageNumber of pageNumbers) {
      const button = page.locator("#page li").filter({ hasText: pageNumber }).first();
      if (await button.count()) {
        await button.click();
        await page.waitForTimeout(1000);
      }

      const current = await page.evaluate(() => {
        const currentRows = [...document.querySelectorAll("ul.dataBody_td")].map((row) => {
          const cells = [...row.querySelectorAll(":scope > li")];
          const name = row.querySelector(".py_name")?.textContent?.trim() || "";
          const status = cells[5]?.textContent?.replace(/\s+/g, " ").trim() || "";
          const reviewer = cells[6]?.textContent?.replace(/\s+/g, " ").trim() || "";
          const score = row.querySelector("input.scoreInput")?.value || "";
          const actionLink = row.querySelector("a.cz_py");
          return {
            rowId: row.id || "",
            createId: row.getAttribute("createid") || "",
            name,
            studentNo: cells[2]?.textContent?.replace(/\s+/g, " ").trim() || "",
            submitTime: cells[3]?.textContent?.replace(/\s+/g, " ").trim() || "",
            status,
            reviewer,
            score,
            actionData: actionLink?.getAttribute("data") || "",
          };
        });
        return {
          url: location.href,
          heading: document.querySelector("h3")?.textContent?.trim() || "",
          pageClassName:
            document.querySelector(".classNameCur, .banji_select_name_text, .mark_tit a, .mark_tit span")
              ?.textContent?.trim() || "",
          rows: currentRows,
        };
      });

      if (!meta) meta = current;
      for (const row of current.rows) {
        if (!row.rowId || seen.has(row.rowId)) continue;
        seen.add(row.rowId);
        rows.push(row);
      }
    }

    const pendingRows = rows
      .filter((row) => row.status.includes("待批"))
      .map((row) => ({
        rowId: row.rowId,
        name: row.name,
        studentNo: row.studentNo,
        submitTime: row.submitTime,
        actionData: row.actionData,
      }));

    const completedRows = rows
      .filter((row) => row.status.includes("已完成") && /^\d+(\.\d+)?$/.test(row.score))
      .map((row) => ({
        rowId: row.rowId,
        name: row.name,
        studentNo: row.studentNo,
        submitTime: row.submitTime,
        score: Number(row.score),
        actionData: row.actionData,
      }));
    const completedScores = completedRows.map((row) => row.score);
    const completedScoreBands = summarizeScoreBands(completedRows);

    const completedSamples = buildCompletedSamples(completedRows);
    const pendingSamples = pendingRows.slice(0, CONFIG.maxPendingSamples);

    const completedEvidenceSamples = [];
    const pendingEvidenceSamples = [];
    if (CONFIG.inspectEvidence) {
      for (const sample of completedSamples) {
        const evidence = await inspectSubmissionEvidence(sample.actionData);
        completedEvidenceSamples.push({
          band: sample.band,
          name: sample.name,
          studentNo: sample.studentNo,
          score: sample.score,
          submitTime: sample.submitTime,
          ...evidence,
        });
      }

      for (const sample of pendingSamples) {
        const evidence = await inspectSubmissionEvidence(sample.actionData);
        pendingEvidenceSamples.push({
          name: sample.name,
          studentNo: sample.studentNo,
          submitTime: sample.submitTime,
          ...evidence,
        });
      }
    }

    output.push({
      ...assignment,
      url: meta?.url || assignment.markUrl,
      heading: meta?.heading || "",
      pageClassName: meta?.pageClassName || "",
      pageNumbers,
      pendingCount: pendingRows.length,
      pendingRows,
      pendingEvidenceSamples,
      completedCount: completedScores.length,
      completedScoreHistogram: scoreHistogram(completedScores),
      completedScoreBands,
      completedEvidenceSamples,
    });
  }

  return output;
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