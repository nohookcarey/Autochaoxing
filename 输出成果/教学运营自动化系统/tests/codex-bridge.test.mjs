import test from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {request} from 'node:http';
import {PassThrough} from 'node:stream';
import {createBridge,validateRequest,runCodex,codexConfigArgs} from '../server/codex-bridge.mjs';
const body={model:'codex-default',messages:[{role:'user',content:'只返回OK'}]};
test('bridge rejects file URLs, credential fields and excessive materials',()=>{
  for(const value of [{...body,apiKey:'private'}, {...body,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'file:///private.png'}}]}]}, {...body,messages:[{role:'user',content:'x'.repeat(70001)}]}]) assert.throws(()=>validateRequest(value));
  assert.equal(validateRequest(body),body);
});
test('official protocol selects account-supported model and accepts completed message event',async()=>{
 const proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough();proc.kill=()=>true;
 let start;proc.stdin.on('data',b=>{const q=JSON.parse(b.toString());const reply=result=>proc.stdout.write(JSON.stringify({id:q.id,result})+'\n');
 if(q.method==='initialize')reply({});
 if(q.method==='model/list')reply({data:[{model:'supported-model',isDefault:true}]});
 if(q.method==='thread/start'){start=q.params;reply({thread:{id:'thread'},model:q.params.model});}
 if(q.method==='turn/start'){assert.equal(q.params.sandboxPolicy,undefined);reply({turn:{id:'turn'}});setImmediate(()=>{
 proc.stdout.write(JSON.stringify({method:'item/completed',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'OK'}}})+'\n');
 proc.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',items:[]}}})+'\n');});}
 });
 const result=await runCodex(body,{cwd:'/tmp',spawnProcess:()=>proc});
 assert.equal(result.content,'OK');assert.equal(result.model,'supported-model');assert.equal(start.ephemeral,true);assert.equal(start.sandbox,'read-only');assert.deepEqual(start.environments,[]);assert.equal(start.approvalPolicy,'never');
 assert.ok(codexConfigArgs().includes('features.shell_tool=false'));
});
test('localhost endpoint enforces exact origin, host and session token; serializes requests',async()=>{
 let release;let running;const entered=new Promise(r=>running=r);let calls=0;
 const server=createBridge({token:'a'.repeat(64),origin:'chrome-extension://'+'b'.repeat(32),cwd:'/tmp',runner:async()=>{calls++;running();await new Promise(r=>release=r);return{content:'OK',model:'supported'};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}/v1/chat/completions`;
 const httpFetch=(url,opts)=>new Promise((resolve,reject)=>{const r=request(url,{method:opts.method,headers:opts.headers},response=>{let data='';response.on('data',b=>data+=b);response.on('end',()=>resolve({status:response.statusCode,json:async()=>JSON.parse(data)}));});r.on('error',reject);r.end(opts.body);});
 const options={method:'POST',headers:{Host:'127.0.0.1:4175',Origin:'chrome-extension://'+'b'.repeat(32),Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify(body)};
 try {
 assert.equal((await httpFetch(url,{...options,headers:{...options.headers,Origin:'https://evil.example'}})).status,403);
 assert.equal((await httpFetch(url,{...options,headers:{...options.headers,Authorization:'Bearer wrong'}})).status,401);
 const first=httpFetch(url,options);await entered;
 assert.equal((await httpFetch(url,options)).status,409);release();const result=await first;assert.equal(result.status,200);assert.equal((await result.json()).choices[0].message.content,'OK');assert.equal(calls,1);
 }finally{server.closeAllConnections();server.close();}
});
function protocolProcess(onTurn){
 const proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough();let kills=0;proc.kill=()=>{kills++;};
 const event=m=>proc.stdout.write(JSON.stringify(m)+'\n');
 proc.stdin.on('data',b=>{const q=JSON.parse(b.toString());if(!q.method)return;const reply=result=>event({id:q.id,result});
 if(q.method==='initialize')reply({});if(q.method==='model/list')reply({data:[{model:'available',isDefault:true}]});if(q.method==='thread/start')reply({thread:{id:'thread'},model:'available'});
 if(q.method==='turn/start'){reply({turn:{id:'turn'}});setImmediate(()=>onTurn(event,q.params));}});
 return{proc,kills:()=>kills};
}
test('Codex tool activity is refused before accepting any answer',async()=>{
 for(const message of [{method:'item/started',params:{item:{type:'commandExecution'}}},{id:88,method:'item/commandExecution/requestApproval',params:{}},{method:'item/completed',params:{item:{type:'mcpToolCall'}}}]){
  const p=protocolProcess(event=>event(message));await assert.rejects(runCodex(body,{cwd:'/tmp',spawnProcess:()=>p.proc}),/中止|拒收/);assert.ok(p.kills()>0);
 }
});
test('failed and empty completions remain unavailable, never success',async()=>{
 for(const status of ['failed','completed']){
 const p=protocolProcess(event=>event({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status,items:[]}}}));
 await assert.rejects(runCodex(body,{cwd:'/tmp',spawnProcess:()=>p.proc}),/未完成|正文为空/);
 }
});
test('cancel and timeout terminate Codex instead of returning late content',async()=>{
 const controller=new AbortController();const p=protocolProcess(()=>controller.abort());
 await assert.rejects(runCodex(body,{cwd:'/tmp',signal:controller.signal,spawnProcess:()=>p.proc}),/取消/);assert.ok(p.kills()>0);
 const q=protocolProcess(()=>{});await assert.rejects(runCodex(body,{cwd:'/tmp',timeoutMs:20,spawnProcess:()=>q.proc}),/超时/);assert.ok(q.kills()>0);
});
test('text and image material order is retained in Codex input',async()=>{
 const content=[{type:'text',text:'材料一'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}},{type:'text',text:'材料二'},{type:'image_url',image_url:{url:'data:image/png;base64,AQ=='}}];
 const p=protocolProcess((event,params)=>{assert.deepEqual(params.input.slice(1).map(i=>i.type),['text','image','text','image']);assert.equal(params.input[1].text,'材料一');assert.equal(params.input[3].text,'材料二');event({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:'OK'}]}}});});
 assert.equal((await runCodex({...body,messages:[{role:'user',content}]},{cwd:'/tmp',spawnProcess:()=>p.proc})).content,'OK');
});
