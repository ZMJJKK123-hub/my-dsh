# @dsh-custom/dsh-client-ui-theme-zai

[English](README.md) | 中文

从 ZCode 移植的 Zai 品牌主题：`zai-light` 与 `zai-dark` 以别名 token 主题注册到 dsh 主题注册表，构建在别名层上的所有 UI 无需触碰基础调色板即可换肤。两者自动出现在 设置 → 外观 的主题列表中。

## 工作方式

- 经 `ctx.theme.register` 注册两个主题：`zai-light`（浅色方案，近白表面、墨色前景、黑色品牌）与 `zai-dark`（深色方案，近黑表面、白色前景、白色品牌）。
- 每个主题恰好覆盖 14 个已文档化的别名 token（`--dsw-alias-*` 与 `--dsw-specific-sidebar-fill`），取值移植自 ZCode 的 `theme-zai-light` / `theme-zai-dark` 调色板。
- 注册不会改变当前激活偏好；用户在外观行里选择主题。

## 配置

无。

## Model Experience

无，本包不注册任何工具、不产生模型可见上下文；只贡献主题调色板 token。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- dsh 别名层没有对应的 ZCode 专有 token（轨迹色、热力图色阶）被舍弃；它们回退到基础调色板。
- 外观行显示原始 id（`zai-light`、`zai-dark`）；若 ui-theme 长出标签面，可再补本地化显示名。
