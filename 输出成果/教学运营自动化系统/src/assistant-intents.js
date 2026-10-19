const intents = [
  {
    key: "scan",
    matches: [/待批/, /扫描.*作业|作业.*扫描/, /哪些作业.*处理/],
    taskLabel: "扫描待批作业",
    reply: "我会先核验当前课程、班级白名单、教师端登录和作业页面入口；通过后才进行只读扫描。",
  },
  {
    key: "course-management",
    matches: [/课程管理/, /添加课程/, /切换课程/, /班级白名单/],
    taskLabel: "课程管理",
    navigateTo: "课程管理",
    reply: "我会打开课程管理，您可以先确认课程、班级范围和启用的教学任务。",
  },
];

export function resolveAssistantIntent(input) {
  const text = String(input || "").trim();
  const intent = intents.find((item) => item.matches.some((pattern) => pattern.test(text)));
  if (!intent) {
    return {
      key: "unknown",
      taskLabel: "澄清任务",
      reply: "当前只接入了“扫描待批作业”的只读前核验。您也可以说“课程管理”来维护本机课程和班级范围。",
    };
  }
  return intent;
}
