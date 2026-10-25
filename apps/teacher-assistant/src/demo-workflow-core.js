// Local demonstration state only. No platform or model requests.
export const SAMPLE_TEXT = "面向高职新生，制作一页中文学习清单；按步骤列出操作，并给出检查项。";
export function scanDemo(scope, scenario) {
  if (scenario === "missing") return { state: "未获取", reason: "模拟列表页未加载完整。不能判断有没有待批，请重新检查页面。", rows: [] };
  if (scenario === "empty") return { state: "确认无待批", reason: "模拟班级与列表范围已核对，范围内待批数为0。", rows: [[scope, "0项", "范围已核对（模拟）"]] };
  return { state: "已获取（模拟）", reason: "只查看选定班级，不修改成绩或提交记录。", rows: [[scope, "提示词练习", "2份待批（模拟）"], [scope, "学习清单练习", "1份待批（模拟）"]] };
}
export function previewDeadline(scope, title, date, original) {
  if (title !== "提示词练习") return { valid: false, reason: "没有找到精确匹配的模拟作业，请核对标题；本次不修改。" };
  if (!/^2026-09-(19|20|21) 23:59$/.test(date)) return { valid: false, reason: "本模拟案例支持9月19日至21日23:59，请填写完整日期和时间。" };
  return { valid: true, scope, title, original, target: date, untouched: scope === "演示班 A" ? "演示班 B" : "演示班 A" };
}
export function suggestionDemo() {
  return { score: 7, rows: [["任务明确 / 4分", "4分", "明确制作学习清单"], ["背景具体 / 3分", "1分", "预设建议：场景描述较少，需核对原文"], ["格式要求 / 3分", "2分", "已要求按步骤及检查项呈现"]], comment: "建议补充清单的使用场景和检查标准。请教师核对背景项，不要直接采用。" };
}
export function saveTeacherDraft(score, comment) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0 || value > 10 || !comment.trim()) return { valid: false, reason: "请填写0至10分，并说明反馈或修订依据。" };
  return { valid: true, score: value, comment: comment.trim(), state: "已保存本地模拟草稿 · 未提交平台" };
}
