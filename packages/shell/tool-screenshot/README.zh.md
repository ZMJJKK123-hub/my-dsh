# @dsh-custom/dsh-tool-screenshot

[English](README.md) | 中文

面向模型的截屏工具：把当前屏幕保存为 PNG 并返回文件路径，让 agent 能通过外部视觉 MCP 工具（例如 `mcp__glm4v__analyze_image`）识别自己的截图。

## 工作原理

- 在 `ctx.tools` 上注册 `screenshot` 工具。
- 执行走 `ctx.shell`，因此与 `tool-pwsh` 一样受相同沙箱策略约束。
- Windows 使用 PowerShell `CopyFromScreen`；macOS 使用 `screencapture`；Linux 使用 ImageMagick `import`。
- 结果是 `{ path, bytes }`；path 是 MCP 视觉工具可读取的本地绝对路径。

## 配置

无。

## 模型体验

不贡献提示词 section，除工具结果外不产生模型可见上下文。该工具只写入一个 PNG 文件并返回其路径。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- Linux 需要 ImageMagick（`import`）；尚未实现 `gnome-screenshot` 回退。
- Windows 和 macOS 支持区域截图；Linux 使用 ImageMagick 裁剪。
- Windows 默认截取虚拟屏幕（所有显示器）。
