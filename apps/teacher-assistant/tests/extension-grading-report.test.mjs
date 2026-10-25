import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const c = { Date, TextEncoder, crypto: webcrypto, structuredClone }; c.globalThis = c;
for (const name of ['grading-batch-core','teaching-followup-core','grading-report-core']) vm.runInNewContext(readFileSync(new URL(`../extension/${name}.js`,import.meta.url),'utf8'),c);
const B=c.LearningTongBatch, R=c.LearningTongReport;
function sample(scores=[80]) {
 const scope={kind:'assignment',courseId:'private-course',classId:'private-class',workId:'private-work',courseName:'私密课程',className:'私密班级',workTitle:'私密作业'};
 const batch=B.createBatch(scope,scores.map((_,i)=>({identity:{...scope,answerId:`private-${i}`},status:'pending'})));
 for (const item of batch.items) item.snapshot={identity:item.identity,status:'pending',complete:true,totalMax:100,questions:[{id:'q-a',automatic:false,maxScore:80,question:'私密题干',studentAnswer:'私密学生回答',attachments:[]},{id:'q-b',automatic:true,maxScore:20,existingScore:20,question:'判断',studentAnswer:'私密客观答案'}]};
 B.setRubrics(batch,{'q-a':{dimensions:[{name:'教师维度',criteria:'私密标准',maxScore:80}]}});
 for(const [i,item]of batch.items.entries()){item.suggestions=[{questionId:'q-a',score:scores[i]-20,dimensionScores:[{name:'教师维度',score:scores[i]-20}],needsReview:false,evidence:'私密评分依据',comment:'私密评语'}];B.confirmItem(batch,item);}
 return batch;
}
test('confirmed and independently verified samples are separate; objective score is preserved',()=>{
 const b=sample([80,90]); b.items[1].state=B.states.verified;b.items[1].selected=false;
 const before=JSON.stringify(b),r=R.analyze(b);
 assert.equal(r.stats.confirmed.mean,80);assert.equal(r.stats.verified.mean,90);assert.equal(r.stats.confirmed.count,1);assert.equal(r.stats.verified.count,1);
 assert.equal(JSON.stringify(b),before); assert.equal(b.items[1].snapshot.questions[1].existingScore,20);
});
test('empty/unreviewed scores are missing, never zero means or verified scores',()=>{
 const b=sample();b.items[0].state=B.states.pending;b.items[0].approval=null;
 const r=R.analyze(b);assert.equal(r.stats.confirmed.mean,null);assert.equal(r.stats.verified.mean,null);assert.equal(r.stats.confirmed.count,0);assert.equal(r.issues[0].category,'review');
 assert.match(R.markdown(r,Date.now()),/暂无有效得分/);
});
test('legitimate zero is retained, not treated as missing',()=>{
 const b=sample([20]);b.items[0].snapshot.questions[1].existingScore=0;B.confirmItem(b,b.items[0]);
 assert.equal(R.analyze(b).stats.confirmed.mean,0);
});
test('mixed full scores are normalized per answer instead of averaged as raw scores',()=>{
 const b=sample([80,80]),i=b.items[1];i.snapshot.totalMax=200;i.snapshot.questions[1].maxScore=120;i.snapshot.questions[1].existingScore=100;B.confirmItem(b,i);
 const r=R.analyze(b); assert.equal(r.stats.confirmed.mean,80);assert.equal(r.stats.confirmed.median,80);
});
test('distribution uses exact boundaries and median, no institutional pass rate assumption',()=>{
 const b=sample([59.99,60,69.99,70,79.99,80,89.99,90,100]);
 const s=R.analyze(b).stats.confirmed;assert.deepEqual(Array.from(s.bands,x=>x.count),[1,2,2,2,2]);assert.equal(s.median,79.99);assert.equal(s.min,59.99);assert.equal(s.max,100);
 assert.match(R.markdown(R.analyze(b),Date.now()),/不设置及格结论/);
});
for(const [field,change] of [
 ['answer',b=>b.items[0].snapshot.questions[0].studentAnswer='changed'],
 ['identity',b=>b.items[0].identity.classId='other'],
 ['rubric',b=>b.rubrics['q-a'].dimensions[0].criteria='changed'],
 ['material',b=>b.items[0].materialKeys={changed:'new'}],
 ['dimension',b=>b.items[0].suggestions[0].dimensionScores=[]],
 ['duplicate suggestion',b=>b.items[0].suggestions.push(structuredClone(b.items[0].suggestions[0]))],
 ['missing objective score',b=>b.items[0].snapshot.questions[1].existingScore=null],
])test(`invalid or changed ${field} excluded from stats, retained as an issue`,()=>{
 const b=sample();change(b);const r=R.analyze(b);assert.equal(r.stats.confirmed.count,0);assert.equal(r.excluded.confirmed,1);assert.equal(r.issues[0].category,'stale');
});
test('verified state remains protected when new standards invalidate statistical evidence',()=>{
 const b=sample();b.items[0].state=B.states.verified;B.setRubrics(b,b.rubrics);
 const r=R.analyze(b);assert.equal(r.counts[B.states.verified],1);assert.equal(r.stats.verified.count,0);assert.match(r.issues[0].action,/已核验项不得因此重提/);assert.equal(b.items[0].state,B.states.verified);
});
test('uncertain/submitting/failed/manual items never counted as verified or auto-retried',()=>{
 const b=sample([80,80,80,80]);[B.states.uncertain,B.states.submitting,B.states.failed,B.states.manual].forEach((s,n)=>b.items[n].state=s);
 const before=JSON.stringify(b),r=R.analyze(b);assert.deepEqual(Array.from(r.issues,i=>i.category),['uncertain','submitting','failed','manual']);assert.equal(r.stats.verified.count,0);assert.match(r.issues[0].action,/禁止盲目/);assert.equal(JSON.stringify(b),before);
});
test('skipped existing grades never enter score distribution or require resubmission',()=>{
 const b=sample();b.items[0].state=B.states.skipped;const r=R.analyze(b);assert.equal(r.stats.confirmed.count,0);assert.equal(r.issues.length,0);assert.equal(r.counts[B.states.skipped],1);
});
test('unread, unconfirmed standards, flagged and ongoing items have distinct instructions',()=>{
 const b=sample([80,80,80]);b.items.forEach(i=>{i.state=B.states.pending;i.approval=null;});b.items[0].snapshot.complete=false;b.items[1].suggestions[0].needsReview=true;b.items[2].state=B.states.generating;
 assert.deepEqual(Array.from(R.analyze(b).issues,i=>i.category),['unread','flagged','generating']);b.rubricVersion=0;assert.equal(R.analyze(b).issues[1].category,'standards');
});
test('unknown status cannot become completed and selected/not-selected require teacher decisions',()=>{
 const b=sample([80,80,80]);b.items[0].selected=false;b.items[2].state='anything';
 const r=R.analyze(b);assert.deepEqual(Array.from(r.issues,i=>i.category),['unselected','selected','unknown']);assert.equal(r.counts['状态未知'],1);assert.equal(b.items[0].selected,false);
});
test('legacy zero without a dated independent rescan is not accepted as zero remaining',()=>{
 const b=sample();b.remainingPending=0;b.scanState='确认无数据';assert.equal(R.analyze(b).remaining,null);
 b.lastRescanAt=b.createdAt-1;assert.equal(R.analyze(b).remaining,null);
 b.lastRescanAt=Date.now();assert.equal(R.analyze(b).remaining,0);
 b.lastRescanAt=Date.now()+60000;assert.equal(R.analyze(b).remaining,null);b.lastRescanAt=Date.now();
 b.scanState='未获取';assert.equal(R.analyze(b).remaining,null);
 b.scanState='确认无数据';b.remainingPending=2;assert.equal(R.analyze(b).remaining,null);
});
test('report exports contain only anonymous aggregates, not personal fields or raw error injection',()=>{
 const b=sample([80,90]);b.items[1].state=B.states.failed;b.items[1].reason='学生姓名 私密报错 https://private.invalid';
 const r=R.analyze(b),out=R.markdown(r,Date.now())+R.csv(r);
 for(const s of ['私密','private-','学生姓名','https://','criteria','approval','answerId','q-a'])assert.ok(!out.includes(s),s);
 assert.ok(R.csv(r).startsWith('\uFEFF'));assert.match(out,/未获取有效复扫/);assert.match(out,/不代表全班/);
 assert.equal(R.csv(r).split('\r\n').length,11);
});
test('demo report explicitly labels simulation and does not claim platform acceptance',()=>{
 const b=sample();b.demo=true;assert.match(R.markdown(R.analyze(b),Date.now()),/脱敏模拟：不是实际教学/);assert.match(R.csv(R.analyze(b)),/脱敏模拟/);
});
test('consent basis changes with score, selection, scope, source answers, rubric and verification state',()=>{
 for(const change of [b=>b.items[0].selected=false,b=>b.scope.classId='other',b=>b.items[0].snapshot.questions[0].studentAnswer='new',b=>b.items[0].suggestions[0].score=70,b=>b.rubricVersion++,b=>b.items[0].state=B.states.verified,b=>b.lastRescanAt=Date.now()]){const b=sample(),key=R.basisKey(b);change(b);assert.notEqual(R.basisKey(b),key);}
});
test('duplicate identities, missing scope and oversized batches fail instead of truncating',()=>{
 const b=sample();b.items.push(structuredClone(b.items[0]));assert.throws(()=>R.analyze(b),/重复/);
 assert.throws(()=>R.analyze({scope:{},items:[]}),/范围不完整/);
 assert.throws(()=>R.analyze({...b,items:Array(5001).fill({})}),/超限/);
 assert.throws(()=>R.markdown(R.analyze(sample()),NaN),/时间/);
});

test('printable report is self-contained and escapes markup without scripts or external requests',()=>{
 const r=R.analyze(sample());r.state='<script>alert("unsafe")</script>';
 const html=R.html(r,Date.now());assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('https://'));assert.match(html,/@media print/);assert.ok(!html.includes('私密'));assert.match(html,/<h1>教师批改工作报告/);
});
