(() => {
  const C=globalThis.LearningTongLifecycle, $=id=>document.getElementById(id), node=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n;};
  let result=null, basis=null, busy=false, revision=0, lastScope='';
  const table=node('table'), head=node('tr'); ['阶段','场景','当前能力','限制与待验收'].forEach(v=>head.append(node('th',v)));table.append(head);
  globalThis.LearningTongTeacherScenes.forEach(r=>{const row=node('tr');[r.phase,r.title,r.status,r.gap].forEach(v=>row.append(node('td',v)));table.append(row);});$('teacher-scenes').append(table);
  function reviewText(r) {
    const lines=[r.kind, r.boundary, ''];
    if(r.kind==='题库审核'){lines.push(`题目：${r.count}；须修正：${r.issues.length}`);r.issues.forEach(i=>lines.push(`第${i.question}题：${i.message}`));r.questions.forEach(q=>lines.push(`${q.id} ${q.type} ${q.points??'分值无效'}分 · ${q.stem}`, ...Object.entries(q.options).map(([k,v])=>`${k}. ${v}`),`教师参考答案：${q.answer}`));}
    else if(r.kind==='组卷审核'){lines.push(`${r.title} · 总分${r.total} · ${r.questions.length}题`);r.questions.forEach(q=>lines.push(`${q.id} ${q.type} ${q.points}分 · ${q.stem}`,...Object.entries(q.options).map(([k,v])=>`${k}. ${v}`),`教师参考答案：${q.answer}`));}
    else if(r.kind==='课堂活动准备'){lines.push(`${r.title} · ${r.type} · ${r.minutes}分钟`,`目标：${r.objective}`,`学生要求：${r.instructions}`,...(r.options||[]).map((o,i)=>`选项${i+1}：${o}`),...(r.groups||[]).map((g,i)=>`第${i+1}组：${g.join('、')}`));if(r.selectedCodes)lines.push(`本次选取：${r.selectedCodes.join('、')}`);}
    else if(r.kind==='学情审核'){lines.push(`人数${r.count}；低于教师阈值${r.flagged}人；材料有缺失${r.unknown}人（两者可重叠）`);Object.entries(r.metrics).forEach(([k,v])=>lines.push(`${k}：已获取${v.known}、未获取${v.unknown}；已获取样本均值${v.average??'未获取'}；低于阈值${v.below}`));r.detail.filter(d=>d.below.length||d.missing.length).forEach(d=>lines.push(`CSV第${d.row}行：低于阈值 ${d.below.join('、')||'无'}；未获取 ${d.missing.join('、')||'无'}`));}
    else if(r.kind==='成绩试算'){lines.push(`人数${r.count}；完整可试算${r.complete}；缺项${r.incomplete}；与原总评有差异${r.changed}；有效样本均值${r.average??'未获取'}`);r.policy.forEach(p=>lines.push(`${p.name}：权重${p.weight}%，满分${p.max}`));r.detail.forEach(d=>lines.push(`CSV第${d.row}行：试算${d.trial??'未获取'}；原总评${d.original??'未获取'}；差值${d.difference??'未获取'}；缺项${d.missing.join('、')||'无'}`));}
    else{lines.push(`文件${r.count}份；总字节${r.bytes}；重复内容${r.duplicateCount}；同名冲突${r.nameCollisionCount}`);r.items.forEach(f=>lines.push(`${f.code}：${f.bytes}字节；重复于${f.duplicateOf||'无'}；同名冲突${f.nameCollision?'有':'无'}；SHA-256 ${f.sha256}`));}
    return lines.join('\n');
  }
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function paperHtml(answer) {
    const qs=answer?result.questions:result.studentPaper.questions;
    const content=[result.title,answer?'教师答案卷（请勿发给学生）':'学生试卷',`总分：${result.total}分`,''];
    qs.forEach((q,i)=>{content.push(`${i+1}. ${q.stem}（${q.type}，${q.points}分）`,...Object.entries(q.options).map(([k,v])=>`${k}. ${v}`));if(answer)content.push(`参考答案：${q.answer}`,`解析：${q.explanation||'未提供'}`);else if(q.type==='简答')content.push('答：\n\n');content.push('');});
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(result.title)}</title><style>body{font:16px/1.8 sans-serif;max-width:900px;margin:40px auto;padding:20px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style><body><pre>${escape(content.join('\n'))}</pre></body></html>`;
  }
  const fields=['course','class','mode','bank','blueprint','seed','title','activity-type','objective','instructions','minutes','options','count','size','pick','progress','chapter-limit','assignment-limit','exam-limit','policy','grades','expected'];
  function key(){return JSON.stringify(fields.map(k=>$('life-'+k).value));}
  const status=s=>$('life-status').textContent=s;
  function invalidate(){revision++;result=basis=null;$('life-confirm').checked=false;$('life-confirm').disabled=true;$('life-export').disabled=$('life-student').disabled=$('life-key').disabled=true;$('life-output').textContent='资料已变化，请重新处理与审核。';}
  function panels(){const mode=$('life-mode').value;document.querySelectorAll('[data-life-panel]').forEach(n=>n.hidden=!n.dataset.lifePanel.split(' ').includes(mode));$('life-student').hidden=$('life-key').hidden=mode!=='paper';$('life-export').hidden=mode==='paper';}
  function scope(){const course=$('life-course').value.trim(), className=$('life-class').value.trim();if(!course||!className)throw Error('请填写本次课程和班级，核对导入材料所属范围。');return {course,className};}
  function refreshApproval(){const approved=!!result && basis===key() && $('life-confirm').checked && !result.blocked; $('life-export').disabled=$('life-student').disabled=$('life-key').disabled=!approved;}
  async function generate(){if(busy)return;invalidate();const token=revision;busy=true;$('life-run').disabled=true;
    try{scope();const mode=$('life-mode').value,v=k=>$('life-'+k).value;let r;
      if(mode==='bank')r=C.questionBank(v('bank'));
      if(mode==='paper')r=C.paper(v('bank'),v('blueprint'),v('seed'),v('title'));
      if(mode==='activity')r=C.activity({type:v('activity-type'),title:v('title'),objective:v('objective'),instructions:v('instructions'),minutes:v('minutes'),options:v('options'),count:v('count'),size:v('size'),pick:v('pick'),seed:v('seed')});
      if(mode==='progress')r=C.progress(v('progress'),{chapter:v('chapter-limit'),assignment:v('assignment-limit'),exam:v('exam-limit')},v('expected'));
      if(mode==='grades')r=C.grades(v('grades'),v('policy'),v('expected'));
      if(mode==='archive')r=await C.manifest($('life-files').files);
      if(token!==revision)return;result=r;basis=key();$('life-output').textContent=reviewText(r);$('life-confirm').disabled=!!r.blocked;
      status(r.blocked?`发现${r.issues.length}项题库问题，修正前禁止导出。`:'已生成本地审核结果，请核对课程、班级、输入完整性和结果后确认导出。未写入平台。');
    }catch(e){if(token===revision)status(e.message);}finally{busy=false;$('life-run').disabled=false;}
  }
  function exportResult(type){try{
    if(!result||basis!==key()||!$('life-confirm').checked||result.blocked)throw Error('资料未处理、已变化或尚未教师确认。');scope();
    let data,filename;
    if(type==='student'){data=paperHtml(false);filename='学生试卷_无答案.html';}
    else if(type==='answer'){data=paperHtml(true);filename='教师答案卷_请妥善保管.html';}
    else{data=C.sanitized(result);filename=`${result.kind}_教师审核.json`;}
    // Scope and row-level student information are never included in these exports.
    const a=node('a'),url=URL.createObjectURL(new Blob([type==='summary'?JSON.stringify(data,null,2):data],{type:type==='summary'?'application/json;charset=utf-8':'text/html;charset=utf-8'}));a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出教师审核文件；文件由教师保管，未上传或发送。');
  }catch(e){status(e.message);}}
  function clear(){fields.filter(k=>!['mode','activity-type'].includes(k)).forEach(k=>$('life-'+k).value='');$('life-files').value='';document.querySelectorAll('[data-life-file]').forEach(n=>n.value='');invalidate();status('已清除本工作台中的材料与结果。主动导出的文件请自行管理。');}
  function example(){clear();$('life-course').value='教师自编模拟课程';$('life-class').value='模拟班级';$('life-bank').value=C.examples.bank;$('life-blueprint').value=C.examples.blueprint;$('life-seed').value='demo-lesson';$('life-title').value='提交自检练习';$('life-objective').value='核对文件完整性与提交要求';$('life-instructions').value='讨论保存后的自检步骤，完成后核对检查清单。';$('life-minutes').value='10';$('life-options').value='先检查文件名\n先重新打开文件';$('life-count').value='12';$('life-size').value='4';$('life-pick').value='2';$('life-progress').value=C.examples.progress;$('life-policy').value=C.examples.policy;$('life-grades').value=C.examples.grades;$('life-expected').value='3';$('life-chapter-limit').value='60';$('life-assignment-limit').value='80';$('life-exam-limit').value='60';status('已载入教师自编模拟材料和阈值；不是学校政策，不代表真实班级。');}
  fields.forEach(k=>$('life-'+k).addEventListener('input',()=>{invalidate();if(k==='mode')panels();}));
  $('life-mode').addEventListener('change',()=>{invalidate();panels();});$('life-activity-type').addEventListener('change',invalidate);$('life-files').addEventListener('change',invalidate);$('life-confirm').addEventListener('change',refreshApproval);$('life-run').addEventListener('click',generate);$('life-clear').addEventListener('click',clear);$('life-example').addEventListener('click',example);
  $('life-export').addEventListener('click',()=>exportResult('summary'));$('life-student').addEventListener('click',()=>exportResult('student'));$('life-key').addEventListener('click',()=>exportResult('answer'));
  window.addEventListener('learningtong-scope',()=>{const bridge=globalThis.LearningTongWorkspaceBridge;const next=JSON.stringify([bridge?.isDemo?.(),bridge?.scope?.()]);if(lastScope&&next!==lastScope){clear();status('平台范围或演示状态已切换，已清除独立工具的材料；请重新填写实际范围。');}lastScope=next;});
  document.querySelectorAll('[data-life-file]').forEach(input=>input.addEventListener('change',async()=>{
    invalidate();const token=revision,file=input.files?.[0];$('life-'+input.dataset.lifeFile).value='';if(!file)return;
    try{if(!/\.csv$/i.test(file.name)||file.size>1000000)throw Error('请提供1MB以内的UTF-8 CSV文件，不会截断读取。');
      const value=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()).replace(/^\uFEFF/,'');
      if(token!==revision)return;$('life-'+input.dataset.lifeFile).value=value;status('已读取教师选择的CSV文件；请核对范围、表头和完整人数，再处理审核。未上传。');
    }catch(e){if(token===revision)status(e instanceof TypeError?'CSV编码无法完整读取，请在Excel另存为CSV UTF-8后再导入。':e.message);}
  }));
  lastScope=JSON.stringify([globalThis.LearningTongWorkspaceBridge?.isDemo?.(),globalThis.LearningTongWorkspaceBridge?.scope?.()]);
  panels();$('life-confirm').disabled=true;status('尚未处理。材料与结果只保留在当前工作台，关闭或重载后需重新导入。');
})();
