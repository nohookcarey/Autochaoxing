import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {verifyRepositoryLayout} from './verify-repository-layout.mjs';
import {stagePublicRepository} from './stage-public-repository.mjs';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'repository-layout-'));
 const files={'README.md':'[安装](INSTALL.md)','INSTALL.md':'Install','docs/README.md':'Docs','legacy/README.md':'Legacy',
 '.github/dependabot.yml':'version: 2\nupdates:\n  - directory: "/apps/teacher-assistant"\n  - directory: "/legacy/chapter-builder"\n  - directory: "/legacy/chapter-tests"\n',
 'docs/teacher-assistant/ci/teacher-assistant.yml':'working-directory: apps/teacher-assistant\ncache-dependency-path: apps/teacher-assistant/package-lock.json\n',
 'apps/teacher-assistant/extension/manifest.json':'{}','apps/teacher-assistant/config/vendor-integrity.json':'{"files":[]}',
 'apps/teacher-assistant/extension/chapter-test-profiles.local.js':'globalThis.LearningTongChapterTestProfiles = [];\n',
 'apps/teacher-assistant/extension/attendance-profiles.local.js':'globalThis.LearningTongAttendanceProfiles = [];\n'};
 for(const dir of ['apps/teacher-assistant','legacy/chapter-builder','legacy/chapter-tests'])for(const name of ['package.json','package-lock.json'])files[dir+'/'+name]='{}';
 for(const [path,content]of Object.entries(files)){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content);}
 return root;
}
test('layout rejects missing navigation, old dependency paths and absent lockfiles',async()=>{
 const root=await fixture();try{
  assert.equal((await verifyRepositoryLayout(root)).passed,true);
  await writeFile(join(root,'README.md'),'[失效](missing.md)\n<img src="missing.png">');
  await writeFile(join(root,'.github/dependabot.yml'),'directory: "/old-app"\n');
  await rm(join(root,'apps/teacher-assistant/package-lock.json'));
  const result=await verifyRepositoryLayout(root);assert.equal(result.passed,false);
  for(const rule of ['broken-link','dependency-projects-mismatch','missing-automation-target'])assert.ok(result.issues.some(i=>i.rule===rule));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('source staging uses committed complete repository, excludes local edits and refuses stale targets',async()=>{
 const root=await fixture(),parent=await mkdtemp(join(tmpdir(),'stage-result-')),target=join(parent,'snapshot');
 const git=(args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
 try{
  git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
  await writeFile(join(root,'README.md'),'uncommitted');await writeFile(join(root,'untracked.txt'),'local only');
  const result=await stagePublicRepository(root,target);assert.equal(result.layout.passed,true);assert.equal(result.module.passed,true);
  assert.equal(await readFile(join(target,'README.md'),'utf8'),'[安装](INSTALL.md)');
  assert.equal(await readFile(join(target,'docs/README.md'),'utf8'),'Docs');
  await assert.rejects(readFile(join(target,'untracked.txt')),{code:'ENOENT'});
  await assert.rejects(stagePublicRepository(root,target),/为空/);
  await assert.rejects(stagePublicRepository(root,join(root,'release')),/仓库之外/);
 }finally{await rm(root,{recursive:true,force:true});await rm(parent,{recursive:true,force:true});}
});
