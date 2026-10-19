import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const supplied = process.argv.includes('--extension-id') ? process.argv[process.argv.indexOf('--extension-id') + 1] : '';
let extensionId = supplied;
if (!extensionId) {
  console.log('学习通教师助手 · 本机Codex连接\n请在浏览器的扩展详情页复制教学运营助手的32位ID。无需输入账号密码或Codex密钥。');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  extensionId = (await rl.question('插件ID：')).trim(); rl.close();
}
if (!/^[a-p]{32}$/.test(extensionId)) { console.error('插件ID无效，未启动连接。'); process.exitCode = 1; }
else {
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../server/codex-bridge.mjs'), '--extension-id', extensionId], { stdio: 'inherit', env: process.env });
  console.log('连接仅开放给该插件。启动后打开提示中的connectionCodeFile，将本次连接码填入插件“系统设置 → 本机Codex”。保持此窗口打开；关闭后本次连接失效。材料会通过当前Codex登录发送给OpenAI。');
  child.on('exit', code => { process.exitCode = code || 0; });
  child.on('error', () => { console.error('本机连接无法启动。'); process.exitCode = 1; });
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => child.kill(event));
}
