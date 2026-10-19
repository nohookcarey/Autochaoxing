export const acquisitionStates = {
  pending: { label: "未获取", description: "尚未访问目标页面，不能据此判断是否有待处理事项。" },
  login: { label: "需人工登录", description: "请教师在可见浏览器完成登录或安全验证；系统不会绕过登录或验证码。" },
  verify: { label: "待页面核验", description: "将只读确认课程、班级白名单和目标页面入口。" },
  ready: { label: "可只读采集", description: "本轮课程范围和页面入口已确认，可以扫描待处理事项。" },
  empty: { label: "确认无数据", description: "已完成只读采集并确认当前范围内没有待处理事项。" },
  drift: { label: "页面结构变化", description: "页面入口或结构与已知规则不一致，需要人工复核。" },
};

export function buildAssignmentPreflight(course) {
  const connectionReady = course.connection === "已核验";
  return {
    taskName: "扫描待批作业",
    courseName: course.name,
    classNames: course.classNames,
    state: connectionReady ? "ready" : "login",
    steps: [
      { label: "课程与班级范围", done: Boolean(course.name && course.classNames.length), detail: course.classNames.join("、") || "尚未设置班级" },
      { label: "教师端登录与安全验证", done: false, detail: "由教师在可见浏览器完成" },
      { label: "作业页面入口", done: connectionReady, detail: connectionReady ? "已核验，可只读扫描" : "等待本轮只读核验" },
    ],
  };
}

export function buildRunRecord(preflight, { state = preflight.state, detail = "" } = {}) {
  return {
    id: `${Date.now()}`,
    taskName: preflight.taskName,
    courseName: preflight.courseName,
    classNames: preflight.classNames,
    state: acquisitionStates[state].label,
    detail,
    createdAt: new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date()),
  };
}
