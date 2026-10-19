import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const forbiddenKeys = /password|passwd|cookie|token|secret|credential|courseId|cpi|entryPoint|url|link/i;
const allowedStates = new Set(["未获取", "已核验"]);

export class CourseImportError extends Error {}

export function getCourseImportsPath(relativePath = process.env.COURSE_IMPORTS_PATH ?? "config/course-imports.local.json") {
  const root = resolve(process.cwd());
  const importPath = resolve(root, relativePath);
  if (relative(root, importPath).startsWith("..")) throw new CourseImportError("课程导入档案必须保存在本机系统目录中。");
  return importPath;
}

function containsForbiddenKey(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) return key;
    const nested = containsForbiddenKey(child);
    if (nested) return nested;
  }
  return undefined;
}

export function validateCourseImports(config) {
  const imports = config?.imports;
  if (!Array.isArray(imports) || imports.length === 0) throw new CourseImportError("imports 至少需要一条课程档案。");
  const keys = new Set();
  for (const item of imports) {
    const sensitiveKey = containsForbiddenKey(item);
    if (sensitiveKey) throw new CourseImportError(`课程档案不允许保存连接或敏感字段：${sensitiveKey}`);
    if (!/^[a-z0-9-]+$/i.test(item.courseKey ?? "")) throw new CourseImportError("courseKey 只能使用字母、数字和连字符。");
    if (keys.has(item.courseKey)) throw new CourseImportError(`courseKey 重复：${item.courseKey}`);
    keys.add(item.courseKey);
    if (!String(item.courseName || "").trim()) throw new CourseImportError(`${item.courseKey} 缺少课程名称。`);
    if (!Array.isArray(item.enabledModules) || item.enabledModules.length === 0) throw new CourseImportError(`${item.courseKey} 缺少启用任务。`);
    if (!allowedStates.has(item.acquisitionState)) throw new CourseImportError(`${item.courseKey} 的导入状态无效。`);
    if (!String(item.reason || "").trim()) throw new CourseImportError(`${item.courseKey} 缺少导入说明。`);
  }
  return imports;
}

export function loadCourseImports(relativePath = process.env.COURSE_IMPORTS_PATH ?? "config/course-imports.local.json") {
  const importPath = getCourseImportsPath(relativePath);
  if (!existsSync(importPath)) throw new CourseImportError("未找到本机课程导入档案。");
  let config;
  try { config = JSON.parse(readFileSync(importPath, "utf8")); }
  catch { throw new CourseImportError("本机课程导入档案不是有效 JSON。"); }
  return validateCourseImports(config);
}
