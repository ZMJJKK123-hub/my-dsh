# @dsh-custom/dsh-tool-browser

[English](README.md) | 中文

后台浏览器自动化工具：在无头 Microsoft Edge 中打开网页并通过 CDP 控制，让 agent 可以运行“截图→分析→操作”循环，不会抢占用户前台。

## 工作原理

- `browser_open(url, headless?)` 启动无头 Edge（使用临时 profile）并打开网址。
- `browser_screenshot(output_path?)` 截取当前页面为 PNG（页面内容，不是桌面）。
- `browser_eval(expression)` 在页面中执行 JavaScript，用于点击、输入、读取状态或跳转。
- `browser_close()` 关闭浏览器并删除临时 profile。
- 每个 agent 会话维护一个浏览器，会话销毁时自动关闭。

## 配置

无。

## 模型体验

这些工具不贡献提示词 section，除工具结果外不产生模型可见上下文。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 需要 Windows 上安装 Microsoft Edge。
- 默认使用无头模式，因此浏览器不会出现在用户屏幕上。
- 实现基于 Node 内置 WebSocket 的 Chrome DevTools Protocol，刻意保持轻量（不依赖 Playwright/Puppeteer）。
