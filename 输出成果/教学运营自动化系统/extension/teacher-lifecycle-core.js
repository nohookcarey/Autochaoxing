(() => {
  const text = v => String(v ?? '').trim();
  const fail = message => { throw new Error(message); };
  const number = (v, name, max = 100000) => {
    if (!text(v) || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text(v))) fail(`${name}须填写非负数，缺失不能按零计算。`);
    const n = Number(v); if (!Number.isFinite(n) || n > max) fail(`${name}超出允许范围。`); return n;
  };
  const integer = (v, name, min, max) => { const n = number(v, name, max); if (!Number.isInteger(n) || n < min) fail(`${name}须为${min}～${max}的整数。`); return n; };
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  function csv(input, headers, limit = 5000) {
    const source = String(input).replace(/^\uFEFF/, '');
    if (source.length > 1000000) fail('材料超过100万字符，不截断处理。');
    const table = []; let row = [], cell = '', quoted = false, ended = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (quoted) { if (c === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; ended = true; } } else cell += c; }
      else if (c === ',' || c === '\n' || c === '\r') {
        row.push(cell); cell = ''; ended = false;
        if (c !== ',') { if (c === '\r' && source[i + 1] === '\n') i++; table.push(row); row = []; }
      } else if (c === '"') { if (cell || ended) fail('CSV引号位置不合法。'); quoted = true; }
      else { if (ended) fail('CSV闭合引号后存在多余内容。'); cell += c; }
      if (table.length > limit + 1) fail(`材料超过${limit}行，不截断处理。`);
    }
    if (quoted) fail('CSV引号未闭合。');
    if (cell || row.length || ended) { row.push(cell); table.push(row); }
    while (table.length && table.at(-1).every(v => !text(v))) table.pop();
    if (table.length < 2) fail('请提供表头及至少一行数据。');
    const columns = table.shift().map(text);
    if (new Set(columns).size !== columns.length || columns.some(c => !headers.includes(c)) || headers.some(c => !columns.includes(c))) fail(`表头须完整且不重复：${headers.join('、')}。`);
    if (table.length > limit) fail(`材料超过${limit}行。`);
    return table.map((r, i) => { if (r.length !== columns.length) fail(`第${i + 2}行列数不一致。`); return Object.fromEntries(columns.map((c, j) => [c, text(r[j])])); });
  }
  const QUESTION_HEADERS = ['题型','题干','A','B','C','D','答案','解析','分值','知识点'];
  const TYPES = ['单选','多选','判断','简答'];
  function questionBank(source) {
    const rows = csv(source, QUESTION_HEADERS, 1000), seen = new Map(), issues = [];
    const questions = rows.map((r, i) => {
      const errors = [], type = r.题型, stem = r.题干;
      if (!TYPES.includes(type)) errors.push('题型只支持单选、多选、判断、简答');
      if (!stem || stem.length > 4000) errors.push('题干为空或超过4000字符');
      const stemKey = stem.replace(/\s+/g, '').normalize('NFKC');
      if (seen.has(stemKey)) errors.push(`题干与第${seen.get(stemKey)}题重复`); else seen.set(stemKey, i + 1);
      const options = Object.fromEntries(['A','B','C','D'].filter(k => r[k]).map(k => [k, r[k]]));
      let answer = r.答案, points = null;
      try { points = number(r.分值, '分值', 1000); if (!points) errors.push('分值必须大于零'); } catch(e) { errors.push(e.message); }
      if (type === '单选' || type === '多选') {
        const raw = answer.toUpperCase().replace(/[\s、,，]/g, '');
        if (!/^[A-D]+$/.test(raw) || new Set(raw).size !== raw.length || [...raw].some(k => !options[k]) || (type === '单选' ? raw.length !== 1 : raw.length < 2)) errors.push('答案不符合题型、包含重复选项或对应选项缺失');
        if (Object.keys(options).length < 2) errors.push('选择题至少需要两个选项');
        answer = [...raw].sort().join('');
      } else if (type === '判断') {
        if (Object.keys(options).length) errors.push('判断题不使用A～D选项');
        const yn = { '正确':'正确', '对':'正确', 'TRUE':'正确', '错误':'错误', '错':'错误', 'FALSE':'错误' }; answer = yn[answer.toUpperCase()] || '';
        if (!answer) errors.push('判断题答案须为正确或错误');
      } else if (type === '简答') {
        if (!answer) errors.push('简答题参考答案缺失');
        if (Object.keys(options).length) errors.push('简答题不使用A～D选项');
      }
      if (Object.values(r).some(v => v.length > 8000)) errors.push('字段超过8000字符');
      errors.forEach(message => issues.push({ question: i + 1, message }));
      return { id: `Q${i + 1}`, type, stem, options, answer, explanation: r.解析, points, topic: r.知识点 };
    });
    return { kind:'题库审核', blocked: !!issues.length, count: questions.length, issues, questions, boundary:'通用题库审核JSON，不是学习通原生导入格式；不自动上传。' };
  }
  function shuffled(items, seed) {
    if (!text(seed)) fail('请填写抽取种子，用于复现本次结果。');
    let state = 2166136261;
    for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const result = items.slice(); for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result;
  }
  function paper(source, blueprint, seed, title) {
    if (!text(title)) fail('试卷名称不能为空。');
    const bank = questionBank(source); if (bank.blocked) fail(`题库有${bank.issues.length}项错误，请先修正。`);
    const requests = csv(blueprint, ['题型','题数','每题分值'], 4), seen = new Set(), selected = [];
    for (const r of requests) {
      if (!TYPES.includes(r.题型) || seen.has(r.题型)) fail('组卷题型无效或重复。'); seen.add(r.题型);
      const count = integer(r.题数, '题数', 0, 1000), points = number(r.每题分值, '每题分值', 1000);
      if (!points && count) fail('有题目的分值须大于零。');
      const pool = shuffled(bank.questions.filter(q => q.type === r.题型), `${seed}:${r.题型}`);
      if (pool.length < count) fail(`${r.题型}不足：需要${count}题，只有${pool.length}题。`);
      selected.push(...pool.slice(0,count).map(q => ({ ...q, points })));
    }
    if (!selected.length) fail('组卷至少需要一题。');
    if (!text(seed)) fail('组卷种子不能为空。');
    const total = round(selected.reduce((s,q) => s + q.points, 0));
    return { kind:'组卷审核', title:text(title), seed:text(seed), total, questions:selected, studentPaper:{ title:text(title), total, questions:selected.map(({answer,explanation,topic,...q}) => q) }, boundary:'本地组卷，不含考试发布、时间设置、防作弊或监考适配；学生卷不含答案与解析。' };
  }
  function groups(countValue, sizeValue, seed) {
    const count = integer(countValue, '人数', 2, 1000), size = integer(sizeValue, '目标组人数', 2, 10);
    const n = Math.ceil(count / size);
    if (Math.floor(count / n) < 2) fail('人数与组大小会产生单人组，请调整。');
    const codes = shuffled(Array.from({length:count}, (_,i) => `S${String(i+1).padStart(3,'0')}`), seed), result = Array.from({length:n},()=>[]);
    codes.forEach((code,i)=>result[i % n].push(code)); return result;
  }
  function activity(data) {
    if (Object.values(data).some(v => String(v ?? '').length > 8000)) fail('活动字段超过8000字符，不截断处理。');
    const types = ['讨论','投票问卷','抢答','选人','分组','签到','直播'];
    if (!types.includes(data.type) || !text(data.title) || !text(data.objective) || !text(data.instructions)) fail('请填写活动类型、主题、目标和学生操作要求。');
    const minutes = integer(data.minutes, '活动分钟数', 1, 240);
    const result = { kind:'课堂活动准备', type:data.type, title:text(data.title), objective:text(data.objective), minutes, instructions:text(data.instructions), boundary:'教师备课稿；不发布活动、不发送通知、不写考勤。匿名编号由教师与座位对应，不读取学生名单。' };
    if (data.type === '投票问卷') { const options = text(data.options).split('\n').map(text).filter(Boolean); if (options.length < 2 || options.length > 20 || new Set(options).size !== options.length) fail('投票问卷请提供2～20个不重复的选项，每行一个。'); result.options = options; }
    if (data.type === '分组') result.groups = groups(data.count, data.size, data.seed);
    if (data.type === '选人') result.selectedCodes = shuffled(Array.from({length:integer(data.count, '人数', 1, 1000)},(_,i)=>`S${String(i+1).padStart(3,'0')}`), data.seed).slice(0,integer(data.pick,'选取人数',1,number(data.count,'人数',1000)));
    return result;
  }
  function uniqueRows(rows) {
    const seen = new Set(); for (const [i,r] of rows.entries()) { if (!r.学号 || seen.has(r.学号)) fail(`第${i+2}行学号缺失或重复，不能合并学生。`); seen.add(r.学号); }
  }
  const PROGRESS_HEADERS = ['学号','章节完成率','作业完成率','测验成绩','课程访问次数'];
  function progress(source, thresholds, expected) {
    const rows = csv(source, PROGRESS_HEADERS); uniqueRows(rows);
    if (rows.length !== integer(expected,'完整名单人数',1,5000)) fail('完整名单人数与导入行数不一致。');
    const limits = { 章节完成率:number(thresholds.chapter,'章节阈值',100), 作业完成率:number(thresholds.assignment,'作业阈值',100), 测验成绩:number(thresholds.exam,'测验阈值',100) };
    let flagged = 0, unknown = 0; const detail = [], totals = Object.fromEntries(PROGRESS_HEADERS.slice(1).map(k=>[k,{known:0,sum:0,unknown:0,below:0}]));
    rows.forEach((r,i)=>{
      const reasons = [], missing = [];
      for (const k of PROGRESS_HEADERS.slice(1)) {
        if (!r[k]) { totals[k].unknown++; missing.push(k); continue; }
        const v = number(r[k],`第${i+2}行${k}`,k==='课程访问次数'?100000:100);
        if (k==='课程访问次数' && !Number.isInteger(v)) fail(`第${i+2}行访问次数须为整数。`);
        totals[k].known++; totals[k].sum+=v;
        if (Object.hasOwn(limits,k) && v < limits[k]) { totals[k].below++; reasons.push(k); }
      }
      if(reasons.length) flagged++; if(missing.length) unknown++;
      detail.push({ row:i+2, below:reasons, missing });
    });
    const metrics = Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,{known:v.known,unknown:v.unknown,average:v.known?round(v.sum/v.known):null,below:v.below}]));
    return { kind:'学情审核', count:rows.length, flagged, unknown, thresholds:limits, metrics, detail, boundary:'教师导入快照；缺失保留未获取，阈值由教师设置。匿名行号只供本地对照，导出不含逐人信息；不自动预警发送。' };
  }
  function gradePolicy(source) {
    const rows = csv(source,['项目','权重','满分'],20), names = new Set();
    const policy = rows.map(r=>{ if(!r.项目 || names.has(r.项目) || ['学号','原总评','__proto__','constructor','prototype'].includes(r.项目)) fail('计分项目名称缺失、重复或保留名称。'); names.add(r.项目); const weight=number(r.权重,'权重',100), max=number(r.满分,'满分',10000); if (!max) fail('项目满分必须大于零。'); return {name:r.项目,weight,max}; });
    if(Math.abs(policy.reduce((s,p)=>s+p.weight,0)-100)>0.000001) fail('权重合计必须为100%。'); return policy;
  }
  function grades(source, policySource, expected) {
    const policy = gradePolicy(policySource), rows = csv(source,['学号',...policy.map(p=>p.name),'原总评']); uniqueRows(rows);
    if(rows.length!==integer(expected,'完整名单人数',1,5000)) fail('完整名单人数与导入行数不一致。');
    const detail=rows.map((r,i)=>{
      const missing=policy.filter(p=>!r[p.name]).map(p=>p.name); let value=0;
      for(const p of policy) if(r[p.name]) value+=number(r[p.name],`第${i+2}行${p.name}`,p.max)/p.max*p.weight;
      const trial=missing.length?null:round(value), original=r.原总评?number(r.原总评,`第${i+2}行原总评`,100):null;
      return {row:i+2,missing,trial,original,difference:trial===null||original===null?null:round(trial-original)};
    });
    const valid=detail.filter(r=>r.trial!==null);
    return { kind:'成绩试算', count:rows.length, complete:valid.length, incomplete:rows.length-valid.length, compared:detail.filter(r=>r.difference!==null).length, changed:detail.filter(r=>r.difference!==null && r.difference!==0).length, average:valid.length?round(valid.reduce((s,r)=>s+r.trial,0)/valid.length):null,policy,detail,boundary:'本地百分制试算，缺项不按零分；原总评保留对照。不是平台正式成绩，不回填或覆盖。导出仅脱敏汇总。' };
  }
  async function manifest(files) {
    files = Array.from(files || []);
    if(!files?.length || files.length>200) fail('请选择1～200份课程文件。');
    if(files.reduce((s,f)=>s+f.size,0)>200000000 || files.some(f=>f.size>30000000)) fail('单文件限30MB、合计限200MB，不截断读取。');
    const items=[]; const byHash=new Map(), byName=new Map();
    for(const [i,file] of Array.from(files).entries()) {
      if(!file.size) fail(`第${i+1}份文件为空，无法作为有效归档材料。`);
      const data=await file.arrayBuffer(); if(data.byteLength!==file.size) fail('读取文件大小不一致，请重新选择。');
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',data)), hash=[...digest].map(n=>n.toString(16).padStart(2,'0')).join('');
      const name=text(file.name).normalize('NFKC');
      const item={code:`F${i+1}`,bytes:file.size,sha256:hash,duplicateOf:byHash.get(hash)||null,nameCollision:byName.has(name)};
      if(!byHash.has(hash))byHash.set(hash,item.code); byName.set(name,item.code); items.push(item);
    }
    return {kind:'课程归档清单',count:items.length,bytes:items.reduce((s,f)=>s+f.bytes,0),duplicateCount:items.filter(f=>f.duplicateOf).length,nameCollisionCount:items.filter(f=>f.nameCollision).length,items,boundary:'仅核验教师主动选取的本机文件，匿名编号对应选择顺序；不复制原文件、不上传，不证明平台完整归档或迁移成功。请同时保留原文件与课程平台导出。'};
  }
  function sanitized(result) { const {detail,...summary}=result; return summary; }
  const examples = {
    bank:'题型,题干,A,B,C,D,答案,解析,分值,知识点\n单选,哪种材料适合作为任务交付物？,可核对的成果文件,只有口头说明,,,A,成果需要可核对,5,交付物\n多选,提交前需要核对哪些内容？,文件完整,命名正确,忽略来源,,AB,核对完整性和命名,5,提交自检\n判断,缺失材料可以直接当作零分。,不使用,,,,错误,缺失材料需要核验,5,核验边界\n简答,说明一次文件保存后的自检步骤。,,,,,核对文件名和格式并重新打开检查,按教师标准审核,10,保存检查',
    blueprint:'题型,题数,每题分值\n单选,1,5\n多选,1,5\n判断,1,5\n简答,1,10',
    progress:'学号,章节完成率,作业完成率,测验成绩,课程访问次数\nDEMO01,90,100,85,12\nDEMO02,40,,55,3\nDEMO03,80,85,,9',
    policy:'项目,权重,满分\n作业,40,100\n测验,60,100',
    grades:'学号,作业,测验,原总评\nDEMO01,90,80,80\nDEMO02,,70,75\nDEMO03,60,90,78'
  };
  // Teacher-authored sample, no real institution policy or student data.
  examples.bank=examples.bank.replace('不使用,,,,错误', ',,,,错误');
  globalThis.LearningTongLifecycle=Object.freeze({csv,questionBank,paper,groups,activity,progress,gradePolicy,grades,manifest,sanitized,examples,TYPES});
})();
