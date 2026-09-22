# @dsh-custom/dsh-git-local

[English](README.md) | 中文

`ctx.git` 能力缝的本地 Service Provider：通过 `ctx.subprocess` 以 argv 直传方式（绝不经过 shell）运行只读 git 命令（根目录/状态/diff/历史/分支），并由 `ctx.sandbox` 按 `ctx.sandboxPolicy` 解析的常驻策略进行约束。

## 工作方式

- 将 `LocalGitService` 注册为 `ctx.git`（每个 context 仅一个实现）。
- 每条命令都以显式 argv 经 subprocess 缝执行，参数无需 shell 引号转义。
- 沙箱约束：取常驻策略的模式，以本次调用的仓库作为可写根。`confine: false`、未挂载沙箱或常驻模式为完全访问时，直接不约束执行。
- 每次运行都设置 `GIT_OPTIONAL_LOCKS=0`，读命令不取机会性索引锁，可在只读约束下正常完成。
- 输出使用 NUL/US/RS 分隔的机器格式（`--porcelain=v1 -z`、自定义 `--format` 分隔符），由 `src/parse.ts` 中的纯函数解析。

## 配置

- `gitBinary`（默认 `git`）：git 可执行文件，绝对路径或 PATH 名。
- `timeoutMs`（默认 `30000`）：单命令超时。
- `maxDiffBytes`（默认 `262144`）：`diff` 补丁文本的默认字节上限。
- `maxLogCount`（默认 `100`）：单次 `log` 返回提交数的上限。
- `maxOutputBytes`（默认 `65536`）：非 diff 命令的单流收集上限。
- `graceMs`（默认 `2500`）：subprocess 终止流程的宽限期。
- `confine`（默认 `true`）：是否按常驻沙箱策略约束命令。

## Model Experience

无，本包不注册任何工具；模型可见性通过调用 `ctx.git` 的 `@dsh-custom/dsh-tool-git` 产生。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 未诞生分支的 `log` 返回空列表；无效 revision 仍以 `GitError` 拒绝。
- `diff` 超出字节上限时保留输出尾部并标记 `truncated`；丢失的头部无法经本缝找回。
