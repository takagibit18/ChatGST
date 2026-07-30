#!/bin/bash
# Verify that the runtime Python exactly matches the interpreter used to build
# the Nuitka extensions. A patch-version mismatch can crash with SIGSEGV.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_FILE="$HERE/PYTHON_RUNTIME.txt"
PYTHON_BIN="${1:-${PYTHON_BIN:-$HERE/.venv/bin/python}}"

[ -f "$RUNTIME_FILE" ] || {
  echo "ERROR: 缺少 $RUNTIME_FILE，无法确认加密包所需 Python 版本。" >&2
  exit 2
}
[ -x "$PYTHON_BIN" ] || {
  echo "ERROR: Python 不存在或不可执行: $PYTHON_BIN" >&2
  exit 2
}

expected_version="$(sed -n 's/^PYTHON_VERSION=//p' "$RUNTIME_FILE")"
expected_soabi="$(sed -n 's/^PYTHON_SOABI=//p' "$RUNTIME_FILE")"
actual_version="$($PYTHON_BIN -c 'import platform; print(platform.python_version())')"
actual_soabi="$($PYTHON_BIN -c 'import sysconfig; print(sysconfig.get_config_var("SOABI") or "")')"

if [ "$actual_version" != "$expected_version" ] || [ "$actual_soabi" != "$expected_soabi" ]; then
  cat >&2 <<EOF
=======================================================================
ERROR: Python 运行时与加密包构建环境不一致，拒绝启动。

  加密包要求: Python $expected_version | SOABI=$expected_soabi
  当前运行时: Python $actual_version | SOABI=$actual_soabi
  Python 路径: $PYTHON_BIN

Nuitka .so 和加密 KELE wheel 对 Python 补丁版本敏感。
不一致可能直接触发 SIGSEGV（退出码 139），不能只确认“都是 3.13”。
请安装完全一致的 Python，或使用服务器实际 Python 重新编译部署包。
=======================================================================
EOF
  exit 42
fi

echo ">>> Python 运行时校验通过: $actual_version | SOABI=$actual_soabi"
