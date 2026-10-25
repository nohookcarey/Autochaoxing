#!/bin/zsh
set -e
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  node scripts/start-codex-bridge.mjs
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" scripts/start-codex-bridge.mjs
else
  print '需要先安装Node.js运行环境。浏览器插件可独立使用；本机Codex连接暂未启动。'
  read -r '?按回车关闭。'
fi
