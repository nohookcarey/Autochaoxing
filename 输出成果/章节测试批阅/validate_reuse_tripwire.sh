#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_FILE="${XTX_WORKFLOW_FILE:-}"
README_FILE="${SCRIPT_DIR}/README.md"
COURSE_CONTEXT_FILE="${SCRIPT_DIR}/nlp_chapter_course_context.md"

PLAYWRIGHT_FILES=(
  "${SCRIPT_DIR}/audit_pending_chapter_tests.js"
  "${SCRIPT_DIR}/discover_all_chapter_tests.js"
  "${SCRIPT_DIR}/grade_chapter_test.js"
)

NODE_FILES=(
  "${SCRIPT_DIR}/browser_timeout_config.js"
  "${SCRIPT_DIR}/chaoxing_helpers.js"
  "${SCRIPT_DIR}/chapter_tests_config.js"
  "${SCRIPT_DIR}/graceful_browser_exit.js"
)

SHELL_FILES=(
  "${SCRIPT_DIR}/run_chapter_workflow.sh"
  "${SCRIPT_DIR}/validate_reuse_tripwire.sh"
)

echo "[验证1/3] 语法与本地文件状态验证"
for file in "${PLAYWRIGHT_FILES[@]}" "${NODE_FILES[@]}"; do
  if ls -lO "$file" | rg -q "dataless"; then
    echo "  FAIL  $file 仍是 dataless 文件，请先恢复为本地真实文件" >&2
    exit 1
  fi
  node --check "$file" >/dev/null
  echo "  OK  $file"
done

for file in "${SHELL_FILES[@]}"; do
  if ls -lO "$file" | rg -q "dataless"; then
    echo "  FAIL  $file 仍是 dataless 文件，请先恢复为本地真实文件" >&2
    exit 1
  fi
  bash -n "$file"
  echo "  OK  $file"
done

echo "[验证2/3] 流程契约验证"
rg -q "discover -> grade -> audit" "$README_FILE"
rg -q "主批改后必须做待批审计" "$README_FILE"
rg -q "pending: 0" "$WORKFLOW_FILE" "$README_FILE"
rg -q "DISCOVERED_CHAPTER_TESTS" "${SCRIPT_DIR}/grade_chapter_test.js"
rg -q "FINAL_SUMMARY" "${SCRIPT_DIR}/grade_chapter_test.js"
rg -q "FINAL_TOTALS" "${SCRIPT_DIR}/grade_chapter_test.js"
rg -q "FINAL_SCORE_TABLE" "${SCRIPT_DIR}/grade_chapter_test.js"
rg -q "FINAL_AUDIT" "${SCRIPT_DIR}/audit_pending_chapter_tests.js"
echo "  OK  工作流、README 与输出契约一致"

echo "[验证3/3] 课程配置一致性验证"
node - <<'NODE' "$SCRIPT_DIR"
const path = require("path");
const scriptDir = process.argv[2];
const helpers = require(path.join(scriptDir, "chaoxing_helpers.js"));
const { KNOWN_CHAPTER_TESTS } = require(path.join(scriptDir, "chapter_tests_config.js"));

const expectedNums = [
  "2.1", "2.2", "2.3",
  "3.1", "3.2", "3.3",
  "4.1", "4.2", "4.3",
  "5.1", "5.2", "5.3", "5.4", "5.5",
  "6.1", "6.2",
  "7.1", "7.2", "7.3", "7.4",
];

const nums = KNOWN_CHAPTER_TESTS.map((item) => item.num);
const missing = expectedNums.filter((num) => !nums.includes(num));
const duplicates = nums.filter((num, index) => nums.indexOf(num) !== index);
const invalid = KNOWN_CHAPTER_TESTS.filter((item) => !item.chapterId || !item.workLibraryId || !item.taskNum);

if (helpers.COURSE_ID !== "") throw new Error(`courseId 不一致: ${helpers.COURSE_ID}`);
if (helpers.CPI !== "") throw new Error(`cpi 不一致: ${helpers.CPI}`);
if (helpers.PRIMARY_CLASS_ID !== "") throw new Error(`primaryClassId 不一致: ${helpers.PRIMARY_CLASS_ID}`);
if (!Array.isArray(helpers.TARGET_CLASSES) || helpers.TARGET_CLASSES.length !== 3) {
  throw new Error("班级白名单数量不正确");
}
if (missing.length) throw new Error(`KNOWN_CHAPTER_TESTS 缺少章节: ${missing.join(", ")}`);
if (duplicates.length) throw new Error(`KNOWN_CHAPTER_TESTS 有重复章节: ${duplicates.join(", ")}`);
if (invalid.length) throw new Error(`KNOWN_CHAPTER_TESTS 存在缺少入口字段的章节: ${invalid.map((item) => item.num).join(", ")}`);
NODE
rg -q '' "$COURSE_CONTEXT_FILE"
rg -q '' "$COURSE_CONTEXT_FILE"
rg -q '人工智能3班' "$COURSE_CONTEXT_FILE"
rg -q '人工智能4班' "$COURSE_CONTEXT_FILE"
rg -q '人工智能6班' "$COURSE_CONTEXT_FILE"
echo "  OK  课程参数、班级白名单、20 个已验证章节入口齐备"

echo "三重验证通过"
