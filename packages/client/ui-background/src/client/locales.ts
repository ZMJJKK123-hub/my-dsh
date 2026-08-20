/**
 * Background plugin copy: a settings row under General. Product copy is
 * Chinese; the English mirror keeps the key set identical.
 */

/** Locale namespace of this plugin. */
export const NS = 'background'

/** Dictionary keys owned by this plugin. */
export type BackgroundKey =
  | 'row.title'
  | 'row.upload'
  | 'row.remove'
  | 'row.previewAlt'
  | 'error.encode'

/** 中文产品文案（默认语言）。 */
export const zh: Record<BackgroundKey, string> = {
  'row.title': '背景图片',
  'row.upload': '上传照片',
  'row.remove': '移除背景',
  'row.previewAlt': '当前背景预览',
  'error.encode': '图片处理失败，请换一张试试',
}

/** English mirror. */
export const en: Record<BackgroundKey, string> = {
  'row.title': 'Background image',
  'row.upload': 'Upload photo',
  'row.remove': 'Remove background',
  'row.previewAlt': 'Current background preview',
  'error.encode': 'Could not process the image — try another one',
}
