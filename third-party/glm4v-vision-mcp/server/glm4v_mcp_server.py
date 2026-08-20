#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GLM-4.6V-Flash 图像理解 MCP 服务器
====================================
基于智谱开放平台 GLM-4.6V-Flash（免费视觉模型，128K 上下文）的图像理解 MCP 服务，
适配 macOS / Linux / Windows（纯 Python 实现，stdio 传输）。

能力（MCP 工具）：
  analyze_image    图文问答 / 图片理解（支持图片 URL、data URI、裸 base64、本地路径；支持多图）
  ocr_image        OCR 文字识别（逐行输出、保留版式、可选区域裁剪）
  analyze_chart    图表解析（柱状/折线/饼图/表格等，结构化提取数据）
  describe_image   图片内容描述
  check_setup      环境自检（API Key / 模型 / 依赖 / 可选联网 ping）

环境变量：
  ZHIPU_API_KEY          智谱开放平台 API Key（必填；兼容 GLM_API_KEY）
  GLM_API_BASE           接口地址（默认 https://open.bigmodel.cn/api/paas/v4/chat/completions）
  GLM_MODEL              模型 ID（默认 glm-4.6v-flash）
  GLM_TIMEOUT            请求超时秒数（默认 120）
  GLM_MAX_TOKENS         默认最大输出 token 数（默认 4096；模型上下文 128K）
  GLM_DOWNLOAD_REMOTE    设为 1 时把 http(s) 图片下载为 base64 后再提交（默认 0：直接传 URL）
  GLM_RETRY_DELAY        429/5xx 重试等待秒数（默认 3）
  GLM_MAX_RETRIES        429/5xx 最大重试次数（默认 3）

图片输入支持：
  - http(s):// 公开 URL
  - data:image/...;base64,....  data URI
  - 裸 base64 字符串（自动识别 jpeg/png/webp/gif/bmp）
  - 本地图片文件绝对/相对路径（<=10MB；>512KB 且装有 Pillow 时自动压缩至最长边 1280px、JPEG 85%）
"""

from __future__ import annotations

import base64
import io
import json
import logging
import mimetypes
import os
import re
import sys
import time
import warnings
from pathlib import Path
from typing import Any, Optional

import httpx
from dotenv import load_dotenv

# 静音第三方库的 INFO 日志与 pydantic_settings 告警，避免污染 Codex 的 stderr
logging.getLogger("mcp").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
warnings.filterwarnings("ignore", category=Warning, module="pydantic_settings")

_PROJECT_ROOT = Path(__file__).resolve().parent
# 优先加载服务器同目录的 .env（一键安装脚本写入），再兼容从任意 cwd 启动；
# GLM_NO_DOTENV=1 时跳过 .env 加载（供 verify.py 隔离测试缺失-Key 分支）
if os.getenv("GLM_NO_DOTENV", "") != "1":
    load_dotenv(_PROJECT_ROOT / ".env")
    load_dotenv()

DEFAULT_API_BASE = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
DEFAULT_MODEL = "glm-4.6v-flash"
DEFAULT_TIMEOUT = 120.0
DEFAULT_MAX_TOKENS = 4096
DEFAULT_RETRY_DELAY = 3.0
DEFAULT_MAX_RETRIES = 3

CONTEXT_WINDOW = 131072  # 128K tokens
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10MB（智谱限制）
COMPRESS_THRESHOLD = 512 * 1024  # >512KB 自动压缩
COMPRESS_MAX_EDGE = 1280
COMPRESS_QUALITY = 85

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}

try:  # Pillow 为可选依赖：用于大图压缩与区域裁剪
    from PIL import Image as _PILImage
    _HAS_PIL = True
except Exception:  # pragma: no cover
    _PILImage = None
    _HAS_PIL = False

from mcp.server.fastmcp import FastMCP

mcp = FastMCP(
    "glm-4-6v-flash",
    instructions=(
        "GLM-4.6V-Flash 图像理解服务器：通过智谱开放平台调用免费视觉模型，"
        "提供图片理解（analyze_image）、OCR（ocr_image）、图表解析（analyze_chart）、"
        "图片描述（describe_image）与环境自检（check_setup）。"
        "图片输入支持 http(s) URL、data URI、裸 base64 与本地文件路径。"
        "详细说明见资源 glm4v://help。"
    ),
)


# ---------------------------------------------------------------------------
# 配置读取
# ---------------------------------------------------------------------------


class Glm4vError(RuntimeError):
    """带用户可读中文提示的业务异常。"""


def _env_str(name: str, default: str) -> str:
    return os.getenv(name, default).strip() or default


def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, default)))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, default)))
    except (TypeError, ValueError):
        return default


def _api_key() -> str:
    key = os.getenv("ZHIPU_API_KEY") or os.getenv("GLM_API_KEY") or ""
    key = key.strip()
    if not key or key == "REPLACE_WITH_YOUR_REAL_KEY":
        raise Glm4vError(
            "未配置有效的 ZHIPU_API_KEY。请设置环境变量 ZHIPU_API_KEY，"
            "获取地址：https://open.bigmodel.cn/usercenter/apikeys 。"
            "（macOS/Linux 可用 export ZHIPU_API_KEY=xxx；Windows 可用 $env:ZHIPU_API_KEY=xxx；"
            "或运行 install.sh / install.ps1 一键配置。）"
        )
    return key


def _api_base() -> str:
    return _env_str("GLM_API_BASE", DEFAULT_API_BASE)


def _model() -> str:
    return _env_str("GLM_MODEL", DEFAULT_MODEL)


def _download_remote() -> bool:
    return _env_str("GLM_DOWNLOAD_REMOTE", "0").lower() in ("1", "true", "yes", "on")


def _mask_key(key: str) -> str:
    if len(key) <= 8:
        return key[:2] + "****"
    return key[:4] + "****" + key[-4:]


# ---------------------------------------------------------------------------
# 图片归一化：URL / data URI / 裸 base64 / 本地路径 -> API media block
# ---------------------------------------------------------------------------

_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=\r\n\s]+$")

_MAGIC_MIME: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"BM", "image/bmp"),
    (b"RIFF", "image/webp"),  # 再校验 WEBP
]


def _detect_mime(data: bytes) -> str:
    for magic, mime in _MAGIC_MIME:
        if data.startswith(magic):
            if mime == "image/webp" and b"WEBP" not in data[:16]:
                continue
            return mime
    return "image/png"


def _data_uri(data: bytes, mime: Optional[str] = None) -> str:
    mime = mime or _detect_mime(data)
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _looks_like_bare_base64(s: str) -> bool:
    if len(s) < 64 or _BASE64_RE.match(s) is None:
        return False
    cleaned = re.sub(r"\s+", "", s)
    return len(cleaned) % 4 == 0


def _fetch_remote(url: str) -> bytes:
    try:
        timeout = httpx.Timeout(_env_float("GLM_TIMEOUT", DEFAULT_TIMEOUT), connect=15.0)
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url, headers={"User-Agent": "glm4v-mcp/1.0"})
            resp.raise_for_status()
            return resp.content
    except httpx.HTTPStatusError as exc:
        raise Glm4vError(
            f"下载图片失败（HTTP {exc.response.status_code}）：{url}。"
            "请确认该 URL 可公开访问且不需要登录/防盗链。"
        ) from exc
    except httpx.RequestError as exc:
        raise Glm4vError(f"下载图片失败（网络错误）：{url}。原因：{exc}") from exc


def _compress_if_needed(data: bytes, mime: str) -> bytes:
    if len(data) <= COMPRESS_THRESHOLD or not _HAS_PIL:
        return data
    try:
        img = _PILImage.open(io.BytesIO(data))
        img = img.convert("RGB")
        if max(img.size) > COMPRESS_MAX_EDGE:
            img.thumbnail((COMPRESS_MAX_EDGE, COMPRESS_MAX_EDGE))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=COMPRESS_QUALITY, optimize=True)
        return buf.getvalue()
    except Exception:
        return data  # 压缩失败则原样提交


def _load_image_bytes(image: str) -> tuple[bytes, str]:
    """把单张图片输入解析为 (字节, mime)。"""
    image = image.strip()
    if not image:
        raise Glm4vError("图片参数为空。请提供图片 URL、data URI、base64 或本地文件路径。")

    # 1) http(s) URL
    if image.startswith("http://") or image.startswith("https://"):
        data = _fetch_remote(image)
        return _compress_if_needed(data, _detect_mime(data)), _detect_mime(data)

    # 2) data URI
    if image.startswith("data:"):
        try:
            header, _, b64 = image.partition(",")
            if ";" not in header or "base64" not in header:
                raise ValueError("非 base64 data URI")
            mime = header[5:].split(";")[0] or "image/png"
            data = base64.b64decode(b64, validate=False)
        except Exception as exc:
            raise Glm4vError(
                "data URI 解析失败：请使用形如 "
                "data:image/png;base64,<内容> 的格式。"
            ) from exc
        return _compress_if_needed(data, mime), mime

    # 3) 裸 base64
    if _looks_like_bare_base64(image):
        try:
            data = base64.b64decode(re.sub(r"\s+", "", image), validate=True)
        except Exception as exc:
            raise Glm4vError("base64 解码失败：内容可能被截断或混入非法字符。") from exc
        mime = _detect_mime(data)
        if data[:4] == b"RIFF" and b"WEBP" not in data[:16]:
            mime = "image/webp" if b"WEBP" in data[:64] else "image/png"
        return _compress_if_needed(data, mime), mime

    # 4) 本地文件路径
    path = Path(image).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    if not path.exists():
        raise Glm4vError(
            f"本地图片不存在：{path}。请检查路径是否正确；"
            "也支持 http(s) URL、data URI 或 base64 输入。"
        )
    if path.is_dir():
        raise Glm4vError(f"给定的是一个目录而非图片文件：{path}")
    if path.suffix.lower() not in ALLOWED_EXT:
        raise Glm4vError(
            f"不支持的图片格式：{path.suffix or '(无扩展名)'}。"
            f"支持 {sorted(ALLOWED_EXT)}；图片大小需 <=10MB。"
        )
    data = path.read_bytes()
    if len(data) > MAX_IMAGE_BYTES:
        raise Glm4vError(
            f"图片过大（{len(data) / 1024 / 1024:.1f}MB > 10MB）：{path}。"
            "请先压缩图片（如把最长边缩到 2048px 内）再重试。"
        )
    mime = mimetypes.guess_type(str(path))[0] or _detect_mime(data)
    return _compress_if_needed(data, mime), mime


def _media_block(image: str, *, region: str = "full", force_download: bool = False) -> dict[str, Any]:
    """单张图片 -> API content block。region != full 时先本地裁剪再提交。"""
    need_crop = region and region.strip().lower() != "full"
    if force_download and (image.startswith("http://") or image.startswith("https://")):
        data, mime = _load_image_bytes(image)
        url = _data_uri(data, mime)
        if need_crop:
            url = _crop_data_uri(url, region)
    elif need_crop:
        # 裁剪需要像素级访问，统一走字节加载
        data, mime = _load_image_bytes(image)
        url = _crop_data_uri(_data_uri(data, mime), region)
    elif image.startswith("http://") or image.startswith("https://"):
        url = image if not _download_remote() else _load_and_uri(image)
    else:
        data, mime = _load_image_bytes(image)
        url = _data_uri(data, mime)
    return {"type": "image_url", "image_url": {"url": url}}


def _load_and_uri(image: str) -> str:
    data, mime = _load_image_bytes(image)
    return _data_uri(data, mime)


_REGION_NAMES = {
    "top-left": (0, 0, 1 / 3, 1 / 3), "top": (1 / 3, 0, 2 / 3, 1 / 3),
    "top-right": (2 / 3, 0, 1, 1 / 3), "left": (0, 1 / 3, 1 / 3, 2 / 3),
    "center": (1 / 3, 1 / 3, 2 / 3, 2 / 3), "right": (2 / 3, 1 / 3, 1, 2 / 3),
    "bottom-left": (0, 2 / 3, 1 / 3, 1), "bottom": (1 / 3, 2 / 3, 2 / 3, 1),
    "bottom-right": (2 / 3, 2 / 3, 1, 1),
}


def _crop_data_uri(data_uri: str, region: str) -> str:
    if not _HAS_PIL:
        raise Glm4vError(
            "区域裁剪需要 Pillow。请运行安装脚本或执行 "
            "pip install pillow 后重启 MCP 服务器。"
        )
    try:
        header, _, b64 = data_uri.partition(",")
        mime = header[5:].split(";")[0] or "image/png"
        img = _PILImage.open(io.BytesIO(base64.b64decode(b64)))
        w, h = img.size
        key = region.strip().lower()
        if key in _REGION_NAMES:
            x0, y0, x1, y1 = _REGION_NAMES[key]
        else:
            m = re.match(r"^\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*$", region)
            if not m:
                raise Glm4vError(
                    f"无法识别的区域参数：{region!r}。"
                    "支持九宫格名（top-left/top/top-right/left/center/right/"
                    "bottom-left/bottom/bottom-right）或矩形坐标 x,y,w,h（百分比，如 10,10,50,50）。"
                )
            x, y, w_pct, h_pct = (float(v) for v in m.groups())
            x0, y0, x1, y1 = x / 100, y / 100, (x + w_pct) / 100, (y + h_pct) / 100
        box = (
            max(0, int(x0 * w)), max(0, int(y0 * h)),
            min(w, int(x1 * w)), min(h, int(y1 * h)),
        )
        if box[2] - box[0] <= 0 or box[3] - box[1] <= 0:
            raise Glm4vError("裁剪区域为空，请检查 region 参数。")
        cropped = img.crop(box).convert("RGB")
        buf = io.BytesIO()
        cropped.save(buf, format="JPEG", quality=95)
        return _data_uri(buf.getvalue(), "image/jpeg")
    except Glm4vError:
        raise
    except Exception as exc:
        raise Glm4vError(f"图片裁剪失败：{exc}") from exc


def _build_media(image: str, *, region: str = "full") -> list[dict[str, Any]]:
    """支持单图或 JSON 数组多图，返回 API content block 列表。"""
    image = image.strip()
    if image.startswith("["):
        try:
            items = json.loads(image)
        except json.JSONDecodeError as exc:
            raise Glm4vError(
                "多图参数解析失败：应为 JSON 字符串数组，例如 "
                '["https://a.com/1.png", "/path/to/2.jpg"]。'
            ) from exc
        if not isinstance(items, list) or not items:
            raise Glm4vError("多图参数为空数组。")
        if len(items) > 8:
            raise Glm4vError("一次最多提交 8 张图片。")
        return [_media_block(str(it), region=region) for it in items]
    return [_media_block(image, region=region)]


# ---------------------------------------------------------------------------
# GLM API 调用
# ---------------------------------------------------------------------------


def _thinking_block(enabled: bool) -> dict[str, str]:
    return {"type": "enabled" if enabled else "disabled"}


def _extract_answer(data: dict[str, Any]) -> str:
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise Glm4vError(f"GLM API 返回结构异常：{json.dumps(data, ensure_ascii=False)[:500]}") from exc

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(item))
        joined = "\n".join(p for p in parts if p.strip())
        if joined.strip():
            return joined.strip()

    reasoning = message.get("reasoning_content")
    if isinstance(reasoning, str) and reasoning.strip():
        return f"[深度思考]\n{reasoning.strip()}"
    return "（模型未返回有效内容，请重试或调整参数。）"


def _friendly_http_error(status: int, body: str, *, retried: bool) -> str:
    snippet = body[:800].strip()
    if status in (401, 403):
        return (
            f"GLM API 鉴权失败（HTTP {status}）：ZHIPU_API_KEY 无效、过期或未授权。"
            "请到 https://open.bigmodel.cn/usercenter/apikeys 重新生成并完整复制 Key，"
            "更新后重启 Codex。详情：" + snippet
        )
    if status == 429:
        extra = "（自动重试后仍被限流）" if retried else ""
        return (
            f"GLM API 限流（HTTP 429）{extra}：免费模型有速率限制。"
            "请稍等片刻后重试，或调大 GLM_RETRY_DELAY / GLM_MAX_RETRIES。详情：" + snippet
        )
    if status == 400:
        return (
            "GLM API 拒绝请求（HTTP 400）：通常是图片格式/大小/URL 不可访问导致。"
            "请确认图片为 jpg/jpeg/png/webp/gif/bmp 且 <=10MB；URL 需可公开访问、无防盗链。"
            "详情：" + snippet
        )
    if status == 404:
        return (
            f"GLM API 地址或模型不存在（HTTP 404）：请检查 GLM_API_BASE 与 GLM_MODEL "
            f"（当前 {_model()}）。详情：" + snippet
        )
    if status >= 500:
        return f"GLM 服务端暂时不可用（HTTP {status}），请稍后重试。详情：" + snippet
    return f"GLM API 请求失败（HTTP {status}）：" + snippet


def _chat(
    media: list[dict[str, Any]],
    *,
    prompt: str,
    temperature: float,
    max_tokens: int,
    thinking: bool = False,
) -> str:
    if not 0.0 <= temperature <= 2.0:
        raise Glm4vError("temperature 必须在 0~2 之间。")
    if not 1 <= max_tokens <= CONTEXT_WINDOW:
        raise Glm4vError(f"max_tokens 必须在 1~{CONTEXT_WINDOW} 之间。")

    payload: dict[str, Any] = {
        "model": _model(),
        "messages": [{"role": "user", "content": [*media, {"type": "text", "text": prompt}]}],
        "thinking": _thinking_block(thinking),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }
    endpoint = _api_base()
    timeout = httpx.Timeout(_env_float("GLM_TIMEOUT", DEFAULT_TIMEOUT), connect=15.0)
    max_retries = _env_int("GLM_MAX_RETRIES", DEFAULT_MAX_RETRIES)
    retry_delay = _env_float("GLM_RETRY_DELAY", DEFAULT_RETRY_DELAY)

    last_err: Optional[str] = None
    for attempt in range(1, max_retries + 2):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(endpoint, json=payload, headers=headers)
                if resp.status_code in (429, 500, 502, 503, 504) and attempt <= max_retries:
                    time.sleep(retry_delay * attempt)
                    continue
                resp.raise_for_status()
                return _extract_answer(resp.json())
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            body = exc.response.text
            retried = status in (429, 500, 502, 503, 504)
            raise Glm4vError(_friendly_http_error(status, body, retried=retried)) from exc
        except httpx.RequestError as exc:
            last_err = f"网络请求失败：{exc}。请检查网络连接、代理与防火墙（服务器需能访问 open.bigmodel.cn）。"
            if attempt <= max_retries:
                time.sleep(retry_delay * attempt)
                continue
            raise Glm4vError(last_err) from exc
    raise Glm4vError(last_err or "GLM API 请求失败：超出最大重试次数。")


# ---------------------------------------------------------------------------
# 提示词模板
# ---------------------------------------------------------------------------


def _language_hint(language: str) -> str:
    lang = (language or "auto").strip().lower()
    if lang == "zh":
        return "请使用中文回答。"
    if lang == "en":
        return "Please answer in English."
    return "请使用与图中文字一致的语言回答（默认中文）。"


def _detail_hint(detail: str) -> str:
    d = (detail or "standard").strip().lower()
    if d == "brief":
        return "请简明扼要地概括核心内容（3~5 句话以内）。"
    if d == "detailed":
        return "请非常详尽地描述：包括前景/背景、空间布局、颜色、文字、对象关系与隐含信息。"
    return "请按中等详细程度描述：主体对象、关键细节、图中文字与整体语义。"


def _ocr_prompt(language: str, preserve_layout: bool) -> str:
    layout = (
        "按视觉顺序逐行输出，保留段落、换行与大致版式；表格内容用 Markdown 表格呈现。"
        if preserve_layout
        else "按自上而下的阅读顺序输出文本即可。"
    )
    return (
        "请对这张图片执行 OCR 文字识别。要求：\n"
        "1. 完整提取图中所有可见文字（含标题、正文、表格、按钮、水印，手写体尽力而为）；\n"
        f"2. {layout}\n"
        "3. 只输出识别到的文字本身，不要添加解释、评论，不要编造图片中不存在的文字；\n"
        f"4. 语言要求：{_language_hint(language)}"
    )


def _chart_prompt(chart_type: str, extract_data: bool) -> str:
    ctype = (chart_type or "auto").strip().lower()
    type_hint = (
        ""
        if ctype == "auto"
        else f"\n用户/调用方标注的图表类型为「{ctype}」，请按此类型重点解析。"
    )
    data_req = (
        "尽可能精确地提取关键数据点与数值（坐标值、占比、极值、关键标签），"
        "用 Markdown 表格结构化输出；"
        if extract_data
        else "概述主要数据特征即可，不必逐点罗列数值；"
    )
    return (
        "请解析这张图表。步骤：\n"
        "1. 识别图表类型（柱状图/折线图/饼图/面积图/散点图/雷达图/表格/流程图/其他）与标题；\n"
        "2. 说明坐标轴、图例、单位、数据系列等关键信息；\n"
        f"3. {data_req}\n"
        "4. 总结主要趋势、异常点与结论；\n"
        "5. 只依据图中可见信息作答，不确定的数值请明确标注「推测/看不清」。"
        f"{type_hint}"
    )


def _describe_prompt(detail: str, language: str) -> str:
    return f"请描述这张图片。\n{_detail_hint(detail)}\n{_language_hint(language)}"


# ---------------------------------------------------------------------------
# MCP 工具
# ---------------------------------------------------------------------------


@mcp.tool()
def analyze_image(
    image: str,
    prompt: str = "请详细描述这张图片的内容。",
    detail: str = "standard",
    language: str = "auto",
    region: str = "full",
    thinking: bool = False,
    temperature: float = 0.7,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """图文问答 / 图片理解：对图片提出任意问题或指令，返回模型回答（128K 上下文）。

    Args:
        image: 图片输入。支持 http(s) URL、data URI（data:image/png;base64,...）、
            裸 base64、本地文件路径；也支持 JSON 字符串数组传多张图（最多 8 张）。
        prompt: 对图片的问题或指令（图文问答的核心参数）。
        detail: 描述详细程度，brief / standard / detailed。
        language: 回答语言，auto / zh / en。
        region: 只看局部区域：九宫格名（top-left、center、bottom-right 等）或
            矩形坐标 "x,y,w,h"（百分比）。默认 full 整图。
        thinking: 是否开启深度思考模式。
        temperature: 采样温度（0~2），越低越稳定。
        max_tokens: 最大输出 token 数（<=131072）。
    """
    media = _build_media(image, region=region)
    full_prompt = f"{prompt}\n\n{_detail_hint(detail)}\n{_language_hint(language)}"
    return _chat(media, prompt=full_prompt, temperature=temperature, max_tokens=max_tokens, thinking=thinking)


@mcp.tool()
def ocr_image(
    image: str,
    language: str = "auto",
    preserve_layout: bool = True,
    region: str = "full",
    temperature: float = 0.1,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """OCR 文字识别：完整提取图片中的文字，保留版式；支持裁剪局部区域识别。

    Args:
        image: 图片输入（URL / data URI / base64 / 本地路径，或 JSON 数组多图）。
        language: 输出语言偏好，auto / zh / en。
        preserve_layout: 是否保留段落、换行与版式（表格转 Markdown）。
        region: 只看局部区域：九宫格名或矩形坐标 "x,y,w,h"（百分比），默认 full。
        temperature: 采样温度（OCR 建议保持较低值）。
        max_tokens: 最大输出 token 数。
    """
    media = _build_media(image, region=region)
    return _chat(
        media,
        prompt=_ocr_prompt(language, preserve_layout),
        temperature=temperature,
        max_tokens=max_tokens,
    )


@mcp.tool()
def analyze_chart(
    image: str,
    chart_type: str = "auto",
    extract_data: bool = True,
    region: str = "full",
    temperature: float = 0.2,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """图表解析：识别图表类型、坐标轴/图例/单位，结构化提取数据并总结趋势。

    Args:
        image: 图表图片输入（URL / data URI / base64 / 本地路径，或 JSON 数组多图）。
        chart_type: 已知图表类型（柱状图/折线图/饼图/表格等），auto 表示自动识别。
        extract_data: 是否逐点提取数值并输出 Markdown 表格。
        region: 只看局部区域（九宫格名或矩形坐标），默认 full。
        temperature: 采样温度。
        max_tokens: 最大输出 token 数。
    """
    media = _build_media(image, region=region)
    return _chat(
        media,
        prompt=_chart_prompt(chart_type, extract_data),
        temperature=temperature,
        max_tokens=max_tokens,
    )


@mcp.tool()
def describe_image(
    image: str,
    detail: str = "standard",
    language: str = "auto",
    temperature: float = 0.7,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """图片内容描述：生成自然语言的图片说明（适合做 alt 文本、摘要、配图说明）。

    Args:
        image: 图片输入（URL / data URI / base64 / 本地路径）。
        detail: brief / standard / detailed。
        language: auto / zh / en。
        temperature: 采样温度。
        max_tokens: 最大输出 token 数。
    """
    media = _build_media(image)
    return _chat(
        media,
        prompt=_describe_prompt(detail, language),
        temperature=temperature,
        max_tokens=max_tokens,
    )


@mcp.tool()
def check_setup(ping: bool = False) -> str:
    """环境自检：检查 ZHIPU_API_KEY 是否配置、模型/端点/依赖版本；ping=True 时做一次真实联网调用。

    Args:
        ping: 是否执行一次真实的 GLM API 最小调用（需要 Key 有效且网络可达）。
    """
    key = os.getenv("ZHIPU_API_KEY") or os.getenv("GLM_API_KEY") or ""
    lines = [
        "=== GLM-4.6V-Flash MCP 环境自检 ===",
        f"Python 版本      : {sys.version.split()[0]}",
        f"模型 ID          : {_model()}",
        f"API 端点         : {_api_base()}",
        f"上下文窗口       : {CONTEXT_WINDOW} tokens（128K）",
        f"默认 max_tokens  : {_env_int('GLM_MAX_TOKENS', DEFAULT_MAX_TOKENS)}",
        f"ZHIPU_API_KEY    : {'已配置 (' + _mask_key(key.strip()) + ')' if key.strip() and key.strip() != 'REPLACE_WITH_YOUR_REAL_KEY' else '未配置'}",
        f"Pillow(压缩/裁剪): {'可用' if _HAS_PIL else '不可用（pip install pillow 后重启生效）'}",
    ]
    if not key.strip() or key.strip() == "REPLACE_WITH_YOUR_REAL_KEY":
        lines.append(
            "提示：请先设置 ZHIPU_API_KEY（https://open.bigmodel.cn/usercenter/apikeys），"
            "再运行 install.sh / install.ps1 或手动配置后重启 Codex。"
        )
    if ping:
        if not key.strip() or key.strip() == "REPLACE_WITH_YOUR_REAL_KEY":
            lines.append("ping 已跳过：未配置 API Key。")
        else:
            try:
                tiny = _data_uri(
                    base64.b64decode(
                        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                    ),
                    "image/png",
                )
                answer = _chat(
                    [{"type": "image_url", "image_url": {"url": tiny}}],
                    prompt="只回复 OK 两个字母。",
                    temperature=0.0,
                    max_tokens=16,
                )
                lines.append(f"ping 结果        : 成功（模型回复：{answer[:40]}）")
            except Glm4vError as exc:
                lines.append(f"ping 结果        : 失败 - {exc}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# MCP 资源
# ---------------------------------------------------------------------------

_HELP_TEXT = """GLM-4.6V-Flash 图像理解 MCP 使用说明
============================================
服务器名称: glm-4-6v-flash （Codex 中工具名为 mcp__glm4v__*）

【工具】
  analyze_image(image, prompt, ...)   图文问答：对图片提出任意问题
  ocr_image(image, ...)               OCR：提取图中文字（保留版式）
  analyze_chart(image, ...)           图表解析：类型/坐标轴/数据/趋势
  describe_image(image, ...)          生成图片描述
  check_setup(ping=False)             环境自检（可联网 ping）

【图片输入】四种形式任选其一：
  1. http(s) URL    如 https://example.com/a.png（需可公开访问）
  2. data URI       如 data:image/png;base64,<内容>
  3. 裸 base64      自动识别 jpeg/png/webp/gif/bmp
  4. 本地路径       绝对或相对路径（<=10MB，>512KB 自动压缩）

【常用参数】
  region    只看局部：top-left/center/bottom-right 等九宫格，或 "x,y,w,h"（百分比）
  language  auto/zh/en；detail  brief/standard/detailed
  thinking  是否开启深度思考（默认关）

【常见错误】
  401/403  → ZHIPU_API_KEY 无效，去 https://open.bigmodel.cn/usercenter/apikeys 重新生成
  429      → 免费模型限流，稍后重试（服务器已自动重试）
  400      → 图片格式/大小/URL 不可访问，检查 jpg/png/webp/gif/bmp、<=10MB
  网络错误  → 检查能否访问 open.bigmodel.cn（代理/防火墙）
"""


@mcp.resource(
    "glm4v://help",
    title="GLM-4.6V-Flash 图像理解使用说明",
    description="读取本 MCP 服务器的工具清单、图片输入格式、参数与常见错误处理。",
)
def help_resource() -> str:
    return _HELP_TEXT


def main() -> None:
    try:
        mcp.run()
    except BaseException:
        # Parent Ctrl+C and stdio teardown raise KeyboardInterrupt /
        # CancelledError / WouldBlock / BrokenPipeError while the Node.js host
        # shuts down. These are expected for a stdio child; never spam stderr.
        pass


if __name__ == "__main__":
    main()
