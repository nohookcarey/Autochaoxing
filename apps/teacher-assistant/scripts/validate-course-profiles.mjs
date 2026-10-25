import { CourseProfileError, loadCourseProfiles } from "../server/course-profiles.mjs";

try {
  const profiles = loadCourseProfiles(process.argv[2]);
  console.log(`本机课程连接配置校验通过：${profiles.length} 门课程。未连接学习通，也未读取任何平台数据。`);
} catch (error) {
  console.error(`配置未通过：${error instanceof CourseProfileError ? error.message : "无法读取配置。"}`);
  process.exitCode = 1;
}
