(() => {
  const core = globalThis.LearningTongAiGrading;
  if (!core || globalThis.__learningTongAiGradingPanel) return;
  globalThis.__learningTongAiGradingPanel = true;

  const PANEL_ID = "learningtong-ai-grading-panel";
  const EXTRACTABLE = new Set(["text", "code", "word", "pdf"]);
  const KIND_LABELS = { text: "文本", code: "代码", word: "Word", pdf: "PDF", image: "图片", other: "附件" };
  let pendingGrading;

  function send(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, (result) => resolve(result || { ok: false, reason: "扩展后台未响应，请重试。" })));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    const title = el("div", "latg-title", "教学运营助手 · AI 批改");
    const hint = el("div", "latg-hint", "点击后会把题目和学生答案发送到你配置的 AI 服务商；附件默认不发送。AI 只生成建议，确认后才会填入页面，且不会提交学习通。");
    const gradeButton = document.createElement("button");
    gradeButton.type = "button";
    gradeButton.className = "latg-button";
    gradeButton.textContent = "生成 AI 批改建议";
    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "latg-button latg-apply-button";
    applyButton.textContent = "应用建议到当前题";
    applyButton.hidden = true;
    const attachmentBar = el("div", "latg-attach-bar");
    attachmentBar.hidden = true;
    const rubricSection = el("div", "latg-rubric");
    const rubricStatus = el("div", "latg-rubric-status", "评分卡：加载中…");
    const rubricActions = el("div", "latg-rubric-actions");
    const editor = el("div", "latg-rubric-editor");
    editor.hidden = true;
    rubricSection.append(rubricStatus, rubricActions, editor);
    const status = el("div", "latg-status");
    status.hidden = true;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "latg-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "收起 AI 批改面板");
    close.addEventListener("click", () => { panel.remove(); globalThis.__learningTongAiGradingPanel = false; });
    gradeButton.addEventListener("click", () => runAiGrading(status, attachmentBar, gradeButton, applyButton));
    applyButton.addEventListener("click", () => {
      const applied = core.applyGrading(document, pendingGrading);
      if (!applied) { setStatus(status, "建议已生成，但当前页面分数框不可编辑，请手动填写。", "latg-warn"); return; }
      applyButton.hidden = true;
      setStatus(status, `已把建议 ${pendingGrading.score} 分${pendingGrading.comment ? "及评语" : ""}填入当前题；请人工核对后再点击学习通“提交”。`, "latg-ok");
      pendingGrading = undefined;
    });
    panel.append(title, hint, gradeButton, applyButton, attachmentBar, rubricSection, status, close);
    wireRubric(rubricStatus, rubricActions, editor);
    return panel;
  }

  function setStatus(status, text, tone) {
    status.hidden = false;
    status.textContent = text;
    status.className = `latg-status ${tone || ""}`;
  }

  async function runAiGrading(status, attachmentBar, gradeButton, applyButton) {
    pendingGrading = undefined;
    applyButton.hidden = true;
    const context = core.extractGradingContext(document);
    let binding;
    try {
      const kind = new URL(location.href).searchParams.get("ceyan") === "1" ? "chapter" : "assignment";
      const identity = LearningTongGradingAdapter.identityOf(document, location.href, kind);
      const snapshot = LearningTongGradingAdapter.readSnapshot(document, location.href, identity);
      if (snapshot.questions.length !== 1 || !snapshot.complete || snapshot.status !== "pending") throw new Error("请使用独立审核工作台处理多题或身份不明确的答案。");
      binding = { identity, key: LearningTongBatch.snapshotKey(snapshot) };
    } catch (e) { setStatus(status, e.message, "latg-error"); return; }
    if (!context.question) {
      setStatus(status, "未识别到题目内容：请确认当前页面是学习通作业批阅页。", "latg-error");
      return;
    }
    const configResponse = await send({ type: "ai-config-get" });
    if (!configResponse?.ok || !configResponse.config?.hasKey) {
      setStatus(status, "请先在扩展弹窗的“AI 批改设置”中配置并授权 API。", "latg-error");
      return;
    }
    const rubricResponse = await send({ type: "ai-rubric-get", questionKey: core.questionKeyOf(context) });
    try {
      LearningTongBatch.validateRubric(rubricResponse?.rubric, context.maxScore);
      context.rubric = rubricResponse.rubric;
    } catch {
      setStatus(status, "请先在评分卡面板起草或填写完整标准，并保存确认后再生成建议。", "latg-error");
      return;
    }
    const attachmentEnabled = configResponse.config.attachmentEnabled === true;
    const attachments = core.collectAttachments(document);
    if (attachments.length) {
      attachmentBar.hidden = false;
      attachmentBar.textContent = `检测到附件：${attachments.map((a) => `${a.fileName}（${KIND_LABELS[a.kind] || a.kind}）`).join("、")}`;
    }
    const pending = attachmentEnabled ? attachments.filter((a) => EXTRACTABLE.has(a.kind)) : [];
    for (const attachment of pending) {
      setStatus(status, `正在读取附件 ${attachment.fileName}…`, "");
      const result = await LearningTongAttachmentExtract.extract(attachment, (a) => send({ type: "ai-attachment-download", attachment: a }));
      if (result.ok) attachment.text = result.text;
      else attachment.error = result.reason;
    }
    context.attachments = attachmentEnabled ? attachments : [];
    const failed = attachmentEnabled ? attachments.filter((a) => EXTRACTABLE.has(a.kind) && !a.text) : [];
    if (failed.length || (attachmentEnabled && attachments.some(a => !EXTRACTABLE.has(a.kind)))) { setStatus(status, failed[0]?.error || "材料含图片或不支持附件，请使用独立审核工作台或人工复核。", "latg-error"); return; }
    if (attachments.length && !attachmentEnabled) { setStatus(status, "本题含附件但未授权完整读取，请使用独立审核工作台。", "latg-error"); return; }
    const missingAnswer = core.describeSubmission(context);
    if (missingAnswer) {
      setStatus(status, missingAnswer, "latg-error");
      return;
    }
    gradeButton.disabled = true;
    gradeButton.textContent = "正在评分…";
    setStatus(status, "正在调用 AI 评分…（通常 5–30 秒）", "");
    const response = await send({ type: "ai-grade-request", context: { ...context, criteria: undefined, scoreInputId: undefined, commentInputId: undefined } });
    gradeButton.disabled = false;
    gradeButton.textContent = "生成 AI 批改建议";
    if (!response?.ok) {
      setStatus(status, response?.reason || "AI 批改失败，请重试。", "latg-error");
      return;
    }
    pendingGrading = { ...response, binding };
    const dims = response.dimensionScores?.length ? `维度得分：${response.dimensionScores.map((d) => `${d.name} ${d.score}`).join(" / ")}。` : "";
    applyButton.hidden = false;
    const notice = response.dataNotice ? `${response.dataNotice}。` : "";
    setStatus(status, response.commentEnabled === false
      ? `AI 建议：${response.score} 分。${dims}${notice}尚未填入页面，请核对后点击“应用建议到当前题”。（模型：${response.model || "AI"}）`
      : `AI 建议：${response.score} 分。${dims}评语：${response.comment}。${notice}尚未填入页面，请核对后点击“应用建议到当前题”。（模型：${response.model || "AI"}）`, "latg-ok");
  }

  function wireRubric(rubricStatus, rubricActions, editor) {
    const questionKey = () => core.questionKeyOf(core.extractGradingContext(document));
    const contextOf = () => core.extractGradingContext(document);

    function refresh() {
      const key = questionKey();
      if (!key) { rubricStatus.textContent = "评分卡：未识别到题目。"; return; }
      send({ type: "ai-rubric-get", questionKey: key }).then((response) => {
        rubricActions.replaceChildren();
        if (response?.ok && response.rubric) {
          rubricStatus.textContent = `评分卡：${response.rubric.dimensions.length} 个维度，共 ${response.rubric.total} 分`;
          const editButton = el("button", "latg-mini-button", "编辑");
          const deleteButton = el("button", "latg-mini-button latg-mini-danger", "删除");
          editButton.addEventListener("click", () => openEditor(response.rubric.dimensions));
          deleteButton.addEventListener("click", async () => {
            await send({ type: "ai-rubric-delete", questionKey: key });
            editor.hidden = true;
            refresh();
          });
          rubricActions.append(editButton, deleteButton);
        } else {
          rubricStatus.textContent = "未设置评分卡（按批改口径评分）";
          const draftButton = el("button", "latg-mini-button", "AI 起草评分卡");
          draftButton.addEventListener("click", draftRubric);
          rubricActions.append(draftButton);
        }
      });
    }

    async function draftRubric() {
      rubricStatus.textContent = "正在起草评分卡…";
      const response = await send({ type: "ai-rubric-draft", context: contextOf() });
      if (!response?.ok) {
        setStatus(document.querySelector(`#${PANEL_ID} .latg-status`), response?.reason || "评分卡起草失败。", "latg-error");
        refresh();
        return;
      }
      openEditor(response.dimensions);
    }

    function row(dimension) {
      const rowEl = el("div", "latg-rubric-row");
      const name = document.createElement("input");
      name.className = "latg-input latg-input-name";
      name.value = dimension?.name || "";
      name.placeholder = "维度名";
      const score = document.createElement("input");
      score.className = "latg-input latg-input-score";
      score.type = "number";
      score.min = "0.5";
      score.step = "0.5";
      score.value = String(dimension?.maxScore ?? "");
      score.placeholder = "分值";
      const criteria = document.createElement("input");
      criteria.className = "latg-input latg-input-criteria";
      criteria.value = dimension?.criteria || "";
      criteria.placeholder = "判定标准";
      const remove = el("button", "latg-row-remove", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", "删除该维度");
      remove.addEventListener("click", () => rowEl.remove());
      rowEl.append(name, score, criteria, remove);
      return rowEl;
    }

    function openEditor(dimensions) {
      editor.replaceChildren();
      const list = el("div", "latg-rubric-list");
      for (const dimension of dimensions || []) list.append(row(dimension));
      const addButton = el("button", "latg-mini-button", "+ 添加维度");
      addButton.type = "button";
      addButton.addEventListener("click", () => list.append(row()));
      const saveButton = el("button", "latg-mini-button latg-mini-primary", "保存评分卡");
      saveButton.type = "button";
      const cancelButton = el("button", "latg-mini-button", "取消");
      cancelButton.type = "button";
      cancelButton.addEventListener("click", () => { editor.hidden = true; refresh(); });
      saveButton.addEventListener("click", async () => {
        const dimensionsData = [...list.querySelectorAll(".latg-rubric-row")].map((rowEl) => ({
          name: rowEl.querySelector(".latg-input-name").value,
          maxScore: Number(rowEl.querySelector(".latg-input-score").value),
          criteria: rowEl.querySelector(".latg-input:not(.latg-input-name):not(.latg-input-score)").value,
        }));
        const response = await send({ type: "ai-rubric-save", questionKey: questionKey(), rubric: { dimensions: dimensionsData }, context: contextOf() });
        const status = document.querySelector(`#${PANEL_ID} .latg-status`);
        if (!response?.ok) {
          setStatus(status, response?.reason || "评分卡保存失败。", "latg-error");
          return;
        }
        editor.hidden = true;
        setStatus(status, `评分卡已保存（${response.rubric.dimensions.length} 个维度，共 ${response.rubric.total} 分），同题将自动复用。`, "latg-ok");
        refresh();
      });
      const actions = el("div", "latg-rubric-actions");
      actions.append(addButton, cancelButton, saveButton);
      editor.append(list, actions);
      editor.hidden = false;
    }

    refresh();
  }

  function mount() {
    if (document.getElementById(PANEL_ID) || !document.querySelector(".TiMu, input.inputBranch.questionScore")) return;
    document.body.append(buildPanel());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
