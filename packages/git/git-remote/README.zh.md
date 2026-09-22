# @dsh-custom/dsh-git-remote

[English](README.md) | 中文

将 `ctx.git` 能力缝以 `gitRemote` Typert Remote 命名空间暴露给 Web 客户端：每个请求携带 sessionId，服务从活跃会话解析工作区根目录，每个应答都是判别结果（`ok` 携带 JSON 投影，或 `false` 携带面板可渲染的错误，且当常驻沙箱策略拦截变更时带 `denied` 标记）。

## 工作方式

- 注册 `GitRemoteService`（一个 `TypertRemoteService`）为 `ctx.gitRemote`，wire 命名空间 `gitRemote`；浏览器半边使用的生成式挂载模块是 `./remote` 导出（`lib/typert.remote-client.js`，由 workspace tsdown 的 Typert 通道产出）。
- Remote 方法：`status`、`diff`、`log`、`branches`、`stage`、`unstage`、`commit`、`push` —— 各自接收 `{ sessionId, ... }`，解析会话的 `header.cwd`，并调用一次 `ctx.git`。
- 失败保留在结果里：`GitError` 变成 `{ ok: false, error, denied? }`；Remote 调用永不 reject。
- Web 客户端自行挂载该命名空间（`ctx.remote.$mount`），与 `ui-change-monitor` 挂载 `changeMonitor` 的方式一致。

## 配置

无。

## Model Experience

无，本包不注册任何工具、不产生模型可见上下文；只向 Web 客户端传递仓库事实。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 无 `header.cwd` 的会话（或未知 sessionId）对所有方法返回同一个 no-workspace 失败。
- 无变更事件：面板按需轮询/刷新；提交/推送通知流属于后续增强。
