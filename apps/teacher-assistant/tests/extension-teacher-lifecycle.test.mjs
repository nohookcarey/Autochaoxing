import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const context={crypto:webcrypto};vm.runInNewContext(readFileSync(new URL('../extension/teacher-lifecycle-core.js',import.meta.url),'utf8'),context);
const C=context.LearningTongLifecycle, plain=v=>JSON.parse(JSON.stringify(v));
test('quoted CSV supports multiline, BOM and escaped quotation but rejects ambiguous fields',()=>{
 assert.deepEqual(plain(C.csv('\uFEFF题,答\r\n"逗号,与\n换行","两次""引号"',['题','答'])),[{题:'逗号,与\n换行',答:'两次"引号'}]);
 for(const s of ['题,题\na,b','题,答\na','题,答\n"未闭合,a','题,答\n"答"坏,b','题,其他\na,b'])assert.throws(()=>C.csv(s,['题','答']));
});
test('teacher-authored bank is valid and paper totals obey explicit blueprint',()=>{
 const r=C.questionBank(C.examples.bank);assert.equal(r.blocked,false);assert.equal(r.count,4);
 const p=C.paper(C.examples.bank,C.examples.blueprint,'demo','练习');assert.equal(p.total,25);assert.equal(p.questions.length,4);
 assert.deepEqual(plain(p),plain(C.paper(C.examples.bank,C.examples.blueprint,'demo','练习')));
});
test('student paper excludes answer, explanation and teacher knowledge tags',()=>{
 const p=C.paper(C.examples.bank,C.examples.blueprint,'demo','练习');
 for(const q of p.studentPaper.questions)assert.equal(['answer','explanation','topic'].some(k=>Object.hasOwn(q,k)),false);
 assert.equal(p.questions[0].answer,'A');
});
test('bank blocks missing answers, nonexistent choices, repeated keys and duplicate questions',()=>{
 for(const [from,to] of [['A,成果需要可核对','D,成果需要可核对'],['AB,核对完整性','AA,核对完整性'],['错误,缺失材料','未知,缺失材料'],['核对文件名和格式并重新打开检查','']])assert.equal(C.questionBank(C.examples.bank.replace(from,to)).blocked,true);
 const r=C.questionBank(C.examples.bank+'\n'+C.examples.bank.split('\n')[1]);assert.ok(r.issues.some(i=>i.message.includes('重复')));
});
test('paper shortage and blueprint conflicts stop rather than replacing or duplicating',()=>{
 assert.throws(()=>C.paper(C.examples.bank,'题型,题数,每题分值\n单选,2,10','demo','练习'),/不足/);
 assert.throws(()=>C.paper(C.examples.bank,'题型,题数,每题分值\n单选,1,10\n单选,1,10','demo','练习'),/重复/);
 assert.throws(()=>C.paper(C.examples.bank,C.examples.blueprint,'','练习'),/种子/);
 assert.throws(()=>C.paper(C.examples.bank,'题型,题数,每题分值\n单选,1,0','demo','练习'),/大于零/);
});
test('balanced anonymous groups preserve every person and avoid single-person leftovers',()=>{
 for(const count of [2,3,5,7,11,12,31]){const g=C.groups(count,4,'seed'),lengths=g.map(a=>a.length),codes=g.flat();assert.equal(codes.length,count);assert.equal(new Set(codes).size,count);assert.ok(Math.min(...lengths)>=2);assert.ok(Math.max(...lengths)-Math.min(...lengths)<=1);}
 assert.throws(()=>C.groups(3,2,'seed'),/单人/);
});
test('classroom selection is anonymous and unique; polls reject duplicated options',()=>{
 const d={type:'选人',title:'讨论',objective:'自检',instructions:'说明步骤',minutes:10,count:12,pick:3,seed:'demo'};
 const r=C.activity(d);assert.equal(r.selectedCodes.length,3);assert.equal(new Set(r.selectedCodes).size,3);assert.ok(r.selectedCodes.every(c=>/^S\d+$/.test(c)));
 assert.throws(()=>C.activity({...d,pick:13}),/范围/);
 assert.throws(()=>C.activity({...d,type:'投票问卷',options:'A\nA'}),/不重复/);
});
test('progress missing values stay unknown; aggregate denominator uses known records only',()=>{
 const r=C.progress(C.examples.progress,{chapter:60,assignment:80,exam:60},3);
 assert.equal(r.count,3);assert.equal(r.flagged,1);assert.equal(r.unknown,2);assert.equal(r.metrics.作业完成率.average,92.5);assert.equal(r.metrics.测验成绩.unknown,1);
 const exportData=JSON.stringify(C.sanitized(r));assert.equal(exportData.includes('DEMO'),false);assert.equal(exportData.includes('"detail"'),false);
});
test('progress duplicate students, wrong totals and nonpercentage values cannot produce success',()=>{
 assert.throws(()=>C.progress(C.examples.progress.replace('DEMO02','DEMO01'),{chapter:60,assignment:80,exam:60},3),/重复/);
 assert.throws(()=>C.progress(C.examples.progress,{chapter:60,assignment:80,exam:60},4),/人数/);
 assert.throws(()=>C.progress(C.examples.progress.replace('90,100','110,100'),{chapter:60,assignment:80,exam:60},3),/范围/);
});
test('weighted trial normalizes component maxima, preserves old totals, and skips incomplete rows',()=>{
 const r=C.grades(C.examples.grades,C.examples.policy,3);assert.equal(r.detail[0].trial,84);assert.equal(r.detail[0].original,80);assert.equal(r.detail[0].difference,4);assert.equal(r.detail[1].trial,null);assert.equal(r.complete,2);assert.equal(r.changed,1);
 const s='学号,作业,测验,原总评\nDEMO01,45,160,84';const p='项目,权重,满分\n作业,40,50\n测验,60,200';assert.equal(C.grades(s,p,1).detail[0].trial,84);
 assert.equal(JSON.stringify(C.sanitized(r)).includes('"trial"'),false);
});
test('grade weights, extra fields, missing roster, invalid maxima and scores block trial',()=>{
 assert.throws(()=>C.grades(C.examples.grades,C.examples.policy.replace('40','30'),3),/100%/);
 assert.throws(()=>C.grades(C.examples.grades.replace('90,80','101,80'),C.examples.policy,3),/范围/);
 assert.throws(()=>C.gradePolicy('项目,权重,满分\n作业,100,0'),/大于零/);
 assert.throws(()=>C.gradePolicy('项目,权重,满分\n__proto__,100,100'),/保留/);
 assert.throws(()=>C.grades(C.examples.grades,C.examples.policy,4),/人数/);
});
test('archive hashes actual bytes, identifies duplicate content and filename collision without exporting names',async()=>{
 const file=(name,content)=>({name,size:Buffer.byteLength(content),arrayBuffer:async()=>Uint8Array.from(Buffer.from(content)).buffer});
 const r=await C.manifest([file('private-student.txt','abc'),file('same.txt','abc'),file('same.txt','different')]);assert.equal(r.duplicateCount,1);assert.equal(r.nameCollisionCount,1);assert.equal(r.items[0].sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');assert.equal(r.items[1].duplicateOf,'F1');assert.equal(JSON.stringify(r).includes('private-student'),false);
});
test('archive refuses empty, oversized or changed files rather than recording partial success',async()=>{
 await assert.rejects(()=>C.manifest([]),/1～200/);await assert.rejects(()=>C.manifest([{size:30000001}]),/30MB/);await assert.rejects(()=>C.manifest([{size:1,name:'empty',arrayBuffer:async()=>new ArrayBuffer(0)}]),/大小不一致/);
});

test('archive accepts browser FileList array-like input',async()=>{
 const bytes=Uint8Array.from([65,66]),file={name:'fixture.txt',size:2,arrayBuffer:async()=>bytes.buffer};const r=await C.manifest({0:file,length:1});assert.equal(r.count,1);
});
