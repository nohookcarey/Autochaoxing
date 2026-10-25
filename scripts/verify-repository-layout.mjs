import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,join,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function verifyRepositoryLayout(directory){
 const root=resolve(directory),issues=[];let linksChecked=0;
 const exists=async path=>{try{await stat(join(root,path));return true;}catch{return false;}};
 for(const path of ['README.md','INSTALL.md','docs/README.md','legacy/README.md','apps/teacher-assistant/package.json','apps/teacher-assistant/extension/manifest.json'])if(!await exists(path))issues.push({path,rule:'missing-entry'});
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  if(['.git','node_modules','dist','release','coverage'].includes(entry.name))continue;
  const full=join(dir,entry.name),path=relative(root,full).split(sep).join('/');
  if(entry.isDirectory()){await walk(full);continue;}if(!entry.isFile()||!path.endsWith('.md'))continue;
  const text=await readFile(full,'utf8');
  const targets=[...text.matchAll(/\]\((<[^>]+>|[^)\s]+)\)/g)].map(m=>m[1].replace(/^<|>$/g,''));
  targets.push(...[...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]));
  for(const target of targets){
   if(/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target))continue;
   const file=target.split(/[?#]/)[0];if(!file)continue;
   let decoded;try{decoded=decodeURIComponent(file);}catch{issues.push({path,rule:'invalid-link'});continue;}
   const absolute=resolve(dirname(full),decoded);
   if(absolute!==root&&!absolute.startsWith(root+sep)){issues.push({path,target,rule:'link-outside-repository'});continue;}
   linksChecked++;if(!await exists(relative(root,absolute)))issues.push({path,target,rule:'broken-link'});
  }
 }}await walk(root);
 for(const config of ['.github/dependabot.yml','docs/teacher-assistant/ci/teacher-assistant.yml']){
  if(!await exists(config)){issues.push({path:config,rule:'missing-automation-config'});continue;}
  const text=await readFile(join(root,config),'utf8');
  if(config.startsWith('.github/')){
   const directories=[...text.matchAll(/^\s*(?:-\s*)?directory:\s*["']?([^"'\n]+?)["']?\s*$/gm)].map(m=>m[1].trim()).sort();
   if(JSON.stringify(directories)!==JSON.stringify(['/apps/teacher-assistant','/legacy/chapter-builder','/legacy/chapter-tests']))issues.push({path:config,rule:'dependency-projects-mismatch'});
  }
  for(const match of text.matchAll(/^\s*(?:-\s*)?(directory|working-directory|cache-dependency-path):\s*["']?([^"'\n]+?)["']?\s*$/gm)){
   const path=match[2].trim().replace(/^\//,'');
   for(const target of match[1]==='directory'?[path+'/package.json',path+'/package-lock.json']:[path])if(!await exists(target))issues.push({path:config,target,rule:'missing-automation-target'});
  }
 }return {passed:!issues.length,linksChecked,issues};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const result=await verifyRepositoryLayout(process.argv[2]||process.cwd());console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;}
