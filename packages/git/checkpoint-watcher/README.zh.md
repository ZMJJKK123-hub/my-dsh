# @dsh-custom/dsh-checkpoint-watcher

[English](README.md) | 中文

每回合开始时的尽力而为影子检查点：带工作区的会话进入回合时，在该回合写入发生前，向会话专属序列落一个 git 检查点——面板的检查点列表由此成为免费的逐回合回滚时间线。

## 工作方式

- 订阅 `session/event`；在 `turn/start` 时以会话 id 为序列键、回合序号为索引（标签 `turn <n>`）调用 `ctx.git.checkpointCreate`。
- 严格尽力而为：任何失败只记警告，绝不影响 agent 回合；无工作区 cwd 的会话或不在 git 仓库内的工作区直接跳过。
- 同一序号的中断重启会覆盖同一 ref——重启是幂等的。

## 配置

- `enabled`（默认 `true`）：设为 false 可在不删行的前提下停止逐回合检查点。

## Model Experience

无，本插件不注册任何工具、不产生模型可见上下文；其创建的检查点仅通过 git 缝的检查点面可见。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- 已删除会话的检查点序列不会被删除；它们在该会话停止产生回合后，经 git 缝的 `checkpointKeepLast` 修剪逐渐老化淘汰。
- 第 0 回合（尚无 cwd）与非 git 工作区按设计静默跳过。
