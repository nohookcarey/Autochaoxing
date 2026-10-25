import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {stagePublicRepository} from '../../../scripts/stage-public-repository.mjs';
if(!process.argv[2])throw Error('请指定独立、空的GitHub发布暂存目录。');
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
console.log(JSON.stringify(await stagePublicRepository(repository,resolve(process.argv[2])),null,2));
