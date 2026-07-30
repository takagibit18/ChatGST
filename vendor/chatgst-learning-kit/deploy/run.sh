#!/bin/bash
# run.sh —— 前台启动服务(调试用;生产用 systemd,见 gov-policy.service)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$HERE/.venv"
[ -x "$VENV/bin/python" ] || { echo "ERROR: 未安装,请先 ./deploy/install.sh" >&2; exit 1; }
"$HERE/deploy/check_python.sh" "$VENV/bin/python"

export PORT="${PORT:-8000}"
export ENV_PATH="${ENV_PATH:-$HERE/.env}"
export FRONTEND_DIR="${FRONTEND_DIR:-$HERE/frontend}"
[ -f "$ENV_PATH" ] || echo ">>> 警告: 未找到 $ENV_PATH,LLM 功能不可用(结构化模式仍可用)"

echo ">>> 启动:127.0.0.1:$PORT (请用 Nginx 反代 + HTTPS 对外)"
exec "$VENV/bin/python" "$HERE/backend/server.py"
