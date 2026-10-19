(() => {
  const core = globalThis.LearningTongSheetFilling;
  const bridge = globalThis.LearningTongPopupBridge;
  if (!core || !bridge) return;
  const extensionApi = globalThis.chrome;

  const MODES = {
    attendance: { buttonId: "#fill-attendance-sheet", inputId: "#attendance-sheet-file", statusId: "#fill-attendance-status", fileLabel: "签到表", view: "attendance-students", taskName: "签到异常统计填表", prefix: "签到异常统计" },
    score: { buttonId: "#fill-score-sheet", inputId: "#score-sheet-file", statusId: "#fill-score-status", fileLabel: "成绩单", view: "score-students", taskName: "期末成绩填表", prefix: "成绩单" },
  };

  function statusPayload(state, reason) { return { acquisitionState: state, reason }; }

  function setCardStatus(mode, kind, text) {
    const node = document.querySelector(MODES[mode].statusId);
    if (!node) return;
    node.className = `fill-card-status${kind ? ` ${kind}` : ""}`;
    node.textContent = text;
  }

  function report(payload) {
    bridge.renderResult(payload);
    const result = document.querySelector("#result");
    if (result) result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function fetchRecords(mode) {
    if (bridge.state.demoMode) return globalThis.LearningTongDemoMode.result(MODES[mode].view);
    const profile = bridge.activeCourse();
    if (!profile?.name) return { acquisitionState: "未获取", reason: "请先选择并保存课程。" };
    if (mode === "attendance") {
      return await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "scan-active-attendance-students", courseName: profile.name }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未返回签到学生扫描结果。" })));
    }
    return await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "scan-active-score-students", profile: { courseName: profile.name, classNames: profile.classNames } }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未返回成绩明细扫描结果。" })));
  }

  function pickSheet(workbook, mode) {
    const XLSX = globalThis.XLSX;
    const names = workbook.SheetNames || [];
    for (const name of names) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: true, defval: "" });
      const structure = core.detectSheetStructure(rows, mode);
      if (structure.ok) return { name, rows, structure };
    }
    return undefined;
  }

  function applyFill(ws, plan) {
    const XLSX = globalThis.XLSX;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
    for (const cell of plan.cells) {
      ws[XLSX.utils.encode_cell({ r: cell.row, c: cell.col })] = cell.numeric ? { t: "n", v: cell.value } : { t: "s", v: String(cell.value) };
      if (cell.row > range.e.r) range.e.r = cell.row;
      if (cell.col > range.e.c) range.e.c = cell.col;
    }
    ws["!ref"] = XLSX.utils.encode_range(range);
  }

  function verifyWorkbook(data, sheetName, plan) {
    const XLSX = globalThis.XLSX;
    const reread = XLSX.read(data, { type: "array" });
    const sheet = reread.Sheets[sheetName];
    if (!sheet) return { ok: false, reason: `生成文件中未找到目标工作表“${sheetName}”。` };
    for (const cell of plan.cells) {
      const address = XLSX.utils.encode_cell({ r: cell.row, c: cell.col });
      const actual = sheet[address]?.v;
      if (cell.numeric ? Number(actual) !== Number(cell.value) : String(actual ?? "") !== String(cell.value)) {
        return { ok: false, reason: `生成文件回读不一致：${sheetName}!${address}。` };
      }
    }
    return { ok: true };
  }

  function downloadWorkbook(data, mode) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
    const courseName = core.normalize(bridge.state.demoMode ? "演示课程" : (bridge.activeCourse()?.name || "")).slice(0, 24);
    const fileName = `${MODES[mode].prefix}_${courseName || "未命名课程"}_${stamp}.xlsx`;
    const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return fileName;
  }

  async function runSheetFilling(mode, file) {
    const config = MODES[mode];
    const button = document.querySelector(config.buttonId);
    bridge.setButtonBusy(button, true, "处理中…");
    setCardStatus(mode, "busy", `已导入「${file.name}」，正在解析表格…`);
    try {
      if (!globalThis.XLSX) {
        report(statusPayload("未获取", "表格组件未加载，请重新打开扩展弹窗。"));
        setCardStatus(mode, "error", "表格组件未加载，请重新打开扩展弹窗。");
        return;
      }
      report(statusPayload("正在读取", `正在解析上传的${config.fileLabel}…`));
      const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = pickSheet(workbook, mode);
      if (!sheet) {
        report(statusPayload("未获取", "表格中没有可用工作表。"));
        setCardStatus(mode, "error", "「" + file.name + "」中没有可用工作表。");
        return;
      }
      const structure = sheet.structure;
      if (!structure.ok) {
        report(statusPayload("未获取", structure.reason));
        setCardStatus(mode, "error", structure.reason);
        return;
      }

      const scanningText = mode === "attendance" ? "正在扫描各班级签到活动学生明细…" : "正在读取当前班级学生成绩明细…";
      setCardStatus(mode, "busy", `表格解析成功（${structure.dataRows.length} 名学生），${scanningText}`);
      report(statusPayload("正在读取", scanningText));
      const payload = await fetchRecords(mode);
      if (payload.acquisitionState === "未获取") {
        report(payload);
        setCardStatus(mode, "error", payload.reason || "未获取到学生数据。");
        return;
      }
      const records = mode === "attendance" ? payload.studentRecords : payload.students;
      if (!Array.isArray(records) || !records.length) {
        const reason = "扫描完成但没有学生记录，请确认课程范围或页面加载状态。";
        report(statusPayload("未获取", reason));
        setCardStatus(mode, "error", reason);
        return;
      }

      setCardStatus(mode, "busy", `已获取 ${records.length} 名学生记录，正在匹配并填入表格…`);
      const match = core.matchStudents(sheet.rows, structure, records);
      if (!match.matches.length) {
        const reason = `表格中的学生与扫描记录（${records.length} 人）未匹配：请检查表格的姓名/学号列与学习通名单是否一致。`;
        report(statusPayload("未获取", reason));
        setCardStatus(mode, "error", reason);
        return;
      }
      if (mode === "score" && match.nameOnlyMatches) {
        const reason = `成绩表存在 ${match.nameOnlyMatches} 人只能按姓名匹配。为避免错填，成绩模式必须全部通过学号匹配。`;
        report(statusPayload("待人工复核", reason));
        setCardStatus(mode, "error", reason);
        return;
      }
      const plan = core.buildFillPlan(sheet.rows, structure, match, mode);
      const targetLabel = mode === "attendance" ? "签到异常次数与明细" : "综合成绩";
      const preview = `准备处理工作表“${sheet.name}”：表中 ${structure.dataRows.length} 人，匹配 ${match.matches.length} 人，未匹配 ${match.unmatchedRows} 行，姓名匹配 ${match.nameOnlyMatches} 人；将写入${targetLabel}。\n\n确认后生成新文件，不覆盖原文件。`;
      if (!globalThis.confirm(preview)) {
        report(statusPayload("已取消", "已取消表格生成，原文件未修改。"));
        setCardStatus(mode, "", "已取消，原文件未修改。");
        return;
      }
      applyFill(workbook.Sheets[sheet.name], plan);
      const data = globalThis.XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const verification = verifyWorkbook(data, sheet.name, plan);
      if (!verification.ok) {
        report(statusPayload("回读失败", `${verification.reason} 未下载文件。`));
        setCardStatus(mode, "error", `${verification.reason} 未下载文件。`);
        return;
      }
      const fileName = downloadWorkbook(data, mode);

      const matchedBy = match.nameOnlyMatches ? `（学号匹配 ${match.matches.length - match.nameOnlyMatches} 人、姓名匹配 ${match.nameOnlyMatches} 人）` : "";
      const unmatchedInfo = match.unmatchedRecords.length
        ? `另有 ${match.unmatchedRecords.length} 名扫描到的学生未在表中匹配：${match.unmatchedRecords.slice(0, 5).map((record) => record.name || record.username).join("、")}${match.unmatchedRecords.length > 5 ? " 等" : ""}，请人工核对。`
        : "";
      let detail = "";
      if (mode === "attendance") {
        const anomalyStudents = records.filter((record) => (record.anomalyCount || 0) > 0);
        const anomalyRecords = records.reduce((sum, record) => sum + (record.anomalyCount || 0), 0);
        detail = `签到异常 ${anomalyStudents.length} 人共 ${anomalyRecords} 条记录；已按异常次数与明细填入表格，无异常学生填“0/无异常”。`;
      } else {
        detail = `已把${payload.activeClass ? `“${payload.activeClass}”` : "当前班级"} ${records.length} 名学生的综合成绩填入表格；如需填其他班级，请在学习通成绩页切换班级后重复操作。`;
      }
      const unmatchedRowsInfo = match.unmatchedRows ? `表中 ${match.unmatchedRows} 行未匹配（保留“未匹配”标记）。` : "";
      const summary = `已生成并回读核验${config.taskName}：${fileName}。表格 ${structure.dataRows.length} 名学生，匹配 ${match.matches.length} 人${matchedBy}。${detail}${unmatchedRowsInfo}${unmatchedInfo}`;
      report({ acquisitionState: "采集到", reason: summary });
      setCardStatus(mode, "ok", `已完成并下载：${fileName}（匹配 ${match.matches.length} 人${matchedBy}）。${unmatchedRowsInfo}${unmatchedInfo}`);
      const taskPayload = statusPayload("采集到", bridge.state.demoMode ? `脱敏演示：已生成${config.taskName}（模拟数据）。` : `已生成${config.taskName}文件，学生明细仅在内存中处理，未保存。`);
      bridge.state.runs = [bridge.createRun(taskPayload, config.taskName), ...bridge.state.runs].slice(0, 100);
      await bridge.save();
    } catch (error) {
      const reason = `填表失败：${core.normalize(error?.message || error).slice(0, 160)}`;
      report(statusPayload("未获取", reason));
      setCardStatus(mode, "error", reason);
    } finally {
      bridge.setButtonBusy(button, false);
    }
  }

  function bindMode(mode) {
    const config = MODES[mode];
    const button = document.querySelector(config.buttonId);
    const input = document.querySelector(config.inputId);
    if (!button || !input) return;
    button.addEventListener("click", () => {
      input.value = "";
      input.click();
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) runSheetFilling(mode, file);
    });
  }

  bindMode("attendance");
  bindMode("score");
})();
