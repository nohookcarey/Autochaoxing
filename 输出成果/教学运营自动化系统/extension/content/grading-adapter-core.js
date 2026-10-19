(() => {
  const B = globalThis.LearningTongBatch;
  const text = node => B.norm(node?.innerText || node?.textContent);
  const val = (doc, names) => { for (const name of names) { const v = doc.querySelector(`#${name}, input[name="${name}"]`)?.value; if (B.norm(v)) return B.norm(v); } return ""; };
  const trustedUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && (u.hostname === "chaoxing.com" || u.hostname.endsWith(".chaoxing.com")); } catch { return false; } };
  function identityOf(doc, url, kind) {
    const u = new URL(url);
    const param = (...names) => { for (const name of names) if (u.searchParams.get(name)) return B.norm(u.searchParams.get(name)); return ""; };
    return { kind, courseId: val(doc, ["courseId", "courseid"]) || param("courseId", "courseid"), classId: val(doc, ["clazzId", "clazzid", "classId"]) || param("clazzId", "clazzid", "classId"), workId: val(doc, ["workId", "workid"]) || param("workId", "workid"), answerId: val(doc, ["workAnswerId", "answerId"]) || param("workAnswerId", "answerId") };
  }
  function scopeOf(doc, url, kind) {
    if (!trustedUrl(url) || !["assignment", "chapter"].includes(kind)) throw new Error("仅支持学习通教师批阅页面。");
    if (doc.querySelector('input[type="password"]') || /登录超星|账号登录|短信登录/.test(text(doc.body).slice(0, 300))) throw new Error("需人工登录。");
    const u = new URL(url);
    const identity = identityOf(doc, url, kind);
    if (!identity.courseId || !identity.classId || !identity.workId || !/\/work\/.*(?:mark-list|review-work|mark)$/.test(u.pathname)) throw new Error("请先打开目标班级的教师待批列表，不能从统计外壳批改。");
    const listSignal = doc.querySelector("ul.dataBody_td, .dataBody, #workAnswerId, input[name='workAnswerId']");
    const roleSignal = /待批|批阅|批改|学生答案|已批/.test(text(doc.body));
    if (!listSignal || !roleSignal) throw new Error("教师批阅角色缺少两个独立信号。");
    const courseName = text(doc.querySelector('.courseName, .course-name, [data-course-name], #courseName')) || val(doc, ["courseName"]);
    const className = text(doc.querySelector('.clazzName, .className, .class-name, #clazzName')) || val(doc, ["clazzName", "className"]);
    const workTitle = text(doc.querySelector('h2.mark_title, #workTitle, .work-title, h1')) || val(doc, ["workTitle", "title"]);
    return { ...identity, courseName, className, workTitle, listUrl: u.href, detected: Boolean(courseName && className && workTitle) };
  }
  function listEntries(doc, url, scope) {
    const actual = identityOf(doc, url, scope.kind);
    if (["courseId", "classId", "workId"].some(k => actual[k] !== scope[k])) throw new Error("列表课程或班级与确认范围不一致。");
    const rows = [...doc.querySelectorAll("ul.dataBody_td")];
    if (!rows.length && !/暂无数据|暂无待批|没有待批/.test(text(doc.body))) throw new Error("页面结构变化，未获取待批列表。");
    const entries = [];
    for (const row of rows) {
      const link = [...row.querySelectorAll("a[data], a[href]")].find(a => /review-work/.test(a.getAttribute("data") || a.getAttribute("href") || ""));
      if (!link) throw new Error("列表行缺少可核验批阅入口。");
      const reviewUrl = new URL(link.getAttribute("data") || link.getAttribute("href"), url).href;
      if (!trustedUrl(reviewUrl)) throw new Error("批阅链接不属于学习通可信域名。");
      const identity = identityOf(doc, reviewUrl, scope.kind);
      const answerId = new URL(reviewUrl).searchParams.get("workAnswerId") || new URL(reviewUrl).searchParams.get("answerId") || B.norm(row.id).replace(/^workAnswer_?/, "");
      identity.answerId = answerId;
      B.identityKey(identity);
      if (["courseId", "classId", "workId"].some(k => identity[k] !== scope[k])) throw new Error("批阅链接与列表范围不一致。");
      const statusNode = row.querySelector('[data-status], .status, .workStatus') || row.querySelectorAll(":scope > li")[5];
      if (!statusNode) throw new Error("列表缺少可核验状态列。");
      const statusText = text(statusNode);
      const explicitlyPending = /待批|未批/.test(statusText);
      const scoreInput = row.querySelector("input.scoreInput");
      const scoreValue = B.norm(scoreInput?.getAttribute("data") || scoreInput?.value);
      const explicitlyGraded = /已批/.test(statusText) || (statusText === "已完成" && scoreValue !== "" && Number.isFinite(Number(scoreValue)));
      entries.push({ identity, reviewUrl, status: explicitlyGraded ? "graded" : explicitlyPending ? "pending" : "unknown" });
    }
    const pagesValue = val(doc, ["totalPage", "totalPages"]);
    if (!pagesValue && rows.length) throw new Error("分页信息缺失，不能证明已扫描全部范围。");
    const totalPages = Number(pagesValue || 1);
    if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > 1000) throw new Error("分页总数无法核验。");
    return { entries, totalPages, explicitEmpty: !rows.length };
  }
  function readSnapshot(doc, url, expected) {
    const identity = identityOf(doc, url, expected.kind);
    if (B.identityKey(identity) !== B.identityKey(expected)) throw new Error("当前答案身份与选中条目不一致。");
    // New teacher pages use one outer .TiMu for several .mark_item1 questions.
    const items = [...doc.querySelectorAll(".mark_item, .mark_item1")].filter(n => n.querySelector(".mark_name") && n.querySelector(".mark_answer_key"));
    const containers = items.length ? items : [...doc.querySelectorAll(".TiMu")];
    if (!containers.length) throw new Error("页面结构变化，未读取到完整题目。");
    const questions = containers.map((box, index) => {
      const input = box.querySelector("input.questionScore, input.inputBranch.questionScore");
      const maxInput = box.querySelector('input[name^="qscore"]');
      const inputId = input?.id || "";
      const id = val(box, ["questionId"]) || box.getAttribute("data-question-id") || box.id || inputId || maxInput?.name?.replace(/^qscore[_-]?/, "") || "";
      const question = text(box.querySelector(".mark_name"));
      const answer = box.querySelector(".mark_answer_key");
      const body = B.norm(answer?.textContent || answer?.innerText);
      const extract = (label, end) => { const p = body.indexOf(label); if (p < 0) return ""; const start = p + label.length; const q = end ? body.indexOf(end, start) : -1; return B.norm(body.slice(start, q < 0 ? undefined : q)).replace(/^[：:]/, "").trim(); };
      const maxScore = Number(maxInput?.value || (question.match(/[（(]\s*([\d.]+)\s*分/) || [])[1]);
      const automatic = Boolean(input && (input.readOnly || input.disabled)) && /单选|多选|判断|客观/.test(question + text(box.querySelector(".questionType")));
      const studentNode = answer?.querySelector(".studentAns .stuAnswerWords, .studentAns dd");
      const referenceNode = answer?.querySelector(".hiddenAnswer dd, .colorGreen dd");
      const studentAnswer = studentNode ? B.norm(studentNode.textContent) : extract("学生答案", "正确答案");
      const referenceAnswer = referenceNode ? B.norm(referenceNode.textContent) : extract("正确答案", "");
      // Never mistake embedded viewer metadata for the original file's contents.
      const embedded = [...answer?.querySelectorAll("iframe.attach-iframe, .editor-iframe iframe") || []];
      let unresolvedMaterials = embedded.map((frame, n) => ({ index: n + 1, kind: globalThis.LearningTongAiGrading.classifyAttachment(frame.getAttribute("filename") || ""), objectId: B.norm(frame.getAttribute("objectid")), source: frame.getAttribute("src") || "", role: frame.closest?.(".studentAns") ? "学生答案" : "材料角色需核实" }));
      const attachments = globalThis.LearningTongAiGrading.collectAttachments({ querySelector: selector => selector === ".mark_answer_key" ? { closest: () => box } : box, body: box });
      // Only the native attachment viewer observed on teacher pages is resolvable.
      for (const [n, frame] of embedded.entries()) {
        const meta = unresolvedMaterials.find(m => m.index === n + 1);
        try {
          const source = new URL(meta.source, url);
          if (!trustedUrl(source.href) || source.origin !== new URL(url).origin || source.pathname !== "/ananas/common-modules/attachment/insertCloud.html" || source.search || !/^[a-f0-9]{32}$/i.test(meta.objectId) || meta.role !== "学生答案") continue;
          const kind = globalThis.LearningTongAiGrading.classifyAttachment(frame.getAttribute("filename") || `材料.${frame.getAttribute("filetype") || ""}`);
          if (!["word", "pdf", "text", "image"].includes(kind)) continue;
          attachments.push({ href: new URL(`/ananas/status/${meta.objectId}`, source).href, objectId: meta.objectId, resolver: "chaoxing-status", fileName: frame.getAttribute("filename") || `材料.${frame.getAttribute("filetype")}`, kind, role: meta.role });
          meta.resolved = true;
        } catch {}
      }
      unresolvedMaterials = unresolvedMaterials.filter(m => !m.resolved);
      const roleOf = element => {
        if (!answer?.contains(element)) return "题干或其他材料，需核实";
        try { const range = doc.createRange(); range.selectNodeContents(answer); range.setEndBefore(element); const prefix = range.toString(); const student = prefix.lastIndexOf("学生答案"), reference = prefix.lastIndexOf("正确答案"); return reference > student ? "参考答案" : student >= 0 ? "学生答案" : "材料角色未定位"; } catch { return "材料角色未定位"; }
      };
      for (const a of attachments.filter(a => !a.resolver)) { const anchor = [...box.querySelectorAll("a[href]")].find(n => new URL(n.getAttribute("href"), url).href === a.href); a.role = anchor ? roleOf(anchor) : "材料角色未定位"; }
      for (const image of answer?.querySelectorAll("img[src]") || []) {
        const href = new URL(image.getAttribute("src"), url).href;
        if (!trustedUrl(href)) throw new Error("答案图片来源无法核验，需人工复核。");
        if (!attachments.some(a => a.href === href)) attachments.push({ href, fileName: `答案图片${index + 1}-${attachments.length + 1}.png`, kind: "image", role: roleOf(image) });
      }
      return { id: B.norm(id), inputId, question, studentAnswer, referenceAnswer, unresolvedMaterials, maxScore, automatic, existingScore: automatic && B.norm(input?.value) ? Number(input.value) : null, attachments, editable: Boolean((input && input.id && !input.readOnly && !input.disabled) || expected.kind === "chapter") };
    });
    const totalInput = doc.querySelector("#tmpscore");
    const totalMax = Number(val(doc, ["fullScore", "totalScore", "workScore"]) || questions.reduce((s, q) => s + q.maxScore, 0));
    const statusValue = val(doc, ["isMarked", "markStatus", "workStatus"]);
    const bodyText = text(doc.body);
    const graded = statusValue === "1" || /已批/.test(text(doc.querySelector(".workStatus, .mark-status")));
    const pending = !graded && (/待批阅|待批改|学生答案|批阅/.test(bodyText)) && Boolean(doc.querySelector("#workAnswerId, input[name='workAnswerId']"));
    const unresolved = questions.some(q => q.unresolvedMaterials.length);
    const missingAnswer = questions.some(q => !q.automatic && !q.studentAnswer && !q.attachments.length);
    const expectedCount = doc.querySelectorAll(".mark_name").length;
    const complete = !unresolved && !missingAnswer && expectedCount === questions.length && questions.every(q => q.id && q.question && Number.isFinite(q.maxScore) && (q.automatic || q.editable)) && Boolean(totalInput && !totalInput.disabled && !totalInput.readOnly);
    return { identity, status: graded ? "graded" : pending ? "pending" : "unknown", questions, totalMax, complete, assignmentTitle: text(doc.querySelector("h2.mark_title")), reason: complete ? "" : unresolved ? "已发现内嵌附件，但尚未读取原文件；不得生成分数或提交，需人工复核。" : missingAnswer ? "学生答案及附件未获取；不能将未获取当作空白作答评分。" : "完整题目标识、题数、可编辑分数框或总分框无法核验。" };
  }
  async function readEmbeddedMaterial(doc, url, identity, attachment, fetcher = fetch) {
    const snapshot = readSnapshot(doc, url, identity);
    if (snapshot.status !== "pending" || !snapshot.questions.some(q => q.attachments.some(a => B.canonical(a) === B.canonical(attachment))) || attachment.resolver !== "chaoxing-status") throw new Error("附件与当前学生提交不一致，请重新读取。");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    async function bytes(response, limit) {
      if (!response.ok || Number(response.headers.get("content-length")) > limit) throw new Error("附件未获取或超限。");
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error("附件超限，不会截断评分。"); chunks.push(value); }
      } finally { await reader.cancel(); }
      const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
    }
    try {
      const metadata = JSON.parse(new TextDecoder().decode(await bytes(await fetcher(attachment.href, { credentials: "include", redirect: "error", signal: controller.signal }), 65536)));
      if (metadata.objectid !== attachment.objectId || !metadata.download || Number(metadata.length) > 15000000) throw new Error("原文件身份不匹配或附件超限。");
      // Native viewer upgrades its HTTP CDN address to HTTPS. No cookies go to CDN.
      const download = new URL(metadata.download);
      if (download.protocol === "http:") download.protocol = "https:";
      if (download.protocol !== "https:" || download.hostname !== "d0.cldisk.com" || download.port || download.username || download.password || download.hash || !/^\/download\/[a-f0-9]{32}$/i.test(download.pathname)) throw new Error("附件下载来源尚未核验，需人工复核。");
      const data = await bytes(await fetcher(download.href, { credentials: "omit", redirect: "error", signal: controller.signal }), 15000000);
      if (!data.length || (Number(metadata.length) > 0 && data.length !== Number(metadata.length))) throw new Error("原文件长度不一致，材料未完整获取。");
      const fresh = readSnapshot(doc, url, identity);
      if (B.snapshotKey(fresh) !== B.snapshotKey(snapshot) || fresh.status !== "pending") throw new Error("读取期间答案发生变化。");
      let binary = ""; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
      return { dataBase64: btoa(binary) };
    } finally { clearTimeout(timer); }
  }
  function prepareSubmission(doc, url, plan) {
    const fresh = readSnapshot(doc, url, plan.identity);
    if (!fresh.complete || fresh.status !== "pending" || B.snapshotKey(fresh) !== plan.snapshotKey) throw new Error("提交前身份、答案、状态或材料发生变化。");
    const expected = fresh.questions.filter(q => !q.automatic);
    if (fresh.identity.kind === "assignment" && (expected.some(q => !q.inputId || !doc.getElementById(q.inputId)) || new Set(expected.map(q => q.inputId)).size !== expected.length)) throw new Error("分数控件无法逐题唯一定位。");
    if (!Array.isArray(plan.questions) || plan.questions.length !== expected.length || new Set(plan.questions.map(q => q.id)).size !== expected.length) throw new Error("提交分项不完整或重复。");
    let sum = fresh.questions.filter(q => q.automatic).reduce((s, q) => s + q.existingScore, 0);
    for (const q of expected) { const p = plan.questions.find(p => p.id === q.id); if (!p || !Number.isFinite(p.score) || p.score < 0 || p.score > q.maxScore) throw new Error("提交分数越界。"); sum += p.score; }
    if (!Number.isFinite(plan.total) || Math.abs(sum - plan.total) > 0.001 || plan.total > fresh.totalMax) throw new Error("提交总分不一致。");
    const buttons = [...doc.querySelectorAll("a.btnBlue, button, input[type='submit']")].filter(n => /^(提交|提交批阅|保存并继续|保存并下一份)$/.test(text(n) || n.value || "") || /markAction\(1\)/.test(n.getAttribute("onclick") || ""));
    if (buttons.length !== 1 || buttons[0].disabled) throw new Error("平台提交入口无法唯一定位。");
    if (fresh.identity.kind === "chapter" && !/markAction\s*\(\s*1\s*\)/.test(buttons[0].getAttribute("onclick") || "")) throw new Error("章节测试总分提交入口尚未核验，转人工处理。");
    const commentInput = doc.querySelector('textarea[name="comment"]');
    if (plan.comment !== null && (!commentInput || commentInput.disabled || commentInput.readOnly)) throw new Error("当前页面没有可编辑的评语控件。");
    return { fresh, button: buttons[0] };
  }
  function applyAndSubmit(doc, url, plan) {
    const { fresh, button } = prepareSubmission(doc, url, plan);
    for (const q of fresh.questions.filter(q => !q.automatic && fresh.identity.kind !== "chapter")) {
      const input = doc.getElementById(q.inputId); if (!input) throw new Error("题目分数框身份无法定位。");
      input.value = String(plan.questions.find(p => p.id === q.id).score);
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const total = doc.querySelector("#tmpscore"); total.value = String(plan.total); total.dispatchEvent(new Event("input", { bubbles: true })); total.dispatchEvent(new Event("change", { bubbles: true }));
    if (plan.comment !== null) { const comment = doc.querySelector('textarea[name="comment"]'); comment.value = String(plan.comment); comment.dispatchEvent(new Event("input", { bubbles: true })); }
    // Only the independently validated native submit control is used; never call arbitrary page code.
    button.click(); return { dispatched: true };
  }
  function verifyList(doc, url, scope, expected, score) {
    const list = listEntries(doc, url, scope);
    const row = [...doc.querySelectorAll("ul.dataBody_td")].find(row => B.norm(row.id).replace(/^workAnswer_?/, "") === expected.answerId || [...row.querySelectorAll("a[data], a[href]")].some(a => { try { return new URL(a.getAttribute("data") || a.getAttribute("href"), url).searchParams.get("workAnswerId") === expected.answerId; } catch { return false; } }));
    const entry = list.entries.find(e => B.identityKey(e.identity) === B.identityKey(expected));
    const scoreInput = row?.querySelector("input.scoreInput");
    const rawScore = scoreInput && (scoreInput.getAttribute("data") || scoreInput.value || scoreInput.getAttribute("value"));
    const value = B.norm(rawScore) ? Number(rawScore) : NaN;
    return { verified: Boolean(entry && entry.status === "graded" && Number.isFinite(value) && Math.abs(value - score) < 0.001), found: Boolean(entry), list };
  }
  globalThis.LearningTongGradingAdapter = Object.freeze({ trustedUrl, identityOf, scopeOf, listEntries, readSnapshot, readEmbeddedMaterial, prepareSubmission, applyAndSubmit, verifyList });
})();
