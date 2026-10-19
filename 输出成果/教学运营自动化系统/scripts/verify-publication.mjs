import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, relative, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const skip=new Set(['.git','node_modules','dist','release','coverage']);
const localPath=/(?:^|\/)(?:\.backup-[^/]*|tmp|\.DS_Store|\.env(?:\..*)?|[^/]+\.(?:pem|key))$|^config\/[^/]+\.local\.json$/;
const patterns=[
 ['personal-path',/\/Users\/[^/\s<>{}"']+\//],
 ['platform-identity',/[?&](?:courseid|clazzid|cpi|workid|workanswerid)=\d{5,}/i],
 ['credential',/\b(?:gh[opusr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{25,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,})\b/],
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const profiles={
 'extension/chapter-test-profiles.local.js':'globalThis.LearningTongChapterTestProfiles = [];\n',
 'extension/attendance-profiles.local.js':'globalThis.LearningTongAttendanceProfiles = [];\n',
};
export async function verifyPublication(directory){
 const root=resolve(directory),issues=[],files=[];
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  if(skip.has(entry.name))continue;const full=join(dir,entry.name),path=relative(root,full).replaceAll('\\','/');
  if(entry.isSymbolicLink()){issues.push({path,rule:'symlink'});continue;}
  if(localPath.test(path)){issues.push({path,rule:'local-only-file'});continue;}
  if(entry.isDirectory()){await walk(full);continue;}if(!entry.isFile())continue;files.push(path);
  if(!/\.(?:js|mjs|jsx|json|md|html|css|yml|yaml|cmd|command|txt)$/i.test(path)||path.startsWith('extension/vendor/'))continue;
  const content=await readFile(full,'utf8');for(const [rule,pattern]of patterns)if(pattern.test(content))issues.push({path,rule});
 }}
 await walk(root);
 for(const [path,expected]of Object.entries(profiles)){
  if(!files.includes(path)||await readFile(join(root,path),'utf8')!==expected)issues.push({path,rule:'private-profile'});
 }
 const integrityPath='config/vendor-integrity.json';
 if(!files.includes(integrityPath))issues.push({path:integrityPath,rule:'missing-vendor-integrity'});
 else{
  const integrity=JSON.parse(await readFile(join(root,integrityPath),'utf8'));
  for(const item of integrity.files){
   if(!files.includes(item.path)){issues.push({path:item.path,rule:'missing-vendor'});continue;}
   const hash=createHash('sha256').update(await readFile(join(root,item.path))).digest('hex');
   if(hash!==item.sha256)issues.push({path:item.path,rule:'vendor-sha256'});
  }
 }
 return {passed:issues.length===0,fileCount:files.length,issues};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await verifyPublication(process.argv[2]||process.cwd());console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
