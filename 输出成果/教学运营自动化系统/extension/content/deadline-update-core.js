(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function validDateTime(value) {
    const match = normalize(value).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return "";
    const [, year, month, day, hour, minute, second = "00"] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)
      || date.getHours() !== Number(hour) || date.getMinutes() !== Number(minute) || date.getSeconds() !== Number(second)) return "";
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  function parseCommand(text, profile = {}) {
    const source = normalize(text);
    if (!/(修改|改为|改到|延期|延长)/.test(source) || !/截止/.test(source)) return undefined;
    const dateText = source.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?/)?.[0] || "";
    const nextEndTime = validDateTime(dateText);
    if (!nextEndTime) return { ok: false, reason: "请使用完整时间，例如：2026-09-01 20:00。" };
    const classNames = Array.isArray(profile.classNames) ? profile.classNames.map(normalize).filter(Boolean) : [];
    const classMatches = classNames.filter((name) => source.includes(name));
    if (classMatches.length !== 1) return { ok: false, reason: "请在指令中写明一个班级白名单中的完整班级名称。" };
    const quotedTitle = source.match(/[《“\"]([^》”\"]+)[》”\"]/)?.[1];
    if (!quotedTitle) return { ok: false, reason: "请用书名号标出作业标题，例如：《单元作业》。" };
    const title = normalize(quotedTitle);
    if (!title) return { ok: false, reason: "作业标题不能为空。" };
    return { ok: true, courseName: normalize(profile.courseName || profile.name), className: classMatches[0], title, nextEndTime };
  }

  function findUniqueTarget(rows = [], request = {}) {
    const title = normalize(request.title);
    const className = normalize(request.className);
    const matches = rows.filter((row) => normalize(row.title) === title && normalize(row.text).includes(className) && normalize(row.modifyId));
    if (!matches.length) return { ok: false, reason: `未找到“${className}｜${title}”的可修改作业。` };
    if (matches.length > 1) return { ok: false, reason: `找到 ${matches.length} 条同名作业，无法唯一定位，已停止。` };
    return { ok: true, target: matches[0] };
  }

  function deadlineDisplayMatches(deadlineText, nextEndTime) {
    const expected = validDateTime(nextEndTime);
    if (!expected) return false;
    const [, month, day, hour, minute] = expected.match(/^\d{4}-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    return normalize(deadlineText).includes(`${month}-${day} ${hour}:${minute}`);
  }

  globalThis.LearningTongDeadlineUpdate = { normalize, validDateTime, parseCommand, findUniqueTarget, deadlineDisplayMatches };
})();
