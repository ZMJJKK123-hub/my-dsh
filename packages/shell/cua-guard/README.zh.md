# @dsh-custom/dsh-cua-guard

[English](README.md) | 中文

CUA 确认门与能力预检：每会话首次 Computer-Use 工具调用（截屏或输入模拟）经审批缝询问用户；决定在会话生命周期内缓存。能力预检在首次询问前验证平台截屏命令可用，绝不在 CUA 无法工作的主机上打扰用户。

## 工作方式

- 拦截五个 CUA 工具（`screenshot`、`mouse_click`、`mouse_trajectory`、`mouse_scroll`、`keyboard_input`）的 `tools/pre-execute`。
- **能力预检**：首次询问前通过 shell 缝运行一行平台探测（Windows 用 PowerShell Forms、macOS 用 `which screencapture`、Linux 用 `which import`）。探测失败直接拒绝并给出清晰理由。
- **审批门**：每会话首次 CUA 调用经 `ctx.approval.request` 询问（在回合内，与 bash 升级同路径）。`allowed-once` 缓存授权；其他结果缓存拒绝，拒绝后本会话所有 CUA 调用均被拒绝。
- 缓存在 `session/disposed` 时丢弃。

## 配置

- `enabled`（默认 `true`）：设为 false 所有 CUA 调用直接通过。
- `reaskMs`（默认 `0`）：超过此毫秒数重新询问；0 表示每会话只问一次。

## Model Experience

拒绝理由作为工具错误输出呈现，教模型为什么 CUA 不可用而不泄露内部状态。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 审批是会话级的而非逐调用的：批准截屏同时也批准了本会话的鼠标和键盘。
- 可视化悬浮窗（实时屏幕视图 + 打断）与 Windows Edge 登录态导入是此缝上的后续增强。
