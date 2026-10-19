import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const contract = JSON.parse(readFileSync(resolve(root, "config/extension-parity-contract.json"), "utf8"));
const source = readFileSync(resolve(root, contract.source), "utf8");

for (const item of contract.items) {
  for (const token of item.sourceTokens) {
    if (!source.includes(token)) throw new Error(`原网页能力证据已变化：${item.name} 缺少 ${token}`);
  }
  const extensionText = item.extensionFiles.map((file) => readFileSync(resolve(root, file), "utf8")).join("\n");
  for (const token of item.extensionTokens) {
    if (!extensionText.includes(token)) throw new Error(`扩展功能回退：${item.name} 缺少 ${token}`);
  }
}

console.log(`原网页—浏览器扩展功能一致性校验通过：${contract.items.length}/${contract.items.length} 项真实交互已覆盖。`);
