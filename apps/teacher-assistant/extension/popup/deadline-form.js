(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function buildRequest(profile = {}, className, title, dateTimeLocal) {
    const courseName = normalize(profile.courseName || profile.name);
    if (!courseName) return { ok: false, reason: "请先选择并保存课程。" };
    const classNames = Array.isArray(profile.classNames) ? profile.classNames.map(normalize).filter(Boolean) : [];
    const selectedClass = normalize(className);
    if (!selectedClass || !classNames.includes(selectedClass)) return { ok: false, reason: "请从当前课程的班级白名单中选择一个班级。" };
    const assignmentTitle = normalize(title);
    if (!assignmentTitle) return { ok: false, reason: "请填写完整作业标题。" };
    const candidate = normalize(dateTimeLocal).replace("T", " ");
    const nextEndTime = globalThis.LearningTongDeadlineUpdate?.validDateTime(candidate);
    if (!nextEndTime) return { ok: false, reason: "请选择完整的新截止日期和时间。" };
    return { ok: true, courseName, className: selectedClass, title: assignmentTitle, nextEndTime };
  }

  globalThis.LearningTongDeadlineForm = Object.freeze({ buildRequest });
})();
