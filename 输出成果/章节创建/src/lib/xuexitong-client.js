import fs from "node:fs";
import path from "node:path";
import { chromium, request as playwrightRequest } from "playwright";
import {
  closeBrowserQuietly,
  createBrowserDisconnectGuard,
  isBrowserClosedError,
  ManualBrowserExitError
} from "./graceful-browser-exit.js";
import { selectors } from "./selectors.js";

const DEFAULT_CARD_TABS = [
  "任务教学目标",
  "任务分析与效果",
  "知识点讲解",
  "任务实施",
  "微课视频",
  "任务总结与拓展"
];

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function createResultStore() {
  return {
    created: [],
    existed: [],
    failed: []
  };
}

export class XuexitongClient {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.api = null;
    this.browserGuard = null;
    this.results = createResultStore();
    this.courseEntry = null;
  }

  async run(chapterPlan) {
    await this.initBrowser();
    await this.browserGuard.run(async () => {
      await this.ensureLoggedIn();
      await this.openCourseByName(this.config.courseName);

      for (const item of chapterPlan) {
        this.browserGuard.throwIfDisconnected();
        await this.processChapterTask(item);
      }

      this.logger.info("执行结果", this.results);
      await this.writeSummary();
    });
  }

  async initBrowser() {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      slowMo: this.config.slowMo
    });
    this.browserGuard = createBrowserDisconnectGuard(this.browser);

    const storageState = fs.existsSync(this.config.storageStatePath)
      ? this.config.storageStatePath
      : undefined;

    this.context = await this.browser.newContext({ storageState });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(this.config.timeoutMs);
    this.api = await playwrightRequest.newContext({ storageState });
  }

  async ensureLoggedIn() {
    await this.page.goto(this.config.baseUrl, {
      waitUntil: "domcontentloaded"
    });

    if (await this.hasActiveSession()) {
      this.logger.info("已复用登录态");
      return;
    }

    this.logger.info("开始账号密码登录");
    await this.page.goto(this.config.loginUrl, {
      waitUntil: "domcontentloaded"
    });
    await this.page.fill(selectors.login.username, this.config.username);
    await this.page.fill(selectors.login.password, this.config.password);
    await this.page.click(selectors.login.submit);
    await this.waitForManualVerificationIfNeeded();

    if (!(await this.hasActiveSession())) {
      throw new Error("登录后仍未检测到有效会话");
    }

    await this.context.storageState({
      path: this.config.storageStatePath
    });
    this.logger.info("登录成功，已保存登录态");
  }

  async hasActiveSession() {
    const url = this.page.url();
    if (url.includes("passport2.chaoxing.com")) {
      return false;
    }

    const text = await this.page.locator("body").innerText().catch(() => "");
    return !/登录|登录后|用户名|密码/.test(text);
  }

  async waitForManualVerificationIfNeeded() {
    const startedAt = Date.now();
    const maxWaitMs = 5 * 60 * 1000;

    while (Date.now() - startedAt < maxWaitMs) {
      if (await this.hasActiveSession()) {
        return;
      }

      const currentUrl = this.page.url();
      if (!currentUrl.includes("passport2.chaoxing.com")) {
        return;
      }

      this.logger.warn("等待手动完成验证码或平台校验");
      await this.page.waitForTimeout(5000);
    }

    throw new Error("等待人工验证超时");
  }

  async openCourseByName(courseName) {
    await this.page.goto("https://i.chaoxing.com/base?t=" + Date.now(), {
      waitUntil: "networkidle"
    });

    const courseFrame = await this.waitForFrame("frame_content");
    const courseLink = courseFrame.locator("a").filter({
      hasText: courseName
    });
    const exactCount = await courseLink.count();

    if (exactCount === 0) {
      throw new Error(`未找到课程：${courseName}`);
    }

    if (exactCount > 1) {
      throw new Error(`存在多个同名课程：${courseName}`);
    }

    const href = await courseLink.first().getAttribute("href");
    if (!href) {
      throw new Error(`课程缺少可用链接：${courseName}`);
    }

    this.courseEntry = href;
    await this.page.goto(href, {
      waitUntil: "networkidle"
    });
    this.setCourseRuntimeParams(this.page.url());

    this.logger.info("已进入课程", {
      courseName,
      courseEntry: href,
      courseId: this.config.courseId,
      classId: this.config.classId,
      cpi: this.config.cpi
    });
  }

  setCourseRuntimeParams(url) {
    const parsed = new URL(url);
    this.config.courseId = parsed.searchParams.get("courseid") || parsed.searchParams.get("courseId");
    this.config.classId = parsed.searchParams.get("clazzid") || parsed.searchParams.get("classId");
    this.config.cpi = parsed.searchParams.get("cpi");

    if (!this.config.courseId || !this.config.classId || !this.config.cpi) {
      throw new Error(`无法从课程链接解析运行参数：${url}`);
    }
  }

  async waitForFrame(namePrefix) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.config.timeoutMs) {
      const frame = this.page.frames().find((item) => item.name().startsWith(namePrefix));
      if (frame) {
        return frame;
      }
      await this.page.waitForTimeout(500);
    }

    throw new Error(`未找到框架：${namePrefix}`);
  }

  async processChapterTask(task) {
    const {
      sourceTitle,
      targetParentTitle,
      targetTitle,
      expectedCode,
      copyCards = true,
      tabs = DEFAULT_CARD_TABS,
      cardContents,
      placeholderTitles = ["新建课程目录"]
    } = task;

    this.logger.info("处理章节任务", {
      sourceTitle,
      targetParentTitle,
      targetTitle,
      expectedCode,
      copyCards
    });

    const editorInfo = await this.openChapterEditorBySourceTitle(sourceTitle);

    try {
      const targetParent = await this.resolveTargetParent(editorInfo.page, targetParentTitle, expectedCode);
      if (!targetParent) {
        throw new Error(`未找到目标父章节：${targetParentTitle}`);
      }

      const existing = await this.findDirectChildChapter(editorInfo.page, targetParent.id, targetTitle, expectedCode);
      if (existing) {
        this.results.existed.push({
          sourceTitle,
          targetParentTitle,
          targetTitle,
          nodeId: existing.id
        });
        this.logger.info("目标章节已存在", {
          sourceTitle,
          targetParentTitle,
          targetTitle,
          expectedCode
        });
      } else {
        const reusable = await this.findDirectChildChapterByCode(editorInfo.page, targetParent.id, expectedCode);
        const normalizedPlaceholderTitles = placeholderTitles.map(normalizeText);
        if (reusable && normalizedPlaceholderTitles.includes(normalizeText(reusable.text))) {
          this.logger.info("发现可复用占位章节，直接改名并写入内容", {
            sourceTitle,
            targetParentTitle,
            expectedCode,
            reusableId: reusable.id,
            reusableText: reusable.text
          });
          if (!this.config.dryRun) {
            await this.renameChapter(reusable.id, targetTitle);
            await this.reloadEditorPage(editorInfo.page);
          }
        } else {
          const placeholder = await this.findPlaceholderChapter(editorInfo.page, targetParent.id, expectedCode, placeholderTitles);
          if (placeholder) {
            this.logger.warn("发现占位章节，先删除再创建", {
              sourceTitle,
              targetParentTitle,
              expectedCode,
              placeholderId: placeholder.id,
              placeholderText: placeholder.text
            });
            if (!this.config.dryRun) {
              await this.deleteChapter(placeholder.id);
              await this.reloadEditorPage(editorInfo.page);
            }
          }

          if (this.config.dryRun) {
            this.logger.info("演练模式，不执行创建", {
              sourceTitle,
              targetParentTitle,
              targetTitle,
              expectedCode
            });
            return;
          }

          const newNode = await this.createChapterUnderParent(editorInfo.page, {
            sourceNodeId: editorInfo.sourceNodeId,
            targetParentId: targetParent.id,
            targetTitle,
            copyCards
          });

          await this.renameChapter(newNode.id, targetTitle);
          await this.reloadEditorPage(editorInfo.page);
        }
      }

      const targetNode =
        existing ||
        (await this.findDirectChildChapter(editorInfo.page, targetParent.id, targetTitle, expectedCode));
      if (!targetNode) {
        throw new Error(`创建后未找到目标章节：${targetTitle}`);
      }

      await this.verifyChapterCards(targetNode.id, targetTitle, tabs);

      if (cardContents) {
        await this.fillChapterCards(targetNode.id, targetTitle, cardContents);
      }

      if (!existing) {
        this.results.created.push({
          sourceTitle,
          targetParentTitle,
          targetTitle,
          expectedCode,
          nodeId: targetNode.id
        });
        this.logger.info("章节创建成功", {
          sourceTitle,
          targetParentTitle,
          targetTitle,
          expectedCode,
          nodeId: targetNode.id
        });
      }
    } catch (error) {
      this.results.failed.push({
        sourceTitle,
        targetParentTitle,
        targetTitle,
        expectedCode,
        reason: error.message
      });
      await this.captureFailure(editorInfo.page, `${expectedCode || "unknown"}-${targetTitle}`);
      throw error;
    } finally {
      await editorInfo.page.close().catch(() => {});
    }
  }

  async openChapterEditorBySourceTitle(sourceTitle) {
    await this.page.goto(this.courseEntry, {
      waitUntil: "networkidle"
    });
    await this.page.locator("text=章节").first().click();
    await this.page.waitForTimeout(4000);

    const chapterFrame = await this.waitForFrame("frame_content-zj");
    const links = await chapterFrame
      .locator(".chapter_unit")
      .filter({ hasText: sourceTitle })
      .locator("a")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: (node.textContent || "").trim().replace(/\s+/g, " "),
          onclick: node.getAttribute("onclick") || ""
        }))
      );

    const editLink = links.find((item) => item.text === "编辑");
    if (!editLink) {
      throw new Error(`未找到来源章节编辑入口：${sourceTitle}`);
    }

    const match = editLink.onclick.match(/toEditOld\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/);
    if (!match) {
      throw new Error(`无法解析来源章节编辑参数：${sourceTitle}`);
    }

    const [, courseId, knowledgeId, clazzId] = match;
    const referUrl =
      `https://mooc1.chaoxing.com/edit/chapters/${courseId}/${knowledgeId}` +
      `?classId=${clazzId}&cpi=${this.config.cpi}&newMooc=true&mooc2=1`;
    const transferUrl =
      `https://mooc1.chaoxing.com/mycourse/transfer?moocId=${courseId}` +
      `&clazzid=${clazzId}&ut=t&refer=${encodeURIComponent(referUrl)}`;

    const editorPage = await this.context.newPage();
    editorPage.setDefaultTimeout(this.config.timeoutMs);
    await editorPage.goto(transferUrl, {
      waitUntil: "networkidle"
    });
    await editorPage.waitForTimeout(3000);

    this.logger.info("已打开来源章节编辑页", {
      sourceTitle,
      knowledgeId
    });

    return {
      page: editorPage,
      sourceNodeId: Number(knowledgeId)
    };
  }

  async reloadEditorPage(page) {
    await page.reload({
      waitUntil: "networkidle"
    });
    await page.waitForTimeout(3000);
  }

  async findSiblingChapter(page, targetTitle, expectedCode) {
    return await page.evaluate(({ targetTitle, expectedCode }) => {
      const tree = Ext.getCmp("chaptertree");
      const root = tree.getStore().getRootNode();
      let found = null;

      const walk = (node) => {
        if (!node || found) {
          return;
        }

        const text = node.data?.text || "";
        const qtitle = node.data?.qtitle || "";
        if (text === targetTitle || (expectedCode && qtitle === expectedCode && text === targetTitle)) {
          found = {
            id: node.data.id,
            text,
            qtitle
          };
          return;
        }

        (node.childNodes || []).forEach(walk);
      };

      walk(root);
      return found;
    }, { targetTitle, expectedCode });
  }

  async findChapterNodeByTitle(page, targetTitle) {
    return await page.evaluate(({ targetTitle }) => {
      const tree = Ext.getCmp("chaptertree");
      const root = tree.getStore().getRootNode();
      const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
      const expectedTitle = normalize(targetTitle);
      const matches = [];

      const walk = (node) => {
        if (!node) {
          return;
        }

        if (normalize(node.data?.text) === expectedTitle) {
          matches.push({
            id: node.data.id,
            text: node.data.text,
            qtitle: node.data.qtitle
          });
        }

        (node.childNodes || []).forEach(walk);
      };

      walk(root);
      if (matches.length > 1) {
        throw new Error(`存在多个同名章节：${targetTitle}`);
      }

      return matches[0] || null;
    }, { targetTitle });
  }

  async findChapterNodeByCode(page, targetCode) {
    if (!targetCode) {
      return null;
    }

    return await page.evaluate(({ targetCode }) => {
      const tree = Ext.getCmp("chaptertree");
      const root = tree.getStore().getRootNode();
      const matches = [];

      const walk = (node) => {
        if (!node) {
          return;
        }

        if ((node.data?.qtitle || "") === targetCode) {
          matches.push({
            id: node.data.id,
            text: node.data.text,
            qtitle: node.data.qtitle
          });
        }

        (node.childNodes || []).forEach(walk);
      };

      walk(root);
      if (matches.length > 1) {
        throw new Error(`存在多个相同编号章节：${targetCode}`);
      }

      return matches[0] || null;
    }, { targetCode });
  }

  async resolveTargetParent(page, targetParentTitle, expectedCode) {
    const parentByTitle = await this.findChapterNodeByTitle(page, targetParentTitle);
    if (!expectedCode) {
      return parentByTitle;
    }

    const codeParts = expectedCode.split(".").filter(Boolean);
    if (codeParts.length <= 2) {
      return parentByTitle;
    }

    const parentCode = codeParts.slice(0, -1).join(".");
    const parentByCode = await this.findChapterNodeByCode(page, parentCode);
    if (!parentByCode) {
      return parentByTitle;
    }

    if (!parentByTitle || parentByTitle.id !== parentByCode.id) {
      this.logger.info("按编号层级修正目标父章节", {
        targetParentTitle,
        expectedCode,
        resolvedParentCode: parentCode,
        resolvedParentTitle: parentByCode.text
      });
    }

    return parentByCode;
  }

  async findDirectChildChapter(page, parentId, targetTitle, expectedCode) {
    return await page.evaluate(({ parentId, targetTitle, expectedCode }) => {
      const tree = Ext.getCmp("chaptertree");
      const parent = tree.getStore().getNodeById(parentId);
      if (!parent) {
        return null;
      }

      const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
      const expectedTitle = normalize(targetTitle);
      const child = (parent.childNodes || []).find((node) => {
        const text = normalize(node.data?.text);
        const qtitle = node.data?.qtitle || "";
        if (expectedCode) {
          return text === expectedTitle && qtitle === expectedCode;
        }
        return text === expectedTitle;
      });

      if (!child) {
        return null;
      }

      return {
        id: child.data.id,
        text: child.data.text,
        qtitle: child.data.qtitle
      };
    }, { parentId, targetTitle, expectedCode });
  }

  async findDirectChildChapterByCode(page, parentId, expectedCode) {
    if (!expectedCode) {
      return null;
    }

    return await page.evaluate(({ parentId, expectedCode }) => {
      const tree = Ext.getCmp("chaptertree");
      const parent = tree.getStore().getNodeById(parentId);
      if (!parent) {
        return null;
      }

      const child = (parent.childNodes || []).find((node) => (node.data?.qtitle || "") === expectedCode);
      if (!child) {
        return null;
      }

      return {
        id: child.data.id,
        text: child.data.text,
        qtitle: child.data.qtitle
      };
    }, { parentId, expectedCode });
  }

  async findPlaceholderChapter(page, parentId, expectedCode, placeholderTitles) {
    if (!expectedCode) {
      return null;
    }

    return await page.evaluate(({ parentId, expectedCode, placeholderTitles }) => {
      const tree = Ext.getCmp("chaptertree");
      const parent = tree.getStore().getNodeById(parentId);
      if (!parent) {
        return null;
      }

      const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
      const placeholderSet = placeholderTitles.map(normalize);
      const child = (parent.childNodes || []).find((node) => {
        const text = normalize(node.data?.text);
        const qtitle = node.data?.qtitle || "";
        return qtitle === expectedCode && placeholderSet.includes(text);
      });

      if (!child) {
        return null;
      }

      return {
        id: child.data.id,
        text: child.data.text,
        qtitle: child.data.qtitle
      };
    }, { parentId, expectedCode, placeholderTitles });
  }

  async createChapterUnderParent(page, { sourceNodeId, targetParentId, targetTitle, copyCards }) {
    const createInfo = await page.evaluate(({ targetParentId }) => {
      const tree = Ext.getCmp("chaptertree");
      const parent = tree.getStore().getNodeById(targetParentId);
      if (!parent) {
        throw new Error("目标父章节不存在");
      }

      const getLayer = (node) => {
        let level = 0;
        let current = node;
        while (current && current.parentNode) {
          if (current.data?.id !== 0) {
            level += 1;
          }
          current = current.parentNode;
        }
        return level;
      };

      return {
        layer: getLayer(parent) + 1,
        existingIds: (parent.childNodes || []).map((item) => item.data.id)
      };
    }, { targetParentId });

    const form = {
      name: "新建课程目录",
      courseid: this.config.courseId,
      parentid: String(targetParentId),
      layer: String(createInfo.layer),
      mooc2: "1"
    };

    if (copyCards) {
      form.copynodeid = String(sourceNodeId);
    }

    const response = await this.api.post("https://mooc1.chaoxing.com/mooc-ans/edit/createchapter", {
      form
    });
    const text = await response.text();
    if (!response.ok()) {
      throw new Error(`创建章节失败：${response.status()} ${text}`);
    }

    const payload = this.parseCreateChapterResponse(text);

    if (!payload?.id) {
      throw new Error(`创建章节未返回有效 id：${text}`);
    }

    await this.reloadEditorPage(page);
    const created = await page.evaluate(({ targetParentId, existingIds, createdId }) => {
      const tree = Ext.getCmp("chaptertree");
      const parent = tree.getStore().getNodeById(targetParentId);
      if (!parent) {
        return null;
      }

      const found =
        (parent.childNodes || []).find((node) => node.data?.id === createdId) ||
        (parent.childNodes || []).find((node) => !existingIds.includes(node.data.id));
      if (!found) {
        return null;
      }

      return {
        id: found.data.id,
        text: found.data.text,
        qtitle: found.data.qtitle
      };
    }, {
      targetParentId,
      existingIds: createInfo.existingIds,
      createdId: payload.id
    });

    if (!created) {
      throw new Error(`创建后未能在目标父章节下定位新节点：${targetTitle}`);
    }

    this.logger.info("已创建原始章节节点", {
      ...created,
      sourceNodeId,
      targetParentId
    });
    return created;
  }

  parseCreateChapterResponse(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      const idMatch = text.match(/id\s*:\s*(\d+)/);
      if (idMatch) {
        return { id: Number(idMatch[1]) };
      }

      throw new Error(`创建章节返回无法解析：${text}`);
    }
  }

  async deleteChapter(nodeId) {
    const response = await this.api.post("https://mooc1.chaoxing.com/mooc-ans/edit/deletechapter", {
      form: {
        courseid: this.config.courseId,
        nodeid: String(nodeId)
      }
    });
    const text = await response.text();

    if (!response.ok()) {
      throw new Error(`删除章节失败：${response.status()} ${text}`);
    }

    this.logger.info("已删除占位章节", {
      nodeId,
      response: text
    });
  }

  async renameChapter(nodeId, targetTitle) {
    const response = await this.api.post("https://mooc1.chaoxing.com/mooc-ans/edit/changename", {
      form: {
        courseid: this.config.courseId,
        nodeid: String(nodeId),
        name: targetTitle
      }
    });
    const text = await response.text();

    if (!response.ok() || !text.includes("\"status\":true")) {
      throw new Error(`章节改名失败：${response.status()} ${text}`);
    }

    this.logger.info("已改名章节", {
      nodeId,
      targetTitle
    });
  }

  async verifyChapterCards(nodeId, targetTitle, tabs) {
    const referUrl =
      `https://mooc1.chaoxing.com/edit/chapters/${this.config.courseId}/${nodeId}` +
      `?classId=${this.config.classId}&cpi=${this.config.cpi}&newMooc=true&mooc2=1`;
    const transferUrl =
      `https://mooc1.chaoxing.com/mycourse/transfer?moocId=${this.config.courseId}` +
      `&clazzid=${this.config.classId}&ut=t&refer=${encodeURIComponent(referUrl)}`;

    const verifyPage = await this.context.newPage();
    verifyPage.setDefaultTimeout(this.config.timeoutMs);

    try {
      await verifyPage.goto(transferUrl, {
        waitUntil: "networkidle"
      });
      await verifyPage.waitForTimeout(4000);

      const pageText = await verifyPage.locator("body").innerText();
      if (!pageText.includes(targetTitle)) {
        throw new Error(`编辑页未显示目标标题：${targetTitle}`);
      }

      for (const tab of tabs) {
        if (!pageText.includes(tab)) {
          throw new Error(`缺少标签页：${tab}`);
        }
      }
    } finally {
      await verifyPage.close().catch(() => {});
    }
  }

  async getChapterCards(nodeId) {
    const response = await this.api.get("https://mooc1.chaoxing.com/mooc-ans/edit/getcard", {
      params: {
        cardid: "0",
        nodeid: String(nodeId),
        courseid: String(this.config.courseId),
        cpi: String(this.config.cpi),
        t: String(Date.now()),
        microTopicId: "0"
      }
    });
    const text = await response.text();
    if (!response.ok()) {
      throw new Error(`读取章节卡片失败：${response.status()} ${text}`);
    }

    const payload = JSON.parse(text);
    if (!Array.isArray(payload.data)) {
      throw new Error(`章节卡片返回异常：${text}`);
    }
    return payload.data;
  }

  async saveChapterCard(nodeId, card) {
    const response = await this.api.post("https://mooc1.chaoxing.com/mooc-ans/edit/savecard", {
      form: {
        title: card.title,
        attachments: "[]",
        description: card.description,
        id: String(card.id),
        nodeid: String(nodeId),
        loading: "true",
        courseId: String(this.config.courseId),
        recordJson: "",
        aiJsonArray: "",
        docPageInfo: "",
        isMicroCourseEdit: "false"
      }
    });
    const text = await response.text();

    if (!response.ok()) {
      throw new Error(`保存卡片失败：${response.status()} ${text}`);
    }
  }

  async fillChapterCards(nodeId, targetTitle, cardContents) {
    const cards = await this.getChapterCards(nodeId);
    const cardMap = new Map(cards.map((card) => [normalizeText(card.title), card]));
    const updates = Object.entries(cardContents);

    for (const [title, description] of updates) {
      const targetCard = cardMap.get(normalizeText(title));
      if (!targetCard) {
        throw new Error(`章节 ${targetTitle} 缺少卡片：${title}`);
      }

      await this.saveChapterCard(nodeId, {
        id: targetCard.id,
        title: targetCard.title,
        description
      });
    }

    this.logger.info("已完成章节内容写入", {
      targetTitle,
      nodeId,
      cardCount: updates.length
    });
  }

  async captureFailure(page, label) {
    const safeName = label.replace(/[^\w\u4e00-\u9fa5-]+/g, "_");
    const filePath = path.join(this.config.paths.screenshotDir, `${Date.now()}-${safeName}.png`);
    await page.screenshot({
      path: filePath,
      fullPage: true
    });
    this.logger.error("已截取失败现场", { filePath });
  }

  async writeSummary() {
    const summaryPath = path.join(this.config.paths.logDir, "summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(this.results, null, 2));
    this.logger.info("已写出结果汇总", { summaryPath });
  }

  async close() {
    if (this.api) {
      await this.api.dispose().catch(() => {});
    }

    if (this.context) {
      await this.context.close().catch(() => {});
    }

    if (this.browser) {
      await closeBrowserQuietly(this.browser);
    }
  }

  static isSafeExit(error) {
    return error instanceof ManualBrowserExitError || isBrowserClosedError(error);
  }
}
