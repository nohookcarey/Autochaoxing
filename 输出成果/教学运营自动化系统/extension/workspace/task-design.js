(() => {
  const D = globalThis.LearningTongTaskDesign, $ = id => document.getElementById(id);
  const fieldIds = ["title", "objective", "deliverable", "naming", "submission", "deadline", "materials", "steps", "checkpoints", "total"];
  let basis = null, draftBasis = null, approval = null;
  const node = (tag, content) => { const n = document.createElement(tag); if (content !== undefined) n.textContent = content; return n; };
  const status = text => { $("task-status").textContent = text; };
  function invalidate() {
    basis = draftBasis = approval = null; $("task-confirm").checked = false;
    $("task-generate").disabled = $("task-confirm").disabled = $("task-md").disabled = $("task-html").disabled = true;
    $("task-issues").replaceChildren();
    status("资料已变化，原检查和审核稿失效；请重新检查。已有草稿保留供对照，不可导出。");
  }
  function labeled(parent, title, control) { const label = node("label", title); label.append(control); parent.append(label); return control; }
  function input(value, type, className) { const n = node(type === "textarea" ? "textarea" : "input"); if (type !== "textarea") n.type = type; n.value = value; n.className = className; n.addEventListener("input", invalidate); return n; }
  function rowEnd(row) { const remove = node("button", "移除此项"); remove.type = "button"; remove.className = "secondary"; remove.addEventListener("click", () => {
    const removingRequirement = row.parentElement.id === "task-requirements";
    row.remove(); reindex(); invalidate();
    if (removingRequirement) { $("task-dimensions").querySelectorAll(".task-mapping").forEach(n => n.value = ""); status("要求序号已变化，已清空全部评分关联，避免错位；请重新填写对应要求并检查。"); }
  }); row.append(remove); }
  function reindex() {
    [...$("task-requirements").children].forEach((r, n) => r.querySelector("strong").textContent = `要求${n + 1}`);
    [...$("task-dimensions").children].forEach((r, n) => r.querySelector("strong").textContent = `分项${n + 1}`);
  }
  function requirement(r = { text: "", graded: true }) {
    const list = $("task-requirements"); if (list.children.length >= 30) { status("任务要求最多30项，不会截断。"); return; }
    const row = node("div"); row.className = "task-row"; row.append(node("strong"));
    labeled(row, "学生任务要求", input(r.text, "textarea", "task-requirement-text"));
    const check = node("label", "此要求计分"); check.className = "check"; const box = input("", "checkbox", "task-graded"); box.checked = r.graded; check.prepend(box); row.append(check);
    rowEnd(row); list.append(row); reindex();
  }
  function dimension(d = { name: "", maxScore: "", criteria: "", requirements: [] }) {
    const list = $("task-dimensions"); if (list.children.length >= 30) { status("评分分项最多30项，不会截断。"); return; }
    const row = node("div"); row.className = "task-row"; row.append(node("strong"));
    const grid = node("div"); grid.className = "form-grid";
    labeled(grid, "分项名称", input(d.name, "text", "task-dimension-name"));
    const score = input(d.maxScore, "number", "task-score"); score.min = "0"; score.step = "any"; labeled(grid, "分项满分", score);
    const refs = input(d.requirements.join("、"), "text", "task-mapping"); refs.placeholder = "例如：1、2（要求序号）"; labeled(grid, "对应计分要求序号", refs); row.append(grid);
    labeled(row, "具体评分依据（教师提供）", input(d.criteria, "textarea", "task-criteria")); rowEnd(row); list.append(row); reindex();
  }
  function read() {
    const result = Object.fromEntries(fieldIds.map(k => [k, $("task-" + k).value])); result.total = result.total.trim() ? Number(result.total) : null;
    result.requirements = [...$("task-requirements").children].map(r => ({ text: r.querySelector(".task-requirement-text").value, graded: r.querySelector(".task-graded").checked }));
    result.dimensions = [...$("task-dimensions").children].map(r => ({ name: r.querySelector(".task-dimension-name").value, maxScore: r.querySelector(".task-score").value.trim() ? Number(r.querySelector(".task-score").value) : null, criteria: r.querySelector(".task-criteria").value, requirements: r.querySelector(".task-mapping").value.trim() ? r.querySelector(".task-mapping").value.split(/[、,，]/).map(v => /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN) : [] }));
    return result;
  }
  function reset(data) {
    fieldIds.forEach(k => $("task-" + k).value = data?.[k] ?? "");
    $("task-requirements").replaceChildren(); $("task-dimensions").replaceChildren();
    (data?.requirements || [{}]).forEach(r => requirement(Object.keys(r).length ? r : undefined));
    (data?.dimensions || [{}]).forEach(d => dimension(Object.keys(d).length ? d : undefined));
    $("task-draft").value = ""; invalidate();
    status(data ? "已载入教师自编模拟示例，请替换为实际任务要求；未连接学习通。" : "尚未检查。只填写教师任务资料，不粘贴学生作答、身份或凭据。");
  }
  const guard = action => { try { action(); } catch (e) { status(e.message); } };
  $("task-add-requirement").addEventListener("click", () => { requirement(); invalidate(); });
  $("task-add-dimension").addEventListener("click", () => { dimension(); invalidate(); });
  fieldIds.forEach(k => $("task-" + k).addEventListener("input", invalidate));
  $("task-example").addEventListener("click", () => reset(D.example()));
  $("task-clear").addEventListener("click", () => reset());
  $("task-check").addEventListener("click", () => guard(() => {
    invalidate(); const data = read(), r = D.analyze(data); basis = D.key(data);
    for (const issue of r.issues) { const item = node("p", `${issue.level === "block" ? "须修正" : "请核对"} · ${issue.message}（${D.targetName(issue.target)}）`); item.className = issue.level === "block" ? "task-block" : "task-warning"; $("task-issues").append(item); }
    const blocks = r.issues.filter(i => i.level === "block").length, warnings = r.issues.length - blocks;
    status(`检查完成：${blocks}项须修正，${warnings}项请人工核对；分项合计${r.sum}分。${r.boundary}`);
    $("task-generate").disabled = r.blocked;
  }));
  $("task-generate").addEventListener("click", () => guard(() => {
    const data = read(); if (!basis || basis !== D.key(data)) throw new Error("资料已变化，请重新检查。");
    $("task-draft").value = D.draft(data); draftBasis = basis; approval = null; $("task-confirm").checked = false; $("task-confirm").disabled = false;
    $("task-md").disabled = $("task-html").disabled = true; status("已根据教师填写内容整理审核稿；请补充待确认项并核对要求与评分依据，再勾选确认导出。");
  }));
  $("task-draft").addEventListener("input", () => { approval = null; $("task-confirm").checked = false; $("task-md").disabled = $("task-html").disabled = true; status("审核稿已修改，原导出确认失效；请重新核对并确认。"); });
  $("task-confirm").addEventListener("change", () => guard(() => {
    approval = null; $("task-md").disabled = $("task-html").disabled = true;
    if (!$("task-confirm").checked) return;
    const data = read(); if (!draftBasis || draftBasis !== D.key(data)) { $("task-confirm").checked = false; throw new Error("资料已变化，请重新检查并生成审核稿。"); }
    approval = D.approvalKey(data, $("task-draft").value); $("task-md").disabled = $("task-html").disabled = false;
    status("教师已确认本份审核稿，可导出后自行发布；未写入平台、未调用AI、未保存本机长期记录。");
  }));
  for (const format of ["md", "html"]) $("task-" + format).addEventListener("click", () => guard(() => {
    const data = read(); if (!draftBasis || draftBasis !== D.key(data) || !$("task-confirm").checked) throw new Error("请重新检查、生成并确认审核稿。");
    const content = D.approvedDraft(data, $("task-draft").value, approval), url = URL.createObjectURL(new Blob([format === "html" ? D.html(content) : content], { type: format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const a = node("a"); a.href = url; a.download = `学生任务说明_教师审核稿.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status("已导出教师审核稿，请自行核对实际课程、班级、入口与截止安排后发布。导出文件由教师保管。");
  }));
  reset();
})();
