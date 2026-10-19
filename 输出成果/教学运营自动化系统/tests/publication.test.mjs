import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {verifyPublication} from '../scripts/verify-publication.mjs';
async function candidate(){const root=await mkdtemp(join(tmpdir(),'teacher-publication-test-'));await mkdir(join(root,'extension'));await mkdir(join(root,'config'));await writeFile(join(root,'extension/chapter-test-profiles.local.js'),'globalThis.LearningTongChapterTestProfiles = [];\n');await writeFile(join(root,'extension/attendance-profiles.local.js'),'globalThis.LearningTongAttendanceProfiles = [];\n');await writeFile(join(root,'config/vendor-integrity.json'),JSON.stringify({files:[]}));return root;}
test('publication permits empty profiles and only reports filenames when rejecting secrets',async()=>{
 const root=await candidate();assert.equal((await verifyPublication(root)).passed,true);
 const secret='ghp_'+'A'.repeat(36);await writeFile(join(root,'settings.js'),'const token="'+secret+'";');const r=await verifyPublication(root);assert.equal(r.passed,false);assert.ok(r.issues.some(i=>i.rule==='credential'));assert.equal(JSON.stringify(r).includes(secret),false);
});
test('publication rejects local connection data, historical backups and changed private profiles',async()=>{
 const root=await candidate();await writeFile(join(root,'config/course-connections.local.json'),'{}');await mkdir(join(root,'.backup-history'));await writeFile(join(root,'extension/attendance-profiles.local.js'),'globalThis.LearningTongAttendanceProfiles = [{courseId:"private"}];');const r=await verifyPublication(root);assert.equal(r.passed,false);assert.ok(r.issues.some(i=>i.rule==='private-profile'));assert.ok(r.issues.filter(i=>i.rule==='local-only-file').length>=2);
});
test('publication verifies vendor byte integrity and rejects actual local paths or platform bindings',async()=>{
 const root=await candidate();await writeFile(join(root,'vendor.js'),'original bytes');await writeFile(join(root,'config/vendor-integrity.json'),JSON.stringify({files:[{path:'vendor.js',sha256:createHash('sha256').update('original bytes').digest('hex')}]}));assert.equal((await verifyPublication(root)).passed,true);
 await writeFile(join(root,'vendor.js'),'modified bytes');await writeFile(join(root,'identity.md'),'https://mooc1.chaoxing.com/work?courseid='+'123456789');const r=await verifyPublication(root);assert.equal(r.passed,false);assert.ok(r.issues.some(i=>i.rule==='vendor-sha256'));assert.ok(r.issues.some(i=>i.rule==='platform-identity'));
});
