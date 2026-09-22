# @dsh-custom/dsh-automations

[English](README.md) | 中文

机器级 cron 定时任务：Harness home 下的持久化任务表、带 misfire 宽限与重叠保护的到期轮询调度器，以及每次运行按 webhook 方式创建的一个 agent 会话。任务跨重启存活；每次触发创建以任务标题命名的新工作区会话并提交其 prompt。

## 工作方式

- `ctx.automations` 提供 `list` / `create` / `update` / `remove` / `runNow`；`create` 校验五字段 cron 表达式（`src/cron.ts` 中的纯 Vixie 语义解析器，本地时间）并计算首次运行时间。
- 调度器每 `tickMs` 轮询：到期且启用的记录先推进 `nextRunAt`（运行中崩溃绝不会重触发同一分钟），再触发一次；in-flight 集合防止慢运行在下一轮堆积；超过 `misfireGraceMs` 的过期运行按"错过"跳过而非补发。
- 任务表经 `dsh-atomic-write` 原子持久化于 `<storeRoot>/tasks.json`；运行结果（`ok`/`error` + 信息）落回记录。
- 包默认导出为 `RunnerAutomationService`，其 `execute` 按 webhook 配方执行：解析预设（权限默认 `workspace-write`，agent 预设取注册表默认）、创建工作区、创建以任务命名的 agent 会话、提交 prompt，接纳失败时回滚挂接。基础 `AutomationService`（具名导出）保留未装配执行器供测试使用。

## 配置

- `storeRoot`（默认 `~/.dsh/automations`）：任务表目录。
- `tickMs`（默认 `30000`）：调度轮询间隔。
- `misfireGraceMs`（默认 `600000`）：超过此时长的过期运行按错过跳过。

## Model Experience

无，本包不注册任何工具；每次触发的自动化成为普通会话，模型经正常会话流程看到其 prompt。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 仅五个数字字段：无月/日名称、无 `@` 简写、无按用户的 CRON_TZ——宿主本地时间即计划时间。
- 分钟级分辨率；一轮内每个到期记录至多触发一次，错过的分钟跳过不补。
- 运行器在 prompt 被接纳后把所有权交给会话生命周期；它不追踪回合完成（运行结果记录的是接纳，不是模型的回答）。
