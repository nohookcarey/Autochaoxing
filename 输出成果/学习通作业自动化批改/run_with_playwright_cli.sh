#!/usr/bin/env bash
set -euo pipefail

PWCLI="${HOME}/.codex/skills/playwright/scripts/playwright_cli.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR_SCRIPT="${SCRIPT_DIR}/validate_reuse_tripwire.sh"
PWCLI_SESSION="${PWCLI_SESSION:-}"

PWCLI_CMD=("$PWCLI")
if [[ -n "$PWCLI_SESSION" ]]; then
  PWCLI_CMD+=("-s=$PWCLI_SESSION")
fi

export ACTION_TIMEOUT="${ACTION_TIMEOUT:-15000}"
export NAVIGATION_TIMEOUT="${NAVIGATION_TIMEOUT:-45000}"
export TASK_FUSE_TIMEOUT="${TASK_FUSE_TIMEOUT:-120000}"
export RETRY_TIMES="${RETRY_TIMES:-2}"

if [[ ! -x "$PWCLI" ]]; then
  echo "未找到 Playwright CLI: $PWCLI" >&2
  exit 1
fi

case "${1:-scan}" in
  login)
    "${PWCLI_CMD[@]}" run-code --filename "${SCRIPT_DIR}/login_xuexitong.js" --json
    ;;
  scan)
    "${PWCLI_CMD[@]}" run-code --filename "${SCRIPT_DIR}/scan_assignment_pending.js" --json
    ;;
  collect)
    "${PWCLI_CMD[@]}" run-code --filename "${SCRIPT_DIR}/collect_assignment_review_basis.js" --json
    ;;
  grade)
    "${PWCLI_CMD[@]}" run-code --filename "${SCRIPT_DIR}/batch_grade_assignment.js" --json
    ;;
  validate)
    "$VALIDATOR_SCRIPT"
    ;;
  *)
    echo "用法: $0 login|scan|collect|grade|validate" >&2
    exit 2
    ;;
esac
