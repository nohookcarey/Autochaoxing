(() => {
  const A = globalThis.LearningTongGradingAdapter, B = globalThis.LearningTongBatch;
  const text = e => B.norm(e?.innerText || e?.textContent), value = e => B.norm(e?.value ?? e?.getAttribute("value"));
  function readPage(doc, url, expected) {
    const scope = A.scopeOf(doc, url, expected.kind);
    if (["courseId", "classId", "workId"].some(k => scope[k] !== expected[k]) || ["courseName", "className", "workTitle"].some(k => scope[k] && scope[k] !== expected[k])) throw new Error("名单页面已切换课程、班级或任务。");
    const u = new URL(url);
    if (u.searchParams.get("status") !== "0" || u.searchParams.has("submit") || ["keyword", "search", "studentName", "studentNo", "submitStatus"].some(k => B.norm(u.searchParams.get(k)))) throw new Error("名单不是全部学生范围，不能从已交或待批筛选推算未交。");
    for (const name of ["keyword", "search", "studentName", "studentNo", "submitStatus", "submit"]) {
      if (value(doc.querySelector(`input[name="${name}"], select[name="${name}"]`))) throw new Error("页面还带有学生或提交筛选，未获取全部名单。");
    }
    const filter = doc.querySelector('select[name="status"], #status');
    const filterAll = filter?.tagName === "SELECT" ? value(filter) === "0" && /全部/.test(text(filter.selectedOptions?.[0])) : value(filter) === "0" && /全部学生|全部状态/.test(text(doc.body));
    if (!filterAll) throw new Error("页面缺少全部学生筛选的独立确认，未获取完整名单。");
    const totalRaw = value(doc.querySelector('#totalStudentCount, input[name="totalStudentCount"]')) || doc.querySelector('[data-total-students]')?.getAttribute('data-total-students');
    const pagesRaw = value(doc.querySelector('#totalPage, #totalPages, input[name="totalPage"]'));
    if (!/^\d+$/.test(totalRaw || "") || !/^\d+$/.test(pagesRaw)) throw new Error("页面缺少可核验的学生总数或分页数，请导入教师导出的完整名单。");
    const total = Number(totalRaw), totalPages = Number(pagesRaw);
    if (total > 5000 || totalPages < 1 || totalPages > 1000) throw new Error("名单人数或分页超过处理范围。");
    const rows = [...doc.querySelectorAll('ul.dataBody_td')];
    if (!rows.length && !(total === 0 && /暂无学生|没有学生|暂无数据/.test(text(doc.body)))) throw new Error("空列表不能证明完整名单已获取。");
    const header = [...doc.querySelectorAll('.dataBody_th > li, .dataHead > li')].map(text);
    const lookup = names => { const indexes = header.flatMap((v, n) => names.includes(v) ? [n] : []); if (indexes.length > 1) throw new Error("名单表头存在多个同义列，无法唯一定位。"); return indexes[0]; };
    const columns = { studentName: lookup(["姓名", "学生姓名"]), studentNo: lookup(["学号", "学生学号"]), submitTime: lookup(["提交时间", "交卷时间"]), status: lookup(["状态", "提交状态", "作业状态"]) };
    const records = rows.map(row => {
      const cells = [...row.querySelectorAll(':scope > li')];
      if (Object.values(columns).every(v => Number.isInteger(v))) return Object.fromEntries(Object.entries(columns).map(([key, n]) => [key, text(cells[n])]));
      // Known legacy teacher mark-list anatomy, never a generic table column guess.
      if (!row.querySelector('.py_name') || cells.length < 7) throw new Error("学生名单列无法可靠识别，转教师导入或人工核对。");
      return { studentName: text(row.querySelector('.py_name')), studentNo: text(cells[2]), submitTime: text(cells[3]), status: text(cells[5]) };
    });
    return { rows: records, total, totalPages, completeFilter: true };
  }
  globalThis.LearningTongRosterAdapter = Object.freeze({ readPage });
})();
