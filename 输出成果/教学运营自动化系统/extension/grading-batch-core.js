(() => {
  const norm = value => String(value ?? "").replace(/\s+/g, " ").trim();
  // Chrome storage may reorder object keys. Arrays and all values stay significant.
  const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const digest = value => {
    const text = typeof value === "string" ? value : canonical(value);
    let a = 2166136261, b = 5381;
    for (const c of text) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
    return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}-${text.length}`;
  };
  const states = Object.freeze({ pending: "待审核", generating: "正在生成", confirmed: "已确认", submitting: "提交中", verified: "已核验", failed: "失败", uncertain: "结果不确定", manual: "待人工复核", skipped: "已跳过" });
  async function materialDigest(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
  }
  function identityKey(identity) {
    for (const field of ["courseId", "classId", "workId", "answerId"]) if (!norm(identity?.[field])) throw new Error(`身份缺少 ${field}，不能批改。`);
    return [identity.kind, identity.courseId, identity.classId, identity.workId, identity.answerId].map(norm).join(":");
  }
  function snapshotKey(snapshot) {
    return canonical({ identity: identityKey(snapshot.identity), questions: snapshot.questions.map(q => ({ id: q.id, question: q.question, studentAnswer: q.studentAnswer, referenceAnswer: q.referenceAnswer, maxScore: q.maxScore, automatic: q.automatic, existingScore: q.automatic ? q.existingScore : undefined, attachments: q.attachments || [], unresolvedMaterials: q.unresolvedMaterials || [] })), totalMax: snapshot.totalMax });
  }
  function validateRubric(rubric, maxScore) {
    if (!Number.isFinite(maxScore) || maxScore <= 0 || !Array.isArray(rubric?.dimensions) || !rubric.dimensions.length) throw new Error("每题需确认非空评分卡和满分。");
    const names = new Set(); let sum = 0;
    for (const d of rubric.dimensions) {
      if (!norm(d.name) || names.has(norm(d.name)) || !norm(d.criteria) || !Number.isFinite(d.maxScore) || d.maxScore <= 0) throw new Error("评分卡存在空白、重复维度或无效分值。");
      names.add(norm(d.name)); sum += d.maxScore;
    }
    if (Math.abs(sum - maxScore) > 0.001) throw new Error("评分卡分项之和必须等于本题满分。");
    return true;
  }
  function validateSuggestion(suggestion, rubric, maxScore) {
    validateRubric(rubric, maxScore);
    if (!suggestion || !Number.isFinite(suggestion.score) || suggestion.score < 0 || suggestion.score > maxScore) throw new Error("建议分数超出范围或格式错误。");
    const scores = suggestion.dimensionScores;
    if (!Array.isArray(scores) || scores.length !== rubric.dimensions.length) throw new Error("建议评分缺少分项，不能提交。");
    const seen = new Set(); let sum = 0;
    for (const d of scores) {
      const rule = rubric.dimensions.find(r => norm(r.name) === norm(d.name));
      if (!rule || seen.has(norm(d.name)) || !Number.isFinite(d.score) || d.score < 0 || d.score > rule.maxScore) throw new Error("建议含重复、未知维度或越界分数。");
      seen.add(norm(d.name)); sum += d.score;
    }
    if (Math.abs(sum - suggestion.score) > 0.001) throw new Error("分项得分与建议总分不一致。");
    if (suggestion.needsReview) throw new Error("AI 标记依据不足，需教师复核后明确解除。");
    return true;
  }
  function createBatch(scope, entries) {
    if (!scope?.courseName || !scope?.className || !scope?.workTitle || !scope?.courseId || !scope?.classId || !scope?.workId || !["assignment", "chapter"].includes(scope.kind)) throw new Error("请先核验一门课程、一个班级、一份作业或测验。");
    const keys = new Set();
    const items = entries.map((entry, i) => {
      const key = identityKey(entry.identity);
      if (keys.has(key)) throw new Error("扫描出现重复提交标识，需复核列表。");
      keys.add(key);
      if (["courseId", "classId", "workId", "kind"].some(k => entry.identity[k] !== scope[k])) throw new Error("列表条目不属于本次课程与班级范围。");
      return { key, ordinal: i + 1, identity: entry.identity, reviewUrl: entry.reviewUrl, state: entry.status === "pending" ? states.pending : entry.status === "graded" ? states.skipped : states.manual, selected: false, snapshot: null, suggestions: [], approval: null, reason: entry.status === "pending" ? "" : "保留平台已有成绩或状态不明确。" };
    });
    return { id: `batch-${Date.now()}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`, scope, items, rubrics: {}, rubricVersion: 0, paused: false, cancelled: false, consent: null, scanState: "采集到", createdAt: Date.now() };
  }
  function setRubrics(batch, rubrics) {
    const pending = batch.items.find(i => i.snapshot);
    if (!pending) throw new Error("尚未读取答案。");
    for (const q of pending.snapshot.questions.filter(q => !q.automatic)) validateRubric(rubrics[q.id], q.maxScore);
    batch.rubrics = structuredClone(rubrics); batch.rubricVersion += 1; delete batch.lessonDraft;
    for (const item of batch.items) delete item.calibration;
    for (const item of batch.items) if (item.snapshot && ![states.verified, states.skipped, states.submitting, states.uncertain].includes(item.state)) { item.approval = null; item.selected = false; item.suggestions = []; delete item.originalSuggestions; item.state = item.snapshot.complete ? states.pending : states.manual; }
    batch.consent = null;
  }
  function assertSnapshot(batch, item, fresh) {
    if (identityKey(fresh.identity) !== item.key || fresh.status !== "pending") throw new Error("身份或待批状态变化，旧建议已失效。");
    if (item.snapshot && snapshotKey(item.snapshot) !== snapshotKey(fresh)) throw new Error("题目、答案或附件变化，请重新读取并审核。");
    if (!fresh.complete || !fresh.questions.length) throw new Error(fresh.reason || "答案材料或评分控件不完整。");
    for (const q of fresh.questions) {
      if (q.unresolvedMaterials?.length) throw new Error("内嵌附件原文件未获取，不能评分或提交。");
      if (!q.id || !Number.isFinite(q.maxScore) || q.maxScore <= 0) throw new Error("题目标识或满分无法确认。");
      if (q.automatic && (!Number.isFinite(q.existingScore) || q.existingScore < 0 || q.existingScore > q.maxScore)) throw new Error("客观题已有评分无法确认。");
      if (q.studentAnswer?.length > 20000 || q.question?.length > 5000 || q.referenceAnswer?.length > 10000) throw new Error("答案或题目超限，不能截断评分。");
    }
    if (new Set(fresh.questions.map(q => q.id)).size !== fresh.questions.length) throw new Error("题目标识重复。");
    if (Math.abs(fresh.questions.reduce((s, q) => s + q.maxScore, 0) - fresh.totalMax) > 0.001) throw new Error("题目满分合计与平台总分不一致。");
  }
  function reviewedTotal(batch, item) {
    if (!item.snapshot?.complete || item.snapshot.questions.some(q => q.unresolvedMaterials?.length)) throw new Error("材料读取未完成。");
    let total = 0;
    for (const q of item.snapshot.questions) {
      if (q.automatic) { total += q.existingScore; continue; }
      const s = item.suggestions.find(s => s.questionId === q.id);
      validateSuggestion(s, batch.rubrics[q.id], q.maxScore); total += s.score;
    }
    if (!Number.isFinite(total) || total > item.snapshot.totalMax) throw new Error("提交总分不合法。");
    return Math.round(total * 100) / 100;
  }
  function approvalKey(batch, item, commentEnabled) {
    return canonical({ snapshot: snapshotKey(item.snapshot), materials: item.materialKeys || {}, rubric: batch.rubrics, rubricVersion: batch.rubricVersion, suggestions: item.suggestions, commentEnabled: Boolean(commentEnabled) });
  }
  function confirmItem(batch, item, commentEnabled = false) {
    if (!batch.rubricVersion) throw new Error("评分卡尚未确认或正在修改，请重新确认。");
    if ([states.verified, states.skipped, states.submitting, states.uncertain, states.generating].includes(item.state)) throw new Error("当前状态不允许确认。");
    reviewedTotal(batch, item);
    item.approval = { key: approvalKey(batch, item, commentEnabled), commentEnabled: Boolean(commentEnabled) };
    item.state = states.confirmed; item.selected = true;
  }
  function submissionPlan(batch, item) {
    if (!batch.rubricVersion) throw new Error("评分卡尚未确认。");
    if (item.state !== states.confirmed || !item.selected || !item.approval || item.approval.key !== approvalKey(batch, item, item.approval.commentEnabled)) throw new Error("答案尚未确认或审核内容已变化。");
    const total = reviewedTotal(batch, item);
    return { identity: item.identity, snapshotKey: snapshotKey(item.snapshot), total, questions: item.snapshot.questions.filter(q => !q.automatic).map(q => { const s = item.suggestions.find(s => s.questionId === q.id); return { id: q.id, score: s.score }; }), comment: item.approval.commentEnabled ? item.suggestions.map(s => s.comment || "").filter(Boolean).join("\n").slice(0, 1000) : null };
  }
  function recover(batch) {
    for (const item of batch.items) {
      if (item.state === states.submitting) { item.state = states.uncertain; item.reason = "提交期间中断，先核验平台，不能自动重提。"; item.selected = false; }
      if (item.state === states.generating) { item.state = states.pending; item.reason = "生成期间中断，可重新生成。"; item.selected = false; }
    }
    batch.paused = true; return batch;
  }
  function summary(batch) {
    return { scope: { courseName: batch.scope.courseName, className: batch.scope.className, workTitle: batch.scope.workTitle, kind: batch.scope.kind }, at: Date.now(), counts: Object.fromEntries(Object.values(states).map(s => [s, batch.items.filter(i => i.state === s).length])), acquisitionState: batch.scanState || "未获取", remainingPending: Number.isInteger(batch.remainingPending) ? batch.remainingPending : null };
  }
  globalThis.LearningTongBatch = Object.freeze({ norm, canonical, digest, materialDigest, states, identityKey, snapshotKey, validateRubric, validateSuggestion, createBatch, setRubrics, assertSnapshot, reviewedTotal, confirmItem, submissionPlan, approvalKey, recover, summary });
})();
