(() => {
  const B = globalThis.LearningTongBatch;
  const trusted = sender => sender?.id === chrome.runtime.id && sender?.url === chrome.runtime.getURL("workspace/workspace.html");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tabCall = (method, ...args) => new Promise((resolve, reject) => chrome.tabs[method](...args, result => chrome.runtime.lastError ? reject(new Error("浏览器标签页不可用。")) : resolve(result)));
  async function page(tabId, message, frameId = 0) {
    return new Promise(resolve => chrome.tabs.sendMessage(tabId, message, { frameId }, result => { const error = chrome.runtime.lastError; resolve(result || { ok: false, reason: error ? "批阅页面未就绪。" : "页面未响应。" }); }));
  }
  async function navigate(tabId, url) {
    if (!LearningTongGradingAdapter.trustedUrl(url)) throw new Error("只允许学习通页面导航。");
    await tabCall("update", tabId, { url });
    for (let i = 0; i < 80; i++) {
      const tab = await tabCall("get", tabId);
      if (tab.status === "complete" && tab.url === url) return;
      if (tab.status === "complete" && /passport|login/.test(tab.url || "")) throw new Error("需人工登录。");
      await sleep(200);
    }
    throw new Error("页面导航超时，未获取。");
  }
  const keyFor = id => `gradingBatch:${id}`;
  const tokenFor = token => `gradingSubmit:${token}`;
  async function load(id) { return (await chrome.storage.session.get(keyFor(id)))[keyFor(id)]; }
  async function save(batch) {
    if (JSON.stringify(batch).length > 7000000) throw new Error("本次会话材料过多，请缩小批次，不会将学生数据写入磁盘。");
    await chrome.storage.session.set({ [keyFor(batch.id)]: batch, gradingActiveBatch: batch.id });
  }
  async function boundBatch(id) {
    const batch = await load(id);
    if (!batch) throw new Error("本次会话已结束，请重新扫描并核对平台结果。");
    return batch;
  }
  function listUrl(batch, pageNumber, pendingOnly = false) {
    const u = new URL(batch.scope.listUrl);
    u.pathname = u.pathname.replace(/\/(?:review-work|mark)$/, "/mark-list").replace("/work/library/mark-list", "/work/mark-list");
    u.searchParams.delete("workAnswerId"); u.searchParams.set("status", pendingOnly ? "3" : "0");
    for (const name of ["courseId", "clazzId", "classId", "workId", "answerId"]) u.searchParams.delete(name);
    u.searchParams.set("courseid", batch.scope.courseId); u.searchParams.set("clazzid", batch.scope.classId); u.searchParams.set("workid", batch.scope.workId);
    u.searchParams.set("submit", "true"); u.searchParams.set("pages", String(pageNumber)); u.searchParams.set("pageNum", String(pageNumber));
    return u.href;
  }
  async function onMessage(message, sender) {
    if (message.type === "batch-followup-start") {
      B.createBatch(message.scope, []);
      const detected = await page(message.tabId, { type: "batch-page-discover", kind: message.scope.kind }, message.frameId);
      if (!detected?.ok || ["courseId", "classId", "workId", "listUrl"].some(k => detected.data[k] !== message.scope[k]) || ["courseName", "className", "workTitle"].some(k => detected.data[k] && detected.data[k] !== message.scope[k])) throw new Error("名单确认期间页面范围发生变化。");
      const previousId = (await chrome.storage.session.get("followupActiveScan")).followupActiveScan;
      const previous = previousId ? (await chrome.storage.session.get(`followupScan:${previousId}`))[`followupScan:${previousId}`] : null;
      if (previous) {
        let owner; try { owner = await tabCall("get", previous.workspaceTabId); } catch {}
        if (owner && previous.workspaceTabId !== sender.tab?.id) throw new Error("另一工作台正在管理学生名单扫描。");
        try { await tabCall("remove", previous.platformTabId); } catch {}
        await chrome.storage.session.remove([`followupScan:${previousId}`, "followupActiveScan"]);
      }
      const id = crypto.randomUUID();
      const u = new URL(listUrl({ scope: message.scope }, 1)); u.searchParams.delete("submit");
      const owned = await tabCall("create", { url: u.href, active: false });
      const record = { id, scope: message.scope, platformTabId: owned.id, workspaceTabId: sender.tab?.id };
      await chrome.storage.session.set({ [`followupScan:${id}`]: record, followupActiveScan: id });
      return { ok: true, id };
    }
    if (["batch-followup-page", "batch-followup-finish"].includes(message.type)) {
      const record = (await chrome.storage.session.get(`followupScan:${message.id}`))[`followupScan:${message.id}`];
      if (!record || record.workspaceTabId !== sender.tab?.id) throw new Error("本次名单扫描未获取或属于另一工作台。");
      if (message.type === "batch-followup-finish") {
        try { await tabCall("remove", record.platformTabId); } catch {}
        await chrome.storage.session.remove([`followupScan:${message.id}`, "followupActiveScan"]); return { ok: true };
      }
      if (!Number.isInteger(message.pageNumber) || message.pageNumber < 1 || message.pageNumber > 1000) throw new Error("名单页码无效。");
      const u = new URL(listUrl({ scope: record.scope }, message.pageNumber)); u.searchParams.delete("submit");
      await navigate(record.platformTabId, u.href);
      return await page(record.platformTabId, { type: "batch-page-roster", scope: record.scope });
    }
    if (message.type === "batch-ai-credentials") {
      const config = await loadAiConfig();
      if (config.provider !== "codex-local" && !(await hasAiOriginPermission(config.baseUrl))) throw new Error("请先在设置中授权该AI域名。");
      return { ok: true, config };
    }
    if (message.type === "batch-attachment") {
      if (message.attachment?.resolver) {
        const batch = await boundBatch(message.id);
        if (batch.workspaceTabId !== sender.tab?.id) throw new Error("附件不属于本工作台。");
        const item = batch.items.find(i => i.key === message.key);
        if (!item?.snapshot?.questions.some(q => q.attachments.some(a => B.canonical(a) === B.canonical(message.attachment)))) throw new Error("附件不属于本批提交。");
        await navigate(batch.platformTabId, item.reviewUrl);
        const fresh = await page(batch.platformTabId, { type: "batch-page-read", identity: item.identity });
        if (!fresh?.ok) throw new Error(fresh?.reason || "附件读取前答案未获取。");
        B.assertSnapshot(batch, item, fresh.data);
        return await page(batch.platformTabId, { type: "batch-page-material", identity: item.identity, attachment: message.attachment });
      }
      if (!LearningTongGradingAdapter.trustedUrl(message.href)) throw new Error("附件来源不属于学习通可信域名。");
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
      try {
        const r = await fetch(message.href, { credentials: "include", signal: controller.signal, redirect: "error" });
        if (!r.ok) throw new Error("附件未获取。");
        const bytes = await LearningTongBackgroundUtils.readBoundedResponse(r, 15000000, controller);
        return { ok: true, dataBase64: bytesToBase64(bytes) };
      } finally { clearTimeout(timer); }
    }
    if (message.type === "batch-tabs") {
      const tabs = await tabCall("query", { url: "https://*.chaoxing.com/*" });
      return { ok: true, tabs: tabs.map(t => ({ id: t.id, title: t.title || "学习通页面" })) };
    }
    if (message.type === "batch-discover") {
      const tab = await tabCall("get", message.tabId);
      if (!LearningTongGradingAdapter.trustedUrl(tab.url)) throw new Error("请选中已登录的学习通教师页面。");
      const frames = await new Promise(resolve => chrome.webNavigation.getAllFrames({ tabId: tab.id }, resolve));
      const matches = [];
      for (const frame of frames || []) {
        if (!LearningTongGradingAdapter.trustedUrl(frame.url)) continue;
        const r = await page(tab.id, { type: "batch-page-discover", kind: message.kind }, frame.frameId);
        if (r?.ok) matches.push({ scope: r.data, tabId: tab.id, frameId: frame.frameId });
      }
      if (matches.length !== 1) throw new Error(matches.length ? "存在多个批阅范围，请直接打开目标待批列表。" : "未获取教师待批页面。请在学习通打开目标作业/章节测验的批阅列表。");
      return { ok: true, ...matches[0] };
    }
    if (message.type === "batch-start") {
      const detected = await page(message.tabId, { type: "batch-page-discover", kind: message.scope.kind }, message.frameId);
      if (!detected?.ok || ["courseId", "classId", "workId", "listUrl"].some(k => detected.data[k] !== message.scope[k])) throw new Error("确认期间页面范围已变化。");
      for (const k of ["courseName", "className", "workTitle"]) if (detected.data[k] && detected.data[k] !== message.scope[k]) throw new Error("课程、班级或作业名称与页面不一致。");
      const batch = B.createBatch(message.scope, []);
      const owned = await tabCall("create", { url: listUrl(batch, 1), active: false });
      batch.platformTabId = owned.id; batch.sourceTabId = message.tabId; batch.workspaceTabId = sender.tab?.id;
      batch.scanState = "未获取";
      await save(batch); return { ok: true, batch };
    }
    if (message.type === "batch-restore") {
      const id = (await chrome.storage.session.get("gradingActiveBatch")).gradingActiveBatch;
      const batch = id ? await load(id) : null;
      if (batch) {
        if (batch.workspaceTabId && batch.workspaceTabId !== sender.tab?.id) {
          let owner; try { owner = await tabCall("get", batch.workspaceTabId); } catch {}
          if (owner) throw new Error("已有审核工作台正在管理本次批改，请回到该标签页。");
        }
        batch.workspaceTabId = sender.tab?.id; B.recover(batch); batch.consent = null; await save(batch);
      }
      return { ok: true, batch };
    }
    if (message.type === "batch-forget") {
      const batch = await load(message.id);
      if (batch) { for (const id of [batch.platformTabId, batch.verificationTabId].filter(Number.isInteger)) { try { await tabCall("remove", id); } catch {} } }
      await chrome.storage.session.remove([keyFor(message.id), "gradingActiveBatch"]);
      return { ok: true };
    }
    if (message.type === "batch-save") {
      const old = await boundBatch(message.batch.id);
      if (old.workspaceTabId && old.workspaceTabId !== sender.tab?.id) throw new Error("本次批改由另一个工作台管理。");
      if (B.canonical(old.scope) !== B.canonical(message.batch.scope) || old.platformTabId !== message.batch.platformTabId || old.verificationTabId !== message.batch.verificationTabId || old.items.some(i => [B.states.submitting, B.states.verified, B.states.uncertain].includes(i.state) && B.canonical(i) !== B.canonical(message.batch.items.find(j => j.key === i.key)))) throw new Error("不能改变已提交条目或当前范围。");
      await save(message.batch); return { ok: true };
    }
    const batch = await boundBatch(message.id);
    if (batch.workspaceTabId && batch.workspaceTabId !== sender.tab?.id) throw new Error("本次批改由另一个工作台管理。");
    if (message.type === "batch-scan-page") {
      await navigate(batch.platformTabId, listUrl(batch, message.pageNumber));
      const r = await page(batch.platformTabId, { type: "batch-page-list", scope: batch.scope });
      if (!r?.ok) throw new Error(r?.reason || "未获取列表。");
      return r;
    }
    if (message.type === "batch-read") {
      const item = batch.items.find(i => i.key === message.key);
      if (!item) throw new Error("条目不属于本次批次。");
      await navigate(batch.platformTabId, item.reviewUrl);
      const r = await page(batch.platformTabId, { type: "batch-page-read", identity: item.identity });
      if (!r?.ok) throw new Error(r?.reason || "未获取完整答案。");
      return r;
    }
    if (message.type === "batch-prepare-submit") {
      const item = batch.items.find(i => i.key === message.key);
      const plan = B.submissionPlan(batch, item);
      let stillPending = false;
      const checkStarted = Date.now();
      for (let p = 1, pages = 1; p <= pages; p++) {
        if (Date.now() - checkStarted > 180000) throw new Error("提交前列表核验超时，未写入平台。");
        await navigate(batch.platformTabId, listUrl(batch, p));
        const list = await page(batch.platformTabId, { type: "batch-page-list", scope: batch.scope });
        if (!list?.ok) throw new Error(list?.reason || "提交前未获取列表状态。");
        pages = list.data.totalPages;
        const found = list.data.entries.find(e => B.identityKey(e.identity) === item.key);
        if (found) { stillPending = found.status === "pending"; break; }
      }
      if (!stillPending) throw new Error("该答案已评分或待批状态无法核验，保留平台已有成绩。");
      await navigate(batch.platformTabId, item.reviewUrl);
      const fresh = await page(batch.platformTabId, { type: "batch-page-read", identity: item.identity });
      if (!fresh?.ok) throw new Error(fresh?.reason || "提交前无法读取答案。");
      B.assertSnapshot(batch, item, fresh.data);
      for (const q of fresh.data.questions.filter(q => !q.automatic)) {
        const keys = item.materialKeys?.[q.id] || [];
        if (keys.length !== q.attachments.length) throw new Error("附件读取依据不完整，不能提交。");
        for (let i = 0; i < q.attachments.length; i++) {
          const downloaded = await onMessage({ type: "batch-attachment", id: batch.id, key: item.key, attachment: q.attachments[i], href: q.attachments[i].href }, sender);
          if (!downloaded.ok) throw new Error(downloaded.reason || "提交前材料未获取。");
          if (await B.materialDigest(downloaded.dataBase64) !== keys[i]) throw new Error("附件内容变化，旧建议已失效，请重新读取并审核。");
        }
      }
      const prepared = await page(batch.platformTabId, { type: "batch-page-prepare", plan });
      if (!prepared?.ok) throw new Error(prepared?.reason || "提交入口无法确认。");
      const token = crypto.randomUUID();
      await chrome.storage.session.set({ [tokenFor(token)]: { batchId: batch.id, key: item.key, plan, approval: item.approval.key, expires: Date.now() + 300000 } });
      return { ok: true, token };
    }
    if (message.type === "batch-submit") {
      const key = tokenFor(message.token);
      const record = (await chrome.storage.session.get(key))[key];
      if (!record || record.batchId !== batch.id || Date.now() > record.expires) throw new Error("提交确认已过期或已使用。");
      // Consume before the first await: serialize token access with the listener-level lock below.
      await chrome.storage.session.remove(key);
      const item = batch.items.find(i => i.key === record.key);
      if (!item || item.approval?.key !== record.approval || B.canonical(B.submissionPlan(batch, item)) !== B.canonical(record.plan)) throw new Error("审核结果已变化。");
      item.submittedPlan = structuredClone(record.plan);
      item.state = B.states.submitting; item.selected = false; await save(batch);
      let dispatch;
      try { dispatch = await page(batch.platformTabId, { type: "batch-page-submit", plan: record.plan }); } catch {}
      item.state = B.states.uncertain; item.reason = dispatch?.reason || "已请求平台提交，尚未独立回读。";
      await save(batch);
      return { ok: true, batch, dispatched: Boolean(dispatch?.ok) };
    }
    if (message.type === "batch-verify") {
      const item = batch.items.find(i => i.key === message.key);
      if (!item || ![B.states.uncertain, B.states.submitting, B.states.verified].includes(item.state)) throw new Error("仅核验已尝试提交的条目。");
      // Verify the score actually dispatched, even if the teacher later changes the rubric.
      const total = item.submittedPlan ? item.submittedPlan.total : B.reviewedTotal(batch, item);
      if (!Number.isFinite(total) || total < 0 || total > item.snapshot.totalMax || (item.submittedPlan && B.identityKey(item.submittedPlan.identity) !== item.key)) throw new Error("原提交核验依据无效，请人工核对平台。");
      const verificationStarted = Date.now();
      // Native markAction defers saving. Never navigate the submission tab away
      // to verify: that cancels the platform's pending timer/request.
      if (batch.verificationTabId) { try { await tabCall("remove", batch.verificationTabId); } catch {} }
      const verificationTab = await tabCall("create", { url: "about:blank", active: false });
      batch.verificationTabId = verificationTab.id; await save(batch);
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await sleep(1000);
          for (let p = 1, pages = 1; p <= pages; p++) {
            if (Date.now() - verificationStarted > 180000) throw new Error("回读超时，结果不确定，不能自动重提。");
            await navigate(verificationTab.id, listUrl(batch, p));
            const r = await page(verificationTab.id, { type: "batch-page-verify", scope: batch.scope, identity: item.identity, score: total });
            if (!r?.ok) throw new Error(r?.reason || "回读失败。");
            pages = r.data.list.totalPages;
            if (r.data.verified) {
              item.state = B.states.verified; item.reason = "同一提交的分数与已批状态已独立核验。";
              // The platform also schedules a delayed redirect after saving.
              // Continue from the verified list tab, retiring that old timer.
              const submittedTabId = batch.platformTabId;
              batch.platformTabId = verificationTab.id;
              delete batch.verificationTabId; await save(batch);
              try { await tabCall("remove", submittedTabId); } catch {}
              return { ok: true, batch };
            }
            if (r.data.found) break;
          }
        }
        item.state = B.states.uncertain; item.reason = "未核实到相同提交的预期分数及已批状态，请人工核对；不会自动重提。"; await save(batch);
        return { ok: false, batch, reason: item.reason };
      } finally {
        if (batch.platformTabId !== verificationTab.id) { try { await tabCall("remove", verificationTab.id); } catch {} }
        delete batch.verificationTabId; await save(batch);
      }
    }
    throw new Error("未知批改任务。");
  }
  // One workspace and one platform operation at a time; no duplicate submission races.
  let locked = false;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message?.type?.startsWith("batch-")) return;
    if (!trusted(sender)) { respond({ ok: false, reason: "批改操作仅允许独立审核工作台发起。" }); return; }
    if (locked) { respond({ ok: false, reason: "另一项批改操作正在进行，请等待。" }); return; }
    locked = true;
    onMessage(message, sender).then(respond).catch(e => respond({ ok: false, acquisitionState: /登录/.test(e.message) ? "需人工登录" : "未获取", reason: e.message })).finally(() => { locked = false; });
    return true;
  });
  globalThis.LearningTongBatchBackground = Object.freeze({ listUrl, load, save });
})();
