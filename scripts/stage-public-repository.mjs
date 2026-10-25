import {execFileSync} from 'node:child_process';
import {mkdir,readdir,writeFile,realpath,chmod} from 'node:fs/promises';
import {resolve,join,dirname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyPublicRepository} from './verify-public-repository.mjs';
import {verifyRepositoryLayout} from './verify-repository-layout.mjs';
import {verifyPublication} from '../apps/teacher-assistant/scripts/verify-publication.mjs';
export async function stagePublicRepository(source,destination){
 source=await realpath(source);const target=resolve(destination);
 const git=(args,encoding='utf8')=>execFileSync('git',['-C',source,...args],{encoding,maxBuffer:32*1024*1024});
 if(await realpath(git(['rev-parse','--show-toplevel']).trim())!==source)throw Error('请使用公开仓库根目录。');
 if(target===source||target.startsWith(source+sep))throw Error('暂存目录必须在仓库之外。');
 await mkdir(target,{recursive:true});const canonical=await realpath(target);
 if(canonical===source||canonical.startsWith(source+sep))throw Error('暂存目录必须在仓库之外。');
 if((await readdir(target)).length)throw Error('暂存目录必须为空；不会覆盖旧包。');
 const commit=git(['rev-parse','HEAD']).trim();
 const entries=git(['ls-tree','-r','-z',commit]).split('\0').filter(Boolean).map(entry=>{
  const tab=entry.indexOf('\t'),[mode,type,oid]=entry.slice(0,tab).split(' '),path=entry.slice(tab+1);
  if(type!=='blob'||!['100644','100755'].includes(mode)||path.split('/').includes('..')||path.startsWith('/'))throw Error('快照含不支持的文件类型或路径。');
  return {mode,oid,path};
 });
 for(const {mode,oid,path} of entries){const file=join(canonical,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,git(['cat-file','blob',oid],null));if(mode==='100755')await chmod(file,0o755);}
 const privacy=await verifyPublicRepository(canonical),layout=await verifyRepositoryLayout(canonical),module=await verifyPublication(join(canonical,'apps/teacher-assistant'));
 if(!privacy.passed||!layout.passed||!module.passed)throw Error('快照核验失败：'+JSON.stringify({privacy,layout,module}));
 return {commit,fileCount:entries.length,privacy,layout,module};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(!process.argv[2])throw Error('请指定独立、空的发布暂存目录。');console.log(JSON.stringify(await stagePublicRepository(process.cwd(),process.argv[2]),null,2));}
