# @dsh-custom/dsh-tool-git

[English](README.md) | 中文

`ctx.git` 能力缝之上的模型工具：`git_status`、`git_diff`、`git_log`、`git_branch_list`、`git_stage`、`git_unstage`、`git_commit`、`git_push`。工具自身不做任何执行——从会话工作区（或显式 `workdir` 参数）解析工作目录，调用能力缝并渲染其类型化结果。

## 工作方式

- 在 `ctx.tools` 上注册四个只读工具；schema 自动进入提示词组装。
- 工作目录按调用解析：绝对 `workdir` 参数优先；相对路径相对会话工作区解析；缺省时即会话工作区。
- `git_diff` 以 `diff` 围栏块渲染补丁并受工具级字节上限约束；`git_log` 受工具级条数上限约束；执行与沙箱约束全部交给能力缝。
- 不在任何仓库中的目录会让调用以能力缝的 `not a git repository` 错误失败。

## 配置

- `maxDiffBytes`（默认 `131072`）：单次 `git_diff` 补丁上限。
- `maxLogCount`（默认 `30`）：单次 `git_log` 返回条数上限。

## Model Experience

### 工具 schema

#### 模型看到什么

八个工具 schema（`git_status`、`git_diff`、`git_log`、`git_branch_list`、`git_stage`、`git_unstage`、`git_commit`、`git_push`）随本 bundle 行进入所有挂载它的 profile 的工具目录；参数形状见生成的[工具目录](../../../docs/tool-catalog.zh.md)。

#### Token effect

条件性：只要该行启用，八个 schema 即存在。

#### KV Cache effect

Append-only：schema 每次提示词组装一次，仅在本行配置或工具面变化时改变。

## Known Limitations and Deferred Work

- 变更工具（`git_stage`、`git_unstage`、`git_commit`、`git_push`）在只读权限预设下如实拒绝；工具内不做升级——请切换预设。
- 无分支切换工具；`git_branch_list` 仅覆盖本地分支。
- `git_commit` 要求模型自己撰写提交信息；宿主侧的 AI 信息生成属于 UI 面板，不属于工具。
