# @deepseek-ai/dsh-client-ui-voice-input

[English](README.md) | 中文

输入框工具行中的麦克风按钮（右侧座位，位于发送按钮之前）。点击后启动浏览器语音识别（Web Speech API——Edge/Chrome）；每段最终文本都会追加到草稿，与已输入内容合并。再次点击停止。不支持的浏览器不渲染任何内容。

## 工作原理

- 以 order 5 注册进 `conversation.input.right`，因此位于工具行中主发送按钮之前。
- 使用会话标准套件（`useInput` 读取实时草稿，`inputActions.setDraft` 写入）——无 Remote、无 Host 状态。
- 语言跟随界面 locale：中文用 `zh-CN`，其余用 `en-US`。
- 错误（权限被拒绝、网络失败、没有语音）通过按钮 title 和瞬态 `data-error` 状态呈现；它们绝不会阻塞输入框。

## 模型体验

不贡献提示词 section、不提供工具、不产生模型可见上下文。它只写入草稿，与用户亲自输入完全一致。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 需要支持 Web Speech API 的浏览器（Edge/Chrome）；不支持 Firefox 和 Safari。
- 识别运行在浏览器厂商的语音服务上；离线机器无法转写。
