# @dsh-custom/dsh-client-ui-git

[English](README.md) | 中文

Web 客户端的源代码管理面板：右侧栏一个 tab，展示会话仓库的分支、领先/落后计数、已暂存与未暂存变更列表（逐文件暂存/取消暂存）、所选文件的差异视图、带 AI 生成按钮的提交框（宿主行配置了模型路由时可用）与推送——全部由 `gitRemote` Remote 命名空间驱动。

## 工作方式

- 自行挂载 `gitRemote` 命名空间（`ctx.remote.$mount`，与 `ui-change-monitor` 挂载 `changeMonitor` 的方式一致），然后把 `git` tab 类型及其 body 注册到键控的 `sidebar.right.pane.tab` 座位。
- 面板状态位于 Slot 标准的独占 store（每会话一个实例），按 tab 分桶：状态、所选文件差异、busy 守卫和一行通知。
- face 解开两层信封（承载层 `RemoteResult`，再是宿主的 `GitRemoteResult`），写入可渲染的失败——`denied` 应答显示权限预设提示而不是原始错误。
- 所有操作都作用于会话自己的仓库：请求只带 sessionId，宿主解析工作区。

## 配置

无。

## Model Experience

无，本包不注册任何工具、不产生模型可见上下文；只渲染 `gitRemote` 命名空间提供的仓库事实。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 差异视图以等宽纯文本渲染补丁；hunk 级红绿渲染器与经 `tabActions` 打开文件属于后续增强。
- 无变更事件订阅：面板在挂载、操作后和刷新按钮时刷新；提交/推送通知流后续由宿主缝提供。
- AI 生成按钮在无暂存变更时禁用；宿主未配置路由时返回如实的未配置失败提示。
