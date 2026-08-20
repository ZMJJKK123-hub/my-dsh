#!/usr/bin/env bash
# =============================================================================
# GLM-4.6V-Flash 图像理解 MCP —— macOS / Linux 一键安装脚本
#
# 用法：
#   ./install.sh                          # 交互输入 ZHIPU_API_KEY
#   ZHIPU_API_KEY=xxx ./install.sh        # 从环境变量读取 Key
#   ./install.sh xxx                      # 直接传 Key 作为第一个参数
#
# 功能：
#   1. 创建 Python 虚拟环境并安装依赖（mcp / httpx / python-dotenv / Pillow）
#   2. 写入 server/.env（ZHIPU_API_KEY，权限 600）
#   3. 把 MCP 服务器注册进 Codex 配置 ~/.codex/config.toml（幂等）
#   4. 修复 Codex models.json 隐藏 MCP 工具的 bug（issue #36382，DeepSeek 模型）
#   5. 安装 Codex Skill（glm-image-understanding，自动触发识图）
#   6. 运行离线冒烟测试
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

VENV="$PROJECT_DIR/.venv"
SERVER="$PROJECT_DIR/server/glm4v_mcp_server.py"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"

info() { printf '\033[1;34m[info]\033[0m  %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m    %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m  %s\n' "$*"; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }

# ---------------------------------------------------------------- 1. python
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  err "未找到 $PYTHON。请先安装 Python 3.10+：https://www.python.org/downloads/ 或 brew install python@3.12"
  exit 1
fi
if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  PY_VER="$("$PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo '?')"
  err "Python 版本过低：$PY_VER（需要 3.10+）。macOS 建议：brew install python@3.12；Debian/Ubuntu：apt install python3.12"
  exit 1
fi
info "使用 Python: $PYTHON"

# ---------------------------------------------------------------- 2. venv + 依赖
if [ ! -x "$VENV/bin/python" ]; then
  info "创建虚拟环境: $VENV"
  "$PYTHON" -m venv "$VENV"
fi
VENV_PY="$VENV/bin/python"
"$VENV_PY" -m pip install --upgrade pip -q
info "安装依赖（mcp / httpx / python-dotenv / Pillow）..."
"$VENV_PY" -m pip install -q -r "$PROJECT_DIR/server/requirements.txt"
ok "依赖安装完成"

# ---------------------------------------------------------------- 3. ZHIPU_API_KEY
KEY="${ZHIPU_API_KEY:-}"
if [ -n "${1:-}" ]; then KEY="$1"; fi
if [ -z "$KEY" ] && [ -f "$PROJECT_DIR/server/.env" ]; then
  KEY="$(grep -E '^ZHIPU_API_KEY=' "$PROJECT_DIR/server/.env" | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
if [ -z "$KEY" ]; then
  printf '请输入 ZHIPU_API_KEY（获取：https://open.bigmodel.cn/usercenter/apikeys ）: '
  read -r -s KEY
  printf '\n'
fi
KEY="$(printf '%s' "$KEY" | xargs)"
if [ -z "$KEY" ]; then
  warn "未输入 Key，将写入占位符 REPLACE_WITH_YOUR_REAL_KEY，稍后需手动替换"
  KEY="REPLACE_WITH_YOUR_REAL_KEY"
fi
printf 'ZHIPU_API_KEY=%s\n' "$KEY" > "$PROJECT_DIR/server/.env"
chmod 600 "$PROJECT_DIR/server/.env" 2>/dev/null || true
ok "已写入 $PROJECT_DIR/server/.env"

# ---------------------------------------------------------------- 4. 注册 Codex MCP
info "注册 MCP 到 Codex 配置: $CODEX_HOME_DIR/config.toml"
"$VENV_PY" "$PROJECT_DIR/scripts/register_codex.py" \
  --python "$VENV_PY" \
  --server "$SERVER" \
  --key "$KEY" \
  --codex-home "$CODEX_HOME_DIR"
ok "Codex MCP 注册完成（服务器名: glm4v）"

# ---------------------------------------------------------------- 5. 修复 models.json
info "检查 Codex models.json（DeepSeek 自定义模型会隐藏 MCP 工具，issue #36382）..."
"$VENV_PY" "$PROJECT_DIR/scripts/fix_models_json.py" --codex-home "$CODEX_HOME_DIR" || warn "models.json 修复跳过（可稍后手动运行 scripts/fix_models_json.py）"

# ---------------------------------------------------------------- 6. 安装 Codex Skill
if [ -d "$PROJECT_DIR/skill/glm-image-understanding" ]; then
  SKILL_DEST="$CODEX_HOME_DIR/skills/glm-image-understanding"
  mkdir -p "$SKILL_DEST"
  cp -R "$PROJECT_DIR/skill/glm-image-understanding/." "$SKILL_DEST/"
  ok "已安装 Codex Skill: $SKILL_DEST"
fi

# ---------------------------------------------------------------- 7. 冒烟测试
info "运行离线冒烟测试..."
"$VENV_PY" "$PROJECT_DIR/scripts/verify.py"

cat <<'EOF'

==================================================
✅ 安装完成！接下来只需 2 步：
==================================================
1. 完全退出 Codex（不是只关窗口），重新打开；
2. 新建会话，发送一张图片或问"这张图里有什么"。

可选验证：
  codex mcp list                  # 应看到 glm4v
  在 Codex 中让模型调用 mcp__glm4v__check_setup(ping=true)

联网真实验证（可选）：
  ZHIPU_API_KEY=<你的Key> "$VENV_PY" scripts/verify.py --full

常用文件：
  server/.env                  # 可随时修改 Key
  ~/.codex/config.toml         # MCP 注册信息（glm4v 段）
  ~/.codex/skills/glm-image-understanding/   # Skill
==================================================
EOF
