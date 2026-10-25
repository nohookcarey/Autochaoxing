#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ACTION="${1:-dry-run}"

cd "$SCRIPT_DIR"

case "$ACTION" in
  validate)
    npm run check
    ;;
  dry-run)
    npm run check
    npm run dry-run -- --input "${2:-./data/chapters.example.json}"
    ;;
  start)
    npm run check
    npm run start -- --input "${2:-./data/chapters.json}"
    ;;
  *)
    echo "用法: $0 {validate|dry-run|start} [input.json]" >&2
    exit 1
    ;;
esac
