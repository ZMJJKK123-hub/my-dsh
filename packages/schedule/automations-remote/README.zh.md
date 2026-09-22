# @dsh-custom/dsh-automations-remote

[English](README.md) | 中文

将 `ctx.automations` 能力缝以 `automationsRemote` Typert Remote 命名空间暴露给 Web 客户端：`list`、`create`、`update`（含启停开关）、`remove`、`runNow`。定时任务是机器级的，请求不携带 sessionId；每个应答都是判别结果——Remote 调用永不 reject。

## 工作方式

- 注册 `AutomationsRemoteService`（一个 `TypertRemoteService`）为 `ctx.automationsRemote`，wire 命名空间 `automationsRemote`；浏览器半边的生成式挂载模块是 `./remote` 导出。
- 每个方法包装一次 `ctx.automations` 调用；wire 视图是本包自己的契约（可变数组、缺省省略的可选字段）。
- Web 客户端自行挂载该命名空间（`ctx.remote.$mount`），与 `ui-change-monitor` 挂载 `changeMonitor` 的方式一致。

## 配置

无。

## Model Experience

无，本包不注册任何工具、不产生模型可见上下文；只向 Web 客户端传递定时任务表。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- `runNow` 的失败随结果返回（例如裸组合下的未装配执行器错误）；面板渲染该信息。
- 无逐任务变更事件：面板在挂载、操作后和刷新按钮时刷新。
