(() => {
  const stateRank = { "采集到": 3, "确认无数据": 2, "未获取": 1 };
  function aggregateFrameResults(results = []) {
    const valid = results.filter(Boolean);
    const courseContext = valid.some((result) => result.signals?.courseContext);
    const candidates = valid.filter((result) => result.scopeVerified)
      .sort((left, right) => (stateRank[right.candidateState] || 0) - (stateRank[left.candidateState] || 0));
    if (courseContext && candidates.length) {
      const selected = candidates[0];
      const acquisitionState = selected.candidateState || selected.acquisitionState;
      return {
        ...selected,
        acquisitionState,
        reason: acquisitionState === "采集到"
          ? `已通过课程主页面与作业 iframe 双重核验，并完成 ${selected.scannedPages?.length || 1} 个分页的只读扫描。`
          : `已通过课程主页面与作业 iframe 双重核验；已扫描 ${selected.scannedPages?.length || 1} 个分页，目标班级没有待批作业。`,
        signals: { ...selected.signals, courseContext: true, crossFrameVerified: true },
      };
    }
    if (candidates.length) return { ...candidates[0], acquisitionState: "未获取", reason: "已识别作业列表，但同标签页未核验到目标课程名称。" };
    return valid.find((result) => result.signals?.courseContext)
      || valid[0]
      || { acquisitionState: "未获取", reason: "当前标签页未返回可识别的学习通页面结构。" };
  }

  function isChaoxingPage(tab) {
    return /^https:\/\/[^/]*chaoxing\.com\//.test(String(tab?.url || ""));
  }

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function pickTargetTab(tabs = [], courseName = "") {
    const candidates = tabs.filter(isChaoxingPage);
    const active = candidates.find((tab) => tab.active);
    if (active) return active;
    const recent = [...candidates].sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0));
    const expected = normalize(courseName);
    if (!expected) return recent[0];
    const matchingShell = recent.find((tab) => normalize(tab.title).includes(expected));
    if (!matchingShell) return recent[0];
    const latest = recent[0];
    const latestIsAnotherCourseShell = /\/mycourse\/tch/.test(String(latest?.url || "")) && !normalize(latest?.title).includes(expected);
    return latestIsAnotherCourseShell ? matchingShell : latest;
  }

  async function readBoundedResponse(response, limit = 15000000, controller) {
    const fail = () => new Error("附件超过15MB或未取得可限量读取的材料，请人工复核。");
    if (!response.body?.getReader) { controller?.abort(); throw fail(); }
    const reader = response.body.getReader();
    let bytes = new Uint8Array(Math.min(limit, 65536));
    let total = 0;
    try {
      if (Number(response.headers.get("content-length")) > limit) throw fail();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1 || value.byteLength > limit - total) throw fail();
        const needed = total + value.byteLength;
        if (needed > bytes.byteLength) {
          const grown = new Uint8Array(Math.min(limit, Math.max(needed, bytes.byteLength * 2)));
          grown.set(bytes); bytes = grown;
        }
        bytes.set(value, total); total = needed;
      }
      return bytes.slice(0, total);
    } catch (error) {
      try { await reader.cancel(); } catch {}
      controller?.abort();
      throw error;
    } finally { reader.releaseLock(); }
  }

  globalThis.LearningTongBackgroundUtils = { aggregateFrameResults, isChaoxingPage, pickTargetTab, readBoundedResponse };
})();
