# ZCode → dsh 移植拍板记录

> 背景：将 ZCode（`C:/Users/59639/Desktop/ZCode`，AI 编程工作台 monorepo）的能力移植到本仓库（DeepSeek Harness 个人 fork）。
> 本文件是**唯一拍板记录**，后续会话直接读本文件恢复上下文，不需要用户重述决定。
> 状态：P1✅ P2✅ P3✅ P4✅ P5✅（已内置：base+依赖+自解析） **P6 进行中**（域字段 pinSession/unpinSession df37422；workspace 控制器暴露 + 客户端 pin/unread 渲染待做）。P7 CUA 完全移植待做。
> 实现节奏约定（用户要求）：一次只做一个小任务、小步走；每完成一小步就 git commit 便于回撤；严格遵循 dsh 现有插件架构；插件直接加进树，不做商店管理 UI。
> 最后更新：2026-09-22

## ✅ 已拍板：要移植（按优先级顺序实现）

| 优先级 | 能力 | 范围 | ZCode 参考实现 | dsh 落点（初步设计，实现前可再细化） |
|---|---|---|---|---|
| P1 | Git 工具链 | 模型可用的 git 工具：status / diff / branch / stage / commit / push、AI 生成 commit message；Web UI 的 Git 面板 | `packages/services/src/git/`（git.ts 接口、repo/gitCliRepo.ts、gitCommitMessageGenerator.ts）；UI 参考 `packages/ui/src/GitPane.tsx` | 新插件 `tool-git`（defineTool + ctx.subprocess 调 git CLI）+ client 侧 UI 插件；diff 展示可复用 change-monitor / ui-primitives 已有渲染 |
| P2 | Git checkpoint / 文件回滚 | 影子 checkpoint、按检查点恢复文件（file rewind） | `packages/services/src/git/gitCheckpointStore.ts`、`gitCheckpointRepo.ts`、file rewind preview | 在 change-monitor 已持久化的每轮 change set 上补「恢复/restore」能力（工具 + ChangesPanel 加按钮）；注意 dsh 哲学：恢复动作要落 session log |
| P3 | 机器级定时任务（cron） | 跨会话、进程重启后仍生效的定时任务（到期自动拉起会话执行 prompt）。**不含** off-peak 闲时批量 | `packages/services/src/session/automationRepo.ts`、`automationService.ts`、`automationCron.ts`（croner + claim 派发 + misfire 宽限）；`packages/desktop/src/scheduler/` | host 级 scheduler 插件：storage（sqlite/json）持久化任务表 + 轮询 claim + 到期拉起 session/headless + UI（任务列表/启停） |
| P4 | 多品牌主题 | 主题体系与资产（ZCode 有 5 种：light/dark/zai-light/zai-dark/system + 设计规范） | `packages/ui/src/useTheme.ts`、`DESIGN.md`（token 体系） | dsh 已有 `ctx.theme`（light/dark/system + 字号 + 可注册 token 覆盖，maid-atelier 皮肤是现成先例），主要工作是主题资产与配色 token，不是框架 |
| P5 | 浏览器自动化内置化 | 把 third-party/dsh-browser-control 内置进默认组合 + 自动安装依赖，无需手动 `npm install @playwright/mcp` | ZCode 内置 browser-use-plugin 对照 | `third-party/dsh-browser-control` 进 base/web bundle 层 + 依赖自动准备 |
| P6 | 置顶/未读 | 会话列表置顶（pin）与新回复未读（unread）标记；归档 dsh 已有 | `packages/ui/src/store/taskQueryCacheStore.ts`（unread overlay、pin 概念） | workspace spec 扩展字段 + ui-workspace 行渲染，纯客户端 |
| P7 | CUA 产品化（**完全移植**，用户拍板） | ① 操作确认门（CUA 动作前弹窗批准/记住选择）② 可视化悬浮窗（实时显示 AI 所见/所做，可打断）③ 权限预检（跨平台化：截屏/辅助功能可用性检测）④ 浏览器登录态导入（Windows Edge 登录态给自动化浏览器） | `packages/services/src/cua-permission-broker/`、`packages/desktop/src/preload/`（CUA 面板）、`packages/desktop/native/windows-browser-import-helper` | ①③ host 侧 CUA 准入插件（配合 tool-input/tool-screenshot）；② client 侧面板；④ 依赖 dsh-browser-control 的 Chrome 启动方式 |

## ❌ 已拍板：明确不要

| 能力 | 拒绝理由（用户原话归纳） |
|---|---|
| dsh 作为 MCP server（#4） | 不重要；已有 ACP server 对应物 |
| 会话分享（#5） | 不重要 |
| SSH/WSL/Docker 远程工作区（#6） | 暂时不需要 |
| TUI 终端界面（#7） | 只用 Web UI |
| 账号/订阅/配额体系（#8） | 完全不需要 |
| 多窗口/手机实时镜像（#11） | 不需要，只用 Web 端 |
| off-peak 闲时批量（#3 的另一半） | dsh 不需要 |
| 官方 MCP 凭据/同步（#15） | 不需要 |

## ⏸️ 挂起

- 插件商店 / marketplace（#9）：用户要求「最后统一一起搞」，本轮不做。插件直接加进树，不做商店管理 UI。

## 实现约定（实现时遵守）

- dsh 插件形态：函数插件具名导出 `name` / `inject` / `Config` / `apply(ctx, config)`，禁止 default export；树内插件命名 `@deepseek-ai/dsh-<name>` 放 `packages/<group>/<pkg>/`；client 插件用 `dsh.client` manifest + tsdown clientBundle。
- 注册即 effect（返回 disposer），无硬编码 tunables（配置走 cordis.yml Config）。
- 新行为走文档化扩展点（`ctx.tools` / `ctx.shell` / `ctx.commands` / `ctx.jobs` / capability seams），不改 agent-loop。
- 对应 cookbook：`docs/cookbook/adding-a-package.md`、`adding-a-tool.md`、`extension-cookbook.md`。
