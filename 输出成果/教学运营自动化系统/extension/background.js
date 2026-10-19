importScripts(
  "content/assignment-scan-core.js",
  "content/deadline-update-core.js",
  "content/chapter-test-scan-core.js",
  "chapter-test-profiles.local.js",
  "content/attendance-scan-core.js",
  "attendance-profiles.local.js",
  "content/course-overview-scan-core.js",
  "content/score-overview-scan-core.js",
  "content/chapter-structure-scan-core.js",
  "content/connection-check-scan-core.js",
  "content/ai-grading-core.js",
  "scan-cache-core.js",
  "background-utils.js",
  "grading-batch-core.js",
  "content/grading-adapter-core.js",
  "grading-batch-background.js",
);

const scanCache = globalThis.LearningTongScanCache;

async function recordScanResult(message, payload) {
  const taskKey = scanCache.MESSAGE_TASK_KEYS[message?.type];
  if (!taskKey || !payload?.acquisitionState) return;
  const courseName = message.courseName || message.profile?.courseName;
  const summary = scanCache.scanSummaryFor(taskKey, payload);
  const at = Date.now();
  const stored = await chrome.storage.local.get([scanCache.STORE_KEY]);
  const next = scanCache.mergeLastScan(stored?.[scanCache.STORE_KEY], {
    courseName,
    taskKey,
    at,
    state: payload.acquisitionState,
    summary,
    ...(taskKey === "assignment-pending" ? { pendingTotal: scanCache.pendingTotalOf(payload) } : {}),
  });
  await chrome.storage.local.set({ [scanCache.STORE_KEY]: next });
  if (taskKey === "assignment-pending") {
    const badge = scanCache.badgeTextFor(scanCache.pendingTotalOf(payload));
    chrome.action.setBadgeText({ text: badge });
    if (badge) chrome.action.setBadgeBackgroundColor({ color: "#b0413b" });
  }
  try {
    chrome.notifications.create(`scan-${taskKey}-${at}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon128.png"),
      title: "教学运营助手",
      message: `${scanCache.TASK_LABELS[taskKey]}：${payload.acquisitionState}${summary ? `——${summary}` : ""}`,
    });
  } catch (error) { /* 通知不可用时静默降级，不影响扫描结果回传。 */ }
}

function respondScan(message, payload) {
  recordScanResult(message, payload).catch(() => {});
  return payload;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const deadlineTokenKey = (token) => `deadlineConfirmation:${token}`;
const AI_CONFIG_KEY = "aiGradingConfig";

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const rubricStorageKey = (questionKey) => `aiRubric:${questionKey}`;

function normalizeRubric(rubric) {
  const dimensions = [];
  for (const raw of rubric?.dimensions || []) {
    const name = LearningTongAiGrading.normalize(raw?.name).slice(0, 24);
    const maxScore = Number(raw?.maxScore);
    const criteria = LearningTongAiGrading.normalize(raw?.criteria).slice(0, 200);
    if (name && Number.isFinite(maxScore) && maxScore > 0 && criteria) {
      dimensions.push({ name, maxScore: Math.round(maxScore * 10) / 10, criteria });
    }
  }
  if (!dimensions.length) return undefined;
  const total = dimensions.reduce((sum, d) => sum + d.maxScore, 0);
  return { dimensions, total: Math.round(total * 10) / 10, updatedAt: Date.now() };
}

async function loadRubric(questionKey) {
  const stored = await chrome.storage.local.get(rubricStorageKey(questionKey));
  return normalizeRubric(stored?.[rubricStorageKey(questionKey)]);
}

async function saveRubric(questionKey, rubric, context) {
  const normalized = normalizeRubric(rubric);
  if (!normalized) return { ok: false, reason: "评分卡为空或格式不正确：每个维度需要名称、分值和标准。" };
  const record = { ...normalized, assignmentTitle: context?.assignmentTitle || "", question: context?.question || "", maxScore: context?.maxScore || normalized.total };
  await chrome.storage.local.set({ [rubricStorageKey(questionKey)]: record });
  return { ok: true, rubric: record };
}

async function loadAiConfig() {
  await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  const local = (await chrome.storage.local.get(AI_CONFIG_KEY))?.[AI_CONFIG_KEY] || {};
  const session = (await chrome.storage.session.get(AI_CONFIG_KEY))?.[AI_CONFIG_KEY] || {};
  // Old versions did not obtain explicit consent to persist the key.
  if (local.apiKey && !local.rememberKey) await chrome.storage.local.set({ [AI_CONFIG_KEY]: { ...local, apiKey: "" } });
  return LearningTongAiGrading.normalizeConfig({ ...local, apiKey: local.rememberKey ? local.apiKey : session.apiKey || "" });
}

async function saveAiConfig(config) {
  const normalized = LearningTongAiGrading.normalizeConfig(config);
  await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.local.set({ [AI_CONFIG_KEY]: { ...normalized, apiKey: normalized.rememberKey ? normalized.apiKey : "" } });
  await chrome.storage.session.set({ [AI_CONFIG_KEY]: { apiKey: normalized.rememberKey ? "" : normalized.apiKey } });
  return normalized;
}

function hasAiOriginPermission(baseUrl) {
  const origin = LearningTongAiGrading.originPattern(baseUrl);
  if (!origin) return Promise.resolve(false);
  if (!chrome.permissions?.contains) return Promise.resolve(true);
  return new Promise((resolve) => chrome.permissions.contains({ origins: [origin] }, resolve));
}

function prepareAiContext(context, config) {
  const notices = [];
  const clampText = (value, limit, label) => {
    const text = String(value || "");
    if (text.length <= limit) return text;
    throw new Error(`${label}超限，不能截断评分，请拆分或人工批改。`);
  };
  const attachments = [];
  if (config.attachmentEnabled) {
    let remaining = 20000;
    for (const attachment of context.attachments || []) {
      if (!attachment?.text) continue;
      if (remaining <= 0) throw new Error("附件合计文本超限，不能截断评分。");
      const text = String(attachment.text).slice(0, remaining);
      if (text.length < String(attachment.text).length) throw new Error("附件文本超限，不能截断评分。");
      attachments.push({ ...attachment, text });
      remaining -= text.length;
    }
  } else if ((context.attachments || []).some((attachment) => attachment?.text)) {
    notices.push("附件未发送（设置中未启用）");
  }
  return {
    context: {
      ...context,
      assignmentTitle: clampText(context.assignmentTitle, 500, "作业名称"),
      question: clampText(context.question, 5000, "题目"),
      referenceAnswer: clampText(context.referenceAnswer, 10000, "参考答案"),
      studentAnswer: clampText(context.studentAnswer, 20000, "学生答案"),
      attachments,
    },
    notice: [...new Set(notices)].join("；"),
  };
}

const ZHIPU_ANTHROPIC_BASE = "https://open.bigmodel.cn/api/anthropic";

function isAnthropicProtocol(baseUrl) {
  return /\/api\/anthropic\/?$/.test(String(baseUrl || ""));
}

function buildAnthropicBody(config, messages, maxTokens) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  const body = { model: config.model, max_tokens: maxTokens, temperature: 0.2, messages: rest.length ? rest : [{ role: "user", content: "" }] };
  if (system) body.system = system;
  return body;
}

async function callAiChatCompletion(config, messages, { maxTokens = 800, timeoutMs = 60000 } = {}) {
  if (config.provider === "codex-local") return { ok: false, reason: "本机Codex请在独立审核工作台使用与测试。" };
  let effective = config;
  let note = "";
  let result = await callAiChatCompletionOnce(effective, messages, { maxTokens, timeoutMs });
  if (result.zhipuCodingPlanFallback) {
    effective = { ...config, baseUrl: ZHIPU_ANTHROPIC_BASE };
    result = await callAiChatCompletionOnce(effective, messages, { maxTokens, timeoutMs });
    if (result.ok) {
      note = "已自动切换智谱 Anthropic 端点（Coding Plan 套餐积分通道）调用成功。";
    }
  }
  if (result.ok || !result.retryWithMoreTokens) return note ? { ...result, note } : result;
  const retried = await callAiChatCompletionOnce(effective, messages, { maxTokens: Math.max(maxTokens * 4, 4000), timeoutMs });
  if (retried.ok) return note ? { ...retried, note } : retried;
  return { ok: false, reason: result.reason.includes("截断") ? retried.reason : result.reason };
}

async function callAiChatCompletionOnce(config, messages, { maxTokens, timeoutMs }) {
  if (!LearningTongAiGrading.configReady(config)) {
    return { ok: false, reason: "AI 批改未配置：请在扩展弹窗“AI 批改设置”中填写 API 地址、密钥和模型。" };
  }
  const anthropic = isAnthropicProtocol(config.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = anthropic
      ? await fetch(`${config.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(buildAnthropicBody(config, messages, maxTokens)),
          signal: controller.signal,
        })
      : await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages, temperature: 0.2, max_tokens: maxTokens }),
          signal: controller.signal,
        });
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "AI API 鉴权失败：请检查 API Key 是否正确。" };
    if (response.status === 404) return { ok: false, reason: "AI API 地址或模型不存在（404）：请检查 Base URL 与模型名。" };
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const apiError = LearningTongAiGrading.normalize((detail.match(/"message"\s*:\s*"([^"]+)"/) || [])[1] || "").replace(/。+$/, "");
      if (response.status === 429) {
        const balanceError = apiError.includes("余额") || apiError.includes("资源包");
        if (balanceError && !anthropic && /open\.bigmodel\.cn/.test(String(config.baseUrl))) {
          return { ok: false, zhipuCodingPlanFallback: true, reason: `AI API 余额不足（429）：${apiError}` };
        }
        return { ok: false, reason: balanceError
          ? `AI API 余额不足（429）：${apiError}。请到服务商控制台充值或更换 API。`
          : `AI API 请求过于频繁（429）：${apiError || "请稍后重试。"}` };
      }
      return { ok: false, reason: `AI API 返回异常状态 ${response.status}${apiError ? `：${apiError}` : "，请稍后重试。"}` };
    }
    const data = await response.json();
    if (anthropic) {
      const text = (data?.content || []).filter((block) => block?.type === "text").map((block) => block.text).join("").trim();
      if (!text) {
        const truncated = data?.stop_reason === "max_tokens";
        return {
          ok: false,
          retryWithMoreTokens: truncated,
          reason: truncated
            ? "AI 思考内容超出 token 上限被截断（思考型模型如 GLM 需要更多额度），正在自动加大额度重试…"
            : "AI 返回了思考内容但没有评分正文，请重试或换用非思考型模型。",
        };
      }
      return { ok: true, content: text };
    }
    const choice = data?.choices?.[0];
    const message = choice?.message;
    const content = message?.content;
    if (!content) {
      const truncated = choice?.finish_reason === "length";
      if (truncated || message?.reasoning_content) {
        return {
          ok: false,
          retryWithMoreTokens: truncated,
          reason: truncated
            ? "AI 思考内容超出 token 上限被截断（思考型模型如 GLM 需要更多额度），正在自动加大额度重试…"
            : "AI 返回了思考内容但没有评分正文，请重试或换用非思考型模型。",
        };
      }
      return { ok: false, reason: "AI API 未返回评分内容，请稍后重试。" };
    }
    return { ok: true, content };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, reason: `AI 评分超时（${Math.round(timeoutMs / 1000)} 秒），请重试或检查网络。` };
    return { ok: false, reason: `AI API 调用失败：${LearningTongAiGrading.normalize(error?.message || error)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function saveDeadlineConfirmation(token, value) {
  await chrome.storage.session.set({ [deadlineTokenKey(token)]: value });
}

async function takeDeadlineConfirmation(token) {
  const key = deadlineTokenKey(token);
  const stored = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return stored[key];
}

function getFrames(tabId) {
  return new Promise((resolve) => chrome.webNavigation.getAllFrames({ tabId }, (frames) => resolve(frames || [{ frameId: 0, url: "" }])));
}

function sendToFrame(tabId, frameId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (result) => {
      if (chrome.runtime.lastError) resolve(undefined);
      else resolve(result);
    });
  });
}

function inspectableChaoxingFrame(frame) {
  return /^https:\/\/[^/]*\.chaoxing\.com\//i.test(String(frame?.url || ""));
}

async function sendWithScriptFallback(tabId, frame, message, files) {
  let snapshot = await sendToFrame(tabId, frame.frameId, message);
  if (snapshot !== undefined || !inspectableChaoxingFrame(frame)) return snapshot;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frame.frameId] },
      files,
    });
    snapshot = await sendToFrame(tabId, frame.frameId, message);
  } catch {
    snapshot = undefined;
  }
  return snapshot;
}

function resolveTargetTab(courseName, sender) {
  return new Promise((resolve) => {
    const query = Number.isInteger(sender?.tab?.windowId) ? { windowId: sender.tab.windowId } : { currentWindow: true };
    chrome.tabs.query(query, (tabs) => resolve(LearningTongBackgroundUtils.pickTargetTab(tabs || [], courseName)));
  });
}

function queryChaoxingTabs(sender) {
  return new Promise((resolve) => {
    const query = Number.isInteger(sender?.tab?.windowId) ? { windowId: sender.tab.windowId } : { currentWindow: true };
    chrome.tabs.query(query, (tabs) => resolve((tabs || []).filter(LearningTongBackgroundUtils.isChaoxingPage)));
  });
}

async function resolveCourseRoleTab(courseName, sender, role) {
  const tabs = (await queryChaoxingTabs(sender))
    .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
  for (const tab of tabs) {
    if (!tab?.id) continue;
    const result = LearningTongConnectionCheck.aggregate(await inspectConnectionFrames(tab.id), courseName);
    if (result.acquisitionState === "采集到" && (!role || result.roles?.includes(role))) return tab;
  }
  return undefined;
}

async function findAttendanceTarget(tabs, profile) {
  for (const tab of tabs) {
    if (!tab?.id) continue;
    const inspections = await inspectAttendanceFrames(tab.id);
    const frame = inspections.find(({ snapshot }) => snapshot?.attendanceRole && snapshot.courseId === profile.courseId);
    if (frame) return { tab, frame };
  }
  return undefined;
}

async function resolveAttendanceTab(profile, sender) {
  const tabs = (await queryChaoxingTabs(sender))
    .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
  return (await findAttendanceTarget(tabs, profile))?.tab;
}

async function waitForAttendanceTarget(sourceTabId, profile, attempts = 70) {
  const source = await new Promise((resolve) => chrome.tabs.get(sourceTabId, (tab) => resolve(tab)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(150);
    const tabs = await new Promise((resolve) => chrome.tabs.query({ windowId: source.windowId }, (items) => resolve((items || []).filter(LearningTongBackgroundUtils.isChaoxingPage))));
    const target = await findAttendanceTarget(tabs, profile);
    if (target) return target;
  }
  return undefined;
}

async function inspectFrames(tabId) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-assignment-frame" }, ["content/assignment-scan-core.js", "content/deadline-update-core.js", "content/assignment-page.js"]) })));
}

async function inspectChapterFrames(tabId) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-chapter-test-frame" }, ["content/chapter-test-scan-core.js", "content/chapter-test-page.js"]) })));
}

async function inspectAttendanceFrames(tabId) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-attendance-frame" }, ["content/attendance-scan-core.js", "content/attendance-page.js"]) })));
}

async function inspectCourseOverviewFrames(tabId) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-course-overview-frame" }, ["content/course-overview-scan-core.js", "content/course-overview-page.js"]) })));
}

async function inspectScoreOverviewFrames(tabId, profile) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-score-overview-frame", profile }, ["content/score-overview-scan-core.js", "content/score-overview-page.js"]) })));
}

async function inspectChapterStructureFrames(tabId) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-chapter-structure-frame" }, ["content/chapter-structure-scan-core.js", "content/chapter-structure-page.js"]) })));
}

async function inspectConnectionFrames(tabId) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-connection-frame" }, ["content/connection-check-scan-core.js", "content/connection-check-page.js"]) })));
}

async function inspectNavigationFrames(tabId) {
  const frames = await getFrames(tabId);
  return Promise.all(frames.map(async (frame) => ({ frame, snapshot: await sendWithScriptFallback(tabId, frame, { type: "inspect-teacher-navigation" }, ["content/navigation-core.js", "content/navigation-page.js"]) })));
}

function resolveCourseShellTab(courseName, sender) {
  return new Promise((resolve) => {
    const query = Number.isInteger(sender?.tab?.windowId) ? { windowId: sender.tab.windowId } : { currentWindow: true };
    chrome.tabs.query(query, (tabs) => {
      const expected = LearningTongAssignmentScan.normalize(courseName);
      const matches = (tabs || []).filter((tab) => LearningTongBackgroundUtils.isChaoxingPage(tab)
        && /\/mycourse\/tch/.test(String(tab.url || ""))
        && LearningTongAssignmentScan.normalize(tab.title).includes(expected));
      resolve(matches.sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0]);
    });
  });
}

async function resolveTaskTab(message, sender) {
  const courseName = message.courseName || message.profile?.courseName || message.request?.courseName;
  if (message.type === "scan-active-attendance" || message.type === "scan-active-attendance-students") {
    const profile = attendanceProfileFor(courseName);
    const attendance = profile && await resolveAttendanceTab(profile, sender);
    if (attendance) return attendance;
  }
  const preferredRoleByTask = {
    "scan-active-assignment-page": "assignment",
    "scan-active-assignment-deadlines": "assignment",
    "prepare-assignment-deadline-update": "assignment",
    "scan-active-chapter-tests": "chapter",
    "scan-active-chapter-structure": "chapter",
    "scan-active-course-overview": "statistics",
    "scan-active-score-overview": "statistics",
    "scan-active-score-students": "statistics",
  };
  const preferredRole = preferredRoleByTask[message.type];
  if (preferredRole) {
    const roleTab = await resolveCourseRoleTab(courseName, sender, preferredRole);
    if (roleTab) return roleTab;
  }
  if (message.type === "check-active-connection") {
    const courseTab = await resolveCourseRoleTab(courseName, sender);
    if (courseTab) return courseTab;
  }
  const preferCourseShell = ["scan-active-assignment-page", "scan-active-assignment-deadlines", "prepare-assignment-deadline-update", "scan-active-chapter-tests", "scan-active-course-overview", "scan-active-score-overview", "scan-active-score-students", "scan-active-chapter-structure"].includes(message.type);
  if (preferCourseShell) {
    const shell = await resolveCourseShellTab(courseName, sender);
    if (shell) return shell;
  }
  return resolveTargetTab(courseName, sender);
}

async function navigateTeacherModule(tabId, module) {
  const frames = await inspectNavigationFrames(tabId);
  const shell = frames.find(({ snapshot }) => snapshot?.courseShellRole);
  if (!shell) return { started: false, reason: "未找到当前课程的教师主页导航。" };
  const result = (await sendToFrame(tabId, shell.frame.frameId, { type: "navigate-teacher-module", module })) || { started: false, reason: "课程主页未返回导航结果。" };
  return !result.started && /未找到.*入口/.test(String(result.reason || "")) ? { ...result, acquisitionState: "页面结构变化" } : result;
}

async function navigateStatisticsSubmodule(tabId, module) {
  const frames = await inspectNavigationFrames(tabId);
  const shell = frames.find(({ snapshot }) => snapshot?.statisticsShellRole);
  if (!shell) return { started: false, reason: "未找到课程统计的基础数据页面。" };
  const result = (await sendToFrame(tabId, shell.frame.frameId, { type: "navigate-statistics-submodule", module })) || { started: false, reason: "统计页未返回导航结果。" };
  return !result.started && /未找到.*入口/.test(String(result.reason || "")) ? { ...result, acquisitionState: "页面结构变化" } : result;
}

function navigationFailure(navigation, fallbackReason) {
  return { acquisitionState: navigation?.acquisitionState || "未获取", reason: navigation?.reason || fallbackReason };
}

async function waitForInspection(inspector, predicate, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await wait(150);
    const inspections = await inspector();
    if (predicate(inspections)) return inspections;
  }
  return undefined;
}

async function visiblePlatformLogin(tabId) {
  const source = await new Promise((resolve) => chrome.tabs.get(tabId, (tab) => resolve(tab)));
  if (!source?.windowId) return false;
  const tabs = await new Promise((resolve) => chrome.tabs.query({ windowId: source.windowId }, (items) => resolve(items || [])));
  if (tabs.some((tab) => /^https:\/\/passport2\.chaoxing\.com\/login/i.test(String(tab.url || "")))) return true;
  const inspections = await inspectConnectionFrames(tabId);
  return inspections.some(({ snapshot }) => snapshot?.loginPage);
}

async function authenticationAwareFailure(tabId, reason) {
  if (await visiblePlatformLogin(tabId)) {
    return { acquisitionState: "需人工登录", reason: "学习通会话已失效或需要重新认证；请在可见浏览器完成登录后重试。" };
  }
  return { acquisitionState: "未获取", reason };
}

function chapterProfileFor(courseName) {
  const expected = LearningTongAssignmentScan.normalize(courseName);
  return (globalThis.LearningTongChapterTestProfiles || []).find((profile) => LearningTongAssignmentScan.normalize(profile.courseName) === expected);
}

function attendanceProfileFor(courseName) {
  const expected = LearningTongAssignmentScan.normalize(courseName);
  return (globalThis.LearningTongAttendanceProfiles || []).find((profile) => LearningTongAssignmentScan.normalize(profile.courseName) === expected);
}

function findWorkFrame(inspections) {
  return inspections.find(({ frame, snapshot }) => snapshot && (/\/work\/list/.test(frame.url || "") || /\/work\/list/.test(snapshot.path || "")));
}

function rowSignature(snapshot) {
  return (snapshot?.rows || []).map((row) => `${row.id}|${row.title}`).join("||");
}

async function waitForWorkPage(tabId, expectedPage, previousSignature) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(150);
    const inspections = await inspectFrames(tabId);
    const work = findWorkFrame(inspections);
    const signatureChanged = rowSignature(work?.snapshot) !== previousSignature;
    if (work?.snapshot?.currentPage === expectedPage && signatureChanged) return { inspections, work };
  }
  return undefined;
}

async function navigateWorkFrame(tabId, work, page) {
  if (work.snapshot.currentPage === page) return true;
  const previousSignature = rowSignature(work.snapshot);
  const started = await sendToFrame(tabId, work.frame.frameId, { type: "navigate-assignment-page", page });
  if (!started?.started) return false;
  return Boolean(await waitForWorkPage(tabId, page, previousSignature));
}

function broadcastProgress(reason) {
  chrome.runtime.sendMessage({ type: "scan-progress", reason }).catch(() => {});
}

async function scanAllAssignmentPages(tabId, profile) {
  broadcastProgress("正在核验当前标签页的课程上下文与作业列表…");
  let inspections = await inspectFrames(tabId);
  const courseContext = inspections.some(({ snapshot }) => LearningTongAssignmentScan.normalize(snapshot?.bodyText).includes(LearningTongAssignmentScan.normalize(profile.courseName)));
  let work = findWorkFrame(inspections);
  if (!work) {
    broadcastProgress("当前页面不是作业页，正在自动进入教师端作业列表…");
    const navigation = await navigateTeacherModule(tabId, "assignment");
    if (navigation?.started) {
      const ready = await waitForInspection(() => inspectFrames(tabId), (items) => Boolean(findWorkFrame(items)));
      if (ready) { inspections = ready; work = findWorkFrame(ready); }
    }
    if (!work) {
      const currentResults = inspections.filter(({ snapshot }) => snapshot).map(({ snapshot }) => LearningTongAssignmentScan.scanSnapshot(snapshot, profile));
      const result = LearningTongBackgroundUtils.aggregateFrameResults(currentResults);
      return navigation?.started
        ? authenticationAwareFailure(tabId, result.reason)
        : navigationFailure(navigation, result.reason);
    }
  }

  const originalPage = work.snapshot.currentPage;
  const pageNumbers = work.snapshot.pageNumbers?.length ? work.snapshot.pageNumbers : [originalPage || "当前页"];
  const rows = [];
  let lastSnapshot = work.snapshot;

  for (const [pageIndex, page] of pageNumbers.entries()) {
    broadcastProgress(`正在扫描作业分页 ${page}（第 ${pageIndex + 1}/${pageNumbers.length} 页）…`);
    if (!(await navigateWorkFrame(tabId, work, page))) {
      return { acquisitionState: "未获取", reason: `无法安全进入作业分页 ${page}，已停止扫描。`, scannedPages: [...new Set(rows.map((row) => row.page))] };
    }
    inspections = await inspectFrames(tabId);
    work = findWorkFrame(inspections);
    if (!work) return { acquisitionState: "未获取", reason: `进入作业分页 ${page} 后未重新识别到作业 iframe。` };
    lastSnapshot = work.snapshot;
    rows.push(...work.snapshot.rows);
  }

  if (originalPage && work?.snapshot?.currentPage !== originalPage) {
    broadcastProgress("正在恢复扫描前的原始分页…");
    await navigateWorkFrame(tabId, work, originalPage);
  }

  broadcastProgress("正在汇总各班级待批数量与课程核验结果…");

  const combined = {
    ...lastSnapshot,
    rows: [...new Map(rows.map((row, index) => [row.id || `${row.page}-${index}`, row])).values()],
    scannedPages: pageNumbers,
  };
  const candidate = LearningTongAssignmentScan.scanSnapshot(combined, profile);
  candidate.pageSummary = pageNumbers.map((page) => ({ page, rowCount: rows.filter((row) => row.page === page).length }));
  candidate.assignmentTotal = candidate.classSummary?.reduce((total, item) => total + item.assignmentCount, 0) || 0;
  const courseShell = { acquisitionState: "未获取", signals: { courseContext } };
  return LearningTongBackgroundUtils.aggregateFrameResults([courseShell, candidate]);
}

async function scanConfiguredChapterTests(tabId, courseName) {
  const profile = chapterProfileFor(courseName);
  if (!profile) return { acquisitionState: "未获取", reason: "当前课程尚未接入章节测试审计配置。" };
  let inspections = await inspectChapterFrames(tabId);
  const expectedCourse = LearningTongAssignmentScan.normalize(profile.courseName);
  const courseContext = inspections.some(({ snapshot }) => LearningTongAssignmentScan.normalize(snapshot?.bodyText).includes(expectedCourse));
  let chapterFrame = inspections.find(({ snapshot }) => snapshot?.chapterRole);
  if (!courseContext) return { acquisitionState: "未获取", reason: `当前标签页未核验到课程“${profile.courseName}”。` };
  if (!chapterFrame) {
    const navigation = await navigateTeacherModule(tabId, "chapter");
    if (navigation?.started) {
      const ready = await waitForInspection(() => inspectChapterFrames(tabId), (items) => items.some(({ snapshot }) => snapshot?.chapterRole));
      if (ready) { inspections = ready; chapterFrame = ready.find(({ snapshot }) => snapshot?.chapterRole); }
    }
    if (!chapterFrame) return navigation?.started
      ? authenticationAwareFailure(tabId, "自动进入章节页失败，请检查页面入口。")
      : navigationFailure(navigation, "自动进入章节页失败，请人工打开章节目录。");
  }
  const payload = await sendToFrame(tabId, chapterFrame.frame.frameId, { type: "scan-chapter-tests", profile });
  if (!payload) return { acquisitionState: "未获取", reason: "章节页未返回扫描结果。" };
  return {
    ...payload,
    reason: payload.acquisitionState === "未获取"
      ? payload.reason
      : `已通过课程主页、教师端章节页与待批列表三重核验。${payload.reason}`,
    signals: { courseContext: true, chapterRole: true, crossFrameVerified: true },
  };
}

async function resolveAttendanceTargetFrame(tabId, profile) {
  const target = {
    tab: { id: tabId },
    frame: (await inspectAttendanceFrames(tabId)).find(({ snapshot }) => snapshot?.attendanceRole && snapshot.courseId === profile.courseId),
  };
  if (target.frame) return target;
  const navigation = await navigateTeacherModule(tabId, "attendance");
  if (navigation?.started) {
    const waited = await waitForAttendanceTarget(tabId, profile);
    if (waited) return waited;
  }
  return { failure: navigation?.started
    ? authenticationAwareFailure(tabId, "自动进入班级活动页失败，请检查页面入口。")
    : navigationFailure(navigation, "自动进入班级活动页失败，请检查登录状态或页面入口。") };
}

async function scanConfiguredAttendance(tabId, courseName) {
  const profile = attendanceProfileFor(courseName);
  if (!profile) return { acquisitionState: "未获取", reason: "当前课程尚未接入签到异常只读配置。" };
  const target = await resolveAttendanceTargetFrame(tabId, profile);
  if (target.failure) return target.failure;
  const payload = await sendToFrame(target.tab.id, target.frame.frame.frameId, { type: "scan-attendance-anomalies", profile });
  if (!payload) return { acquisitionState: "未获取", reason: "活动页未返回签到扫描结果。" };
  if (payload.acquisitionState === "未获取" && /Failed to fetch|HTTP 401|HTTP 403/i.test(String(payload.reason || ""))) {
    return authenticationAwareFailure(target.tab.id, payload.reason);
  }
  return {
    ...payload,
    reason: `已核验本机课程配置、教师端活动页与班级列表。${payload.reason}`,
    signals: { courseProfile: true, attendanceRole: true, classScopeVerified: true },
  };
}

async function scanAttendanceStudents(tabId, courseName) {
  const profile = attendanceProfileFor(courseName);
  if (!profile) return { acquisitionState: "未获取", reason: "当前课程尚未接入签到异常只读配置。" };
  const target = await resolveAttendanceTargetFrame(tabId, profile);
  if (target.failure) return target.failure;
  broadcastProgress("正在读取各签到活动的学生明细（仅内存处理，用于填表）…");
  const payload = await sendToFrame(target.tab.id, target.frame.frame.frameId, { type: "scan-attendance-students", profile });
  if (!payload) return { acquisitionState: "未获取", reason: "活动页未返回签到学生扫描结果。" };
  if (payload.acquisitionState === "未获取") {
    if (/Failed to fetch|HTTP 401|HTTP 403/i.test(String(payload.reason || ""))) return authenticationAwareFailure(target.tab.id, payload.reason);
    return payload;
  }
  return {
    ...payload,
    reason: `已核验课程配置与活动页，${payload.reason}`,
    signals: { courseProfile: true, attendanceRole: true, classScopeVerified: true, studentRecordsInMemory: true },
  };
}

async function scanCourseOverview(tabId, courseName) {
  let inspections = await inspectCourseOverviewFrames(tabId);
  let result = LearningTongCourseOverviewScan.aggregate(inspections, courseName);
  if (result.acquisitionState === "采集到") return result;
  const navigation = await navigateTeacherModule(tabId, "statistics");
  if (!navigation?.started) return navigationFailure(navigation, result.reason);
  const ready = await waitForInspection(() => inspectCourseOverviewFrames(tabId), (items) => LearningTongCourseOverviewScan.aggregate(items, courseName).acquisitionState === "采集到", 70);
  if (!ready) return authenticationAwareFailure(tabId, "已点击“统计”，但课程概览未在限定时间内完整加载。");
  return LearningTongCourseOverviewScan.aggregate(ready, courseName);
}

async function ensureScorePageReady(tabId, profile) {
  const inspections = await inspectScoreOverviewFrames(tabId, profile);
  if (LearningTongScoreOverviewScan.aggregate(inspections, profile).acquisitionState === "采集到") return inspections;
  const navigationFrames = await inspectNavigationFrames(tabId);
  let statisticsReady = navigationFrames.some(({ snapshot }) => snapshot?.statisticsShellRole) ? navigationFrames : undefined;
  if (!statisticsReady) {
    const navigation = await navigateTeacherModule(tabId, "statistics");
    if (!navigation?.started) return navigationFailure(navigation, LearningTongScoreOverviewScan.aggregate(inspections, profile).reason);
    statisticsReady = await waitForInspection(() => inspectNavigationFrames(tabId), (items) => items.some(({ snapshot }) => snapshot?.statisticsShellRole), 70);
    if (!statisticsReady) return authenticationAwareFailure(tabId, "已点击“统计”，但基础数据页未在限定时间内加载。");
  }
  const subnavigation = await navigateStatisticsSubmodule(tabId, "score");
  if (!subnavigation?.started) return navigationFailure(subnavigation, "无法进入学生成绩页。");
  const ready = await waitForInspection(() => inspectScoreOverviewFrames(tabId, profile), (items) => LearningTongScoreOverviewScan.aggregate(items, profile).acquisitionState === "采集到", 70);
  if (!ready) return authenticationAwareFailure(tabId, "已点击“学生成绩”，但成绩汇总未在限定时间内加载。");
  return ready;
}

async function scanScoreOverview(tabId, profile) {
  const ready = await ensureScorePageReady(tabId, profile);
  if (!Array.isArray(ready)) return ready;
  return LearningTongScoreOverviewScan.aggregate(ready, profile);
}

async function scanChapterStructure(tabId, courseName) {
  let inspections = await inspectChapterStructureFrames(tabId);
  let result = LearningTongChapterStructureScan.aggregate(inspections, courseName);
  if (result.acquisitionState === "采集到") return result;
  const navigation = await navigateTeacherModule(tabId, "chapter");
  if (!navigation?.started) return navigationFailure(navigation, result.reason);
  const ready = await waitForInspection(() => inspectChapterStructureFrames(tabId), (items) => LearningTongChapterStructureScan.aggregate(items, courseName).acquisitionState === "采集到", 70);
  if (!ready) return authenticationAwareFailure(tabId, "已点击“章节”，但章节结构未在限定时间内加载。");
  return LearningTongChapterStructureScan.aggregate(ready, courseName);
}

async function scanScoreStudents(tabId, profile) {
  const ready = await ensureScorePageReady(tabId, profile);
  if (!Array.isArray(ready)) return ready;
  const scoreFrame = ready.find(({ snapshot }) => snapshot?.scoreRole);
  if (!scoreFrame) return { acquisitionState: "未获取", reason: "未找到学生成绩页框架。" };
  broadcastProgress("正在读取学生成绩明细（仅内存处理，用于填表）…");
  const payload = await sendToFrame(tabId, scoreFrame.frame.frameId, { type: "scan-score-students", profile });
  if (!payload) return { acquisitionState: "未获取", reason: "成绩页未返回学生明细结果。" };
  if (payload.acquisitionState === "未获取" && /Failed to fetch|HTTP 401|HTTP 403/i.test(String(payload.reason || ""))) {
    return authenticationAwareFailure(tabId, payload.reason);
  }
  return { ...payload, signals: { ...payload.signals, studentRecordsInMemory: true } };
}

async function refineConnectionResult(tabId, payload, courseName) {
  if (payload?.acquisitionState !== "采集到" || payload.classNames?.length) return payload;
  const withClasses = await waitForInspection(
    () => inspectConnectionFrames(tabId),
    (items) => (LearningTongConnectionCheck.aggregate(items, courseName).classNames || []).length > 0,
    13,
  );
  return withClasses ? LearningTongConnectionCheck.aggregate(withClasses, courseName) : payload;
}

async function checkConnection(tabId, courseName, sender) {
  let expected = LearningTongConnectionCheck.normalize(courseName);
  const inspections = await inspectConnectionFrames(tabId);
  const discovered = !expected
    && LearningTongConnectionCheck.findCourseShellSnapshot(inspections.map(({ snapshot }) => snapshot).filter(Boolean));
  if (discovered) expected = LearningTongConnectionCheck.normalize(discovered.courseLabel || discovered.title || "");
  const result = LearningTongConnectionCheck.aggregate(inspections, expected);
  if (result.acquisitionState === "采集到") {
    const refined = await refineConnectionResult(tabId, result, expected);
    if (!LearningTongConnectionCheck.normalize(courseName)) {
      return { ...refined, reason: `${refined.reason}已自动识别当前课程“${refined.detectedCourseName || expected}”。` };
    }
    return refined;
  }
  if (result.acquisitionState !== "未获取" || result.courseContext) return result;
  if (expected) return refineConnectionResult(tabId, (await enterCourseFromCourseList(expected, sender)) || result, expected);
  const courseList = inspections.flatMap(({ snapshot }) => snapshot?.courseList || []);
  if (courseList.length) {
    return {
      acquisitionState: "未获取",
      reason: `已检测到“我教的课”课程列表（${courseList.length} 门课程）。请在“课程名称”栏填写目标课程名后重试；检测会自动进入该课程并回填班级白名单。`,
      discoveredCourses: courseList.map(({ name }) => name).filter(Boolean),
    };
  }
  return {
    acquisitionState: "未获取",
    reason: "当前标签页未核验到课程。请先在学习通打开目标课程主页（或“我教的课”课程列表），再点击“检测当前连接”。",
  };
}

function senderWindowId(sender) {
  return Number.isInteger(sender?.tab?.windowId) ? sender.tab.windowId : undefined;
}

function createTab(options) {
  return new Promise((resolve) => chrome.tabs.create(options, (tab) => resolve(tab)));
}

function removeTab(tabId) {
  return new Promise((resolve) => chrome.tabs.remove(tabId, () => resolve()));
}

function activateTab(tabId) {
  return new Promise((resolve) => chrome.tabs.update(tabId, { active: true }, () => resolve()));
}

async function openCourseFromList(course, sender) {
  const windowId = senderWindowId(sender);
  const created = await createTab({ url: course.href, active: false, ...(windowId !== undefined ? { windowId } : {}) });
  if (!created?.id) return { acquisitionState: "未获取", reason: "已从课程列表定位到课程，但打开课程主页失败。" };
  const ready = await waitForInspection(
    () => inspectConnectionFrames(created.id),
    (items) => LearningTongConnectionCheck.aggregate(items, course.name).acquisitionState === "采集到",
    80,
  );
  if (!ready) return { acquisitionState: "未获取", reason: "已从课程列表打开课程主页，但课程主页未在限定时间内完成加载。" };
  const payload = await refineConnectionResult(created.id, LearningTongConnectionCheck.aggregate(ready, course.name), course.name);
  return { ...payload, reason: `${payload.reason}已自动从“我教的课”课程列表进入课程主页。` };
}

async function enterCourseFromCourseList(courseName, sender) {
  const expected = LearningTongConnectionCheck.normalize(courseName);
  if (!expected) return undefined;
  const tabs = (await queryChaoxingTabs(sender))
    .sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
  for (const tab of tabs) {
    if (!tab?.id) continue;
    const entry = LearningTongConnectionCheck.findCourseListEntry(await inspectConnectionFrames(tab.id), expected);
    if (entry) return openCourseFromList(entry, sender);
  }
  const windowId = senderWindowId(sender);
  const created = await createTab({ url: "https://i.chaoxing.com/", active: false, ...(windowId !== undefined ? { windowId } : {}) });
  if (!created?.id) return undefined;
  const ready = await waitForInspection(
    () => inspectConnectionFrames(created.id),
    (items) => items.some(({ snapshot }) => snapshot?.loginPage || (snapshot?.courseList || []).length),
    60,
  );
  if (ready?.some(({ snapshot }) => snapshot?.loginPage)) {
    await activateTab(created.id);
    return { acquisitionState: "需人工登录", reason: "学习通会话已失效或需要重新认证；请在可见浏览器完成登录后重试。" };
  }
  const entry = ready && LearningTongConnectionCheck.findCourseListEntry(ready, expected);
  if (!entry) {
    const hasList = ready && ready.some(({ snapshot }) => (snapshot?.courseList || []).length);
    await removeTab(created.id);
    if (hasList) return { acquisitionState: "未获取", reason: `“我教的课”课程列表中没有找到课程“${courseName}”；请核对扩展中的课程名称与学习通一致。` };
    return undefined;
  }
  const outcome = await openCourseFromList(entry, sender);
  await removeTab(created.id);
  return outcome;
}

async function collectDeadlineRows(tabId) {
  let inspections = await inspectFrames(tabId);
  let work = findWorkFrame(inspections);
  if (!work) {
    const navigation = await navigateTeacherModule(tabId, "assignment");
    if (navigation?.started) {
      const ready = await waitForInspection(() => inspectFrames(tabId), (items) => Boolean(findWorkFrame(items)));
      if (ready) {
        inspections = ready;
        work = findWorkFrame(ready);
      }
    }
    if (!work) return { ok: false, reason: navigation?.reason || "自动进入普通作业列表失败。" };
  }
  const originalPage = work.snapshot.currentPage;
  const pageNumbers = work.snapshot.pageNumbers?.length ? work.snapshot.pageNumbers : [originalPage || "当前页"];
  const rows = [];
  for (const page of pageNumbers) {
    if (!(await navigateWorkFrame(tabId, work, page))) return { ok: false, reason: `无法安全进入作业分页 ${page}，已停止。` };
    inspections = await inspectFrames(tabId);
    work = findWorkFrame(inspections);
    if (!work) return { ok: false, reason: `进入作业分页 ${page} 后未识别到作业列表。` };
    rows.push(...(work.snapshot.rows || []));
  }
  return { ok: true, rows, work, originalPage, pageNumbers };
}

async function waitForDeadlineEditor(tabId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(150);
    const frames = await getFrames(tabId);
    for (const frame of frames) {
      const snapshot = await sendToFrame(tabId, frame.frameId, { type: "inspect-assignment-deadline-editor" });
      if (snapshot?.editorRole) return { frame, snapshot };
    }
  }
  return undefined;
}

async function prepareDeadlineUpdate(tabId, request, targetTitle = "") {
  const expectedCourse = LearningTongDeadlineUpdate.normalize(request.courseName);
  const inspections = await inspectFrames(tabId);
  const courseContext = inspections.some(({ snapshot }) => LearningTongDeadlineUpdate.normalize(snapshot?.bodyText).includes(expectedCourse));
  if (!courseContext) return { acquisitionState: "未获取", reason: `当前标签页未核验到课程“${request.courseName}”。` };
  const collected = await collectDeadlineRows(tabId);
  if (!collected.ok) return { acquisitionState: "未获取", reason: `${collected.reason} 当前选中的平台标签页：${LearningTongDeadlineUpdate.normalize(targetTitle) || "未识别"}。` };
  const selected = LearningTongDeadlineUpdate.findUniqueTarget(collected.rows, request);
  if (!selected.ok) {
    if (collected.originalPage && collected.work?.snapshot?.currentPage !== collected.originalPage) await navigateWorkFrame(tabId, collected.work, collected.originalPage);
    return { acquisitionState: "未获取", reason: selected.reason };
  }
  const targetPage = selected.target.page;
  if (!(await navigateWorkFrame(tabId, collected.work, targetPage))) return { acquisitionState: "未获取", reason: `无法进入目标作业所在分页 ${targetPage}。` };
  const refreshed = findWorkFrame(await inspectFrames(tabId));
  if (!refreshed) return { acquisitionState: "未获取", reason: "目标分页加载后未重新识别到作业列表。" };
  const opened = await sendToFrame(tabId, refreshed.frame.frameId, { type: "open-assignment-deadline-editor", modifyId: selected.target.modifyId, title: request.title, className: request.className });
  if (!opened?.started) return { acquisitionState: "未获取", reason: opened?.reason || "未能打开作业发放设置页。" };
  const editor = await waitForDeadlineEditor(tabId);
  if (!editor) return { acquisitionState: "未获取", reason: "作业发放设置页未在限定时间内加载，未提交修改。" };
  if (LearningTongDeadlineUpdate.normalize(editor.snapshot.title) !== LearningTongDeadlineUpdate.normalize(request.title)
    || !LearningTongDeadlineUpdate.normalize(editor.snapshot.bodyText).includes(LearningTongDeadlineUpdate.normalize(request.className))) {
    return { acquisitionState: "未获取", reason: "发放设置页的作业或班级与目标不一致，未提交修改。" };
  }
  if (editor.snapshot.endTime === request.nextEndTime) return { acquisitionState: "未获取", reason: "目标时间与当前截止时间相同，无需修改。" };
  const confirmationToken = crypto.randomUUID();
  await saveDeadlineConfirmation(confirmationToken, { tabId, frameId: editor.frame.frameId, createdAt: Date.now(), request });
  return {
    acquisitionState: "待确认",
    reason: "已唯一定位作业并读取原截止时间。确认后只修改这一条，提交后立即回到列表独立核验。",
    confirmationToken,
    preview: { courseName: request.courseName, className: request.className, title: request.title, beforeEndTime: editor.snapshot.endTime, nextEndTime: request.nextEndTime },
  };
}

async function confirmDeadlineUpdate(confirmationToken) {
  const pending = await takeDeadlineConfirmation(confirmationToken);
  if (!pending) return { acquisitionState: "未获取", reason: "确认已失效，请重新生成预览。" };
  if (Date.now() - pending.createdAt > 5 * 60 * 1000) return { acquisitionState: "未获取", reason: "预览已超过 5 分钟，请重新核验。" };
  const applied = await sendToFrame(pending.tabId, pending.frameId, { type: "apply-assignment-deadline-update", title: pending.request.title, className: pending.request.className, nextEndTime: pending.request.nextEndTime });
  if (!applied?.started) return { acquisitionState: "未获取", reason: applied?.reason || "写入未启动。" };
  let listReady = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(250);
    const work = findWorkFrame(await inspectFrames(pending.tabId));
    if (work) { listReady = true; break; }
  }
  if (!listReady) return { acquisitionState: "回读失败", reason: "平台已接收提交动作，但未在限定时间内返回作业列表；不会自动重试，请人工核验。" };
  const collected = await collectDeadlineRows(pending.tabId);
  if (!collected.ok) return { acquisitionState: "回读失败", reason: `提交后无法完成列表回读：${collected.reason}` };
  const selected = LearningTongDeadlineUpdate.findUniqueTarget(collected.rows, pending.request);
  if (!selected.ok) return { acquisitionState: "回读失败", reason: `提交后无法唯一回读目标：${selected.reason}` };
  const deadlineText = LearningTongAssignmentScan.deadlineOf(selected.target.text);
  const passed = LearningTongDeadlineUpdate.deadlineDisplayMatches(deadlineText, pending.request.nextEndTime);
  return passed
    ? { acquisitionState: "已完成", reason: "单条作业截止时间已提交，并从作业列表独立回读一致。", verification: { title: pending.request.title, className: pending.request.className, nextEndTime: pending.request.nextEndTime, listDeadline: deadlineText } }
    : { acquisitionState: "回读失败", reason: "平台返回的列表截止时间与目标时间不一致；不会自动重试，请人工核验。" };
}

async function cancelDeadlineUpdate(confirmationToken) {
  const pending = await takeDeadlineConfirmation(confirmationToken);
  if (!pending) return { acquisitionState: "已取消", reason: "预览已取消或失效，未修改平台。" };
  const cancelled = await sendToFrame(pending.tabId, pending.frameId, { type: "cancel-assignment-deadline-update" });
  if (!cancelled?.cancelled) return { acquisitionState: "已取消", reason: "预览已取消，未修改平台；请返回作业列表。" };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(150);
    if (findWorkFrame(await inspectFrames(pending.tabId))) return { acquisitionState: "已取消", reason: "已取消本次预览并返回作业列表，未修改平台。" };
  }
  return { acquisitionState: "已取消", reason: "预览已取消，未修改平台；页面未自动返回，请手动返回作业列表。" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ai-config-get") {
    loadAiConfig().then((config) => sendResponse({ ok: true, config: { ...config, apiKey: config.apiKey ? "********" : "", hasKey: Boolean(config.apiKey) } })).catch(() => sendResponse({ ok: false, reason: "读取 AI 配置失败。" }));
    return true;
  }
  if (message?.type === "ai-config-save") {
    const incoming = message.config || {};
    loadAiConfig().then(async (existing) => {
      const apiKey = incoming.apiKey === "********" || incoming.apiKey === "" ? ((incoming.provider || "api") === existing.provider ? existing.apiKey : "") : incoming.apiKey;
      const saved = await saveAiConfig({ ...incoming, apiKey });
      sendResponse({ ok: true, config: { ...saved, apiKey: "********", hasKey: Boolean(saved.apiKey) } });
    }).catch(() => sendResponse({ ok: false, reason: "保存 AI 配置失败。" }));
    return true;
  }
  if (message?.type === "ai-config-clear") {
    (async () => {
      const existing = await loadAiConfig();
      await chrome.storage.local.remove(AI_CONFIG_KEY);
      await chrome.storage.session.remove(AI_CONFIG_KEY);
      const origin = LearningTongAiGrading.originPattern(existing.baseUrl);
      if (origin && chrome.permissions?.remove) await new Promise((resolve) => chrome.permissions.remove({ origins: [origin] }, resolve));
      sendResponse({ ok: true, reason: "已清除 API Key、AI 设置和对应 API 域名授权。" });
    })().catch(() => sendResponse({ ok: false, reason: "清除 AI 设置失败。" }));
    return true;
  }
  if (message?.type === "ai-config-test") {
    (async () => {
      const config = await loadAiConfig();
      if (!(await hasAiOriginPermission(config.baseUrl))) {
        sendResponse({ ok: false, reason: "尚未授权该 AI API 域名，请先点击“保存设置并授权域名”。" });
        return;
      }
      const probe = await callAiChatCompletion(config, [
        { role: "system", content: "只输出 JSON。" },
        { role: "user", content: '输出 {"ok":1}' },
      ], { maxTokens: 600, timeoutMs: 30000 });
      if (!probe.ok) {
        sendResponse({ ok: false, reason: probe.reason });
        return;
      }
      if (probe.note) {
        await saveAiConfig({ ...config, baseUrl: ZHIPU_ANTHROPIC_BASE });
        sendResponse({ ok: true, reason: `连接成功：模型 ${config.model} 已响应。${probe.note}已将 API 地址固定为 ${ZHIPU_ANTHROPIC_BASE}。` });
        return;
      }
      sendResponse({ ok: true, reason: `连接成功：模型 ${config.model} 已响应。` });
    })().catch((error) => sendResponse({ ok: false, reason: `测试失败：${LearningTongAiGrading.normalize(error?.message || error)}` }));
    return true;
  }
  if (message?.type === "ai-attachment-download") {
    (async () => {
      const url = String(message.attachment?.href || "");
      const fileName = String(message.attachment?.fileName || "");
      let parsed;
      try { parsed = new URL(url); } catch { parsed = undefined; }
      const trustedSender = !sender?.url && !sender?.tab?.url ? false : [sender?.url, sender?.tab?.url].filter(Boolean).every((value) => { try { return new URL(value).hostname.endsWith("chaoxing.com"); } catch { return false; } });
      const trustedTarget = parsed?.protocol === "https:" && (parsed.hostname === "chaoxing.com" || parsed.hostname.endsWith(".chaoxing.com"));
      if (!trustedSender || !trustedTarget) {
        sendResponse({ ok: false, reason: "附件链接无效或不属于学习通可信域名。" });
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(url, { credentials: "include", signal: controller.signal });
        if (!response.ok) {
          sendResponse({ ok: false, reason: `附件下载失败（HTTP ${response.status}），请人工批改。` });
          return;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        sendResponse({ ok: true, dataBase64: bytesToBase64(bytes) });
      } catch (error) {
        if (error?.name === "AbortError") sendResponse({ ok: false, reason: `附件下载超时：${fileName || url.slice(0, 60)}` });
        else sendResponse({ ok: false, reason: `附件下载失败：${LearningTongAiGrading.normalize(error?.message || error).slice(0, 120)}` });
      } finally {
        clearTimeout(timer);
      }
    })();
    return true;
  }
  if (message?.type === "ai-rubric-get") {
    (async () => {
      const rubric = await loadRubric(message.questionKey);
      sendResponse({ ok: true, rubric: rubric || null });
    })().catch((error) => sendResponse({ ok: false, reason: LearningTongAiGrading.normalize(error?.message || error) }));
    return true;
  }
  if (message?.type === "ai-rubric-draft") {
    (async () => {
      const config = await loadAiConfig();
      if (!LearningTongAiGrading.configReady(config)) {
        sendResponse({ ok: false, reason: "AI 批改未配置：请先在扩展弹窗“AI 批改设置”中完成配置。" });
        return;
      }
      const context = message.context || {};
      const completion = await callAiChatCompletion(config, LearningTongAiGrading.buildRubricMessages(context), { maxTokens: 1500, timeoutMs: 60000 });
      if (!completion.ok) { sendResponse(completion); return; }
      sendResponse(LearningTongAiGrading.parseRubricResponse(completion.content, context.maxScore || 100));
    })().catch((error) => sendResponse({ ok: false, reason: `评分卡起草失败：${LearningTongAiGrading.normalize(error?.message || error)}` }));
    return true;
  }
  if (message?.type === "ai-rubric-save") {
    (async () => {
      sendResponse(await saveRubric(message.questionKey, message.rubric, message.context));
    })().catch(() => sendResponse({ ok: false, reason: "评分卡保存失败。" }));
    return true;
  }
  if (message?.type === "ai-rubric-delete") {
    (async () => {
      await chrome.storage.local.remove(rubricStorageKey(message.questionKey));
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false, reason: "评分卡删除失败。" }));
    return true;
  }
  if (message?.type === "ai-grade-request") {
    (async () => {
      const config = await loadAiConfig();
      if (!LearningTongAiGrading.configReady(config)) {
        sendResponse({ ok: false, reason: "AI 批改未配置：请在扩展弹窗“AI 批改设置”中填写 API 地址、密钥和模型。" });
        return;
      }
      if (!(await hasAiOriginPermission(config.baseUrl))) {
        sendResponse({ ok: false, reason: "尚未授权该 AI API 域名。请打开扩展的“AI 批改设置”，点击“保存设置并授权域名”。" });
        return;
      }
      const prepared = prepareAiContext(message.context || {}, config);
      const context = prepared.context;
      const commentEnabled = context.commentEnabled === undefined ? config.commentEnabled !== false : context.commentEnabled !== false;
      const rubric = context.rubric || (await loadRubric(LearningTongAiGrading.questionKeyOf(context)));
      const messages = LearningTongAiGrading.buildMessages({ ...context, criteria: context.criteria || config.criteria, commentEnabled, rubric });
      const hasRubric = Boolean(rubric?.dimensions?.length);
      const attachmentChars = (context.attachments || []).reduce((sum, a) => sum + (a.text?.length || 0), 0);
      const maxTokens = hasRubric ? 2600 : commentEnabled ? 2000 : 800;
      const completion = await callAiChatCompletion(config, messages, { maxTokens, timeoutMs: attachmentChars > 8000 ? 120000 : 90000 });
      if (!completion.ok) { sendResponse(completion); return; }
      const grading = LearningTongAiGrading.parseGradingResponse(completion.content, context.maxScore || 100, { commentRequired: commentEnabled });
      if (grading.ok && hasRubric) {
        try { LearningTongBatch.validateSuggestion(grading, rubric, context.maxScore || 100); } catch (e) { sendResponse({ ok: false, reason: e.message }); return; }
        const caps = new Map(rubric.dimensions.map((d) => [d.name, d.maxScore]));
        let total = 0;
        for (const d of grading.dimensionScores) {
          d.score = Math.round(Math.min(caps.get(d.name) ?? d.score, d.score) * 10) / 10;
          total += d.score;
        }
        grading.rubricTotal = Math.round(total * 10) / 10;
        grading.score = grading.rubricTotal;
      }
      sendResponse({ ...grading, model: config.model, dataNotice: prepared.notice });
    })().catch((error) => sendResponse({ ok: false, reason: `AI 批改失败：${LearningTongAiGrading.normalize(error?.message || error)}` }));
    return true;
  }
  if (message?.type === "get-extension-capabilities") {
    const chapterProfile = chapterProfileFor(message.courseName);
    const attendanceProfile = attendanceProfileFor(message.courseName);
    sendResponse({
      chapterTests: Boolean(chapterProfile),
      chapterClassNames: chapterProfile?.classNames || [],
      chapterTestCount: chapterProfile?.tests?.length || 0,
      attendance: Boolean(attendanceProfile),
      attendanceClassNames: attendanceProfile?.classNames || [],
      courseOverview: Boolean(LearningTongAssignmentScan.normalize(message.courseName)),
      scoreOverview: Boolean(LearningTongAssignmentScan.normalize(message.courseName)),
      chapterStructure: Boolean(LearningTongAssignmentScan.normalize(message.courseName)),
    });
    return undefined;
  }
  if (message?.type === "confirm-assignment-deadline-update") {
    confirmDeadlineUpdate(message.confirmationToken).then(sendResponse).catch((error) => sendResponse({ acquisitionState: "未获取", reason: `截止时间回读失败：${LearningTongAssignmentScan.normalize(error?.message || error)}` }));
    return true;
  }
  if (message?.type === "cancel-assignment-deadline-update") {
    cancelDeadlineUpdate(message.confirmationToken).then(sendResponse).catch(() => sendResponse({ acquisitionState: "已取消", reason: "已取消本次预览，未修改平台。" }));
    return true;
  }
  if (!["scan-active-assignment-page", "scan-active-assignment-deadlines", "prepare-assignment-deadline-update", "scan-active-chapter-tests", "scan-active-attendance", "scan-active-attendance-students", "scan-active-course-overview", "scan-active-score-overview", "scan-active-score-students", "scan-active-chapter-structure", "check-active-connection"].includes(message?.type)) return undefined;
  resolveTaskTab(message, sender).then(async (tab) => {
    if (!tab?.id) {
      if (message.type === "check-active-connection") {
        const entered = await enterCourseFromCourseList(message.courseName, sender);
        if (entered) {
          sendResponse(entered);
          return;
        }
      }
      sendResponse({ acquisitionState: "未获取", reason: "请先打开已登录的学习通教师端页面。" });
      return;
    }
    try {
      if (message.type === "prepare-assignment-deadline-update") {
        sendResponse(await prepareDeadlineUpdate(tab.id, message.request, tab.title));
        return;
      }
      if (message.type === "scan-active-chapter-tests") {
        sendResponse(respondScan(message, await scanConfiguredChapterTests(tab.id, message.courseName)));
        return;
      }
      if (message.type === "scan-active-attendance") {
        sendResponse(respondScan(message, await scanConfiguredAttendance(tab.id, message.courseName)));
        return;
      }
      if (message.type === "scan-active-attendance-students") {
        sendResponse(await scanAttendanceStudents(tab.id, message.courseName));
        return;
      }
      if (message.type === "scan-active-course-overview") {
        sendResponse(respondScan(message, await scanCourseOverview(tab.id, message.courseName)));
        return;
      }
      if (message.type === "scan-active-score-overview") {
        sendResponse(respondScan(message, await scanScoreOverview(tab.id, message.profile)));
        return;
      }
      if (message.type === "scan-active-score-students") {
        sendResponse(await scanScoreStudents(tab.id, message.profile));
        return;
      }
      if (message.type === "scan-active-chapter-structure") {
        sendResponse(respondScan(message, await scanChapterStructure(tab.id, message.courseName)));
        return;
      }
      if (message.type === "check-active-connection") {
        sendResponse(await checkConnection(tab.id, message.courseName, sender));
        return;
      }
      const payload = await scanAllAssignmentPages(tab.id, message.profile);
      if (message.type === "scan-active-assignment-deadlines" && payload.signals?.crossFrameVerified) {
        payload.acquisitionState = payload.assignmentDeadlines?.length ? "采集到" : "未获取";
        payload.reason = payload.assignmentDeadlines?.length
          ? `已通过课程主页面与作业 iframe 双重核验，并采集 ${payload.assignmentDeadlines.length} 个作业的截止时间。`
          : "已核验作业范围，但当前列表没有可识别的截止时间。";
      }
      sendResponse(respondScan(message, payload));
    } catch (error) {
      sendResponse({ acquisitionState: "未获取", reason: `全分页扫描失败：${LearningTongAssignmentScan.normalize(error?.message || error)}` });
    }
  });
  return true;
});
