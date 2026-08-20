---
name: glm-image-understanding
description: >
  图像理解 / 识图（基于智谱 GLM-4.6V-Flash 免费视觉模型，128K 上下文，通过 MCP 服务器
  glm4v 提供）。当用户发送、粘贴、引用或提到任何图片（含截图、照片、扫描件、二维码、票据、
  验证码、含文字图片），或要求 OCR 识别文字、解析图表（柱状图/折线图/饼图/表格）、描述图片
  内容、做图文问答、识别图中物体/文字/数据/表情包时，必须优先使用本 Skill 并通过 MCP 工具
  （mcp__glm4v__analyze_image / ocr_image / analyze_chart / describe_image）完成识图，
  优先级高于普通对话回复：不要回答"我看不到图片"或拒绝看图。本机主模型通常不支持图片输入，
  识图一律走 MCP 工具。
metadata:
  short-description: GLM-4.6V-Flash 图像理解 / OCR / 图表解析（自动触发）
---

# 图像理解（GLM-4.6V-Flash）

本 Skill 把图片交给免费的 GLM-4.6V-Flash 视觉模型（128K 上下文）理解，并如实转述结果。

## 触发规则（优先级高于普通对话）

满足以下任一条件即触发，且必须先完成识图再回答其他内容：

1. 用户消息中直接附带图片（粘贴 / 上传的图片、截图）；
2. 用户给出图片路径、图片 URL、base64 或 data URI；
3. 用户提到图片 / 图像 / 照片 / 截图 / OCR / 文字识别 / 图表 / 柱状图 / 折线图 / 饼图 /
   表格 / 二维码 / 票据 / 验证码 / 表情包 等并要求解读；
4. 用户说"看看这张图 / 这是什么 / 帮我读一下图中文字 / 图里有什么"等。

## 工具选择

| 用户意图 | 调用工具 |
| --- | --- |
| 具体问题 / 内容理解 / 图文问答 | `mcp__glm4v__analyze_image(image, prompt)` |
| 提取文字 / OCR | `mcp__glm4v__ocr_image(image, language)` |
| 图表 / 数据图解析 | `mcp__glm4v__analyze_chart(image, chart_type, extract_data)` |
| 图片描述 / alt 文本 | `mcp__glm4v__describe_image(image, detail)` |
| 排查 Key / 模型 / 连通问题 | `mcp__glm4v__check_setup(ping=true)` |

## 图片传参规范

- 用户已附带图片时，优先把图片文件绝对路径传给 `image`；无路径时用 URL；
- 支持多图对比：`image` 传 JSON 字符串数组，如 `["/path/1.png","https://x.com/2.jpg"]`（最多 8 张）；
- 大图 / 细节图建议配合 `region` 参数分区域识别：
  九宫格名（`top-left`、`center`、`bottom-right` 等）或矩形坐标 `"x,y,w,h"`（百分比）。

## 错误处理（如实反馈，不吞错误）

- 工具返回 401/403 → 提示用户 `ZHIPU_API_KEY` 无效：去 https://open.bigmodel.cn/usercenter/apikeys
  重新生成，然后重跑 install.sh / install.ps1 或改 `server/.env`，重启 Codex；
- 429 → 免费模型限流，服务器已自动重试，仍失败则请用户稍候再试；
- 400 → 图片格式 / 大小 / URL 不可访问，建议换一种输入方式（本地路径 ⇄ URL ⇄ base64）；
- 工具不存在（`mcp__glm4v__*` 未列出）→ 按顺序排查：
  1. `~/.codex/config.toml` 是否有 `[mcp_servers.glm4v]` 段（重跑 install 脚本）；
  2. 是否已修复 models.json（DeepSeek 模型需 `supports_search_tool: false`，issue #36382）；
  3. 是否完全退出并重新打开 Codex（仅关窗口不生效）；
  4. `codex mcp list` 查看服务器状态。

## 注意事项

- 只转述 GLM-4.6V-Flash 返回的内容，不要编造图中细节；
- OCR / 图表结果保留 Markdown 表格格式；
- 若用户只是正常文字对话、与图片无关，则本 Skill 不触发，正常回答即可。
