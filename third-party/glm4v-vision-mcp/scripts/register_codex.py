#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 GLM-4.6V-Flash MCP 服务器注册进 Codex 配置（~/.codex/config.toml）。

特性：
  - 幂等：重复执行不会产生重复配置块
  - 安全：只增改本工具管理的标记块，保留 config.toml 其余内容
  - 采纳：若用户已手写过 [mcp_servers.glm4v] 段，会被本工具接管并更新

用法：
  python register_codex.py \
      --python <venv-python绝对路径> \
      --server <glm4v_mcp_server.py绝对路径> \
      --key <ZHIPU_API_KEY> \
      [--codex-home <CODEX_HOME，默认 ~/.codex>] \
      [--server-name glm4v]

环境变量 ZHIPU_API_KEY 存在且未传 --key 时自动使用。
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

MARK_START = "# >>> glm4v-vision-mcp (managed by install script) >>>"
MARK_END = "# <<< glm4v-vision-mcp <<<"

# 捕获任意 [mcp_servers.glm4v] 段（含其后跟随的 [mcp_servers.glm4v.env] 子段），
# 用于“采纳”用户手写配置，避免 TOML 重复键。
_SECTION_RE = re.compile(
    r"^\[mcp_servers\.glm4v\]\s*$.*?(?=^\[|\Z)",
    re.MULTILINE | re.DOTALL,
)


def _find_codex_home() -> Path:
    env = os.getenv("CODEX_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".codex"


def _toml_literal(value: str) -> str:
    """TOML 字面量字符串：优先单引号；含单引号时退回双引号并转义。"""
    if "'" not in value:
        return f"'{value}'"
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_block(python_path: str, server_path: str, key: str) -> str:
    return "\n".join(
        [
            MARK_START,
            "[mcp_servers.glm4v]",
            f"command = {_toml_literal(python_path)}",
            f"args = [{_toml_literal(server_path)}]",
            "enabled = true",
            "startup_timeout_sec = 120",
            "tool_timeout_sec = 300",
            "",
            "[mcp_servers.glm4v.env]",
            f"ZHIPU_API_KEY = {_toml_literal(key)}",
            "# 说明：ZHIPU_API_KEY 已写入 Codex 配置（仅本机可见）。",
            "# 也可改用系统环境变量：macOS/Linux 在 ~/.zshrc 或 ~/.bashrc 加",
            "#   export ZHIPU_API_KEY=xxx",
            "# Windows 在 PowerShell 执行：setx ZHIPU_API_KEY xxx （需重开终端）",
            MARK_END,
            "",
        ]
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="注册 GLM-4.6V MCP 到 Codex 配置")
    ap.add_argument("--python", required=True, help="运行 MCP 服务器的 python 绝对路径（venv）")
    ap.add_argument("--server", required=True, help="glm4v_mcp_server.py 绝对路径")
    ap.add_argument("--key", default="", help="ZHIPU_API_KEY（缺省时读环境变量）")
    ap.add_argument("--codex-home", default="", help="CODEX_HOME 目录")
    args = ap.parse_args()

    codex_home = Path(args.codex_home).expanduser() if args.codex_home else _find_codex_home()
    config_path = codex_home / "config.toml"

    key = (args.key or os.getenv("ZHIPU_API_KEY") or "").strip()
    if not key:
        print("[warn] 未提供 ZHIPU_API_KEY，将写入占位符 REPLACE_WITH_YOUR_REAL_KEY，"
              "请稍后自行替换（获取：https://open.bigmodel.cn/usercenter/apikeys）")
        key = "REPLACE_WITH_YOUR_REAL_KEY"

    python_path = str(Path(args.python).resolve())
    server_path = str(Path(args.server).resolve())
    block = build_block(python_path, server_path, key)

    text = ""
    if config_path.exists():
        text = config_path.read_text(encoding="utf-8", errors="replace")
        had_managed = MARK_START in text
        text = _SECTION_RE.sub("", text)  # 采纳/清理旧段（含用户手写段）
        if had_managed:
            # 清理旧标记块（_SECTION_RE 已覆盖，此处仅为标记残留兜底）
            pattern = re.compile(re.escape(MARK_START) + r".*?" + re.escape(MARK_END), re.DOTALL)
            text = pattern.sub("", text)
    else:
        codex_home.mkdir(parents=True, exist_ok=True)

    text = text.rstrip() + "\n\n" + block
    config_path.write_text(text, encoding="utf-8")

    print(f"[ok] 已写入 {config_path}")
    print(f"     MCP 服务器名 : glm4v")
    print(f"     command      : {python_path}")
    print(f"     args         : {server_path}")
    print(f"     ZHIPU_API_KEY: {key[:4]}****{key[-4:] if len(key) > 8 else ''}")
    print("重启 Codex（完全退出后重新打开）并新建会话后，可用工具：")
    print("     mcp__glm4v__analyze_image / ocr_image / analyze_chart / describe_image / check_setup")
    return 0


if __name__ == "__main__":
    sys.exit(main())
