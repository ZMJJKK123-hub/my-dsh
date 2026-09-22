/**
 * `automationsPanel` namespace dictionaries, and the namespace's declaration.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automations tab name, guide entry, rows, actions, and failure lines. */
    automationsPanel: AutomationsPanelKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '定时任务',
  'guide.title': '定时任务',
  'guide.description': '按 cron 计划在各工作区自动新建会话并执行 prompt。',
  'loading': '正在读取定时任务…',
  'empty': '还没有定时任务。',
  'create.title': '新建定时任务',
  'create.open': '新建',
  'create.submit': '创建',
  'create.cancel': '取消',
  'create.namePlaceholder': '任务名称',
  'create.cronPlaceholder': 'cron 表达式（分 时 日 月 周）',
  'create.workspacePlaceholder': '工作区绝对路径',
  'create.promptPlaceholder': '每次运行的 prompt',
  'row.nextRun': '下次 {time}',
  'row.lastOk': '上次成功',
  'row.lastError': '上次失败：{message}',
  'row.disabled': '已停用',
  'action.runNow': '立即运行',
  'action.toggleOn': '启用',
  'action.toggleOff': '停用',
  'action.delete': '删除',
  'action.refresh': '刷新',
  'error.unavailable': '操作失败：{message}',
} as const

/** English dictionary. */
export const en = {
  'type.label': 'Automations',
  'guide.title': 'Automations',
  'guide.description': 'Schedule cron-driven sessions with your prompt in any workspace.',
  'loading': 'Loading automations…',
  'empty': 'No automations yet.',
  'create.title': 'New automation',
  'create.open': 'New',
  'create.submit': 'Create',
  'create.cancel': 'Cancel',
  'create.namePlaceholder': 'Task title',
  'create.cronPlaceholder': 'cron expression (minute hour dom month dow)',
  'create.workspacePlaceholder': 'Absolute workspace path',
  'create.promptPlaceholder': 'Prompt for every run',
  'row.nextRun': 'next {time}',
  'row.lastOk': 'last run ok',
  'row.lastError': 'last failed: {message}',
  'row.disabled': 'disabled',
  'action.runNow': 'Run now',
  'action.toggleOn': 'Enable',
  'action.toggleOff': 'Disable',
  'action.delete': 'Delete',
  'action.refresh': 'Refresh',
  'error.unavailable': 'operation failed: {message}',
} as const

/** The namespace's key set: zh is the source of truth. */
export type AutomationsPanelKey = keyof typeof zh
