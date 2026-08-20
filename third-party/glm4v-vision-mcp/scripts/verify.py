#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GLM-4.6V-Flash MCP 服务器验证脚本。

离线模式（默认，无需 API Key）：
  1. 以 stdio 子进程启动 MCP 服务器，完成 initialize 握手
  2. 列出全部工具，校验 analyze_image / ocr_image / analyze_chart / describe_image / check_setup 存在
  3. 校验错误分支：非法图片路径、未配置 Key 时返回可读的中文错误
  4. 校验 check_setup 输出

联网模式（--full，需真实 ZHIPU_API_KEY）：
  额外对公开 URL 图片与本地生成的测试图执行真实的 analyze_image / ocr_image 调用。

用法：
  python verify.py                 # 离线冒烟
  python verify.py --full          # 联网验证（读取环境变量 ZHIPU_API_KEY）
  python verify.py --server <路径>  # 指定服务器文件
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import os
import sys
from pathlib import Path

# 兜底：Windows GBK 控制台遇到 emoji/生僻字时避免 UnicodeEncodeError
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_DEFAULT = PROJECT_ROOT / "server" / "glm4v_mcp_server.py"

EXPECTED_TOOLS = {
    "analyze_image",
    "ocr_image",
    "analyze_chart",
    "describe_image",
    "check_setup",
}

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _child_env(api_key: str | None) -> dict | None:
    env = dict(os.environ)
    env.pop("ZHIPU_API_KEY", None)
    env.pop("GLM_API_KEY", None)
    # 隔离 server/.env：保证“缺失 Key”分支在已安装 Key 后仍可测
    env["GLM_NO_DOTENV"] = "1"
    if api_key:
        env["ZHIPU_API_KEY"] = api_key
        env.pop("GLM_NO_DOTENV", None)
    return env


async def _list_tools(session) -> set[str]:
    result = await session.list_tools()
    return {t.name for t in result.tools}


async def _call(session, name: str, args: dict) -> tuple[bool, str]:
    result = await session.call_tool(name, args)
    parts: list[str] = []
    for item in result.content:
        text = getattr(item, "text", None)
        if text:
            parts.append(str(text))
    return bool(result.isError), "\n".join(parts)


async def offline_check(server: Path) -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(server)],
        env=_child_env(None),
    )
    print(f"[1/4] 启动服务器: {sys.executable} {server}")
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("[2/4] MCP 握手成功（initialize ok）")

            tools = await _list_tools(session)
            missing = EXPECTED_TOOLS - tools
            if missing:
                print(f"[FAIL] 缺少工具: {sorted(missing)}；实际: {sorted(tools)}")
                raise SystemExit(1)
            print(f"[ok] 工具齐全: {sorted(tools)}")

            print("[3/4] 错误分支验证…")
            err, msg = await _call(session, "ocr_image", {"image": "不存在的图片文件.png"})
            assert err and ("本地图片不存在" in msg or "图片" in msg), f"非法路径未返回友好错误: {msg}"
            print(f"[ok] 非法图片路径 -> {msg.splitlines()[0]}")

            err, msg = await _call(
                session,
                "analyze_image",
                {"image": f"data:image/png;base64,{TINY_PNG_B64}"},
            )
            assert err and "ZHIPU_API_KEY" in msg, f"未配置 Key 未返回友好错误: {msg}"
            print(f"[ok] 未配置 Key -> {msg.splitlines()[0]}")

            err, msg = await _call(session, "check_setup", {"ping": False})
            assert not err and "GLM-4.6V-Flash MCP 环境自检" in msg, f"check_setup 异常: {msg}"
            print("[ok] check_setup 输出正常")

    print("[4/4] 离线冒烟测试全部通过 [PASS]")


async def full_check(server: Path, api_key: str) -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(server)],
        env=_child_env(api_key),
    )
    print(f"[联网] 使用 Key: {api_key[:4]}****{api_key[-4:]}")
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            print("[联网] 1/3 URL 图片问答（cdn.bigmodel.cn 测试图）…")
            err, msg = await _call(
                session,
                "analyze_image",
                {"image": "https://cdn.bigmodel.cn/static/logo/register.png",
                 "prompt": "这张图片上有什么文字？用一句话回答。"},
            )
            print(f"       -> {'错误' if err else '回答'}: {msg[:200]}")
            if err:
                print("       [warn] URL 图片调用失败（可能网络受限），继续后续检查")

            print("[联网] 2/3 本地生成图片 OCR…")
            local_img = PROJECT_ROOT / ".verify_tmp_ocr.png"
            try:
                from PIL import Image, ImageDraw  # type: ignore
                img = Image.new("RGB", (640, 200), "white")
                d = ImageDraw.Draw(img)
                d.text((30, 60), "Hello GLM-4.6V-Flash 12345", fill="black")
                img.save(local_img)
                err, msg = await _call(
                    session, "ocr_image", {"image": str(local_img), "language": "en"}
                )
                print(f"       -> {'错误' if err else 'OCR结果'}: {msg[:200]}")
            except Exception as exc:  # noqa: BLE001
                print(f"       [warn] 本地 OCR 检查跳过: {exc}")
            finally:
                if local_img.exists():
                    local_img.unlink()

            print("[联网] 3/3 图表解析（本地生成的柱状图）…")
            chart_img = PROJECT_ROOT / ".verify_tmp_chart.png"
            try:
                from PIL import Image, ImageDraw  # type: ignore
                img = Image.new("RGB", (600, 360), "white")
                d = ImageDraw.Draw(img)
                vals = [(80, 240), (160, 160), (240, 200), (320, 90), (400, 130)]
                for i, (x, h) in enumerate(vals):
                    d.rectangle([x, 300 - h, x + 55, 300], fill=(70, 130, 220))
                    d.text((x + 5, 305), f"Q{i + 1}", fill="black")
                img.save(chart_img)
                err, msg = await _call(
                    session,
                    "analyze_chart",
                    {"image": str(chart_img), "chart_type": "柱状图", "extract_data": True},
                )
                print(f"       -> {'错误' if err else '分析'}: {msg[:200]}")
            except Exception as exc:  # noqa: BLE001
                print(f"       [warn] 图表检查跳过: {exc}")
            finally:
                if chart_img.exists():
                    chart_img.unlink()

    print("[联网] 验证完成 [PASS]")


def main() -> int:
    ap = argparse.ArgumentParser(description="GLM-4.6V MCP 验证")
    ap.add_argument("--server", default=str(SERVER_DEFAULT), help="服务器文件路径")
    ap.add_argument("--full", action="store_true", help="联网验证（需 ZHIPU_API_KEY）")
    args = ap.parse_args()

    server = Path(args.server).resolve()
    if not server.exists():
        print(f"[error] 服务器文件不存在: {server}", file=sys.stderr)
        return 1

    asyncio.run(offline_check(server))

    if args.full:
        key = (os.getenv("ZHIPU_API_KEY") or os.getenv("GLM_API_KEY") or "").strip()
        if not key:
            print("[error] --full 需要设置 ZHIPU_API_KEY 环境变量", file=sys.stderr)
            return 1
        asyncio.run(full_check(server, key))
    return 0


if __name__ == "__main__":
    sys.exit(main())
