(() => {
  const attentionStates = new Set(["未获取", "需人工登录", "页面结构变化", "权限不足", "待人工复核"]);
  const completedStates = new Set(["采集到", "确认无数据", "演示回读通过", "已取消"]);

  function list(runs) {
    return Array.isArray(runs) ? runs : [];
  }

  function category(run) {
    const state = String(run?.state || "");
    if (attentionStates.has(state)) return "attention";
    if (completedStates.has(state)) return "completed";
    return "other";
  }

  function filterRuns(runs, mode = "all") {
    if (mode === "all") return list(runs);
    return list(runs).filter((run) => category(run) === mode);
  }

  function summarize(runs) {
    return list(runs).reduce((summary, run) => {
      summary.total += 1;
      const key = category(run);
      if (key === "attention") summary.attention += 1;
      if (key === "completed") summary.completed += 1;
      return summary;
    }, { total: 0, attention: 0, completed: 0 });
  }

  globalThis.LearningTongRunHistory = Object.freeze({ category, filterRuns, summarize });
})();
