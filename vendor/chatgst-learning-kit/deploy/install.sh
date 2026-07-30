#!/bin/bash
# =============================================================================
# install.sh —— 在【服务器】上安装(建 venv + 装加密 kele wheel + 依赖)
#
# 前置:服务器 Python 必须与包内 PYTHON_RUNTIME.txt 完全一致,并且能联网。
# 用法(在解包后的部署目录里执行):
#   ./deploy/install.sh  # 直接使用默认配置运行
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"      # 部署根(deploy 的上级)

# 【修改点 1】: 指定与 PYTHON_RUNTIME.txt 完全一致的 Python 绝对路径
PY="${PY:-/usr/local/python3.13/bin/python3.13}"
VENV="$HERE/.venv"

# 【修改点 2】: 默认使用清华镜像源，防止下载超时
export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"

command -v "$PY" >/dev/null || { echo "ERROR: 找不到 $PY" >&2; exit 1; }

echo ">>> 安装前强制校验 Python 精确版本（补丁版本和 SOABI）"
"$HERE/deploy/check_python.sh" "$PY"

echo ">>> 建虚拟环境: $VENV"
"$PY" -m venv "$VENV"
"$HERE/deploy/check_python.sh" "$VENV/bin/python"
"$VENV/bin/pip" install -q --upgrade pip

WHL="$(find "$HERE/wheels" -name 'kele-*.whl' | head -1)"
[ -f "$WHL" ] || { echo "ERROR: wheels/ 下找不到 kele wheel" >&2; exit 1; }

echo ">>> 安装加密 kele wheel + 依赖 (使用镜像源: $PIP_INDEX_URL)"
"$VENV/bin/pip" install -i "$PIP_INDEX_URL" "$WHL"

echo ">>> 自检: import kele + zhengwu_policy(.so)"
"$VENV/bin/python" -c "
import sys; sys.path.insert(0, '$HERE/backend')
import kele, zhengwu_policy
print('  kele', kele.__version__, '| zhengwu loader:', type(zhengwu_policy.__loader__).__name__)
"
echo ">>> 安装完成。下一步: cp .env.sample .env 并填好凭证, 再 ./deploy/run.sh"
