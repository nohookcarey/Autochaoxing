#!/usr/bin/env bash
set -euo pipefail

PWCLI="${HOME}/.codex/skills/playwright/scripts/playwright_cli.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VALIDATOR_SCRIPT="${SCRIPT_DIR}/validate_deadline_update_tripwire.sh"
PWCLI_SESSION="${PWCLI_SESSION:-}"

PWCLI_CMD=("$PWCLI")
if [[ -n "$PWCLI_SESSION" ]]; then
  PWCLI_CMD+=("-s=$PWCLI_SESSION")
fi

if [[ ! -x "$PWCLI" ]]; then
  echo "未找到 Playwright CLI: $PWCLI" >&2
  exit 1
fi

case "${1:-scan}" in
  login)
    "${PWCLI_CMD[@]}" run-code --filename "${SCRIPT_DIR}/login_xuexitong.js" --json
    ;;
  scan)
    "${PWCLI_CMD[@]}" run-code --filename "${SCRIPT_DIR}/scan_deadline_targets.js" --json
    ;;
  update)
    "${PWCLI_CMD[@]}" run-code --filename "${SCRIPT_DIR}/update_assignment_deadline.js" --json
    ;;
  validate)
    "$VALIDATOR_SCRIPT"
    ;;
  *)
    echo "用法: $0 login|scan|update|validate" >&2
    exit 2
    ;;
esac
