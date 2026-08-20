# @deepseek-ai/dsh-client-ui-change-monitor

[English](README.md) | 中文

每轮变更监控的浏览器端：每当一个已完成的 agent 轮次修改了文件，结束的助手消息下方会出现一行“N 个文件被修改”；展开后显示 VS Code / Cline 风格的文件列表，点击文件会打开内联红绿 diff（删除用错误色、新增用成功色、未变化的上下文用中性色）。较长的未变化连续片段折叠为“N 行已跳过”标记，每个变更周围保留五行上下文。每一轮的条目把该轮与上一轮结束状态比较——即 agent 在这一轮中实际改了什么。

## 工作原理

- 插件自行挂载 `changeMonitor` Remote 命名空间（`ctx.remote.$mount`）；api-remotes 的固定选择不包含它。
- turn-tail 条目为每个已完成的轮次认领 `conversation.chat.turnTail` 链，从 Host 加载该轮的变更集，并在**该轮没有文件变更时不渲染任何内容**——会话不会出现 agent 未挣得的条目。
- 所有数据都经每个会话一个的 `ChangeMonitorController` 流动，带小型缓存；一次短时有界轮询等待 Host 完成最新轮次的结算。任何失败都降级为“无变更”，绝不呈现错误界面。
- 查看器在构造上只读：它渲染轮末捕获的已存储 hunks，绝不渲染实时工作区内容。

## 模型体验

不贡献提示词 section、不提供工具、不产生模型可见上下文。它只渲染 Host 计算出的变更集。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 历史只保留 `maxHistory` 个轮次（Host 配置）；一旦被裁剪，更早的轮次会消失。
- 很早的轮次的 turn-tail 会按需拉取其存储记录；不做任何预取。
