#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_FILE="/LOCAL/Documents/Obsidian Vault/01-工作流/工作流-学习通作业截止日期批量修改.md"
README_FILE="${SCRIPT_DIR}/README.md"

PLAYWRIGHT_FN_FILES=(
  "${SCRIPT_DIR}/login_xuexitong.js"
  "${SCRIPT_DIR}/scan_deadline_targets.js"
  "${SCRIPT_DIR}/update_assignment_deadline.js"
)

SHELL_FILES=(
  "${SCRIPT_DIR}/run_deadline_workflow.sh"
  "${SCRIPT_DIR}/validate_deadline_update_tripwire.sh"
)

echo "[验证1/3] 语法验证"
for file in "${PLAYWRIGHT_FN_FILES[@]}"; do
  node - <<'NODE' "$file"
const fs = require("fs");
const file = process.argv[2];
const code = fs.readFileSync(file, "utf8");
new Function(`return (${code});`)();
NODE
  echo "  OK  $file"
done

for file in "${SHELL_FILES[@]}"; do
  bash -n "$file"
  echo "  OK  $file"
done

echo "[验证2/3] 契约验证"
rg -q "目标作业清单" "$WORKFLOW_FILE"
rg -q "单条真实修改" "$WORKFLOW_FILE"
rg -q '回读 `endTime`' "$WORKFLOW_FILE"
rg -q "answerDeadlinePicker" "$WORKFLOW_FILE"
rg -q "targetAssignments" "${SCRIPT_DIR}/scan_deadline_targets.js"
rg -q "passed" "${SCRIPT_DIR}/update_assignment_deadline.js"
rg -q "login|scan|update|validate" "${SCRIPT_DIR}/run_deadline_workflow.sh"
echo "  OK  工作流与脚本输出契约一致"

echo "[验证3/3] 场景验证"
test -f "${SCRIPT_DIR}/deadline_update_config.template.json"
rg -q 'targetDate' "${SCRIPT_DIR}/deadline_update_config.template.json"
rg -q 'targetClasses' "${SCRIPT_DIR}/deadline_update_config.template.json"
rg -q 'keepOriginalTime' "${SCRIPT_DIR}/deadline_update_config.template.json"
echo "  OK  配置模板和执行入口齐备"

echo "三重验证通过"
