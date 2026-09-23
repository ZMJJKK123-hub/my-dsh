/**
 * `gitPanel` namespace dictionaries, and the namespace's declaration.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'gitPanel'>` or `PropsLocale<'gitPanel'>` needs only this file.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Source-control tab name, guide entry, groups, actions, and failure lines. */
    gitPanel: GitPanelKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '源代码',
  'guide.title': '源代码',
  'guide.description': '查看这个会话仓库的分支、变更与暂存，提交并推送。',
  'loading': '正在读取仓库…',
  'notRepo': '当前会话工作区不是 git 仓库。',
  'noWorkspace': '请先在左侧选择一个包含 git 仓库的工作区，源代码面板才能显示内容。点击右上角 ← 可收起此栏。',
  'empty': '工作区干净，没有变更。',
  'changes.title': '变更',
  'staged.title': '已暂存',
  'status.initial': '尚未有提交',
  'status.detached': '分离头指针',
  'status.ahead': '领先 {n}',
  'status.behind': '落后 {n}',
  'action.refresh': '刷新',
  'action.stage': '暂存',
  'action.stageAll': '全部暂存',
  'action.unstage': '取消暂存',
  'action.commit': '提交',
  'action.generate': 'AI 生成',
  'action.push': '推送',
  'action.restore': '恢复到此检查点',
  'commit.placeholder': '提交信息（首行为标题）',
  'commit.nothing': '没有已暂存的变更可提交。',
  'diff.loading': '正在加载差异…',
  'diff.empty': '选择一个文件查看差异。',
  'diff.failed': '差异加载失败：{message}',
  'diff.truncated': '差异过长，仅显示末尾部分。',
  'error.denied': '操作被权限预设阻止：请切换到允许写入的模式后重试。',
  'error.unavailable': 'git 操作失败：{message}',
  'notice.committed': '已提交 {hash} {subject}',
  'notice.pushed': '已推送 {branch} 到 {remote}',
  'notice.restored': '已从检查点恢复工作区',
  'checkpoints.title': '检查点',
  'checkpoints.empty': '暂无检查点',
  'checkpoints.loading': '正在读取检查点…',
} as const

/** English dictionary. */
export const en = {
  'type.label': 'Source Control',
  'guide.title': 'Source Control',
  'guide.description': 'Branch, changes, and staging for this session repository; commit and push.',
  'loading': 'Reading repository…',
  'notRepo': 'The session workspace is not a git repository.',
  'noWorkspace': 'Select a workspace with a git repository from the left sidebar first. Click the ← arrow at the top right to collapse this panel.',
  'empty': 'Working tree clean.',
  'changes.title': 'Changes',
  'staged.title': 'Staged',
  'status.initial': 'no commits yet',
  'status.detached': 'detached HEAD',
  'status.ahead': 'ahead {n}',
  'status.behind': 'behind {n}',
  'action.refresh': 'Refresh',
  'action.stage': 'Stage',
  'action.stageAll': 'Stage All',
  'action.unstage': 'Unstage',
  'action.commit': 'Commit',
  'action.generate': 'Generate',
  'action.push': 'Push',
  'action.restore': 'Restore to this checkpoint',
  'commit.placeholder': 'Commit message (first line is the subject)',
  'commit.nothing': 'Nothing staged to commit.',
  'diff.loading': 'Loading diff…',
  'diff.empty': 'Select a file to see its diff.',
  'diff.failed': 'Diff failed: {message}',
  'diff.truncated': 'Diff truncated; showing the tail only.',
  'error.denied': 'Blocked by the permission preset: switch to a write-capable mode and retry.',
  'error.unavailable': 'git operation failed: {message}',
  'notice.committed': 'Committed {hash} {subject}',
  'notice.pushed': 'Pushed {branch} to {remote}',
  'notice.restored': 'Work tree restored from the checkpoint',
  'checkpoints.title': 'Checkpoints',
  'checkpoints.empty': 'No checkpoints yet',
  'checkpoints.loading': 'Loading checkpoints…',
} as const

/** The namespace's key set: zh is the source of truth. */
export type GitPanelKey = keyof typeof zh
