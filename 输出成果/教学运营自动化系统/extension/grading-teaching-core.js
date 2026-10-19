(() => {
  const B = globalThis.LearningTongBatch;
  const exactFields = (o, keys) => {
    if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).some(k => !keys.includes(k))) throw new Error("评分卡文件含未知字段，不能导入学生数据或凭据。");
  };
  const questions = batch => batch.items.find(i => i.snapshot)?.snapshot.questions.filter(q => !q.automatic) || [];
  function templateFromBatch(batch, name, library) {
    if (!batch.rubricVersion || !questions(batch).length) throw new Error("先确认本次评分卡，再保存模板。");
    name = B.norm(name); if (!name || name.length > 60) throw new Error("请输入60字以内的模板名称。");
    const version = Math.max(0, ...library.filter(t => t.name === name).map(t => t.version)) + 1;
    const template = { name, version, questions: questions(batch).map(q => ({ maxScore: q.maxScore, reference: String(batch.references?.[q.id] || ""), rubric: structuredClone(batch.rubrics[q.id]) })) };
    validateTemplate(template); return template;
  }
  function validateTemplate(t) {
    exactFields(t, ["name", "version", "questions"]);
    if (typeof t.name !== "string" || !B.norm(t.name) || t.name.length > 60 || !Number.isSafeInteger(t.version) || t.version < 1 || !Array.isArray(t.questions) || !t.questions.length || t.questions.length > 50) throw new Error("评分卡名称、版本或题数无效。");
    for (const q of t.questions) {
      exactFields(q, ["maxScore", "reference", "rubric"]);
      if (typeof q.reference !== "string" || q.reference.length > 10000) throw new Error("参考答案为空字段或超限。");
      exactFields(q.rubric, ["dimensions"]);
      for (const d of q.rubric.dimensions || []) {
        exactFields(d, ["name", "maxScore", "criteria"]);
        if (typeof d.name !== "string" || d.name.length > 100 || typeof d.criteria !== "string" || d.criteria.length > 3000) throw new Error("评分维度名称或标准超限。");
      }
      B.validateRubric(q.rubric, q.maxScore);
    }
    if (JSON.stringify(t).length > 100000) throw new Error("单个评分卡超过100KB，请简化标准。");
    return true;
  }
  function appendTemplates(library, incoming) {
    const result = structuredClone(library);
    for (const t of incoming) { validateTemplate(t); const copied = structuredClone(t); copied.version = Math.max(0, ...result.filter(v => v.name === t.name).map(v => v.version)) + 1; result.push(copied); }
    if (result.length > 100 || JSON.stringify(result).length > 500000) throw new Error("评分卡库超过100个版本或500KB，请先导出并移除不再使用的版本。");
    return result;
  }
  function importLibrary(raw) {
    if (typeof raw !== "string" || raw.length > 500000) throw new Error("请选择500KB以内的评分卡库JSON。");
    const data = JSON.parse(raw); exactFields(data, ["format", "templates"]);
    if (data.format !== "learningtong-rubrics-v1" || !Array.isArray(data.templates) || data.templates.length > 100) throw new Error("评分卡库格式无效。");
    data.templates.forEach(validateTemplate); return data.templates;
  }
  function exportLibrary(library) { library.forEach(validateTemplate); return JSON.stringify({ format: "learningtong-rubrics-v1", templates: library }, null, 2); }
  function mapTemplate(batch, template) {
    validateTemplate(template); const qs = questions(batch);
    if (qs.length !== template.questions.length || qs.some((q, n) => Math.abs(q.maxScore - template.questions[n].maxScore) > .001)) throw new Error("模板题数或满分与当前任务不一致，不自动缩放或匹配。");
    return { rubrics: Object.fromEntries(qs.map((q, n) => [q.id, structuredClone(template.questions[n].rubric)])), references: Object.fromEntries(qs.map((q, n) => [q.id, template.questions[n].reference])) };
  }
  function binding(batch, item) {
    return JSON.stringify({ snapshot: B.snapshotKey(item.snapshot), rubric: batch.rubrics, references: batch.references, version: batch.rubricVersion, materials: item.materialKeys || {}, ai: item.originalSuggestions, teacher: item.suggestions });
  }
  function recordCalibration(batch, item) {
    if (!batch.rubricVersion || !item.snapshot || [B.states.skipped, B.states.submitting, B.states.uncertain, B.states.generating, B.states.verified].includes(item.state)) throw new Error("请先生成可审核样本，再输入教师评分。");
    if (!Array.isArray(item.originalSuggestions)) throw new Error("本份没有保留原始AI建议，请重新生成校准样本。");
    B.reviewedTotal(batch, item); let teacher = 0, ai = 0, maxScore = 0;
    for (const q of item.snapshot.questions.filter(q => !q.automatic)) {
      const original = item.originalSuggestions.find(s => s.questionId === q.id);
      B.validateSuggestion({ ...original, needsReview: false }, batch.rubrics[q.id], q.maxScore);
      teacher += item.suggestions.find(s => s.questionId === q.id).score; ai += original.score; maxScore += q.maxScore;
    }
    if (!maxScore) throw new Error("没有可校准的主观题。");
    // Calibration is explicitly separate from authorizing platform submission.
    item.approval = null; item.selected = false; item.state = B.states.pending;
    item.calibration = { key: binding(batch, item), teacher, ai, maxScore };
    return item.calibration;
  }
  function calibrationReport(batch) {
    const samples = batch.items.filter(i => i.calibration && i.snapshot && batch.rubricVersion && i.calibration.key === binding(batch, i)).map(i => i.calibration);
    const differences = samples.map(s => (s.teacher - s.ai) / s.maxScore * 100);
    const bias = differences.length ? differences.reduce((a, b) => a + b, 0) / differences.length : null;
    const absolute = differences.length ? differences.reduce((a, b) => a + Math.abs(b), 0) / differences.length : null;
    return { count: samples.length, bias, absolute, direction: bias === null ? "尚无有效校准样本" : Math.abs(bias) < 1 ? "样本中教师与AI平均分接近" : bias > 0 ? "样本中AI评分偏严" : "样本中AI评分偏松" };
  }
  const reviewedItems = batch => batch.items.filter(i => [B.states.confirmed, B.states.verified].includes(i.state) && i.snapshot && i.approval && batch.rubricVersion && i.approval.key === B.approvalKey(batch, i, i.approval.commentEnabled));
  const lectureKey = batch => JSON.stringify(reviewedItems(batch).map(i => [i.key, i.approval.key]));
  function lecturePlan(batch) {
    const reviewed = reviewedItems(batch);
    if (!reviewed.length) throw new Error("请先审核确认至少一份完整答案；未审核或过期建议不用于讲评。");
    const groups = new Map();
    for (const item of reviewed) {
      B.reviewedTotal(batch, item);
      item.snapshot.questions.filter(q => !q.automatic).forEach((q, n) => {
        const suggestion = item.suggestions.find(s => s.questionId === q.id);
        for (const d of batch.rubrics[q.id].dimensions) {
          const key = JSON.stringify([n, d.name, d.maxScore, d.criteria]);
          if (!groups.has(key)) groups.set(key, { question: n + 1, name: d.name, criteria: d.criteria, count: 0, seen: 0 });
          const group = groups.get(key); group.seen++;
          if (suggestion.dimensionScores.find(s => B.norm(s.name) === B.norm(d.name)).score < d.maxScore - .001) group.count++;
        }
      });
    }
    const ranked = [...groups.values()].filter(g => g.count).sort((a, b) => b.count - a.count);
    const text = ["# 本次作业讲评提纲（教师审核稿）", "", `依据：${reviewed.length}份已审核答案；其余${batch.items.length - reviewed.length}份未纳入。仅代表当前审核样本，不代表全班或全部题目。`, "仅统计主观题扣分；客观题评分保留且不纳入。没有发送新AI请求，也未摘录学生身份、作答或附件。", "", "## 扣分集中项与讲解重点", "扣分分项是复核线索，不能直接认定学生存在某种概念错误。请教师结合材料确认错因。"];
    if (!ranked.length) text.push("当前审核样本的主观题分项均未扣分；没有依据生成共性错误结论。");
    for (const g of ranked) text.push(`- 主观题${g.question} · ${g.name}：${g.count}/${g.seen}份在此分项扣分${g.count === 1 ? "（单例，不能称共性错误）" : ""}。讲解依据：${g.criteria}`);
    text.push("", "## 合成示例与补练建议（不是学生原文）");
    ranked.slice(0, 5).forEach(g => text.push(`- 主观题${g.question} · ${g.name}：教师先编写一份遗漏该标准的示例和一份符合标准的示例，组织学生对照“${g.criteria}”找出差异；学生补写或修正，并按评分卡自检。`));
    if (!ranked.length) text.push("按当前评分卡增加一个条件变化的迁移练习，人工检查是否仍能完整满足标准。");
    text.push("", "## 课堂检查与教师补充", "先说明标准 → 对照合成示例 → 独立修正 → 同伴检查 → 教师抽查。", "请补充经核实的错因、教师自编匿名示例及本课时间安排，检查后再用于课堂；不自动发布到学习通。");
    return text.join("\n");
  }
  globalThis.LearningTongTeaching = Object.freeze({ templateFromBatch, validateTemplate, appendTemplates, importLibrary, exportLibrary, mapTemplate, recordCalibration, calibrationReport, lecturePlan, lectureKey });
})();
