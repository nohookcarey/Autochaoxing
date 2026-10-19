import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const forbiddenKeys = /password|passwd|cookie|token|secret|credential/i;
const numericValue = (value) => typeof value === "string" && /^\d+$/.test(value.trim());

export class CourseProfileError extends Error {}

export function getCourseProfilesPath(relativePath = process.env.COURSE_CONFIG_PATH ?? "config/course-connections.local.json") {
  const root = resolve(process.cwd());
  const profilePath = resolve(root, relativePath);
  if (relative(root, profilePath).startsWith("..")) throw new CourseProfileError("课程连接配置必须保存在本机系统目录中。");
  return profilePath;
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

export function validateCourseProfiles(config) {
  const profiles = config?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) throw new CourseProfileError("profiles 至少需要一条课程连接配置。");
  const keys = new Set();
  for (const profile of profiles) {
    const sensitiveKey = containsForbiddenKey(profile);
    if (sensitiveKey) throw new CourseProfileError(`不允许保存敏感字段：${sensitiveKey}`);
    if (!/^[a-z0-9-]+$/i.test(profile.courseKey ?? "")) throw new CourseProfileError("courseKey 只能使用字母、数字和连字符。");
    if (keys.has(profile.courseKey)) throw new CourseProfileError(`courseKey 重复：${profile.courseKey}`);
    keys.add(profile.courseKey);
    if (!String(profile.courseName || "").trim()) throw new CourseProfileError(`${profile.courseKey} 缺少课程名称。`);
    if (!numericValue(profile.courseId)) throw new CourseProfileError(`${profile.courseKey} 缺少纯数字 courseId。`);
    if (!numericValue(profile.cpi)) throw new CourseProfileError(`${profile.courseKey} 缺少纯数字 cpi。`);
    if (!Array.isArray(profile.classNames) || profile.classNames.length === 0 || profile.classNames.some((name) => !String(name).trim())) throw new CourseProfileError(`${profile.courseKey} 缺少班级白名单。`);
    if (!Array.isArray(profile.enabledModules) || profile.enabledModules.length === 0) throw new CourseProfileError(`${profile.courseKey} 缺少启用任务。`);
    if (!profile.entryPoints?.assignment) throw new CourseProfileError(`${profile.courseKey} 缺少作业页面入口说明。`);
  }
  return profiles;
}

export function loadCourseProfiles(relativePath = process.env.COURSE_CONFIG_PATH ?? "config/course-connections.local.json") {
  const profilePath = getCourseProfilesPath(relativePath);
  if (!existsSync(profilePath)) throw new CourseProfileError("未找到本机课程连接配置。请从示例文件创建 course-connections.local.json。");
  let config;
  try {
    config = JSON.parse(readFileSync(profilePath, "utf8"));
  } catch {
    throw new CourseProfileError("本机课程连接配置不是有效 JSON。");
  }
  return validateCourseProfiles(config);
}

export function saveCourseProfiles(config, relativePath = process.env.COURSE_CONFIG_PATH ?? "config/course-connections.local.json") {
  const profiles = validateCourseProfiles(config);
  const profilePath = getCourseProfilesPath(relativePath);
  const temporaryPath = `${profilePath}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(profilePath), { recursive: true });
    writeFileSync(temporaryPath, `${JSON.stringify({ profiles }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, profilePath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return profiles;
}
