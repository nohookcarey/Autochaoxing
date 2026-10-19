import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("扩展必须使用 Manifest V3。");
if (!manifest.permissions?.includes("activeTab") || !manifest.permissions?.includes("storage") || !manifest.permissions?.includes("webNavigation") || !manifest.permissions?.includes("scripting")) throw new Error("扩展缺少最小必要权限。");
if ((manifest.host_permissions || []).some((item) => item === "<all_urls>")) throw new Error("扩展不得申请全站访问权限。");
if (!(manifest.optional_host_permissions || []).includes("https://*/*")) throw new Error("AI API 域名必须通过可选权限按需授权。");
const scanner = readFileSync(resolve(root, "extension/content/assignment-scan-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/assignment-page.js"), "utf8");
for (const forbidden of ["cookies", "password", "localStorage", "fetch(", "XMLHttpRequest"]) {
  if (scanner.includes(forbidden)) throw new Error(`扫描器不应包含 ${forbidden}。`);
}
for (const expected of ["未获取", "确认无数据", "采集到", "scannedPages"]) {
  if (!scanner.includes(expected)) throw new Error(`扫描器缺少状态契约：${expected}`);
}
if (!manifest.content_scripts?.[0]?.all_frames) throw new Error("扩展必须扫描课程壳页与作业 iframe。");
for (const expected of ["content/navigation-core.js", "content/navigation-page.js"]) {
  if (!manifest.content_scripts?.[0]?.js?.includes(expected)) throw new Error(`扩展缺少受控自动导航脚本：${expected}`);
}
for (const expected of ["content/chapter-test-scan-core.js", "content/chapter-test-page.js"]) {
  if (!manifest.content_scripts?.[0]?.js?.includes(expected)) throw new Error(`扩展缺少章节测试扫描脚本：${expected}`);
}
for (const expected of ["content/attendance-scan-core.js", "content/attendance-page.js"]) {
  if (!manifest.content_scripts?.[0]?.js?.includes(expected)) throw new Error(`扩展缺少签到扫描脚本：${expected}`);
}
for (const expected of ["content/course-overview-scan-core.js", "content/course-overview-page.js"]) {
  if (!manifest.content_scripts?.[0]?.js?.includes(expected)) throw new Error(`扩展缺少课程概览扫描脚本：${expected}`);
}
for (const expected of ["content/score-overview-scan-core.js", "content/score-overview-page.js"]) {
  if (!manifest.content_scripts?.[0]?.js?.includes(expected)) throw new Error(`扩展缺少成绩概览扫描脚本：${expected}`);
}
for (const expected of ["content/chapter-structure-scan-core.js", "content/chapter-structure-page.js"]) {
  if (!manifest.content_scripts?.[0]?.js?.includes(expected)) throw new Error(`扩展缺少章节结构扫描脚本：${expected}`);
}
for (const expected of ["content/connection-check-scan-core.js", "content/connection-check-page.js"]) {
  if (!manifest.content_scripts?.[0]?.js?.includes(expected)) throw new Error(`扩展缺少连接检测脚本：${expected}`);
}
if (!manifest.content_scripts?.[0]?.js?.includes("content/deadline-update-core.js")) throw new Error("扩展缺少受控改期核心脚本。");
const chapterScanner = readFileSync(resolve(root, "extension/content/chapter-test-scan-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/chapter-test-page.js"), "utf8");
for (const expected of ["mark-list", 'status: "3"', "parsePendingList", "aggregateTargetResults", "确认无数据"]) {
  if (!chapterScanner.includes(expected)) throw new Error(`章节测试扫描器缺少必要契约：${expected}`);
}
const chapterProfiles = readFileSync(resolve(root, "extension/chapter-test-profiles.local.js"), "utf8");
for (const forbidden of ["password", "username", "cookie", "studentId", "clazzId", "courseId", "cpi"]) {
  if (chapterProfiles.includes(forbidden)) throw new Error(`本机章节测试配置不应包含 ${forbidden}。`);
}
const attendanceScanner = readFileSync(resolve(root, "extension/content/attendance-scan-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/attendance-page.js"), "utf8");
for (const expected of ["pcActivelist", "getAttendList", "invalidIdentityRows", "unknownStatuses", "不可用于回填"]) {
  if (!attendanceScanner.includes(expected)) throw new Error(`签到扫描器缺少风险门禁：${expected}`);
}
const attendanceProfiles = readFileSync(resolve(root, "extension/attendance-profiles.local.js"), "utf8");
for (const forbidden of ["password", "username", "cookie", "studentId", "cpi"]) {
  if (attendanceProfiles.includes(forbidden)) throw new Error(`本机签到配置不应包含 ${forbidden}。`);
}
const overviewScanner = readFileSync(resolve(root, "extension/content/course-overview-scan-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/course-overview-page.js"), "utf8");
for (const expected of ["课程资源建设概览", "教学运行概况", "aggregateOnly", "未读取学生姓名或个人成绩"]) {
  if (!overviewScanner.includes(expected)) throw new Error(`课程概览扫描器缺少聚合或隐私契约：${expected}`);
}
const scoreScanner = readFileSync(resolve(root, "extension/content/score-overview-scan-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/score-overview-page.js"), "utf8");
for (const expected of ["综合成绩平均分", "classScopeVerified", "aggregateOnly", "未读取或返回学生姓名、学号和个人成绩"]) {
  if (!scoreScanner.includes(expected)) throw new Error(`成绩概览扫描器缺少范围或隐私契约：${expected}`);
}
const structureScanner = readFileSync(resolve(root, "extension/content/chapter-structure-scan-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/chapter-structure-page.js"), "utf8");
for (const expected of ["chapterCount", "sectionCount", "taskPointCount", "structureOnly", "未修改章节内容"]) {
  if (!structureScanner.includes(expected)) throw new Error(`章节结构扫描器缺少只读契约：${expected}`);
}
const connectionScanner = readFileSync(resolve(root, "extension/content/connection-check-scan-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/connection-check-page.js"), "utf8");
for (const expected of ["需人工登录", "authenticatedTeacherPage", "recognizedRole", "当前标签页未核验到课程"]) {
  if (!connectionScanner.includes(expected)) throw new Error(`连接检测缺少登录或课程门禁：${expected}`);
}
const deadlineUpdater = readFileSync(resolve(root, "extension/content/deadline-update-core.js"), "utf8") + readFileSync(resolve(root, "extension/content/assignment-page.js"), "utf8");
for (const expected of ["findUniqueTarget", "confirmationToken", "chrome.storage.session", "apply-assignment-deadline-update", "作业标题或班级与确认范围不一致", "不会自动重试"]) {
  if (!(deadlineUpdater + readFileSync(resolve(root, "extension/background.js"), "utf8")).includes(expected)) throw new Error(`受控改期缺少门禁：${expected}`);
}
const background = readFileSync(resolve(root, "extension/background.js"), "utf8");
for (const expected of ["getAllFrames", "sendWithScriptFallback", "inspectableChaoxingFrame", "chrome.scripting.executeScript", "content/navigation-core.js", "content/navigation-page.js", "queryChaoxingTabs", "resolveCourseRoleTab", "findAttendanceTarget", "resolveAttendanceTab", "waitForAttendanceTarget", "visiblePlatformLogin", "authenticationAwareFailure", "需人工登录", "navigationFailure", "页面结构变化", "scanAllAssignmentPages", "navigate-assignment-page", "waitForWorkPage", "resolveCourseShellTab", "resolveTaskTab", "inspect-teacher-navigation", "navigate-teacher-module", "navigate-statistics-submodule", "waitForInspection", "scanConfiguredChapterTests", "inspect-chapter-test-frame", "scanConfiguredAttendance", "inspect-attendance-frame", "scanCourseOverview", "inspect-course-overview-frame", "scanScoreOverview", "inspect-score-overview-frame", "scanChapterStructure", "inspect-chapter-structure-frame", "checkConnection", "inspect-connection-frame", "prepareDeadlineUpdate", "confirmDeadlineUpdate", "cancelDeadlineUpdate"]) {
  if (!background.includes(expected)) throw new Error(`后台缺少全分页扫描能力：${expected}`);
}
for (const expected of ["hasAiOriginPermission", "trustedTarget", "prepareAiContext", "ai-config-clear", "grading.score = grading.rubricTotal"]) {
  if (!background.includes(expected)) throw new Error(`AI 风险控制缺少必要契约：${expected}`);
}
if (!background.includes("message.request?.courseName")) throw new Error("受控改期必须用请求中的课程名称选择目标标签页。");
const popup = readFileSync(resolve(root, "extension/popup/popup.js"), "utf8");
for (const expected of ["teachingOperationsExtension", "courseSelect", "check-active-connection", "scan-active-assignment-page", "scan-active-assignment-deadlines", "prepare-assignment-deadline-update", "confirm-assignment-deadline-update", "cancel-assignment-deadline-update", "scan-active-chapter-tests", "scan-active-attendance", "scan-active-course-overview", "scan-active-score-overview", "scan-active-chapter-structure", "historyPayload", "recent-run-item", "exportReport", "课程连接检测", "作业截止时间清单", "作业截止时间修改预演", "普通作业待批核验", "尚未提供本轮评分口径", "章节测试待批审计", "签到活动与异常审计", "课程聚合概览", "班级成绩聚合概览", "章节结构只读检查"]) {
  if (!popup.includes(expected)) throw new Error(`扩展弹窗缺少必要能力：${expected}`);
}
if (!popup.includes("resetChatForMode") || !popup.includes("chatLog.replaceChildren")) throw new Error("脱敏演示必须清除切换前的聊天内容。");
const popupHtml = readFileSync(resolve(root, "extension/popup/popup.html"), "utf8");
const demoMode = readFileSync(resolve(root, "extension/popup/demo-mode.js"), "utf8");
for (const expected of ["demo-mode.js", "toggle-demo-mode", "export-architecture"]) {
  if (!popupHtml.includes(expected)) throw new Error(`扩展弹窗缺少脱敏演示入口：${expected}`);
}
for (const expected of ["ai-attachment-enabled", "clear-ai-config", "保存设置并授权域名", "scan-course-overview", "scan-chapter-structure"]) {
  if (!popupHtml.includes(expected)) throw new Error(`扩展弹窗缺少稳定版入口或隐私控制：${expected}`);
}
const aiGradingPage = readFileSync(resolve(root, "extension/content/ai-grading-page.js"), "utf8");
for (const expected of ["生成 AI 批改建议", "应用建议到当前题", "pendingGrading"]) {
  if (!aiGradingPage.includes(expected)) throw new Error(`AI 批改缺少建议确认流程：${expected}`);
}
const sheetFilling = readFileSync(resolve(root, "extension/popup/sheet-filling.js"), "utf8");
for (const expected of ["verifyWorkbook", "成绩模式必须全部通过学号匹配", "确认后生成新文件", "回读失败"]) {
  if (!sheetFilling.includes(expected)) throw new Error(`表格回填缺少预览或回读门禁：${expected}`);
}
for (const expected of ["教学运营演示课程", "演示班 A", "未连接学习通", "architectureSvg"]) {
  if (!demoMode.includes(expected)) throw new Error(`脱敏演示缺少必要契约：${expected}`);
}
for (const forbidden of ["courseid=", "clazzid=", "cpi=", "studentNo"] ) {
  if (demoMode.includes(forbidden)) throw new Error(`脱敏演示不得包含：${forbidden}`);
}
const courseState = readFileSync(resolve(root, "extension/popup/course-state.js"), "utf8");
for (const expected of ["course-state.js", "archive-current-course", "archived-courses-panel", "archived-course-list"]) {
  if (!popupHtml.includes(expected)) throw new Error(`扩展弹窗缺少课程归档入口：${expected}`);
}
for (const expected of ["activeCourses", "archivedCourses", "archiveCourse", "restoreCourse", "至少保留一门当前课程"]) {
  if (!(courseState + popup).includes(expected)) throw new Error(`课程归档缺少必要契约：${expected}`);
}
const runHistory = readFileSync(resolve(root, "extension/popup/run-history.js"), "utf8");
for (const expected of ["run-history.js", "run-filter", "run-history-summary", "需处理", "已完成"]) {
  if (!popupHtml.includes(expected)) throw new Error(`扩展弹窗缺少任务记录筛选：${expected}`);
}
for (const expected of ["filterRuns", "summarize", "需人工登录", "页面结构变化", "确认无数据"]) {
  if (!(runHistory + popup).includes(expected)) throw new Error(`任务记录缺少状态契约：${expected}`);
}
const deadlineForm = readFileSync(resolve(root, "extension/popup/deadline-form.js"), "utf8");
for (const expected of ["deadline-form.js", "show-deadline-form", "deadline-class", "deadline-title", "deadline-time", "preview-deadline-update", "生成修改预览"]) {
  if (!popupHtml.includes(expected)) throw new Error(`扩展弹窗缺少单条改期表单：${expected}`);
}
for (const expected of ["buildRequest", "validDateTime", "班级白名单", "完整作业标题", "previewDeadlineFromForm"]) {
  if (!(deadlineForm + popup).includes(expected)) throw new Error(`单条改期表单缺少门禁：${expected}`);
}
console.log("浏览器扩展校验通过：仅本机、最小权限、多课程范围、只读审计与单条作业受控改期。");
