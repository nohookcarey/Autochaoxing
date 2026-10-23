import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context={URL,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,btoa};context.globalThis=context;
for(const file of ['grading-batch-core.js','content/ai-grading-core.js','content/grading-adapter-core.js'])vm.runInNewContext(readFileSync(new URL('../extension/'+file,import.meta.url),'utf8'),context);
const A=context.LearningTongGradingAdapter;
const identity={kind:'assignment',courseId:'fixture-course',classId:'fixture-class',workId:'fixture-work',answerId:'fixture-answer'};
const url='https://mooc1.chaoxing.com/work/library/review-work?courseId=fixture-course&clazzId=fixture-class&workId=fixture-work&workAnswerId=fixture-answer';
// DOM boundary fixtures based on the observed new teacher page; no real student data.
function fixture({questions=2,embedded=false,empty=false,titleCount=questions,native=false}={}){
 const boxes=Array.from({length:questions},(_,i)=>{
  const fields={};const frame={getAttribute:k=>({filename:'匿名材料.docx',objectid:native?'a'.repeat(32):'fixture-object',src:native?'https://mooc1.chaoxing.com/ananas/common-modules/attachment/insertCloud.html':'https://mooc1.chaoxing.com/ananas/modules/attach/index.html'}[k]||null),closest:()=>({})};
  const answer={textContent:`学生答案：${empty?'':'正文'+i}正确答案：参考`,innerText:'正确答案：参考',querySelector:s=>s.includes('.studentAns')?{textContent:empty?'':'正文'+i}:s.includes('.hiddenAnswer')?{textContent:'参考'}:null,querySelectorAll:s=>s.includes('iframe')&&embedded?[frame]:[],contains:()=>true};
  const box={id:'question-'+i,getAttribute:()=>null,querySelector:s=>s.startsWith('#')?null:s.includes('input.questionScore')?{id:'score-'+i,value:'',disabled:false,readOnly:false}:s.includes('qscore')?{value:'100'}:s==='.mark_name'?{textContent:'说明工作步骤（100分）'}:s==='.mark_answer_key'?answer:null,querySelectorAll:()=>[]};
  answer.closest=()=>box;return box;
 });
 return {body:{textContent:'教师批阅 学生答案'},querySelectorAll:s=>s==='.mark_item, .mark_item1'?boxes:s==='.TiMu'?[{querySelector:()=>boxes[0]}]:s==='.mark_name'?Array.from({length:titleCount},()=>({})):[],querySelector:s=>s==='#tmpscore'?{value:'',disabled:false,readOnly:false}:s.includes('workAnswerId')?{value:identity.answerId}:s.includes('fullScore')?{value:String(questions*100)}:null};
}
test('new page outer TiMu enumerates each question, not one wrapper',()=>{
 const r=A.readSnapshot(fixture(),url,identity);assert.equal(r.questions.length,2);assert.equal(r.totalMax,200);assert.equal(r.complete,true);assert.equal(r.questions[0].id,'question-0');assert.equal(r.questions[1].id,'question-1');
});
test('hidden reference display does not erase student answer or mix labels',()=>{
 const r=A.readSnapshot(fixture({questions:1}),url,identity);assert.equal(r.questions[0].studentAnswer,'正文0');assert.equal(r.questions[0].referenceAnswer,'参考');
});
test('iframe attachment is explicitly unread, cannot masquerade as complete empty answer',()=>{
 const r=A.readSnapshot(fixture({questions:1,embedded:true,empty:true}),url,identity);assert.equal(r.complete,false);assert.match(r.reason,/内嵌附件/);assert.equal(r.questions[0].unresolvedMaterials.length,1);assert.equal(r.questions[0].unresolvedMaterials[0].kind,'word');
});
test('missing answer and inconsistent question count remain incomplete',()=>{
 assert.equal(A.readSnapshot(fixture({questions:1,empty:true}),url,identity).complete,false);
 assert.equal(A.readSnapshot(fixture({questions:2,titleCount:3}),url,identity).complete,false);
});

const nativeFixture=()=>fixture({questions:1,embedded:true,empty:true,native:true});
const nativeAttachment=()=>A.readSnapshot(nativeFixture(),url,identity).questions[0].attachments[0];
function fetchFixture({objectid='a'.repeat(32),download='http://d0.cldisk.com/download/'+ 'b'.repeat(32),length=3,body=new Uint8Array([80,75,3])}={}) {
 const calls=[];
 const fetcher=async(href,options)=>{calls.push({href,options});return calls.length===1?new Response(JSON.stringify({objectid,download,length})):new Response(body);};
 return {fetcher,calls};
}
test('native DOCX viewer becomes a bound attachment, no viewer text used as answer',()=>{
 const r=A.readSnapshot(nativeFixture(),url,identity);assert.equal(r.complete,true);assert.equal(r.questions[0].studentAnswer,'');assert.equal(r.questions[0].unresolvedMaterials.length,0);assert.equal(r.questions[0].attachments[0].resolver,'chaoxing-status');assert.equal(r.questions[0].attachments[0].role,'学生答案');
});
test('native material resolves verified object, HTTPS CDN with no credentials, exact bytes',async()=>{
 const {fetcher,calls}=fetchFixture();const r=await A.readEmbeddedMaterial(nativeFixture(),url,identity,nativeAttachment(),fetcher);
 assert.equal(r.dataBase64,'UEsD');assert.equal(calls[0].options.credentials,'include');assert.equal(calls[1].options.credentials,'omit');assert.equal(calls[1].options.redirect,'error');assert.ok(calls[1].href.startsWith('https://d0.cldisk.com/'));
});
function imageFixture({src='https://p.ananas.chaoxing.com/star3/origin/'+'a'.repeat(32),role='学生答案'}={}) {
 const doc=fixture({questions:1,empty:true});
 const answer=doc.querySelectorAll('.mark_item, .mark_item1')[0].querySelector('.mark_answer_key');
 const image={getAttribute:name=>name==='src'?src:null};
 answer.querySelectorAll=selector=>selector==='img[src]'?[image]:[];
 doc.createRange=()=>({selectNodeContents(){},setEndBefore(){},toString:()=>role+'：'});
 return doc;
}
test('native inline answer image uses the bound original-file resolver instead of cross-origin image fetch',async()=>{
 const doc=imageFixture();const snapshot=A.readSnapshot(doc,url,identity);const attachment=snapshot.questions[0].attachments[0];
 assert.equal(snapshot.complete,true);assert.equal(attachment.kind,'image');assert.equal(attachment.resolver,'chaoxing-status');assert.equal(attachment.role,'学生答案');
 assert.equal(attachment.href,'https://mooc1.chaoxing.com/ananas/status/'+'a'.repeat(32));
 const {fetcher,calls}=fetchFixture();const result=await A.readEmbeddedMaterial(doc,url,identity,attachment,fetcher);
 assert.equal(result.dataBase64,'UEsD');assert.equal(calls.length,2);assert.equal(calls[1].options.credentials,'omit');assert.equal(calls[1].options.redirect,'error');
});
test('inline image resolution excludes reference material, altered routes and mismatched descriptors',async()=>{
 for(const options of [{role:'正确答案'},{src:'https://other.chaoxing.com/star3/origin/'+'a'.repeat(32)},{src:'https://p.ananas.chaoxing.com/star3/origin/'+'a'.repeat(32)+'?extra=1'},{src:'https://p.ananas.chaoxing.com/star3/origin/'+'a'.repeat(32)+'#fragment'},{src:'https://p.ananas.chaoxing.com/star3/thumb/'+'a'.repeat(32)}]){
  assert.equal(A.readSnapshot(imageFixture(options),url,identity).questions[0].attachments[0].resolver,undefined);
 }
 const doc=imageFixture();const attachment=A.readSnapshot(doc,url,identity).questions[0].attachments[0];const {fetcher,calls}=fetchFixture();
 await assert.rejects(A.readEmbeddedMaterial(doc,url,identity,{...attachment,objectId:'c'.repeat(32)},fetcher),/不一致/);assert.equal(calls.length,0);
});
test('material rejected when descriptor or submission does not match current answer',async()=>{
 const {fetcher,calls}=fetchFixture();await assert.rejects(A.readEmbeddedMaterial(nativeFixture(),url,identity,{...nativeAttachment(),objectId:'c'.repeat(32)},fetcher),/不一致/);assert.equal(calls.length,0);
 await assert.rejects(A.readEmbeddedMaterial(nativeFixture(),url,{...identity,answerId:'other'},nativeAttachment(),fetcher),/身份/);
});
test('metadata object mismatch and unverified download host fail before file fetch',async()=>{
 for(const options of [{objectid:'c'.repeat(32)},{download:'https://example.com/download/'+ 'b'.repeat(32)},{download:'https://d0.cldisk.com.evil.test/download/'+ 'b'.repeat(32)},{download:'file:///download/'+ 'b'.repeat(32)}]) {
  const {fetcher,calls}=fetchFixture(options);await assert.rejects(A.readEmbeddedMaterial(nativeFixture(),url,identity,nativeAttachment(),fetcher),/身份|来源/);assert.equal(calls.length,1);
 }
});
test('incomplete and oversized original files fail without truncation',async()=>{
 for(const options of [{length:4},{length:15000001},{length:0,body:new Uint8Array(15000001)}]) {
  const {fetcher}=fetchFixture(options);await assert.rejects(A.readEmbeddedMaterial(nativeFixture(),url,identity,nativeAttachment(),fetcher),/长度|超限/);
 }
});
test('page change during download invalidates material',async()=>{
 const doc=nativeFixture(),{fetcher}=fetchFixture();let changed=false;const original=doc.querySelectorAll;doc.querySelectorAll=s=>changed&&s==='.mark_item, .mark_item1'?[]:changed&&s==='.TiMu'?[]:original(s);
 const r=async(...args)=>{const result=await fetcher(...args);if(String(args[0]).startsWith('https://d0'))changed=true;return result;};
 await assert.rejects(A.readEmbeddedMaterial(doc,url,identity,nativeAttachment(),r),/页面结构|变化/);
});
function listFixture(status,score){
 const link={getAttribute:k=>k==='data'?url:null};
 const row={id:'workAnswer_fixture-answer',querySelectorAll:s=>s==='a[data], a[href]'?[link]:[],querySelector:s=>s==='input.scoreInput'?{value:score,getAttribute:()=>score}:s.includes('data-status')?{textContent:status}:null};
 return {body:{textContent:'教师批阅'},querySelectorAll:s=>s==='ul.dataBody_td'?[row]:[],querySelector:s=>s.includes('totalPage')?{value:'1'}:null};
}
test('completed answer with explicit numeric platform score is skipped, not pending',()=>{
 const r=A.listEntries(listFixture('已完成','88'),url,identity);assert.equal(r.entries[0].status,'graded');
});
test('completed label without readable score remains unknown, never claims zero pending',()=>{
 for(const score of ['', '无法获取'])assert.equal(A.listEntries(listFixture('已完成',score),url,identity).entries[0].status,'unknown');
});
test('pending answer with zero score control remains pending',()=>{
 assert.equal(A.listEntries(listFixture('待批阅','0'),url,identity).entries[0].status,'pending');
});
