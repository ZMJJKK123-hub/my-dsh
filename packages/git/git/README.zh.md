# @dsh-custom/dsh-git

[English](README.md) | 中文

`ctx.git` 能力缝的 Service Definition：供模型工具与 UI 面板共享的只读仓库事实（根目录、状态、diff、提交历史、分支）。本包只声明接口与结果类型；本地实现在 `@dsh-custom/dsh-git-local`。

## 工作方式

- 声明抽象 `GitService`（`ctx.git`）：`resolveRoot`、`status`、`diff`、`log`、`branches`。
- 每个方法按调用传入仓库目录（由调用方解析会话工作区），且绝不写仓库。
- git 失败以 `GitError` 抛出（含退出码、stderr，以及沙箱策略拦截时的 `denied` 标记）。

## 配置

无。本包没有任何运行时行为，仅是类型与接口声明。

## Model Experience

无，本包不注册任何工具、不产生模型可见上下文；模型可见性通过消费本缝的 `@dsh-custom/dsh-tool-git` 产生。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 只读面：暂存、提交、推送与历史改写属于后续的写入缝，不在本接口内。
- 不列出远端分支；`branches` 仅覆盖 `refs/heads`。
