# GLM-4.6V-Flash 图像理解 MCP + Codex Skill

基于智谱开放平台 **GLM-4.6V-Flash**（免费视觉模型，**128K 上下文**）的图像理解 MCP 服务，
一键部署到 macOS / Linux / Windows，并封装为 Codex Skill：**用户发图即自动识图，优先级高于普通对话**。

> 你只需要做一件事：**填入 ZHIPU_API_KEY**（免费申请：https://open.bigmodel.cn/usercenter/apikeys ），
> 其余全部自动化。

---

## 零、配合 DeepSeek Harness 使用（原生 MCP 接入）

DSH 原生支持 MCP（`@deepseek-ai/dsh-mcp-client`），无需 Codex，直接把本模块注册为 DSH 工具：

**在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 加入**（注意：`command` 用你的 venv python 绝对路径）：

```yaml
# GLM-4.6V 视觉理解 MCP → DSH 原生工具（mcp__glm4v__*）
- id: mcp-glm4v
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: glm4v
    transport: stdio
    command: 'C:\path\to\glm4v-vision-mcp\.venv\Scripts\python.exe'   # macOS/Linux: .venv/bin/python
    args:
      - 'C:\path\to\glm4v-vision-mcp\server\glm4v_mcp_server.py'
    toolCallTimeoutMs: 300000
    failOnStartupError: false
```

**生效步骤**：
1. 确认已安装 venv 依赖（`server/requirements.txt`）且 `server/.env` 已填 Key
2. 保存配置 → **完全退出并重启 DSH**（`dsh web` 或托盘退出）
3. 验证：DSH 会话里应出现 `mcp__glm4v__analyze_image` / `ocr_image` / `analyze_chart` 等工具
4. 发一张图或说「这张图里有什么」→ 模型自动调用识图工具

> Key 由服务器自动读取同目录 `server/.env`，DSH 配置无需硬编码密钥。
> 下面「四、MCP 接入参数」是通用配置，同样适用于 Codex / Cline / Claude Desktop 等。

---

## 一、目录结构

```
glm4v-vision-mcp/
├── server/
│   ├── glm4v_mcp_server.py      # MCP 服务器（单文件，纯 Python，跨平台）
│   ├── requirements.txt         # 依赖清单
│   └── .env.example             # 环境变量模板
├── scripts/
│   ├── register_codex.py        # 幂等注册 MCP 到 ~/.codex/config.toml
│   ├── fix_models_json.py       # 修复 Codex 隐藏 MCP 工具的 bug（issue #36382）
│   └── verify.py                # 离线冒烟测试 + 可选联网真实验证
├── skill/
│   └── glm-image-understanding/ # Codex Skill（触发规则见 SKILL.md）
│       ├── SKILL.md
│       └── agents/openai.yaml
├── install.sh                   # macOS / Linux 一键安装
├── install.ps1                  # Windows 一键安装
├── mcp-config.example.json      # MCP 接入参数（通用 JSON，供 Cline/Claude/Cherry 等）
└── README.md                    # 本文档
```

## 二、MCP 能力（工具清单）

| 工具 | 说明 |
| --- | --- |
| `analyze_image(image, prompt, ...)` | 图文问答 / 图片理解，支持 URL、data URI、裸 base64、本地路径，支持最多 8 张多图 |
| `ocr_image(image, language, ...)` | OCR 文字识别：逐行输出、保留版式、表格转 Markdown，支持区域裁剪 |
| `analyze_chart(image, chart_type, ...)` | 图表解析：识别类型/坐标轴/图例/单位，结构化提取数据，总结趋势 |
| `describe_image(image, detail, ...)` | 图片内容描述（brief / standard / detailed） |
| `check_setup(ping=true)` | 环境自检：Key / 模型 / 端点 / 依赖 / 真实联网 ping |

**图片输入四种形式**（`image` 参数）：
1. `http(s)://` 公开 URL（默认直传，也可 `GLM_DOWNLOAD_REMOTE=1` 下载为 base64）
2. `data:image/png;base64,....` data URI
3. 裸 base64（自动识别 jpeg/png/webp/gif/bmp）
4. 本地文件绝对/相对路径（≤10MB；>512KB 且装有 Pillow 时自动压缩至最长边 1280px、JPEG 85%）

其他参数：`region`（九宫格或 `"x,y,w,h"` 百分比区域裁剪）、`language`（auto/zh/en）、
`detail`（brief/standard/detailed）、`thinking`、`temperature`、`max_tokens`（≤131072）。

**模型与端点**（OpenAI 兼容接口）：

```
POST https://open.bigmodel.cn/api/paas/v4/chat/completions
Authorization: Bearer <ZHIPU_API_KEY>
model: glm-4.6v-flash   （上下文 128K tokens）
```

## 三、一键部署（只需 ZHIPU_API_KEY）

### macOS / Linux

```bash
chmod +x install.sh
./install.sh                # 按提示粘贴 ZHIPU_API_KEY
# 或：ZHIPU_API_KEY=你的Key ./install.sh
```

### Windows

```powershell
# 在 PowerShell 中（以项目目录为当前目录）
Set-ExecutionPolicy -Scope Process Bypass   # 仅本次会话放开脚本执行
.\install.ps1                               # 按提示粘贴 ZHIPU_API_KEY
# 或：$env:ZHIPU_API_KEY="你的Key"; .\install.ps1
```

脚本会自动完成：创建虚拟环境 → 安装依赖 → 写入 `server/.env` → 注册 Codex MCP →
修复 models.json（issue #36382）→ 安装 Skill → 离线冒烟测试。

### 部署后：重启生效（必须）

1. **完全退出 Codex**（菜单 Quit / 任务栏退出，不是只关窗口），重新打开；
2. 新建会话（旧会话不加载新 MCP 工具）；
3. 验证：

```
codex mcp list                     # 应看到 glm4v
# 或在 Codex 会话里说：调用 mcp__glm4v__check_setup(ping=true)
```

4. 发送一张图片或问「这张图里有什么」→ 模型会自动调用 `mcp__glm4v__analyze_image`。

## 四、MCP 接入参数

### Codex（install 脚本已自动写入 `~/.codex/config.toml`）

```toml
[mcp_servers.glm4v]
command = "/绝对路径/glm4v-vision-mcp/.venv/bin/python"   # Windows: ...\.venv\Scripts\python.exe
args = ["/绝对路径/glm4v-vision-mcp/server/glm4v_mcp_server.py"]
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 300

[mcp_servers.glm4v.env]
ZHIPU_API_KEY = "你的Key"
```

等价命令：`codex mcp add glm4v --env ZHIPU_API_KEY=你的Key -- /path/to/python /path/to/glm4v_mcp_server.py`

### 其他客户端（Cline / Claude Desktop / Cherry Studio / Cursor 等）

复制 [mcp-config.example.json](mcp-config.example.json)，把 `/ABS/PATH/...` 与
`PASTE_YOUR_ZHIPU_API_KEY_HERE` 替换后按客户端要求导入（Claude Desktop 为
`claude_desktop_config.json` 的 `mcpServers`，Cline 为 `cline_mcp_settings.json`，
Cherry Studio 直接粘贴该 JSON）：

```json
{
  "mcpServers": {
    "glm4v": {
      "command": "python3",
      "args": ["/绝对路径/glm4v-vision-mcp/server/glm4v_mcp_server.py"],
      "env": { "ZHIPU_API_KEY": "你的Key" },
      "startup_timeout_sec": 120,
      "tool_timeout_sec": 300
    }
  }
}
```

> Windows 下 `command` 用 `.venv\Scripts\python.exe` 的绝对路径；macOS/Linux 用
> `.venv/bin/python`（也可以直接用系统 `python3`，前提是已 `pip install -r server/requirements.txt`）。

## 五、Codex Skill：触发规则与优先级

Skill 已随安装脚本放入 `~/.codex/skills/glm-image-understanding/`（或项目级 `.codex/skills/`）。
Codex 的 Skill 机制：**frontmatter 的 `description` 是唯一触发开关**（元数据常驻上下文），
命中后加载正文指令。本 Skill 的触发规则（详见 `SKILL.md`）：

1. 用户消息中**直接附带图片**（粘贴 / 上传 / 截图）→ 自动触发识图；
2. 用户给出图片**路径 / URL / base64 / data URI**；
3. 用户提到 **图片/截图/OCR/文字识别/图表/柱状图/折线图/饼图/表格/二维码/票据/验证码** 等关键词；
4. 用户说「看看这张图 / 这是什么 / 帮我读一下图中文字」。

**优先级高于普通对话**的实现方式：
- description 明确指示"必须优先调用 MCP 工具，不得回答'我看不到图片'"；
- Skill 正文规定工具选择、参数规范、错误处理，模型按指令先识图再回答；
- 由于主模型通常不支持图片输入（如 deepseek-v4-flash），识图 100% 走
  `mcp__glm4v__*` 工具，天然优先于文字回复。

若你的客户端不支持 Skills，上述"触发规则"已等效写死在模型提示中——即只要 MCP 注册成功，
模型收到图片路径/URL 就会主动调 `analyze_image`。

## 六、ZHIPU_API_KEY 环境绑定方案（三选一，建议 A+B）

| 方案 | 做法 | 生效方式 |
| --- | --- | --- |
| **A. Codex 配置注入（推荐）** | install 脚本已写入 `~/.codex/config.toml` 的 `[mcp_servers.glm4v.env]` | 重启 Codex |
| **B. server/.env 兜底** | install 脚本已写入 `server/.env`（权限 600） | 服务器每次启动自动读取 |
| **C. 系统环境变量** | macOS/Linux：`~/.zshrc` 加 `export ZHIPU_API_KEY=xxx`；Windows：`setx ZHIPU_API_KEY xxx` 后重开终端 | 重开终端 / 重启 Codex |

Key 只保存在本机（config.toml / .env），不进源码、不提交仓库。修改 Key 后只需改
`server/.env` 或重跑 install 脚本，再重启 Codex。

## 七、异常报错提示（服务器内置，中英双语可读）

| 现象 | 服务器返回 | 处理 |
| --- | --- | --- |
| 未配置 Key | `未配置有效的 ZHIPU_API_KEY…` | 填 Key（见第六节） |
| 401/403 | `鉴权失败：ZHIPU_API_KEY 无效、过期或未授权` | 去 bigmodel.cn 重新生成，更新后重启 |
| 429 | `限流：免费模型有速率限制，请稍候重试` | 已自动重试 3 次（可调 GLM_RETRY_DELAY/GLM_MAX_RETRIES） |
| 400 | `拒绝请求：图片格式/大小/URL 不可访问` | 换 jpg/png/webp/gif/bmp、≤10MB、URL 需公开 |
| 404 | `API 地址或模型不存在` | 检查 GLM_API_BASE / GLM_MODEL |
| 5xx | `GLM 服务端暂时不可用` | 稍后重试 |
| 网络错误 | `网络请求失败…检查网络、代理与防火墙` | 确认能访问 open.bigmodel.cn |
| 本地文件不存在 | `本地图片不存在：<路径>` | 检查路径；或改用 URL/base64 |
| 文件过大 | `图片过大（x MB > 10MB）` | 先压缩图片 |
| 区域参数错误 | `无法识别的区域参数…` | 用九宫格名或 `"x,y,w,h"` 百分比 |
| 工具不出现（Codex 侧） | — | 见第八节故障排查 |

## 八、故障排查

- **MCP 工具不出现**：① 确认 `~/.codex/config.toml` 有 `[mcp_servers.glm4v]`；② 确认
  `fix_models_json.py` 已执行（DeepSeek 自定义模型目录会隐藏 MCP 工具，issue
  [#36382](https://github.com/openai/codex/issues/36382)）；③ **完全退出并重开 Codex**；④ `codex mcp list` 检查。
- **调用超时**：大图+思考模式较慢，已设 `tool_timeout_sec = 300`；仍超时则先压缩图片或用 `region` 裁剪。
- **免费模型不稳定**：偶发 429，服务器内置重试；仍失败稍后再试，或换付费模型 `glm-4.6v`（改 `GLM_MODEL`）。
- **相关已知 issue**：[#19425](https://github.com/openai/codex/issues/19425)、[#34018](https://github.com/openai/codex/issues/34018)（Windows 桌面端 MCP 工具暴露，彻底重启即可）。

## 九、环境变量参考

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | — | 必填。智谱 API Key（兼容 `GLM_API_KEY`） |
| `GLM_API_BASE` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | 接口地址 |
| `GLM_MODEL` | `glm-4.6v-flash` | 模型 ID |
| `GLM_TIMEOUT` | `120` | 请求超时秒数 |
| `GLM_MAX_TOKENS` | `4096` | 默认最大输出 token（上下文 128K） |
| `GLM_DOWNLOAD_REMOTE` | `0` | `1` 时远程图下载为 base64 再提交 |
| `GLM_RETRY_DELAY` / `GLM_MAX_RETRIES` | `3` / `3` | 429/5xx 重试参数 |

## 十、卸载

```bash
# 1. 删除 Codex 注册段（或手动删 config.toml 中 glm4v 段）
python scripts/register_codex.py --python x --server x --key x   # 不适用；直接手动删
# 手动：编辑 ~/.codex/config.toml 删除 [mcp_servers.glm4v] 与 [mcp_servers.glm4v.env] 段
# 2. 删除 Skill
rm -rf ~/.codex/skills/glm-image-understanding
# 3. 删除项目目录（含 .venv）
```

## 十一、验证（可选）

```bash
# 离线（无需 Key）：工具注册 + 错误分支
.venv/bin/python scripts/verify.py          # Windows: .venv\Scripts\python.exe scripts\verify.py

# 联网（需真实 Key）：URL 图片问答 + 本地图 OCR + 图表解析
ZHIPU_API_KEY=你的Key .venv/bin/python scripts/verify.py --full
```

## 十二、参考资料

- 智谱 GLM-4.6V-Flash 文档：https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash
- GLM-4.6V 文档：https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v
- OpenAI Codex Skills 文档：https://developers.openai.com/codex/skills
- Codex MCP 配置文档：https://developers.openai.com/codex/config-basic
- 参考实现：[chiyan11/glm-4.6v-flash-mcp](https://github.com/chiyan11/glm-4.6v-flash-mcp)、[LinHaiJ/configure-glm-vision](https://github.com/LinHaiJ/configure-glm-vision)
