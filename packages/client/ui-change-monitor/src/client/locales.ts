/**
 * Dictionary namespace of the changes panel.
 * @module @deepseek-ai/dsh-client-ui-change-monitor/client
 */

export const NS = 'changeMonitor'

/** Dictionary keys owned by this plugin. */
export type ChangeMonitorKey =
  | 'summary.files'
  | 'summary.files.one'
  | 'summary.additions'
  | 'summary.deletions'
  | 'row.view'
  | 'row.hide'
  | 'status.modified'
  | 'status.added'
  | 'status.deleted'
  | 'binary.summary'
  | 'history.loading'
  | 'row.noChanges'
  | 'diff.copy'
  | 'diff.copied'
  | 'diff.skipped'

/** English copy. */
export const en: Record<ChangeMonitorKey, string> = {
  'summary.files': '{count} files changed',
  'summary.files.one': '1 file changed',
  'summary.additions': '+{count}',
  'summary.deletions': '−{count}',
  'row.view': 'View changes',
  'row.hide': 'Hide changes',
  'status.modified': 'M',
  'status.added': 'A',
  'status.deleted': 'D',
  'binary.summary': 'Binary file changed',
  'history.loading': 'Computing changes…',
  'row.noChanges': 'No file changes in this workspace',
  'diff.copy': 'Copy diff',
  'diff.copied': 'Copied',
  'diff.skipped': '⋯ {count} lines skipped',
}

/** Chinese copy. */
export const zh: Record<ChangeMonitorKey, string> = {
  'summary.files': '{count} 个文件被修改',
  'summary.files.one': '1 个文件被修改',
  'summary.additions': '+{count}',
  'summary.deletions': '−{count}',
  'row.view': '查看更改',
  'row.hide': '收起更改',
  'status.modified': 'M',
  'status.added': 'A',
  'status.deleted': 'D',
  'binary.summary': '二进制文件已更改',
  'history.loading': '正在计算更改…',
  'row.noChanges': '当前目录下没有文件更改',
  'diff.copy': '复制 Diff',
  'diff.copied': '已复制',
  'diff.skipped': '⋯ 此处省略 {count} 行',
}
