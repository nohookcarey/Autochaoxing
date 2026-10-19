(() => {
  const B = globalThis.LearningTongBatch, AI = globalThis.LearningTongBatchAi, T = globalThis.LearningTongTeaching;
  const $ = id => document.getElementById(id);
  let batch, discovery, currentKey, busy = false, controller, previewKey = "", imageUrls = [], observedProvider = "", operation = "";
  const control = { paused: false, cancelled: false };
  let savedCourses = [], selectedCourse = null, historicalSummaries = [];
  let rubricLibrary = [], demoLibrary = [];
  const live = Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.session);
  const send = message => new Promise(resolve => {
    if (batch?.demo) { resolve({ ok: false, reason: "脱敏试用不访问平台或真实AI设置，请先清除模拟材料。" }); return; }
    if (!live) { resolve({ ok: false, reason: "请从浏览器工具栏打开已安装的插件，或点击脱敏试用查看界面。" }); return; }
    chrome.runtime.sendMessage(message, result => { const error = chrome.runtime.lastError; resolve(result || { ok: false, reason: error ? "扩展后台未响应，请重新打开工作台。" : "未获取响应。" }); });
  });
  function node(tag, content, cls) { const n = document.createElement(tag); if (content !== undefined) n.textContent = content; if (cls) n.className = cls; return n; }
  function notice(message) { $("notice").textContent = message; }
  function guarded(action) { return async () => { if (busy) { notice("当前任务尚未结束，请先暂停或取消。"); return; } busy = true; render(); try { await action(); } catch (e) { notice(e.message || String(e)); } finally { busy = false; operation = ""; render(); } }; }
  async function persist() { if (batch?.demo) return; const r = await send({ type: "batch-save", batch }); if (!r.ok) throw new Error(r.reason); }
  function changed(item) { item.approval = null; item.selected = false; item.state = B.states.pending; previewKey = ""; delete batch.lessonDraft; delete item.calibration; }
  function invalidateStandards() {
    batch.rubricVersion = 0; batch.consent = null; delete batch.lessonDraft;
    for (const item of batch.items) { delete item.calibration; if (item.snapshot && ![B.states.verified, B.states.uncertain, B.states.submitting, B.states.skipped].includes(item.state)) changed(item); }
    $("consent").checked = false; $("template-consent").checked = false; previewKey = "";
  }
  function scopeLine() { return batch ? `${batch.scope.courseName} / ${batch.scope.className} / ${batch.scope.workTitle}` : "尚未获取范围。"; }
  const library = () => batch?.demo ? demoLibrary : rubricLibrary;
  function renderTeachingTools() {
    const selected = $("template-select").value;
    $("template-select").replaceChildren(node("option", library().length ? "选择评分卡版本" : "尚无模板"));
    $("template-select").firstChild.value = "";
    library().forEach((t, n) => { const option = node("option", `${t.name} · v${t.version} · ${t.questions.length}题`); option.value = n; $("template-select").append(option); });
    $("template-select").value = selected;
    $("library-status").textContent = batch?.demo ? `模拟评分卡库：${library().length}个版本，仅本次预览，不写入真实模板库。` : `本机评分卡库：${library().length}个版本。只保留教师主动保存的标准和参考答案。`;
    $("teaching-tools").querySelectorAll("button,input,select,textarea").forEach(n => { n.disabled = busy; });
    $("template-save").disabled = busy || !batch?.rubricVersion;
    $("template-load").disabled = busy || !batch?.items.some(i => i.snapshot);
    $("generate-sample").disabled = busy || !batch?.rubricVersion;
    const item = batch?.items.find(i => i.key === currentKey);
    $("record-calibration").disabled = busy || !batch?.rubricVersion || !item?.originalSuggestions || [B.states.verified, B.states.submitting, B.states.uncertain, B.states.skipped].includes(item?.state);
    $("calibration-rubric").disabled = busy || !batch;
    const report = batch ? T.calibrationReport(batch) : { count: 0, bias: null, direction: "尚无有效校准样本" };
    $("calibration-status").textContent = report.count ? `${report.count}份有效样本：${report.direction}。按主观题满分归一到100分，教师减AI的平均差为${report.bias.toFixed(1)}分，平均绝对差为${report.absolute.toFixed(1)}分；仅供调整标准，不自动平移分数。` : report.direction;
    $("lecture-generate").disabled = busy || !batch;
    const stale = batch?.lessonDraft && batch.lessonBasis !== T.lectureKey(batch);
    $("lecture-export").disabled = busy || !batch?.lessonDraft || Boolean(stale);
    $("lecture-draft").value = batch?.lessonDraft || "";
    $("lecture-status").textContent = stale ? "审核范围或分数已变化，请重新整理提纲，再补充教师内容。" : "没有新AI请求；未审核、结果不确定或过期建议不参与统计。";
  }
  async function saveLibrary(next) {
    if (batch?.demo) { demoLibrary = next; return; }
    if (!live) throw new Error("请从已安装插件打开工作台；本地页面只有脱敏试用可保存模拟模板。");
    await chrome.storage.local.set({ gradingRubricLibraryV1: next }); rubricLibrary = next;
  }
  function requireTemplateConsent() { if (!$("template-consent").checked) throw new Error("请先检查名称、标准和参考答案不含学生信息，并勾选本机保存确认。"); }
  async function saveTemplate() {
    requireTemplateConsent(); const template = T.templateFromBatch(batch, $("template-name").value, library());
    await saveLibrary(T.appendTemplates(library(), [template])); notice(`评分卡“${template.name}”已保存为新版本，未保存题目标识或学生答案。`);
  }
  async function loadTemplate() {
    const index = $("template-select").value; if (index === "") throw new Error("请选择一个模板版本。");
    const mapped = T.mapTemplate(batch, library()[Number(index)]); invalidateStandards();
    const old = batch.rubrics; batch.rubrics = mapped.rubrics; batch.references = mapped.references; renderRubrics(); batch.rubrics = old;
    await persist(); notice("模板按题序载入；请逐题核对参考答案和评分标准，再确认本次评分卡。未自动确认或提交。");
  }
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importTemplates() {
    requireTemplateConsent(); const file = $("template-file").files[0]; if (!file || file.size > 500000) throw new Error("请选择500KB以内的评分卡库JSON。");
    const templates = T.importLibrary(await file.text()); await saveLibrary(T.appendTemplates(library(), templates)); $("template-file").value = "";
    notice(`已导入${templates.length}个模板，同名另存新版本；使用前仍需核对并确认。`);
  }
  async function removeTemplate() {
    const index = $("template-select").value; if (index === "") throw new Error("请选择需移除的版本。");
    const template = library()[Number(index)];
    if (!confirm(`移除“${template.name}”v${template.version}？建议先导出评分卡库备份。不会修改本次评分卡。`)) return;
    await saveLibrary(library().filter((_t, n) => n !== Number(index))); notice("选中模板版本已移除，本次评分卡未改变。");
  }
  async function generateSamples() {
    const count = Number($("sample-count").value); if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error("校准样本数须为1～5的整数。");
    await generate(count); $("calibration-panel").open = true;
  }
  async function recordCalibration() {
    const item = batch.items.find(i => i.key === currentKey); T.recordCalibration(batch, item); previewKey = ""; await persist();
    await renderDetail(item); notice("本份已记录为校准样本，没有选中提交；可继续确认评分，或调整评分卡后重新校准。");
  }
  async function generateLecture() {
    const text = T.lecturePlan(batch);
    if (batch.lessonDraft && !confirm("重新生成会替换本次讲评稿中的教师补充，是否继续？")) return;
    batch.lessonDraft = text; batch.lessonBasis = T.lectureKey(batch); await persist(); $("lecture-panel").open = true;
    notice("已按有效审核样本整理讲评稿。请核实错因并补充教师自编示例；未发送新AI请求或发布内容。");
  }
  function exportLecture() {
    if (!batch?.lessonDraft || batch.lessonBasis !== T.lectureKey(batch)) throw new Error("没有有效讲评稿，或审核范围已变化，请重新整理。");
    download(batch.lessonDraft, "作业讲评_教师审核稿.md", "text/markdown;charset=utf-8");
  }
  function render() {
    window.dispatchEvent(new Event("learningtong-scope"));
    const available = Boolean(batch);
    for (const id of ["batch-card", "submit-card"]) $(id).hidden = !available;
    $("rubric-card").hidden = !batch?.items.some(i => i.snapshot);
    $("scope-summary").textContent = scopeLine(); $("course-summary").textContent = scopeLine();
    $("mode").textContent = batch?.demo ? "脱敏模拟 · 不连接平台" : batch ? "本机运行 · 范围已确认" : "本机运行 · 尚未连接";
    $("rubric-card").querySelectorAll("input,textarea,button").forEach(n => { n.disabled = busy; });
    $("course-select").disabled = busy || Boolean(batch);
    $("course-select").hidden = Boolean(batch?.demo);
    $("saved-courses").replaceChildren();
    if (batch?.demo) $("saved-courses").append(node("p", "教学运营演示课程 · 演示班A（模拟）"));
    else for (const course of savedCourses) $("saved-courses").append(node("p", `${course.name} · ${(course.classNames || []).join("、") || "班级范围待确认"}`));
    renderTeachingTools();
    if (!batch) return;
    const counts = B.summary(batch).counts;
    $("progress").textContent = `共${batch.items.length}份 · 已确认${counts[B.states.confirmed]} · 已核验${counts[B.states.verified]} · 待复核${counts[B.states.manual]} · 不确定${counts[B.states.uncertain]}`;
    const items = $("items"); items.replaceChildren();
    const filter = $("filter").value;
    for (const item of batch.items) {
      if (filter === "review" && ![B.states.pending, B.states.manual, B.states.failed].includes(item.state)) continue;
      if (["confirmed", "uncertain", "verified"].includes(filter) && item.state !== B.states[filter]) continue;
      const row = node("div", undefined, `item${currentKey === item.key ? " active" : ""}`);
      const check = document.createElement("input"); check.type = "checkbox"; check.checked = item.selected; check.disabled = item.state !== B.states.confirmed || busy; check.setAttribute("aria-label", `选择答案${item.ordinal}提交`);
      check.addEventListener("change", async () => { item.selected = check.checked; previewKey = ""; try { await persist(); } catch (e) { notice(e.message); } });
      const button = node("button", `答案 ${String(item.ordinal).padStart(2, "0")}`); button.append(node("small", item.state));
      button.addEventListener("click", () => { currentKey = item.key; render(); renderDetail(item); }); row.append(check, button); items.append(row);
    }
    const lockedDetail = [B.states.verified, B.states.submitting, B.states.uncertain].includes(batch.items.find(i => i.key === currentKey)?.state);
    $("answer-detail").querySelectorAll("button,input,textarea").forEach(n => {
      n.disabled = busy || lockedDetail;
      if (n.dataset.confirmScore) {
        const item = batch.items.find(i => i.key === currentKey);
        try { B.reviewedTotal(batch, item); } catch { n.disabled = true; }
        if (!batch.rubricVersion) n.disabled = true;
      }
    });
    $("submit").disabled = !previewKey || busy;
    $("generate").disabled = busy || !batch.rubricVersion;
    $("pause").disabled = !busy;
    $("resume").disabled = busy || !batch.paused;
    $("records").replaceChildren(node("p", `${batch.demo ? "模拟结果：" : "本次汇总："}${Object.entries(counts).filter(([, n]) => n).map(([s, n]) => `${s}${n}份`).join("，")}。剩余待批：${batch.remainingPending ?? "未获取"}。`));
    if (!batch.demo) for (const record of historicalSummaries) $("records").append(node("p", `${new Date(record.at).toLocaleString("zh-CN")} · ${record.scope.courseName} / ${record.scope.className} / ${record.scope.workTitle} · ${record.acquisitionState} · 剩余待批${record.remainingPending ?? "未获取"}`));
  }
  async function refreshTabs() {
    const r = await send({ type: "batch-tabs" }); $("platform-tab").replaceChildren();
    if (!r.ok) { notice(r.reason); return; }
    for (const tab of r.tabs) { const option = node("option", tab.title); option.value = tab.id; $("platform-tab").append(option); }
    if (!r.tabs.length) notice("未发现学习通页面，请先在浏览器登录并打开目标批阅列表。");
  }
  async function discover() {
    const r = await send({ type: "batch-discover", tabId: Number($("platform-tab").value), kind: $("kind").value });
    if (!r.ok) throw new Error(r.reason);
    if (selectedCourse && r.scope.courseName && selectedCourse.name !== r.scope.courseName) throw new Error("当前平台课程与选择课程不一致，请切换到正确教师页面。");
    if (selectedCourse?.classNames?.length && r.scope.className && !selectedCourse.classNames.includes(r.scope.className)) throw new Error("当前班级不在所选课程的确认范围内。");
    discovery = r; $("scope-form").hidden = false;
    $("course-name").value = r.scope.courseName || selectedCourse?.name || ""; $("class-name").value = r.scope.className; $("work-title").value = r.scope.workTitle;
    notice("已读取批阅页面范围。请对照原页面确认课程、班级和任务名称，再扫描。");
  }
  async function scanAll() {
    const entries = []; let pages = 1;
    for (let p = 1; p <= pages; p++) {
      notice(`正在读取第${p}/${pages}页待批列表…`);
      const r = await send({ type: "batch-scan-page", id: batch.id, pageNumber: p });
      if (!r.ok) { batch.scanState = "未获取"; batch.remainingPending = null; await persist(); throw new Error(r.reason); }
      pages = r.data.totalPages; entries.push(...r.data.entries);
    }
    return entries;
  }
  async function start() {
    if (!discovery) throw new Error("请先识别范围。");
    if (batch) throw new Error("请先清除上一批次材料再切换任务。");
    const scope = { ...discovery.scope, courseName: B.norm($("course-name").value), className: B.norm($("class-name").value), workTitle: B.norm($("work-title").value) };
    B.createBatch(scope, []);
    const r = await send({ type: "batch-start", scope, tabId: discovery.tabId, frameId: discovery.frameId });
    if (!r.ok) throw new Error(r.reason); batch = r.batch;
    const entries = await scanAll(); batch.items = B.createBatch(scope, entries).items; batch.scanState = entries.some(e => e.status === "unknown") ? "未获取" : "采集到"; await persist();
    for (const item of batch.items.filter(i => i.state === B.states.pending)) {
      notice(`正在读取答案${item.ordinal}，本步骤不发送AI、不写平台…`);
      const answer = await send({ type: "batch-read", id: batch.id, key: item.key });
      try { if (!answer.ok) throw new Error(answer.reason); item.snapshot = answer.data; B.assertSnapshot(batch, item, answer.data); }
      catch (e) { item.state = B.states.manual; item.reason = e.message; }
      await persist();
    }
    const pending = batch.items.filter(i => ![B.states.skipped].includes(i.state));
    batch.remainingPending = entries.some(e => e.status === "unknown") ? null : pending.length; if (!pending.length) batch.scanState = "确认无数据";
    await persist(); renderRubrics();
    currentKey = batch.items.find(i => i.snapshot)?.key;
    if (currentKey) await renderDetail(batch.items.find(i => i.key === currentKey));
    notice(pending.length ? "扫描完成。请先确认评分卡，再授权生成建议；不完整材料已标记待人工复核。" : "已核验正确范围与全部分页，确认无待批。");
  }
  function renderRubrics() {
    const holder = $("rubrics"); holder.replaceChildren();
    const template = batch?.items.find(i => i.snapshot)?.snapshot;
    for (const q of template?.questions.filter(q => !q.automatic) || []) {
      const block = node("div", undefined, "rubric-question"); block.dataset.questionId = q.id;
      block.append(node("strong", `${q.question}（满分${q.maxScore}）`));
      const referenceLabel = node("label", "参考答案（可补充，不含学生答案）"); const ref = node("textarea"); ref.className = "rubric-reference"; ref.value = batch.references?.[q.id] ?? q.referenceAnswer; referenceLabel.append(ref); block.append(referenceLabel);
      const rules = batch.rubrics[q.id]?.dimensions || [{ name: "符合任务要求", maxScore: q.maxScore, criteria: "" }];
      const addRow = d => { const row = node("div", undefined, "dimension"); const name = node("input"); name.value = d.name; name.placeholder = "维度名称"; name.setAttribute("aria-label", "评分维度"); const max = node("input"); max.type = "number"; max.step = "0.1"; max.value = d.maxScore; max.setAttribute("aria-label", "维度满分"); const criteria = node("textarea"); criteria.value = d.criteria; criteria.placeholder = "具体、可判定的评分标准"; criteria.setAttribute("aria-label", "评分标准"); row.append(name, max, criteria); block.append(row); };
      rules.forEach(addRow);
      const add = node("button", "增加评分维度", "secondary"); add.addEventListener("click", () => addRow({ name: "", maxScore: 0, criteria: "" })); block.append(add); holder.append(block);
    }
  }
  async function confirmRubrics() {
    const rules = {}, references = {};
    for (const block of $("rubrics").children) {
      const dimensions = [...block.querySelectorAll(".dimension")].map(row => ({ name: B.norm(row.children[0].value), maxScore: Number(row.children[1].value), criteria: B.norm(row.children[2].value) })).filter(d => d.name || d.criteria || d.maxScore);
      rules[block.dataset.questionId] = { dimensions };
      references[block.dataset.questionId] = block.querySelector(".rubric-reference").value;
    }
    B.setRubrics(batch, rules); batch.references = references;
    batch.templates = Object.fromEntries(batch.items.find(i => i.snapshot).snapshot.questions.map(q => [q.id, JSON.stringify({ question: q.question, referenceAnswer: q.referenceAnswer, maxScore: q.maxScore })]));
    $("consent").checked = false; previewKey = ""; await persist(); notice("本次评分卡已确认。修改后需再次确认，旧评分建议与审核将失效。");
  }
  async function config() { const r = await send({ type: "batch-ai-credentials" }); if (!r.ok) throw new Error(r.reason); return r.config; }
  async function materialFor(q, cfg, preview = false, item) {
    const material = [];
    for (const a of q.attachments || []) {
      notice(`正在完整读取附件${a.fileName}…`);
      let contentKey;
      const r = await LearningTongAttachmentExtract.extractMaterial(a, async attachment => { const downloaded = await send({ type: "batch-attachment", id: batch.id, key: item?.key, attachment, href: attachment.href }); if (downloaded.ok) contentKey = await B.materialDigest(downloaded.dataBase64); return downloaded; }, { vision: preview || cfg.visionSupported });
      if (!r.ok) throw new Error(r.reason);
      r.contentKey = contentKey;
      r.role = a.role || "材料角色未定位";
      material.push(r);
    }
    return material;
  }
  async function generate(limit = Infinity) {
    if (!batch?.rubricVersion || !$("consent").checked) throw new Error("请确认评分卡并授权本批材料发送。");
    if (batch.cancelled) batch.cancelled = false;
    batch.paused = false; control.paused = false; control.cancelled = false; operation = "generate"; controller = new AbortController();
    const cfg = batch.demo ? { baseUrl: "脱敏模拟", model: "模拟模型", visionSupported: true } : await config();
    if (!batch.demo && observedProvider !== B.digest({ provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model })) { $("consent").checked = false; await loadConfig(); throw new Error("AI服务已变化，请重新核对并授权发送。"); }
    batch.consent = { provider: cfg.baseUrl, model: cfg.model, rubricVersion: batch.rubricVersion, at: Date.now() }; await persist();
    for (const item of batch.items.filter(i => [B.states.pending, B.states.failed].includes(i.state) && !i.calibration).slice(0, limit)) {
      if (control.paused || control.cancelled) break;
      if (!item.snapshot?.complete) { item.state = B.states.manual; item.reason = item.snapshot?.reason || "答案材料未完整获取。"; await persist(); continue; }
      item.state = B.states.generating; item.suggestions = []; delete item.originalSuggestions; delete item.calibration; delete batch.lessonDraft; item.materialKeys = {}; item.selected = false; item.approval = null; await persist(); render();
      try {
        const fresh = batch.demo ? { ok: true, data: item.snapshot } : await send({ type: "batch-read", id: batch.id, key: item.key });
        if (!fresh.ok) throw new Error(fresh.reason); B.assertSnapshot(batch, item, fresh.data);
        for (const q of item.snapshot.questions.filter(q => !q.automatic)) {
          if (batch.templates[q.id] !== JSON.stringify({ question: q.question, referenceAnswer: q.referenceAnswer, maxScore: q.maxScore })) throw new Error("题目与已确认评分卡模板不一致，需人工复核。");
          const material = batch.demo ? [] : await materialFor(q, cfg, false, item);
          item.materialKeys[q.id] = material.map(m => m.contentKey);
          const grading = batch.demo ? { questionId: q.id, score: q.maxScore * .8, dimensionScores: batch.rubrics[q.id].dimensions.map(d => ({ name: d.name, score: d.maxScore * .8 })), comment: "任务步骤清楚，可补充核验依据。", evidence: "模拟依据：答案列出了计划、生成与检查步骤。", needsReview: false } : await AI.grade(cfg, { ...q, referenceAnswer: batch.references[q.id] || q.referenceAnswer }, batch.rubrics[q.id], material, { signal: controller.signal });
          if (material.some(m => /未定位|需核实/.test(m.role))) { grading.needsReview = true; grading.evidence += "；附件材料角色需要教师对照原文确认。"; }
          item.suggestions.push(grading);
          if (controller.signal.aborted) throw new Error("已取消生成。");
        }
        item.originalSuggestions = structuredClone(item.suggestions);
        item.state = item.suggestions.some(s => s.needsReview) ? B.states.manual : B.states.pending; item.reason = "";
      } catch (e) { item.state = /材料|图片|读取|题目|评分卡|身份|答案|附件|超限/.test(e.message) ? B.states.manual : B.states.failed; item.reason = e.message; }
      await persist(); if (currentKey === item.key) await renderDetail(item); render();
    }
    controller = null; operation = ""; notice(control.paused ? "已暂停；当前请求已完成，可继续未生成项。" : control.cancelled ? "已取消生成，未提交任何成绩。" : "建议生成结束，请逐份核对并确认；没有答案被自动选中提交。");
  }
  async function renderDetail(item) {
    for (const url of imageUrls) URL.revokeObjectURL(url); imageUrls = [];
    const detail = $("answer-detail"); detail.replaceChildren(node("h3", `答案 ${item.ordinal}`), node("span", item.state, "badge"));
    if (item.reason) detail.append(node("p", item.reason));
    if (!item.snapshot) { detail.append(node("p", "未获取完整答案，请在平台人工核对。")); return; }
    for (const q of item.snapshot.questions) {
      detail.append(node("h4", `${q.question}（${q.maxScore}分）`), node("div", q.studentAnswer || "无网页文字，见附件材料。", "answer-text"));
      if (q.referenceAnswer) detail.append(node("p", `平台参考答案：${q.referenceAnswer}`));
      if (q.unresolvedMaterials?.length) detail.append(node("p", `内嵌附件${q.unresolvedMaterials.length}份（${q.unresolvedMaterials.map(m => m.kind).join("、")}）：原文件未获取，请在平台人工核对。`));
      if (q.attachments?.length) {
        detail.append(node("p", `附件：${q.attachments.map(a => a.fileName).join("、")}`));
        const preview = node("button", "查看完整附件 / 原图", "secondary");
        preview.addEventListener("click", guarded(async () => { const materials = await materialFor(q, { visionSupported: true }, true, item); if (currentKey !== item.key) return; const area = node("div"); for (const m of materials) { if (m.text) area.append(node("div", m.text, "answer-text")); for (const src of m.images || []) { const image = document.createElement("img"); image.src = src; image.alt = "当前答案附件或PDF原页"; image.className = "answer-image"; area.append(image); } } preview.replaceWith(area); notice("附件仅在本机展示，未发送AI。"); })); detail.append(preview);
      }
      if (q.automatic) { detail.append(node("p", `保留平台客观题评分：${q.existingScore}分`)); continue; }
      const suggestion = item.suggestions.find(s => s.questionId === q.id);
      if (!suggestion) { detail.append(node("p", "尚未生成完整评分建议。")); continue; }
      detail.append(node("p", `评分依据：${suggestion.evidence}`));
      for (const dimension of suggestion.dimensionScores) {
        const row = node("label", undefined, "score-row"); row.append(node("span", dimension.name)); const input = node("input"); input.type = "number"; input.step = "0.1"; input.value = dimension.score;
        input.disabled = [B.states.submitting, B.states.uncertain, B.states.verified].includes(item.state) || busy;
        input.addEventListener("change", async () => { dimension.score = Number(input.value); suggestion.score = suggestion.dimensionScores.reduce((sum, d) => sum + d.score, 0); changed(item); await persist(); render(); }); row.append(input); detail.append(row);
      }
      const comment = node("textarea"); comment.value = suggestion.comment; comment.setAttribute("aria-label", "教师评语"); comment.disabled = [B.states.submitting, B.states.uncertain, B.states.verified].includes(item.state) || busy;
      comment.addEventListener("change", async () => { suggestion.comment = comment.value; changed(item); await persist(); render(); }); detail.append(comment);
      if (suggestion.needsReview) {
        const check = node("label", "我已对照完整材料核实此项不确定结论", "check"); const input = node("input"); input.type = "checkbox"; input.addEventListener("change", async () => { suggestion.needsReview = !input.checked; changed(item); await persist(); render(); }); check.prepend(input); detail.append(check);
      }
    }
    const commentLabel = node("label", "本份答案同时提交已审核评语（默认不写）", "check"); const commentCheck = node("input"); commentCheck.type = "checkbox"; commentCheck.checked = item.approval?.commentEnabled || false; commentLabel.prepend(commentCheck);
    const confirm = node("button", "确认本份评分并选中提交"); confirm.dataset.confirmScore = "true"; confirm.disabled = !item.snapshot.complete || item.snapshot.questions.some(q => q.unresolvedMaterials?.length) || [B.states.verified, B.states.skipped, B.states.uncertain, B.states.submitting].includes(item.state) || busy;
    try { B.reviewedTotal(batch, item); } catch { confirm.disabled = true; }
    if (!batch.rubricVersion) confirm.disabled = true;
    confirm.addEventListener("click", guarded(async () => { B.confirmItem(batch, item, commentCheck.checked); previewKey = ""; await persist(); notice(`答案${item.ordinal}已审核确认，最终清单确认后才写入平台。`); await renderDetail(item); })); detail.append(commentLabel, confirm);
  }
  function selectedPlans() { return batch.items.filter(i => i.selected).map(i => ({ ordinal: i.ordinal, key: i.key, ...B.submissionPlan(batch, i) })); }
  function showPreview(target, plans) {
    target.replaceChildren(node("p", `${scopeLine()} · 选中${plans.length}份`));
    const table = node("table"), heading = node("tr"); for (const s of ["答案", "最终分数", "提交评语"]) heading.append(node("th", s)); table.append(heading);
    for (const plan of plans) { const row = node("tr"); row.append(node("td", `答案${plan.ordinal}`), node("td", plan.total), node("td", plan.comment === null ? "否" : "是")); table.append(row); } target.append(table);
  }
  async function previewSubmit() { const plans = selectedPlans(); if (!plans.length) throw new Error("请先审核并选中至少一份答案。"); previewKey = JSON.stringify(plans); showPreview($("submission-preview"), plans); }
  async function submitSelected() {
    const plans = selectedPlans(); if (!previewKey || previewKey !== JSON.stringify(plans)) throw new Error("清单已变化，请重新查看最终清单。");
    showPreview($("dialog-preview"), plans); $("confirm-dialog").showModal();
  }
  async function executeSelected() {
    $("confirm-dialog").close(); const plans = selectedPlans();
    if (previewKey !== JSON.stringify(plans)) throw new Error("确认期间清单已变化，请重新审核。"); previewKey = "";
    control.paused = false; control.cancelled = false; operation = "submit";
    for (const plan of plans) {
      if (control.paused || control.cancelled) break;
      notice(`正在提交并核验答案${plan.ordinal}…`);
      if (batch.demo) { const i = batch.items.find(i => i.key === plan.key); i.state = B.states.verified; i.selected = false; continue; }
      const prepared = await send({ type: "batch-prepare-submit", id: batch.id, key: plan.key }); if (!prepared.ok) throw new Error(prepared.reason);
      const submitted = await send({ type: "batch-submit", id: batch.id, token: prepared.token });
      if (!submitted.ok) { const restored = await send({ type: "batch-restore" }); if (restored.batch) batch = restored.batch; throw new Error(submitted.reason); }
      batch = submitted.batch;
      const verified = await send({ type: "batch-verify", id: batch.id, key: plan.key }); if (verified.batch) batch = verified.batch;
      if (!verified.ok) throw new Error(verified.reason); render();
    }
    await rescan(); await recordSummary();
    if (currentKey) await renderDetail(batch.items.find(i => i.key === currentKey));
    operation = "";
    notice(control.paused || control.cancelled ? "已在当前答案核验后停止剩余提交。继续时需重新查看最终清单。" : batch.demo ? "模拟提交与核验完成，未连接学习通，不能作为真实验收证据。" : `选中答案已独立核验。剩余待批：${batch.remainingPending ?? "未获取"}。`);
  }
  async function rescan() {
    if (batch.demo) { batch.remainingPending = batch.items.filter(i => i.state !== B.states.verified && i.state !== B.states.skipped).length; batch.lastRescanAt = Date.now(); return; }
    batch.remainingPending = null; batch.lastRescanAt = null; batch.scanState = "未获取"; await persist();
    const entries = await scanAll();
    if (entries.some(e => e.status === "unknown")) { batch.scanState = "未获取"; batch.remainingPending = null; }
    else { batch.remainingPending = entries.filter(e => e.status === "pending").length; batch.scanState = batch.remainingPending ? "采集到" : "确认无数据"; batch.lastRescanAt = Date.now(); }
    await persist(); notice(`独立复扫：${batch.scanState}，剩余待批${batch.remainingPending ?? "未获取"}。`);
  }
  async function verifyUncertain() { for (const i of batch.items.filter(i => i.state === B.states.uncertain)) { const r = await send({ type: "batch-verify", id: batch.id, key: i.key }); if (r.batch) batch = r.batch; if (!r.ok) throw new Error(r.reason); } await rescan(); await recordSummary(); }
  async function recordSummary() { if (batch.demo || !live) return; const stored = await chrome.storage.local.get("gradingBatchSummaries"); const records = stored.gradingBatchSummaries || []; records.unshift(B.summary(batch)); await chrome.storage.local.set({ gradingBatchSummaries: records.slice(0, 100) }); }
  function updateProvider() {
    const codex = $("ai-provider").value === "codex-local";
    $("codex-help").hidden = !codex; $("api-url").readOnly = codex;
    $("remember-key").disabled = codex;
    $("key-label").textContent = codex ? "本次本机连接码" : "API Key";
    if (codex) { $("api-url").value = "http://127.0.0.1:4175/v1"; $("remember-key").checked = false; }
  }
  $("ai-provider").addEventListener("change", () => { $("api-key").value = ""; $("api-model").value = $("ai-provider").value === "codex-local" ? "codex-default" : ""; if ($("ai-provider").value === "api") $("api-url").value = "https://api.example.com/v1"; updateProvider(); });
  async function loadConfig() {
    const r = await send({ type: "ai-config-get" }); if (!r.ok || batch?.demo) return;
    observedProvider = B.digest({ provider: r.config.provider, baseUrl: r.config.baseUrl, model: r.config.model });
    $("ai-provider").value = r.config.provider || "api"; updateProvider();
    $("api-url").value = r.config.baseUrl; $("api-model").value = r.config.model; $("api-key").value = r.config.hasKey ? "********" : ""; $("remember-key").checked = r.config.rememberKey;
    $("provider").textContent = `服务商：${r.config.provider === "codex-local" ? "OpenAI（本机Codex）" : new URL(r.config.baseUrl).hostname} · 模型：${r.config.model} · 图像${r.config.visionSupported ? "已测试" : "未测试"}`;
    $("config-status").textContent = r.config.hasKey ? `已配置。图像能力${r.config.visionSupported ? "已验证" : "需单独测试"}。` : "请配置密钥。旧版未明确授权保存的密钥不再长期保留。";
  }
  async function saveConfig() {
    if (batch?.demo) throw new Error("脱敏模式不会修改真实AI设置，请先清除模拟材料。");
    if (!live) throw new Error("请从浏览器工具栏打开已安装插件，再配置AI。");
    const codex = $("ai-provider").value === "codex-local";
    if (codex && $("api-key").value !== "********" && !/^[a-f0-9]{64}$/.test($("api-key").value.trim())) throw new Error("请填写本次桥接生成的64位连接码；不要填写Codex登录凭据或API Key。");
    const u = new URL(codex ? "http://127.0.0.1:4175/v1" : $("api-url").value); if (!codex && u.protocol !== "https:") throw new Error("服务地址必须使用HTTPS。");
    const granted = codex || await chrome.permissions.request({ origins: [`${u.origin}/*`] }); if (!granted) throw new Error("未授权域名，不会发送请求。");
    const r = await send({ type: "ai-config-save", config: { provider: codex ? "codex-local" : "api", baseUrl: u.href.replace(/\/$/, ""), model: $("api-model").value || (codex ? "codex-default" : ""), apiKey: $("api-key").value, rememberKey: !codex && $("remember-key").checked, commentEnabled: false, visionSupported: false } });
    if (!r.ok) throw new Error(r.reason); batch && (batch.consent = null); $("consent").checked = false; await loadConfig(); notice("设置已保存，请分别测试文本与图像能力。材料尚未发送。");
  }
  async function testCapability(vision) {
    const cfg = await config(); let messages;
    let expected = "TEXT-OK";
    if (vision) {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 110; const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 320, 110); ctx.fillStyle = "black"; ctx.font = "bold 54px Arial";
      expected = String(Math.floor(Math.random() * 9000) + 1000); ctx.fillText(expected, 40, 75);
      messages = [{ role: "user", content: [{ type: "text", text: "只返回图片中的四位数字，不加其他内容。" }, { type: "image_url", image_url: { url: canvas.toDataURL("image/png") } }] }];
    } else messages = [{ role: "user", content: "只返回 TEXT-OK，不加其他内容。" }];
    const raw = await AI.request(cfg, messages, { maxTokens: 1000 });
    if (B.norm(raw).replace(/["`]/g, "") !== expected) throw new Error("模型返回内容未通过能力测试；相关能力暂未验证。");
    if (vision) { const r = await send({ type: "ai-config-save", config: { ...cfg, visionSupported: true } }); if (!r.ok) throw new Error(r.reason); }
    await loadConfig(); notice(`${vision ? "图像" : "文本"}能力测试通过。仅发送了合成测试材料。`);
  }
  async function draftRubric() {
    if (!batch) throw new Error("先读取答案。");
    if (batch.demo) { invalidateStandards(); for (const text of $("rubrics").querySelectorAll(".dimension textarea")) text.value = "步骤完整、依据明确、能说明核验方法。"; notice("已填写模拟评分卡，需教师确认。"); return; }
    const cfg = await config(); const rubrics = {};
    for (const q of batch.items.find(i => i.snapshot).snapshot.questions.filter(q => !q.automatic)) {
      const raw = await AI.request(cfg, LearningTongAiGrading.buildRubricMessages({ ...q, assignmentTitle: "教师题目评分卡", criteria: "依据题目与参考答案起草，不含学生答案。" }), { maxTokens: 2600 });
      const parsed = LearningTongAiGrading.parseRubricResponse(raw, q.maxScore); if (!parsed.ok) throw new Error(parsed.reason);
      B.validateRubric(parsed, q.maxScore); rubrics[q.id] = { dimensions: parsed.dimensions };
    }
    // Draft is editable only; it does not approve or replace an active grading rubric.
    const old = batch.rubrics; invalidateStandards(); batch.rubrics = rubrics; renderRubrics(); batch.rubrics = old; notice("草拟评分卡已展示，核对后点击确认；未发送学生答案。");
  }
  function demo() {
    if (batch && !batch.demo) { notice("请先清除当前真实批次材料，再开启模拟。"); return; }
    const scope = { courseName: "教学运营演示课程", className: "演示班A", workTitle: "学习计划实践", kind: "assignment", courseId: "demo-course", classId: "demo-class", workId: "demo-work" };
    batch = B.createBatch(scope, [1, 2, 3].map(n => ({ identity: { ...scope, answerId: `demo-${n}` }, reviewUrl: "", status: "pending" }))); batch.demo = true;
    for (const i of batch.items) i.snapshot = { identity: i.identity, status: "pending", complete: true, totalMax: 100, questions: [{ id: "demo-question", question: "说明你如何使用AI完成学习计划，并检查结果。", studentAnswer: "先整理需求，再拟定计划、生成草稿，最后逐项检查时间与任务是否合理。", referenceAnswer: "应说明计划、生成、核对的完整过程。", maxScore: 100, attachments: [], automatic: false }] };
    batch.remainingPending = 3; currentKey = batch.items[0].key; $("provider").textContent = "模拟服务 · 不发送任何材料"; renderRubrics(); render(); renderDetail(batch.items[0]); notice("脱敏模拟：所有答案与评分均为模拟，不连接平台，不代表真实批改能力。");
  }
  for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => { document.querySelectorAll("[data-view]").forEach(n => n.classList.toggle("active", n === button)); for (const view of ["tasks", "courses", "records", "settings"]) $("view-" + view).hidden = view !== button.dataset.view; });
  for (const id of ["course-name", "class-name", "work-title"]) $(id).addEventListener("input", () => window.dispatchEvent(new Event("learningtong-scope")));
  for (const id of ["platform-tab", "kind"]) $(id).addEventListener("change", () => { if (!batch) { discovery = null; $("scope-form").hidden = true; render(); } });
  $("course-select").addEventListener("change", () => { selectedCourse = savedCourses.find(c => c.id === $("course-select").value) || null; discovery = null; $("scope-form").hidden = true; notice("课程已选择，仍需识别并核验当前教师批阅页面。"); render(); });
  for (const [id, action] of Object.entries({ "refresh-tabs": refreshTabs, discover, start, "confirm-rubrics": confirmRubrics, generate, resume: generate, "draft-rubric": draftRubric, "preview-submit": previewSubmit, submit: submitSelected, "dialog-confirm": executeSelected, verify: verifyUncertain, rescan, "save-config": saveConfig, "test-text": () => testCapability(false), "test-vision": () => testCapability(true), "clear-config": async () => { const r = await send({ type: "ai-config-clear" }); if (!r.ok) throw new Error(r.reason); await loadConfig(); notice(r.reason); }, "clear-session": async () => { if (!batch.demo) { const r = await send({ type: "batch-forget", id: batch.id }); if (!r.ok) throw new Error(r.reason); } batch = null; currentKey = null; previewKey = ""; $("answer-detail").replaceChildren(); $("consent").checked = false; notice("已清除本批次会话材料；平台已提交结果未改变。"); } })) $(id).addEventListener("click", guarded(action));
  $("pause").addEventListener("click", () => { if (batch) { control.paused = true; batch.paused = true; notice(operation === "submit" ? "将在当前答案提交与核验后停止剩余提交。" : "将在当前请求结束后暂停生成，不写入平台。"); } });
  $("cancel").addEventListener("click", () => { if (batch) { control.cancelled = true; batch.cancelled = true; controller?.abort(); notice(operation === "submit" ? "将在当前答案核验后停止，其余选中答案不会提交。" : "已请求取消生成；正在完成的页面读取仍会回传，未提交成绩。"); } });
  $("dialog-cancel").addEventListener("click", () => $("confirm-dialog").close());
  $("filter").addEventListener("change", render); $("demo").addEventListener("click", () => { if (!busy) demo(); });
  for (const [id, action] of Object.entries({ "template-save": saveTemplate, "template-load": loadTemplate, "template-export": () => download(T.exportLibrary(library()), "教师评分卡库.json", "application/json"), "template-remove": removeTemplate, "generate-sample": generateSamples, "record-calibration": recordCalibration, "calibration-rubric": () => $("rubric-card").scrollIntoView({ block: "start" }), "lecture-generate": generateLecture, "lecture-export": exportLecture })) $(id).addEventListener("click", guarded(action));
  $("template-file").addEventListener("change", guarded(importTemplates));
  $("template-name").addEventListener("input", () => { $("template-consent").checked = false; });
  $("lecture-draft").addEventListener("input", () => { if (batch && !busy) batch.lessonDraft = $("lecture-draft").value; });
  $("lecture-draft").addEventListener("change", async () => { if (batch && !busy) try { await persist(); } catch (e) { notice(e.message); } });
  $("rubrics").addEventListener("input", () => {
    $("template-consent").checked = false;
    if (batch?.rubricVersion && !busy) { invalidateStandards(); render(); notice("评分卡正在修改，请重新确认；旧审核和校准样本已失效。"); }
  });
  $("rubric-file").addEventListener("change", guarded(async () => { const file = $("rubric-file").files[0]; if (!file || file.size > 100000) throw new Error("请选择100KB以内的评分卡JSON。"); const rubric = JSON.parse(await file.text()); for (const q of batch.items.find(i => i.snapshot).snapshot.questions.filter(q => !q.automatic)) B.validateRubric(rubric[q.id], q.maxScore); const old = batch.rubrics; invalidateStandards(); batch.rubrics = rubric; renderRubrics(); batch.rubrics = old; notice("评分卡已导入，核对后需再次确认。"); }));
  $("export").addEventListener("click", () => { if (!batch) return; const summary = B.summary(batch); summary.scope = { courseName: "课程已脱敏", className: "班级已脱敏", workTitle: "任务已脱敏", kind: batch.scope.kind }; summary.demo = Boolean(batch.demo); const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "批改核验脱敏汇总.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  // Closing/reloading stops the workspace scheduler; the next workspace restores the session and independently verifies interrupted submissions.
  window.addEventListener("pagehide", () => controller?.abort());
  globalThis.LearningTongWorkspaceBridge = Object.freeze({
    batchView: () => batch ? structuredClone(batch) : null,
    isBusy: () => busy,
    focusItem: async key => { if (busy || !batch) throw new Error("请等待当前任务结束。"); const item = batch.items.find(i => i.key === key); if (!item) throw new Error("答案不属于当前批次。"); $("filter").value = "all"; currentKey = key; render(); await renderDetail(item); $("answer-detail").scrollIntoView({ block: "start" }); },
    live, send, notice, isDemo: () => Boolean(batch?.demo),
    scope: () => batch ? { scope: batch.scope, tabId: discovery?.tabId, frameId: discovery?.frameId } : discovery ? { scope: { ...discovery.scope, courseName: B.norm($("course-name").value), className: B.norm($("class-name").value), workTitle: B.norm($("work-title").value) }, tabId: discovery.tabId, frameId: discovery.frameId } : null,
    lock: () => { if (busy) return false; busy = true; operation = "followup"; render(); return true; },
    unlock: () => { busy = false; operation = ""; render(); },
  });
  (async () => { if (live) {
    const local = await chrome.storage.local.get(["teachingOperationsExtension", "gradingBatchSummaries", "gradingRubricLibraryV1"]);
    rubricLibrary = T.importLibrary(JSON.stringify({ format: "learningtong-rubrics-v1", templates: local.gradingRubricLibraryV1 || [] }));
    savedCourses = (local.teachingOperationsExtension?.courses || []).filter(c => !c.archived && c.name);
    historicalSummaries = (local.gradingBatchSummaries || []).slice(0, 100);
    for (const course of savedCourses) { const option = node("option", course.name); option.value = course.id; $("course-select").append(option); $("saved-courses").append(node("p", `${course.name} · ${(course.classNames || []).join("、") || "班级范围待确认"}`)); }
    if (historicalSummaries.length) $("records").append(node("p", `已保存${historicalSummaries.length}条脱敏任务汇总。`));
    const r = await send({ type: "batch-restore" }); if (r.batch) { batch = r.batch; renderRubrics(); notice("已恢复本次会话草稿。中断提交须先核验，生成建议需重新授权。"); } await refreshTabs(); await loadConfig();
  } render(); })().catch(e => notice(e.message));
})();
