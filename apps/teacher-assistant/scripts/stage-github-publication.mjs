import {cp,mkdir,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative,basename,sep} from 'node:path';
import {verifyPublication} from './verify-publication.mjs';
const source=process.cwd(),target=resolve(process.argv[2]||'');
if(!process.argv[2]||target===source)throw Error('请指定独立的GitHub发布目录。');
const topFiles=['.gitignore','.gitattributes','.npmrc','AGENTS.md','LICENSE','README.md','index.html','package.json','package-lock.json','vite.config.mjs'];
const directories=['.openai','automation','config','extension','public','server','src','tests','worker'];
const scripts=['build-extension-release.mjs','prepare-sites-build.mjs','start-codex-bridge.mjs','start-local.mjs','validate-assignment-scanner.mjs','validate-course-profiles.mjs','validate-extension-parity.mjs','validate-extension.mjs','verify-extension-release.mjs','verify-publication.mjs','stage-github-publication.mjs','启动Codex连接.cmd','启动Codex连接.command'];
const filter=path=>basename(path)!=='.DS_Store'&&!/\.local\.json$| 2\./.test(path);
if(target.startsWith(source+sep))throw Error('发布暂存目录必须在源码目录之外。');
try { if((await readdir(target)).length)throw Error('发布暂存目标必须为空，防止残留文件混入。'); } catch(error) { if(error.code!=='ENOENT')throw error; }
await mkdir(target,{recursive:true});
for(const file of topFiles)await cp(join(source,file),join(target,file));
for(const directory of directories)await cp(join(source,directory),join(target,directory),{recursive:true,filter});
await mkdir(join(target,'scripts'),{recursive:true});for(const file of scripts)await cp(join(source,'scripts',file),join(target,'scripts',file));
await writeFile(join(target,'extension/chapter-test-profiles.local.js'),'globalThis.LearningTongChapterTestProfiles = [];\n');
await writeFile(join(target,'extension/attendance-profiles.local.js'),'globalThis.LearningTongAttendanceProfiles = [];\n');
const result=await verifyPublication(target);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
