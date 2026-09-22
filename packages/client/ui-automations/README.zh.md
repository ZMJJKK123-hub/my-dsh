# @dsh-custom/dsh-client-ui-automations

[English](README.md) | 中文

Web 客户端的机器级 cron 定时任务面板：右侧栏一个 tab，列出每个定时任务（名称、cron、下次运行、上次结果），每行提供启用/停用、立即运行和删除，另有新建表单（名称、cron、工作区绝对路径、prompt）——全部由 `automationsRemote` 命名空间驱动。

## 工作方式

- 自行挂载 `automationsRemote` 命名空间（`ctx.remote.$mount`），然后把 `automations` tab 类型及其 body 注册到键控的 `sidebar.right.pane.tab` 座位。
- 面板状态是 Slot 标准独占 store（每会话一个实例），按 tab 分桶：列表、busy 守卫和一行通知。
- face 解开两层信封并写入可渲染的失败；每次变更后刷新列表。

## 配置

无。

## Model Experience

无，本包不注册任何工具、不产生模型可见上下文；只渲染 `automationsRemote` 命名空间提供的定时任务表。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 无逐任务变更事件：面板在挂载、操作后和刷新按钮时刷新。
- 新建表单直接输入 cron 文本；字段级表达式辅助与工作区选择器属于后续增强。
