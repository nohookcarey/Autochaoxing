(() => {
  // Only teacher-authored inputs. No page access, AI requests or storage.
  const fields = ["title", "objective", "deliverable", "naming", "submission", "deadline", "materials", "steps", "checkpoints", "requirements", "total", "dimensions"];
  const labels = { title: "任务名称", objective: "学习目标", deliverable: "交付物", naming: "文件命名", submission: "提交方式", deadline: "截止安排", materials: "材料与工具", steps: "操作步骤", checkpoints: "自检检查点", requirements: "任务要求", total: "任务总分", dimensions: "评分分项" };
  const targetName = key => labels[key] || (/^requirement-\d+$/.test(key) ? `要求${Number(key.split("-")[1]) + 1}` : /^dimension-\d+$/.test(key) ? `分项${Number(key.split("-")[1]) + 1}` : "教师资料");
  function exact(o, keys) {
    if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).some(k => !keys.includes(k))) throw new Error("任务资料含未知字段，请只填写教师任务要求与评分标准。");
  }
  function text(value, limit, label) {
    if (typeof value !== "string" || value.length > limit) throw new Error(`${label}须为${limit}字以内的文字，超限材料不会截断。`);
    return value.trim();
  }
  function normalize(input) {
    exact(input, fields);
    const data = {};
    for (const k of fields.slice(0, 9)) data[k] = text(input[k], k === "title" ? 120 : 6000, targetName(k));
    for (const [key, limit] of [["requirements", 30], ["dimensions", 30]]) {
      if (!Array.isArray(input[key]) || input[key].length > limit) throw new Error(`要求和评分分项各最多${limit}项。`);
    }
    data.requirements = input.requirements.map(r => { exact(r, ["text", "graded"]); if (typeof r.graded !== "boolean") throw new Error("请明确要求是否计分。"); return { text: text(r.text, 2000, "要求"), graded: r.graded }; });
    data.total = input.total;
    data.dimensions = input.dimensions.map(d => {
      exact(d, ["name", "maxScore", "criteria", "requirements"]);
      if (!Array.isArray(d.requirements) || d.requirements.length > 30) throw new Error("请填写要求序号列表。");
      return { name: text(d.name, 100, "分项名称"), maxScore: d.maxScore, criteria: text(d.criteria, 3000, "评分依据"), requirements: [...d.requirements] };
    });
    return data;
  }
  const positiveScore = value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10000;
  function analyze(input) {
    const data = normalize(input), issues = [];
    const add = (level, code, message, target) => issues.push({ level, code, message, target });
    for (const [key, name] of [["title", "任务名称"], ["objective", "学习目标"], ["deliverable", "交付物与格式"], ["submission", "提交方式"]]) if (!data[key]) add("block", "missing", `请补充${name}。`, key);
    for (const [key, name] of [["naming", "文件命名"], ["deadline", "截止安排"], ["materials", "材料与工具"], ["steps", "操作步骤"], ["checkpoints", "自检检查点"]]) if (!data[key]) add("warning", "optional", `${name}未填写，请确认是否需要；不会代拟。`, key);
    if (!positiveScore(data.total)) add("block", "total", "总分须为大于0且不超过10000的有限数字。", "total");
    if (!data.requirements.length) add("block", "requirements", "请至少填写一条学生任务要求。", "requirements");
    const requirementNames = new Set(), dimensionNames = new Set(), mapped = new Set();
    data.requirements.forEach((r, n) => {
      if (!r.text) add("block", "empty-requirement", `要求${n + 1}未填写内容。`, `requirement-${n}`);
      const name = r.text.replace(/\s+/g, " ");
      if (name && requirementNames.has(name)) add("block", "duplicate-requirement", `要求${n + 1}与其他要求重复，请合并或写明区别。`, `requirement-${n}`);
      requirementNames.add(name);
    });
    if (!data.dimensions.length) add("block", "dimensions", "请至少填写一条评分分项。", "dimensions");
    let sum = 0;
    data.dimensions.forEach((d, n) => {
      const target = `dimension-${n}`, name = d.name.replace(/\s+/g, " ");
      if (!name || !d.criteria) add("block", "incomplete-dimension", `分项${n + 1}缺少名称或评分依据。`, target);
      if (name && dimensionNames.has(name)) add("block", "duplicate-dimension", `分项${n + 1}名称重复。`, target);
      dimensionNames.add(name);
      if (!positiveScore(d.maxScore)) add("block", "score", `分项${n + 1}分值无效。`, target); else sum += d.maxScore;
      if (!d.requirements.length) add("block", "unmapped-dimension", `分项${n + 1}没有对应任务要求，可能出现未告知的计分项。`, target);
      const seen = new Set();
      for (const id of d.requirements) {
        if (!Number.isSafeInteger(id) || id < 1 || id > data.requirements.length) add("block", "invalid-mapping", `分项${n + 1}的要求序号无效。`, target);
        else if (seen.has(id)) add("block", "duplicate-mapping", `分项${n + 1}重复关联要求${id}。`, target);
        else { seen.add(id); if (!data.requirements[id - 1].graded) add("block", "ungraded-mapping", `要求${id}标为不计分，却被分项${n + 1}计分。`, target); else mapped.add(id); }
      }
    });
    if (positiveScore(data.total) && Math.abs(sum - data.total) > .001) add("block", "sum", `分项合计${Number(sum.toFixed(3))}分，与总分${data.total}分不一致。`, "total");
    data.requirements.forEach((r, n) => { if (r.graded && !mapped.has(n + 1)) add("block", "unmapped-requirement", `计分要求${n + 1}没有对应评分分项；请补充关联或明确改为不计分。`, `requirement-${n}`); });
    for (const [target, value] of [...fields.slice(0, 9).map(k => [k, data[k]]), ...data.requirements.map((r, n) => [`requirement-${n}`, r.text]), ...data.dimensions.map((d, n) => [`dimension-${n}`, d.criteria])]) {
      if (/(适当|若干|尽量|酌情|较好|高质量|自行发挥)/.test(value)) add("warning", "vague", "发现可能含糊的词，请人工核对是否有可观察的标准；这只是关键词提示。", target);
      if (/(待补充|待填写|待定|【教师填写)/.test(value)) add("warning", "placeholder", "发现待填写或待定内容，请补充或明确不适用后再用于教学。", target);
    }
    return { data, issues, sum: Number(sum.toFixed(3)), blocked: issues.some(i => i.level === "block"), boundary: "只核对必备字段、分值和教师明确关联；不判断专业内容正确性、截止时间合理性或语义是否一致。" };
  }
  const key = input => JSON.stringify(normalize(input));
  function draft(input) {
    const result = analyze(input), d = result.data;
    if (result.blocked) throw new Error("先修正阻止生成的问题，再生成任务说明。");
    const lines = [`# ${d.title}`, "", "教师任务说明审核稿：请核对内容、工具、时间及评分要求后自行发布。", "", "## 本次任务", d.objective, "", "## 任务要求"];
    d.requirements.forEach((r, n) => lines.push(`${n + 1}. ${r.text}（${r.graded ? "计分" : "不计分"}）`));
    for (const [heading, value] of [["材料与工具", d.materials], ["操作步骤", d.steps], ["交付物与格式", d.deliverable], ["文件命名", d.naming], ["提交方式", d.submission], ["截止安排", d.deadline], ["自检检查点", d.checkpoints]]) lines.push("", `## ${heading}`, value || "【教师待补充或确认不适用】");
    lines.push("", `## 评分标准（总分${d.total}分）`);
    d.dimensions.forEach((r, n) => lines.push(`${n + 1}. ${r.name} · ${r.maxScore}分 · 对应要求${r.requirements.join("、")}：${r.criteria}`));
    lines.push("", "## 教师发布前核对", result.boundary);
    result.issues.filter(i => i.level === "warning").forEach(i => lines.push(`- 待核对（${targetName(i.target)}）：${i.message}`));
    const content = lines.join("\n"); text(content, 100000, "审核稿"); return content;
  }
  function approvalKey(input, content) { text(content, 100000, "审核稿"); if (!content.trim()) throw new Error("审核稿为空。"); return JSON.stringify([key(input), content]); }
  function approvedDraft(input, content, approval) {
    if (analyze(input).blocked) throw new Error("当前要求或分值仍有阻止生成的问题。");
    if (!approval || approval !== approvalKey(input, content)) throw new Error("资料或草稿变化，请重新检查、生成并确认审核稿。");
    return content;
  }
  const escape = value => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function html(content) {
    text(content, 100000, "审核稿");
    const body = content.split("\n").map(line => {
      const heading = line.match(/^(#{1,3}) (.*)$/); if (heading) return `<h${heading[1].length}>${escape(heading[2])}</h${heading[1].length}>`;
      if (!line) return ""; return `<p>${escape(line)}</p>`;
    }).join("\n");
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>学生任务说明 · 教师审核稿</title><style>body{max-width:880px;margin:32px auto;padding:0 24px;color:#253849;font:16px/1.8 system-ui,sans-serif}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}h1{font-size:28px}h2{font-size:20px;border-bottom:1px solid #dce5eb;padding-bottom:8px;margin-top:28px;break-after:avoid}h3{font-size:18px;break-after:avoid}@media print{body{margin:0;max-width:none}}</style><body>${body}</body></html>`;
  }
  function example() {
    return { title: "练习：制作一份活动海报（模拟）", objective: "完成一份信息完整的活动海报，并说明两次修改的理由。", deliverable: "一张PNG海报和一份PDF过程说明。", naming: "练习编号_小组编号_成果类型；不在示例中填写真实身份。", submission: "教师确认的学习通任务附件区。此处仅为示例，需核实实际入口。", deadline: "【教师填写实际截止时间】", materials: "教师提供的活动简报；使用已获授权的图片素材。", steps: "1. 整理活动信息\n2. 起草布局方案\n3. 制作并修改海报\n4. 对照要求核对并导出", checkpoints: "活动信息齐全；正文可读；两次修改有记录；附件可正常打开。", requirements: [{ text: "海报包含活动名称、地点、时间及参与方式。", graded: true }, { text: "记录两次修改，逐次说明依据和结果。", graded: true }, { text: "按约定格式和命名上传文件。", graded: false }], total: 100, dimensions: [{ name: "信息完整", maxScore: 60, criteria: "四类信息各15分；缺少哪类即该类不得分。", requirements: [1] }, { name: "修改说明", maxScore: 40, criteria: "每次修改的依据和结果各10分，共两次。", requirements: [2] }] };
  }
  globalThis.LearningTongTaskDesign = Object.freeze({ normalize, analyze, key, draft, approvalKey, approvedDraft, html, example, targetName });
})();
