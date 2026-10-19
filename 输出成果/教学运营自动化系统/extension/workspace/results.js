(() => {
  const R = globalThis.LearningTongReport, W = globalThis.LearningTongWorkspaceBridge;
  const $ = id => document.getElementById(id), node = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  let basis = "", report = null;
  function render() {
    const batch = W.batchView(), next = R.basisKey(batch);
    if (next !== basis) { $("report-confirm").checked = false; basis = next; }
    $("report-stats").replaceChildren(); $("report-issues").replaceChildren();
    for (const id of ["report-refresh", "report-export", "report-html", "report-csv", "report-filter", "report-confirm"]) $(id).disabled = W.isBusy() || !batch;
    if (!batch) { report = null; $("report-status").textContent = "尚未获取本次批改数据；不能当作无待批或零分。"; return; }
    try { report = R.analyze(batch); } catch (e) { report = null; $("report-status").textContent = `统计未获取：${e.message}`; $("report-export").disabled = true; $("report-html").disabled = true; $("report-csv").disabled = true; return; }
    $("report-status").textContent = `${report.demo ? "脱敏模拟" : "当前会话"} · 本批${report.total}份 · 已核验${report.counts[LearningTongBatch.states.verified]}份 · 待处理与异常${report.issues.length}份。上次有效复扫剩余待批：${report.remaining ?? "未获取"}${report.lastRescanAt ? `（${LearningTongFollowup.displayTime(report.lastRescanAt)} 北京时间，历史快照）` : "，未获取不能当作0"}。`;
    for (const [key, title] of [["confirmed", "教师已确认、尚未提交"], ["verified", "平台已回读核验的会话样本"]]) {
      const s = report.stats[key], card = node("div"); card.className = "result-group"; card.append(node("h4", title), node("p", `有效得分样本${s.count}份，排除${report.excluded[key]}份失效或不完整数据。`));
      if (!s.count) card.append(node("p", "尚无有效得分，不计算平均值。"));
      else { card.append(node("strong", `平均满分占比 ${s.mean}% · 中位数 ${s.median}%`));
        for (const b of s.bands) { const row = node("div"); row.className = "result-bar"; const progress = node("progress"); progress.max = s.count; progress.value = b.count; progress.setAttribute("aria-label", `${title} ${b.label} ${b.count}份`); row.append(node("span", b.label), progress, node("span", `${b.count}份`)); card.append(row); }
      } $("report-stats").append(card);
    }
    const selected = $("report-filter").value;
    const filtered = report.issues.filter(i => selected === "all" || i.category === selected);
    for (const issue of filtered) {
      const row = node("div"); row.className = "result-issue"; row.append(node("strong", `答案${issue.ordinal} · ${issue.title}`), node("p", issue.action));
      const button = node("button", "定位到当前答案"); button.className = "secondary"; button.disabled = W.isBusy();
      button.addEventListener("click", async () => { try { const current = W.batchView(); if (!current || R.basisKey(current) !== basis) throw new Error("批次已变化，请先刷新统计。"); await W.focusItem(current.items[issue.index].key); } catch (e) { W.notice(e.message); } });
      row.append(button); $("report-issues").append(row);
    }
    $("report-issues").append(node("p", filtered.length ? `当前筛选${filtered.length}份；这里只提供处理指引。` : "当前筛选没有条目；不等于平台无待批。"));
  }
  function download(text, filename, type) {
    if (W.isBusy()) throw new Error("当前批改任务尚未结束，请等待后核对报告。");
    const batch = W.batchView(); if (!batch || R.basisKey(batch) !== basis || !$("report-confirm").checked) throw new Error("请刷新统计并勾选教师报告确认；数据变化后需再次确认。");
    const blob = URL.createObjectURL(new Blob([text], { type })), a = node("a"); a.href = blob; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(blob), 1000);
    W.notice("已导出脱敏汇总，没有学生身份、答案、逐人分数或平台链接；未执行平台写入。");
  }
  $("report-refresh").addEventListener("click", render);
  $("report-filter").addEventListener("change", render);
  for (const [id, format] of [["report-export", "md"], ["report-html", "html"], ["report-csv", "csv"]]) $(id).addEventListener("click", () => { try { if (!report) throw new Error("尚无有效统计报告。"); download(format === "md" ? R.markdown(report, Date.now()) : format === "html" ? R.html(report, Date.now()) : R.csv(report), format === "md" ? "教师批改工作报告_脱敏汇总.md" : format === "html" ? "教师批改工作报告_脱敏汇总.html" : "批改得分统计_脱敏汇总.csv", format === "md" ? "text/markdown;charset=utf-8" : format === "html" ? "text/html;charset=utf-8" : "text/csv;charset=utf-8"); } catch (e) { W.notice(e.message); } });
  window.addEventListener("learningtong-scope", render); render();
})();
