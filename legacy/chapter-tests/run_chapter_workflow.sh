#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-discover}"

cd "$SCRIPT_DIR"

case "$ACTION" in
  validate)
    ./validate_reuse_tripwire.sh
    ;;
  discover)
    node discover_all_chapter_tests.js
    ;;
  grade)
    node grade_chapter_test.js
    ;;
  audit)
    node audit_pending_chapter_tests.js
    ;;
  all)
    ./validate_reuse_tripwire.sh
    node grade_chapter_test.js
    node audit_pending_chapter_tests.js
    ;;
  *)
    echo "用法: $0 {validate|discover|grade|audit|all}" >&2
    exit 1
    ;;
esac
