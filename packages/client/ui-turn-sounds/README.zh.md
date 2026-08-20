# @dsh-custom/dsh-client-ui-turn-sounds

[English](README.md) | 中文

浏览器提示音：当 agent 完成一轮回复时播放完成音，当 agent 向你提问时播放提问音。设置在 Settings 的“提示音”页面。

## 工作原理

- 监听所有已列出会话的会话快照，识别新增的已完成轮次（`turnEnds`）和新增的待回答问题（`pending` 中 `kind: 'question'` 的条目），因此即使 dsh 标签页在后台或另一个会话正在运行，也会播放声音。
- 默认音效用 Web Audio 合成；用户可以在设置里为每个槽位上传播放 mp3/wav/ogg，单个不超过 1MB。
- 设置保存在 `localStorage` 的 `dsh.turn-sounds` 键下。

## 配置

无。

## 模型体验

不贡献提示词 section、不提供工具、不产生模型可见上下文。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 声音在 dsh 浏览器标签页内播放，不会在浏览器之外全局播放。
- 浏览器自动播放策略可能需要先有一次用户交互；插件会在首次点击或按键时预热 AudioContext。
- 自定义音效以 data URL 存在 `localStorage` 中；清除站点数据会移除它们。
