import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scannerPath = resolve(process.cwd(), "automation/scan-assignment-pending.js");
const source = readFileSync(scannerPath, "utf8");
new Function(`return (${source});`)();

for (const required of ["--course-name", "--target-classes", "gateStatus", "acquisitionState", "确认无数据", "未获取", "pendingAssignments", "classSummary"]) {
  if (!source.includes(required)) throw new Error(`扫描器缺少必要契约：${required}`);
}
for (const forbidden of ["汽车智能1班", "汽车智能2班", "login_xuexitong", "password", "cookie"]) {
  if (source.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`扫描器包含不应复用的内容：${forbidden}`);
}
console.log("作业只读扫描适配器校验通过：无硬编码班级、无登录逻辑、包含门禁与状态契约。");
