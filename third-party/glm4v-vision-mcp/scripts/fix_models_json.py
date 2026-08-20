#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复 Codex ~/.codex/models.json 导致 MCP 工具静默消失的问题。

背景（openai/codex issue #36382）：
  DeepSeek 官方安装脚本写入的模型配置含 `"supports_search_tool": true` + `"tool_mode": null`，
  会让 Codex 把 MCP 工具注册为 Deferred 且不注入模型可见工具列表——
  表现为模型能看到 list_mcp_resources 等基础工具，但看不到/无法调用 mcp__* 工具。

修复：把这些条目的 supports_search_tool 改为 false（自动备份原文件）。

仅修改满足以下条件的模型条目，避免误伤其他配置：
  - supports_search_tool 当前为 true，且
  - (模型 id/名称含 deepseek) 或 (tool_mode 为 null)

用法：
  python fix_models_json.py [--codex-home <CODEX_HOME，默认 ~/.codex>] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def _find_codex_home() -> Path:
    import os

    env = os.getenv("CODEX_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".codex"


def _iter_entries(data):
    """models.json 可能是 {models:[...]} 或 [...]。"""
    if isinstance(data, list):
        yield from data
    elif isinstance(data, dict):
        for key in ("models", "data"):
            if isinstance(data.get(key), list):
                yield from data[key]


def patch(path: Path, dry_run: bool) -> int:
    raw = path.read_text(encoding="utf-8", errors="replace")
    data = json.loads(raw)
    changed = 0
    for entry in _iter_entries(data):
        if not isinstance(entry, dict):
            continue
        if entry.get("supports_search_tool") is not True:
            continue
        ident = " ".join(
            str(entry.get(k, "")) for k in ("id", "name", "model")
        ).lower()
        tool_mode_null = entry.get("tool_mode") is None
        if "deepseek" in ident or tool_mode_null:
            entry["supports_search_tool"] = False
            changed += 1
    if changed == 0:
        print(f"[ok] {path} 无需修复（未发现触发 issue #36382 的模型条目）")
        return 0
    if dry_run:
        print(f"[dry-run] 将修改 {changed} 个条目（supports_search_tool: true -> false）")
        return 0
    backup = path.with_name(f"models.json.bak-{int(time.time())}")
    backup.write_text(raw, encoding="utf-8")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] 已修复 {changed} 个条目：supports_search_tool: true -> false")
    print(f"     备份文件：{backup}")
    print("     现在请完全退出并重新打开 Codex（仅关闭窗口可能不生效），新建会话。")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="修复 models.json 隐藏 MCP 工具的问题")
    ap.add_argument("--codex-home", default="", help="CODEX_HOME 目录")
    ap.add_argument("--dry-run", action="store_true", help="只预览不改写")
    args = ap.parse_args()

    codex_home = Path(args.codex_home).expanduser() if args.codex_home else _find_codex_home()
    models_path = codex_home / "models.json"
    if not models_path.exists():
        print(f"[skip] 未找到 {models_path}（非 Codex 或未生成 models.json，无需修复）")
        return 0
    try:
        return patch(models_path, dry_run=args.dry_run)
    except Exception as exc:  # noqa: BLE001
        print(f"[error] 修复失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
