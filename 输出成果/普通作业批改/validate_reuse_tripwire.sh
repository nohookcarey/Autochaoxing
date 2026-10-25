#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_FILE="${XTX_WORKFLOW_FILE:-}"
README_FILE="${SCRIPT_DIR}/README.md"
COURSE_CONTEXT_FILE="${SCRIPT_DIR}/course_context.md"

PLAYWRIGHT_FN_FILES=(
  "${SCRIPT_DIR}/login_xuexitong.js"
  "${SCRIPT_DIR}/scan_assignment_pending.js"
  "${SCRIPT_DIR}/collect_assignment_review_basis.js"
  "${SCRIPT_DIR}/batch_grade_assignment.js"
)

NODE_FILES=(
  "${SCRIPT_DIR}/xuexitong_grading_common.js"
)

SHELL_FILES=(
  "${SCRIPT_DIR}/run_with_playwright_cli.sh"
  "${SCRIPT_DIR}/validate_reuse_tripwire.sh"
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

for file in "${NODE_FILES[@]}"; do
  node --check "$file" >/dev/null
  echo "  OK  $file"
done

for file in "${SHELL_FILES[@]}"; do
  bash -n "$file"
  echo "  OK  $file"
done

echo "[验证2/3] 流程契约验证"
rg -q "不能跳过“扫描”“口径判断”“复扫”“评分表输出”" "$WORKFLOW_FILE"
rg -q "评分表只在对话中展示" "$WORKFLOW_FILE"
rg -q "三重验证" "$WORKFLOW_FILE" "$README_FILE" "$COURSE_CONTEXT_FILE" || true
rg -q "pendingAssignments" "${SCRIPT_DIR}/scan_assignment_pending.js"
rg -q "classSummary" "${SCRIPT_DIR}/scan_assignment_pending.js"
rg -q "completedScoreBands" "${SCRIPT_DIR}/collect_assignment_review_basis.js"
rg -q "pendingEvidenceSamples" "${SCRIPT_DIR}/collect_assignment_review_basis.js"
rg -q "scoreTable" "${SCRIPT_DIR}/batch_grade_assignment.js"
echo "  OK  工作流与脚本输出契约一致"

echo "[验证3/3] 课程配置一致性验证"
rg -q '`courseId`: ``' "$COURSE_CONTEXT_FILE"
rg -q '`cpi`: ``' "$COURSE_CONTEXT_FILE"
rg -q '待填写班级1' "$COURSE_CONTEXT_FILE"
rg -q '待填写班级2' "$COURSE_CONTEXT_FILE"
rg -q 'courseWorkListUrl' "$COURSE_CONTEXT_FILE"
rg -q 'login\\|scan\\|collect\\|grade\\|validate' "${SCRIPT_DIR}/run_with_playwright_cli.sh"
test -f "${SCRIPT_DIR}/assignment_params_template.js"
echo "  OK  课程参数已脱敏、入口脚本和参数模板齐备"

echo "三重验证通过"
