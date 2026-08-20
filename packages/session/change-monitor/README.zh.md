# @deepseek-ai/dsh-change-monitor

[English](README.md) | 中文

每轮文件变更监控：监听持久化会话事件流，在 `turn/start` 时对会话工作区做快照，并在 `turn/end` 结算后再次快照，把两次快照的差异生成变更集，Web 客户端以 VS Code / Cline 风格变更面板渲染。

该监控**按设计尽力而为**：快照、diff 或存储失败只记录警告，绝不影响 agent 轮次。它同样**不依赖 git**：一切从前后内容快照推导，因此可在任何工作区使用，无论是否仓库。

## 工作原理

1. `session/event` 的 `turn/start` → 监控把工作区文件元数据（相对路径、大小、mtime、SHA-256 哈希、text/binary/large 类型）记录进 before 快照。文本内容**只**在 before 快照中保留——磁盘会被轮次覆盖，只有快照能在之后提供 before 文本；保留的字节会在该轮 diff 存储后立即释放。
2. agent 正常工作；没有任何东西在轮中拦截工具或读取文件系统。
3. `turn/end` → 监控等待 `settleDelayMs`，反复扫描元数据直到其停止变化（受 `settleMaxAttempts` 限制），再快照 after（仅元数据 + 哈希，不保留内容），然后做 diff。变更文件的 after 文本在 diff 时从磁盘读取。
4. 在 git 工作区中，监控也会纳入轮中提交：它记录轮初 HEAD，在轮末与当前 HEAD 做 diff，并把已提交的路径合并进快照。轮中被修改并提交的文件报告为 modified，新增文件报告为 added，删除文件报告为 deleted；轮初已是脏文件、提交后内容未变的文件仍显示为无变更。
5. diff 基于内容而非时间戳：agent 把文件改回原始字节时报告为无变更。只有 `modified` / `added` / `deleted` 文件进入变更集；二进制文件和超过 diff 上限的文件只报告 size-only 摘要。
6. 变更集按会话以 JSONL 持久化在存储根目录下（默认 `$DSH_HOME/changes/<sessionId>.jsonl`），按 `maxHistory` 轮次裁剪，并通过 `changeMonitor` Remote 命名空间提供给浏览器。

## 远程 API

| 方法 | 请求 | 结果 |
| --- | --- | --- |
| `changeMonitor.turns` | `{ sessionId }` | 已完成的 `TurnSummary[]`，最新在前 |
| `changeMonitor.current` | `{ sessionId }` | 最新 `ChangeSetSummary` 或 `null` |
| `changeMonitor.turn` | `{ sessionId, turn }` | 该轮的 `ChangeSetSummary` 或 `null` |
| `changeMonitor.file` | `{ sessionId, turn, path }` | 该文件的完整 `FileChange`（hunks） |
| `changeMonitor.session` | `{ sessionId }` | 保留轮次上的累计 `ChangeSetSummary` 或 `null` |

所有结果都使用 `{ ok: true, value } | { ok: false, error }` 信封；失败携带 `internal` / `not-found` / `invalid-path` 错误码。文件路径是工作区相对路径，并针对路径穿越进行校验。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `exclude` / `include` | `[]` | 额外忽略模式 / 重新接纳模式（gitignore-lite 方言） |
| `maxSnapshotFileSize` | `10 MiB` | 超过该上限的文件只记录元数据 |
| `maxDiffFileSize` | `10 MiB` | 超过该上限的文件永远不会做文本 diff |
| `maxDiffCells` | `25_000_000` | LCS 预算；超过后 diff 在共享锚点行二分，未触碰的片段作为上下文保留 |
| `contextLines` | `5` | 每个变更区域周围的上下文行数 |
| `settleDelayMs` | `200` | 轮末与第一次稳定性扫描之间的等待 |
| `settleMaxAttempts` | `5` | 稳定性重扫次数上限 |
| `historyEnabled` | `true` | 持久化历史；`false` 只在内存保留最新 |
| `maxHistory` | `100` | 每个会话保留的轮次数 |
| `storeRoot` | `$DSH_HOME/changes` | 历史目录覆盖 |

## 默认忽略集

目录：`.git/`、`node_modules/`、`.venv/`、`venv/`、`__pycache__/`、`dist/`、`build/`、`lib/`、`bin/`、`.next/`、`.cache/`、`coverage/`、`.turbo/`、`.nx/`、`.idea/`、`.vscode/`、`.DS_Store/`、`out/`、`target/`、`.pytest_cache/`、`.mypy_cache/`。

文件形态：`*.pyc`、`*.pyo`、`*.log`、`*.tmp`、`*.temp`、`*.swp`、`*.swo`、`*.part`、`*.map`、`*.tsbuildinfo`、`.DS_Store`、`Thumbs.db`、`desktop.ini`。

构建产物（`lib/`、sourcemaps、tsbuildinfo）被排除，避免生成物淹没变更集；当项目把手写源码放在 `lib/` 下时，可用 `include` 模式重新接纳。

锁文件（`pnpm-lock.yaml`、`package-lock.json`、`requirements.txt`）**特意不**忽略——它们是真实的项目变更。

## 模型体验

监控不贡献提示词 section、不提供工具、不产生模型可见上下文。它只读取持久化会话日志和文件系统。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 未实现重命名检测：重命名文件报告为 `deleted` + `added`。
- 会话级累计视图只回放保留的轮次；一旦 `maxHistory` 裁剪旧轮次，合并视图从最旧的保留记录开始。
- before 快照失败的轮次（例如工作区消失）会被跳过并给出警告，而不是与空基线做 diff。
- 结算窗口是启发式的；极长运行的异步写入仍可能赶在最终快照之前。存储的 diff 始终是快照所见的真实前后比较。
