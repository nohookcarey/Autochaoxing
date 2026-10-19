(() => {
  if (globalThis.__learningTongBatchAdapter) return;
  globalThis.__learningTongBatchAdapter = true;
  const A = globalThis.LearningTongGradingAdapter;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith("batch-page-")) return;
    try {
      if (message.type === "batch-page-material") {
        A.readEmbeddedMaterial(document, location.href, message.identity, message.attachment).then(data => respond({ ok: true, ...data })).catch(e => respond({ ok: false, reason: String(e.message || e) }));
        return true;
      }
      let data;
      if (message.type === "batch-page-discover") data = A.scopeOf(document, location.href, message.kind);
      else if (message.type === "batch-page-list") data = A.listEntries(document, location.href, message.scope);
      else if (message.type === "batch-page-roster") data = LearningTongRosterAdapter.readPage(document, location.href, message.scope);
      else if (message.type === "batch-page-read") data = A.readSnapshot(document, location.href, message.identity);
      else if (message.type === "batch-page-prepare") { A.prepareSubmission(document, location.href, message.plan); data = { prepared: true }; }
      else if (message.type === "batch-page-submit") data = A.applyAndSubmit(document, location.href, message.plan);
      else if (message.type === "batch-page-verify") data = A.verifyList(document, location.href, message.scope, message.identity, message.score);
      else return;
      respond({ ok: true, data });
    } catch (e) { respond({ ok: false, reason: String(e.message || e) }); }
  });
})();
