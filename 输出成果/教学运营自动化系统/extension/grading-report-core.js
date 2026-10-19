(() => {
  const B = globalThis.LearningTongBatch, F = globalThis.LearningTongFollowup;
  const definitions = Object.freeze({
    uncertain: ["结果不确定", "先独立核对平台已提交结果，禁止盲目重新提交。"],
    submitting: ["正在提交与回读", "等待当前提交与独立回读结束；中断后先核验。"],
    failed: ["失败待核对", "检查权限、连接及材料，先核对平台结果，再决定读取或重新生成。"],
    manual: ["需人工复核", "对照原页面与材料核对；读取失败不能当作没有待批。"],
    stale: ["审核或统计依据失效", "重新核对范围、答案、评分卡和分项；已核验项不得因此重提。"],
    unread: ["答案未完整读取", "重新读取当前答案及附件，完整核验后再生成或审核。"],
    standards: ["评分卡待确认", "核对每题分项、参考答案与满分后确认本次评分卡。"],
    generating: ["建议正在生成", "等待当前请求结束；需要时使用现有暂停或取消按钮。"],
    flagged: ["建议有不确定处", "教师对照材料查证，不将不确定建议用于提交。"],
    generate: ["待生成建议", "确认材料发送范围，再使用现有生成入口。"],
    review: ["建议待教师审核", "对照答案与依据审核分项，再明确确认；不会自动选中。"],
    selected: ["已确认并选中，待提交", "核对最终提交清单，再通过现有确认入口提交。"],
    unselected: ["已确认但未选中", "自行决定是否选中；本清单不会替教师选择或提交。"],
    unknown: ["状态需核对", "回到当前答案核对状态，不能据此认定提交成功。"],
  });
  const round = n => Math.round(n * 100) / 100;
  function scoreOf(batch, item) {
    if (!batch.rubricVersion || !item.approval || item.approval.key !== B.approvalKey(batch, item, item.approval.commentEnabled)) throw new Error("审核依据已变化。");
    if (B.identityKey(item.identity) !== item.key || ["kind", "courseId", "classId", "workId"].some(k => item.identity[k] !== batch.scope[k])) throw new Error("身份范围已变化。");
    B.assertSnapshot(batch, item, item.snapshot);
    const subjective = item.snapshot.questions.filter(q => !q.automatic);
    if (item.suggestions.length !== subjective.length || new Set(item.suggestions.map(s => s.questionId)).size !== subjective.length || item.suggestions.some(s => !subjective.some(q => q.id === s.questionId))) throw new Error("建议题目缺失或重复。");
    const total = B.reviewedTotal(batch, item), max = item.snapshot.totalMax;
    if (!Number.isFinite(max) || max <= 0 || total < 0 || total > max) throw new Error("总分无效。");
    return total / max * 100;
  }
  function distribution(values) {
    const sorted = [...values].sort((a, b) => a - b), count = sorted.length;
    const bands = ["低于60%", "60%至不足70%", "70%至不足80%", "80%至不足90%", "90%至100%"].map(label => ({ label, count: 0 }));
    for (const v of values) bands[v < 60 ? 0 : v < 70 ? 1 : v < 80 ? 2 : v < 90 ? 3 : 4].count++;
    return { count, mean: count ? round(values.reduce((a, b) => a + b, 0) / count) : null, median: count ? round(count % 2 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2) : null, min: count ? round(sorted[0]) : null, max: count ? round(sorted.at(-1)) : null, bands };
  }
  function analyze(batch) {
    if (!batch?.scope || !Array.isArray(batch.items) || batch.items.length > 5000) throw new Error("尚未获取批次，或批次数量超限。");
    if (!["assignment", "chapter"].includes(batch.scope.kind) || ["courseId", "classId", "workId", "courseName", "className", "workTitle"].some(k => !B.norm(batch.scope[k]))) throw new Error("批次课程、班级与任务范围不完整。");
    const keys = new Set();
    for (const item of batch.items) { if (!item.key || keys.has(item.key)) throw new Error("批次条目标识缺失或重复，不能统计。"); keys.add(item.key); }
    const counts = Object.fromEntries([...Object.values(B.states), "状态未知"].map(s => [s, 0]));
    const groups = { confirmed: [], verified: [] }, issues = [], excluded = { confirmed: 0, verified: 0 };
    for (const [index, item] of batch.items.entries()) {
      counts[Object.values(B.states).includes(item.state) ? item.state : "状态未知"]++;
      let category;
      if ([B.states.confirmed, B.states.verified].includes(item.state)) {
        const group = item.state === B.states.verified ? "verified" : "confirmed";
        try { groups[group].push(scoreOf(batch, item)); } catch { excluded[group]++; category = "stale"; }
        if (!category && item.state === B.states.confirmed) category = item.selected ? "selected" : "unselected";
      } else if (item.state === B.states.skipped) continue;
      else if (item.state === B.states.uncertain) category = "uncertain";
      else if (item.state === B.states.submitting) category = "submitting";
      else if (item.state === B.states.failed) category = "failed";
      else if (item.state === B.states.manual) category = "manual";
      else if (item.state === B.states.generating) category = "generating";
      else if (item.state !== B.states.pending) category = "unknown";
      else if (!item.snapshot?.complete) category = "unread";
      else if (!batch.rubricVersion) category = "standards";
      else if (item.suggestions?.some(s => s.needsReview)) category = "flagged";
      else if (!item.suggestions?.length) category = "generate";
      else category = "review";
      if (category) issues.push({ index, ordinal: index + 1, category, title: definitions[category][0], action: definitions[category][1] });
    }
    const remaining = Number.isInteger(batch.remainingPending) && batch.remainingPending >= 0 && Number.isFinite(batch.lastRescanAt) && batch.lastRescanAt >= batch.createdAt && batch.lastRescanAt <= Date.now() && ["采集到", "确认无数据"].includes(batch.scanState) && !(batch.scanState === "确认无数据" && batch.remainingPending !== 0) ? batch.remainingPending : null;
    return { demo: Boolean(batch.demo), kind: batch.scope.kind === "chapter" ? "章节测试" : "普通作业", total: batch.items.length, state: ["采集到", "确认无数据", "未获取"].includes(batch.scanState) ? batch.scanState : "未获取", counts, stats: { confirmed: distribution(groups.confirmed), verified: distribution(groups.verified) }, excluded, issues, issueCounts: Object.entries(definitions).map(([category, [title, action]]) => ({ category, title, action, count: issues.filter(i => i.category === category).length })).filter(i => i.count), remaining, lastRescanAt: remaining === null ? null : batch.lastRescanAt };
  }
  // Local consent binding only; the digest and source contents never enter exports.
  function basisKey(batch) {
    if (!batch) return "";
    return B.digest({ scope: batch.scope, version: batch.rubricVersion, rubrics: batch.rubrics, references: batch.references, scan: batch.scanState, remaining: batch.remainingPending, rescan: batch.lastRescanAt, items: batch.items.map(i => ({ key: i.key, state: i.state, selected: i.selected, snapshot: i.snapshot, materials: i.materialKeys, approval: i.approval, suggestions: i.suggestions })) });
  }
  function markdown(report, at) {
    if (!Number.isFinite(at)) throw new Error("报告时间无效。");
    const lines = ["# 教师批改工作报告（脱敏汇总）", "", report.demo ? "【脱敏模拟：不是实际教学或平台提交结果】" : "【当前浏览器会话汇总：平台状态须以独立回读与复扫为准】", `生成时间：${F.displayTime(at)}（北京时间）`, `任务类型：${report.kind}；课程、班级和任务名称已脱敏。`, `本批${report.total}份，不代表全班、整门课程或本周全部教学。`, "", "## 处理状态", `采集状态：${report.state}。`];
    for (const [state, count] of Object.entries(report.counts)) if (count) lines.push(`- ${state}：${count}份`);
    lines.push(report.remaining === null ? "剩余待批：未获取有效复扫记录，不能当作0。" : `上次独立复扫剩余待批：${report.remaining}份；时间${F.displayTime(report.lastRescanAt)}（北京时间）。这是历史快照。`);
    lines.push("", "## 得分观察", "按各答案总分除以其满分计算百分比，含平台已有客观题分数；不是统一满分100分的原始分数，不设置及格结论。仅统计有效审核样本，不能评价全班或AI准确率。");
    for (const [key, title] of [["confirmed", "教师已确认、尚未提交"], ["verified", "平台已回读核验的会话样本"]]) {
      const s = report.stats[key]; lines.push("", `### ${title}`, `有效样本：${s.count}份；因依据失效或不完整而排除${report.excluded[key]}份。`);
      if (!s.count) { lines.push("暂无有效得分数据，不计算平均值。"); continue; }
      lines.push(`平均满分占比${s.mean}%；中位数${s.median}%；最低${s.min}%；最高${s.max}%。`);
      s.bands.forEach(b => lines.push(`- ${b.label}：${b.count}份`));
    }
    lines.push("", "## 待处理与异常", "以下为类型汇总，不包含学生身份、答案、逐人分数、原始报错或平台链接。");
    if (!report.issueCounts.length) lines.push("本批会话没有列出的待处理条目；不代表平台已确认无待批。");
    report.issueCounts.forEach(i => lines.push(`- ${i.title}：${i.count}份。${i.action}`));
    lines.push("", "## 教师下一步", "先核对结果不确定项与失败项 → 补齐材料/确认标准 → 审核建议 → 核对最终清单 → 经现有教师确认入口提交 → 独立回读与全量复扫。", "本报告不执行重试、选择答案、提交成绩、改期或通知；已评分与已核验答案继续保护。报告仅即时生成，主动导出的文件由教师保管。");
    return lines.join("\n");
  }
  function csv(report) {
    const rows = [["样本类型", "有效份数", "排除份数", "平均满分占比%", "中位数%", "最低%", "最高%", "区间", "区间份数", "证据范围"]];
    for (const [key, title] of [["confirmed", "教师已确认尚未提交"], ["verified", "平台已回读核验会话样本"]]) {
      const s = report.stats[key]; for (const b of s.bands) rows.push([title, s.count, report.excluded[key], s.mean ?? "未获取", s.median ?? "未获取", s.min ?? "未获取", s.max ?? "未获取", b.label, b.count, report.demo ? "脱敏模拟" : "仅本批有效审核样本"]);
    }
    const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
    return "\uFEFF" + rows.map(r => r.map(cell).join(",")).join("\r\n");
  }
  function html(report, at) {
    const escape = v => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const body = markdown(report, at).split("\n").filter(Boolean).map(line => {
      for (const [prefix, tag] of [["### ", "h3"], ["## ", "h2"], ["# ", "h1"]]) if (line.startsWith(prefix)) return `<${tag}>${escape(line.slice(prefix.length))}</${tag}>`;
      return `<p${line.startsWith("- ") ? ' class="row"' : ""}>${escape(line)}</p>`;
    }).join("\n");
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>教师批改工作报告 · 脱敏汇总</title><style>body{font:16px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#253849;background:#f4f6f8;margin:0}main{max-width:920px;margin:35px auto;background:white;padding:38px;border:1px solid #dde5eb;border-radius:10px}h1{font-size:27px}h2{font-size:21px;border-top:1px solid #dde5eb;padding-top:20px;margin-top:30px}h3{font-size:18px}p{margin:10px 0;overflow-wrap:anywhere}.row{padding-left:12px;color:#40586c}@media(max-width:600px){main{margin:12px;padding:20px}}@media print{body{background:white}main{margin:0;padding:0;border:0}h2,h3{break-after:avoid}p{break-inside:avoid}}</style></head><body><main>${body}</main></body></html>`;
  }
  globalThis.LearningTongReport = Object.freeze({ definitions, analyze, basisKey, markdown, csv, html });
})();
