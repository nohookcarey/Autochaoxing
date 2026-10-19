(() => {
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

  const isNameLike = (text) => /^[\u4e00-\u9fa5·]{2,10}$/.test(normalize(text));
  const isStudentIdLike = (text) => /^\d{6,}$/.test(normalize(text));

  function findHeaderRow(rows) {
    const limit = Math.min(rows.length, 12);
    for (let i = 0; i < limit; i += 1) {
      const texts = (rows[i] || []).map(normalize);
      const hasName = texts.some((text) => /姓名/.test(text));
      const hasId = texts.some((text) => /学号|工号/.test(text));
      if (hasName || (hasId && texts.some(isNameLike))) return i;
    }
    for (let i = 0; i < limit; i += 1) {
      const texts = (rows[i] || []).map(normalize).filter(Boolean);
      if (texts.length >= 2 && texts.filter(isStudentIdLike).length >= 2) return i;
    }
    let dataLikeRows = 0;
    const checkLimit = Math.min(rows.length, 6);
    for (let i = 0; i < checkLimit; i += 1) {
      const cells = (rows[i] || []).map(normalize).filter(Boolean);
      if (cells.some(isStudentIdLike) && cells.some(isNameLike)) dataLikeRows += 1;
    }
    if (dataLikeRows >= 2) return -1;
    return -2;
  }

  function columnStats(rows, dataStart, colIndex) {
    let ids = 0;
    let names = 0;
    let filled = 0;
    for (let i = dataStart; i < rows.length; i += 1) {
      const cell = normalize((rows[i] || [])[colIndex]);
      if (!cell) continue;
      filled += 1;
      if (isStudentIdLike(cell)) ids += 1;
      else if (isNameLike(cell)) names += 1;
    }
    return { ids, names, filled };
  }

  function detectSheetStructure(rows, mode) {
    if (!Array.isArray(rows) || !rows.length) return { ok: false, reason: "表格为空，请确认上传的是签到表或成绩单。" };
    const headerIndex = findHeaderRow(rows);
    if (headerIndex === -2) return { ok: false, reason: "未找到学生名单表头（需包含“姓名”或“学号”列）。" };
    const noHeader = headerIndex === -1;
    const dataStart = noHeader ? 0 : headerIndex + 1;
    const header = noHeader ? [] : (rows[headerIndex] || []).map(normalize);
    let nameCol = header.findIndex((text) => /姓名/.test(text));
    let idCol = header.findIndex((text) => /学号|工号/.test(text));
    if (nameCol < 0 || idCol < 0) {
      for (let c = 0; c < Math.max(header.length, 8); c += 1) {
        const stats = columnStats(rows, dataStart, c);
        if (idCol < 0 && stats.filled >= 2 && stats.ids >= stats.filled * 0.6) idCol = c;
        else if (nameCol < 0 && stats.filled >= 2 && stats.names >= stats.filled * 0.6) nameCol = c;
      }
    }
    if (nameCol < 0 && idCol < 0) return { ok: false, reason: "未识别到姓名或学号列，请检查表格内容。" };
    if (nameCol === idCol) return { ok: false, reason: "姓名列与学号列识别冲突，请检查表头。" };

    let appendCols = [];
    let countCol = -1;
    let detailCol = -1;
    let scoreCol = -1;
    if (mode === "attendance") {
      if (!noHeader) {
        countCol = header.findIndex((text) => /签到异常|异常次数|异常数/.test(text));
        detailCol = header.findIndex((text) => /异常明细|异常说明|异常情况|异常描述/.test(text));
      }
      if (countCol < 0) appendCols.push({ header: "签到异常次数", kind: "count" });
      if (detailCol < 0) appendCols.push({ header: "签到异常明细", kind: "detail" });
    } else {
      if (!noHeader) {
        scoreCol = header.findIndex((text) => /综合成绩|期末成绩|总评成绩|最终成绩/.test(text));
        if (scoreCol < 0) scoreCol = header.findIndex((text) => /成绩|分数/.test(text) && !/平均/.test(text));
      }
      if (scoreCol < 0) appendCols.push({ header: "综合成绩", kind: "score" });
    }
    const dataRows = [];
    for (let i = dataStart; i < rows.length; i += 1) {
      const cells = (rows[i] || []).map(normalize);
      const name = nameCol >= 0 ? cells[nameCol] : "";
      const id = idCol >= 0 ? cells[idCol] : "";
      if (isNameLike(name) || isStudentIdLike(id)) dataRows.push(i);
    }
    if (!dataRows.length) return { ok: false, reason: "表格表头下未找到学生名单行。" };
    return { ok: true, headerIndex, noHeader, nameCol, idCol, countCol, detailCol, scoreCol, appendCols, dataRows };
  }

  function matchStudents(rows, structure, records) {
    const byUsername = new Map();
    const byName = new Map();
    const duplicatedNames = new Set();
    for (const record of records || []) {
      const username = normalize(record.username);
      const name = normalize(record.name);
      if (username && !byUsername.has(username)) byUsername.set(username, record);
      if (name) {
        if (byName.has(name) && byName.get(name) !== record) duplicatedNames.add(name);
        else byName.set(name, record);
      }
    }
    const matches = [];
    const matched = new Set();
    let nameOnlyMatches = 0;
    let unmatchedRows = 0;
    for (const rowIndex of structure.dataRows) {
      const cells = (rows[rowIndex] || []).map(normalize);
      const name = structure.nameCol >= 0 ? cells[structure.nameCol] : "";
      const username = structure.idCol >= 0 ? cells[structure.idCol] : "";
      let record = username ? byUsername.get(username) : undefined;
      let matchBy = record ? "学号" : "";
      if (!record && name && !duplicatedNames.has(name)) {
        record = byName.get(name);
        if (record) {
          matchBy = "姓名";
          nameOnlyMatches += 1;
        }
      }
      if (!record) {
        unmatchedRows += 1;
        continue;
      }
      matched.add(record);
      matches.push({ rowIndex, record, matchBy });
    }
    const unmatchedRecords = (records || []).filter((record) => !matched.has(record));
    return { matches, unmatchedRecords, unmatchedRows, nameOnlyMatches, duplicatedNames: [...duplicatedNames] };
  }

  function buildFillPlan(rows, structure, matchResult, mode) {
    const cells = [];
    let appendStart = 0;
    for (const row of rows) appendStart = Math.max(appendStart, (row || []).length);
    const appendOffset = {};
    structure.appendCols.forEach((col, index) => {
      appendOffset[col.kind] = appendStart + index;
      if (structure.headerIndex >= 0) cells.push({ row: structure.headerIndex, col: appendStart + index, value: col.header, numeric: false, isHeader: true });
    });
    const countCol = structure.countCol >= 0 ? structure.countCol : appendOffset.count;
    const detailCol = structure.detailCol >= 0 ? structure.detailCol : appendOffset.detail;
    const scoreCol = structure.scoreCol >= 0 ? structure.scoreCol : appendOffset.score;

    const matchedRowIndexes = new Set(matchResult.matches.map((match) => match.rowIndex));
    for (const rowIndex of structure.dataRows) {
      if (matchedRowIndexes.has(rowIndex)) continue;
      if (mode === "attendance") {
        if (countCol >= 0) cells.push({ row: rowIndex, col: countCol, value: "未匹配", numeric: false });
      }
    }
    for (const match of matchResult.matches) {
      if (mode === "attendance") {
        const record = match.record;
        const count = record.anomalyCount || 0;
        const detail = count > 0 ? (record.anomalySummary || "有异常") : "无异常";
        if (countCol >= 0) cells.push({ row: match.rowIndex, col: countCol, value: count, numeric: true });
        if (detailCol >= 0) cells.push({ row: match.rowIndex, col: detailCol, value: detail, numeric: false });
      } else {
        const record = match.record;
        if (scoreCol >= 0 && Number.isFinite(record.score)) {
          cells.push({ row: match.rowIndex, col: scoreCol, value: record.score, numeric: true });
        }
      }
    }
    return { cells, countCol, detailCol, scoreCol };
  }

  globalThis.LearningTongSheetFilling = { normalize, detectSheetStructure, matchStudents, buildFillPlan };
})();
