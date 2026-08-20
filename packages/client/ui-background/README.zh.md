# @deepseek-ai/dsh-client-ui-background

[English](README.md) | 中文

自定义聊天背景：在 **设置 → 通用 → 背景图片** 上传照片，它会成为主区域背景。侧边栏保留自己的填充；图片保存在本地（压缩为 localStorage 中的 JPEG data URL），刷新后仍然保留。

## 工作原理

1. 插件注册一行 `settings.general.item`（位于外观之后），包含上传按钮、预览和移除按钮。
2. 选择图片后会将其缩小（长边上限 1920px），并通过 canvas 编码为 JPEG。
3. data URL 持久化在 `localStorage`（`dsh.background.image`）中，并应用到 document body：`data-dsh-bg` 加上 `--dsh-bg-url` 自定义属性。
4. 注入的全局样式会在设置 `data-dsh-bg` 时，把页面级表面（使用 `--dsw-alias-bg-base` 的区域：框架、聊天区、详情面板）变为透明，让背景图片透出。消息气泡、输入框和侧边栏使用自己的 token，保持不透明。

## 模型体验

不贡献提示词 section、不提供工具、不产生模型可见上下文；插件只作用于浏览器。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 背景只作用于主区域；侧边栏和详情栏按设计保留自己的填充。
- 图片以 JPEG 存储（照片效果最佳）；不保留 PNG 透明通道。
- 存储的图片位于浏览器 localStorage 中——清除站点数据会移除背景。
