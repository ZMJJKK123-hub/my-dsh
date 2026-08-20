/**
 * Background persistence and application: the uploaded photo is downscaled
 * to a JPEG data URL, stored in localStorage (survives reloads), and applied
 * to the document body. The injected global style (client/index.ts) turns
 * the page-level surfaces transparent when `data-dsh-bg` is present, so the
 * image shows through the main area while the sidebar keeps its own fill.
 *
 * @module @deepseek-ai/dsh-client-ui-background/client
 */

/** localStorage key holding the applied background's data URL. */
export const BACKGROUND_STORAGE_KEY = 'dsh.background.image'

/** <style> element id of the injected background rule. */
export const BACKGROUND_STYLE_ID = 'dsh-background-style'

/** Downscale target: images wider than this are shrunk (long side kept). */
export const DEFAULT_MAX_WIDTH = 1920

/** JPEG quality for the stored data URL. */
export const DEFAULT_QUALITY = 0.82

/**
 * The currently stored background data URL.
 * @returns the data URL, or null when none is stored.
 */
export function loadBackground(): string | null {
  return localStorage.getItem(BACKGROUND_STORAGE_KEY)
}

/** Store a background data URL. @param url - the image data URL to persist. */
export function saveBackground(url: string): void {
  localStorage.setItem(BACKGROUND_STORAGE_KEY, url)
}

/** Remove the stored background. */
export function clearBackground(): void {
  localStorage.removeItem(BACKGROUND_STORAGE_KEY)
}

/**
 * Apply a background image to the document body: marks `data-dsh-bg` and
 * publishes the image through the `--dsh-bg-url` custom property, which the
 * injected style consumes.
 * @param url - image data URL (or any URL the browser can paint).
 */
export function applyBackground(url: string): void {
  document.body.dataset.dshBg = ''
  document.body.style.setProperty('--dsh-bg-url', `url("${url}")`)
}

/** Remove the applied background from the body (the stored image stays). */
export function clearAppliedBackground(): void {
  delete document.body.dataset.dshBg
  document.body.style.removeProperty('--dsh-bg-url')
}

/** Whether a background is currently applied to the body. */
export function isBackgroundApplied(): boolean {
  return document.body.dataset.dshBg !== undefined
}

/**
 * Downscale and encode an image file into a JPEG data URL. The image is
 * loaded through an <img>, drawn onto a canvas capped at `maxWidth`, and
 * exported; files already narrower than the cap keep their width. Binary
 * (non-image) files and decode failures reject.
 * @param file - the picked image file.
 * @param maxWidth - long-side cap for the stored image.
 * @param quality - JPEG quality passed to `canvas.toDataURL`.
 * @returns the data URL.
 */
export async function encodeImage(file: File, maxWidth = DEFAULT_MAX_WIDTH, quality = DEFAULT_QUALITY): Promise<string> {
  const sourceUrl = await readAsDataUrl(file)
  const image = await loadImage(sourceUrl)
  const scale = Math.min(1, maxWidth / image.naturalWidth)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('background: canvas 2d context unavailable')
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}

/** Read a file as a data URL. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('background: file read failed'))
    reader.readAsDataURL(file)
  })
}

/** Decode an image source into an <img> element (rejects on decode failure). */
function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('background: image decode failed'))
    image.src = source
  })
}
