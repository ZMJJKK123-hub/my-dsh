// @vitest-environment jsdom
/**
 * Background persistence/application logic: localStorage round-trip, body
 * application and removal, and image downscale+encode with a stubbed
 * Image/canvas pipeline.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyBackground, BACKGROUND_STORAGE_KEY, clearAppliedBackground,
  clearBackground, encodeImage, isBackgroundApplied, loadBackground, saveBackground,
} from '../src/client/background.ts'

afterEach(() => {
  localStorage.clear()
  delete document.body.dataset.dshBg
  document.body.style.removeProperty('--dsh-bg-url')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Replace FileReader with a deterministic one that resolves on a timer. */
function stubFileReader(): void {
  class FakeFileReader {
    result: string | ArrayBuffer | null = null
    onload: ((ev: ProgressEvent<FileReader>) => unknown) | null = null
    onerror: ((ev: ProgressEvent<FileReader>) => unknown) | null = null
    readAsDataURL(_blob: Blob): void {
      setTimeout(() => {
        this.result = 'data:image/png;base64,AA=='
        this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
      }, 0)
    }
  }
  vi.stubGlobal('FileReader', FakeFileReader)
}

describe('background persistence', () => {
  it('round-trips the stored image through localStorage', () => {
    expect(loadBackground()).toBeNull()
    saveBackground('data:image/jpeg;base64,abc')
    expect(loadBackground()).toBe('data:image/jpeg;base64,abc')
    clearBackground()
    expect(loadBackground()).toBeNull()
    expect(localStorage.getItem(BACKGROUND_STORAGE_KEY)).toBeNull()
  })

  it('applies and clears the body background', () => {
    expect(isBackgroundApplied()).toBe(false)
    applyBackground('data:image/jpeg;base64,abc')
    expect(isBackgroundApplied()).toBe(true)
    expect(document.body.dataset.dshBg).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-bg-url')).toBe('url("data:image/jpeg;base64,abc")')
    clearAppliedBackground()
    expect(isBackgroundApplied()).toBe(false)
    expect(document.body.style.getPropertyValue('--dsh-bg-url')).toBe('')
  })
})

describe('encodeImage', () => {
  it('downscales wide images to the max width and exports a JPEG data URL', async () => {
    const image = {
      naturalWidth: 3840, naturalHeight: 2160,
      onload: null, onerror: null, src: '',
    } as unknown as HTMLImageElement
    function ctor(): HTMLImageElement { return image }
    vi.stubGlobal('Image', ctor)

    const context = { drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,out')
    stubFileReader()

    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    const pending = encodeImage(file, 1920, 0.8)
    // Let the FileReader timer fire and the encode pipeline reach loadImage,
    // then fire the load callback on the stubbed Image.
    await new Promise(resolve => setTimeout(resolve, 0))
    image.onload?.(new Event('load'))
    const url = await pending

    expect(url).toBe('data:image/jpeg;base64,out')
    expect((context.drawImage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(image)
    const drawArgs = (context.drawImage as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    // drawImage(image, dx, dy, dWidth, dHeight)
    expect(drawArgs[3]).toBe(1920)
    expect(drawArgs[4]).toBe(1080)
    expect(vi.mocked(HTMLCanvasElement.prototype.toDataURL)).toHaveBeenCalledWith('image/jpeg', 0.8)
  })

  it('keeps images narrower than the cap at their original size', async () => {
    const image = {
      naturalWidth: 800, naturalHeight: 600,
      onload: null, onerror: null, src: '',
    } as unknown as HTMLImageElement
    function ctor(): HTMLImageElement { return image }
    vi.stubGlobal('Image', ctor)

    const context = { drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,out')
    stubFileReader()

    const file = new File(['x'], 'small.png', { type: 'image/png' })
    const pending = encodeImage(file, 1920)
    await new Promise(resolve => setTimeout(resolve, 0))
    image.onload?.(new Event('load'))
    await pending

    const drawArgs = (context.drawImage as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[]
    expect(drawArgs[3]).toBe(800)
    expect(drawArgs[4]).toBe(600)
  })

  it('rejects when the image fails to decode', async () => {
    const image = {
      naturalWidth: 100, naturalHeight: 100,
      onload: null, onerror: null, src: '',
    } as unknown as HTMLImageElement
    function ctor(): HTMLImageElement { return image }
    vi.stubGlobal('Image', ctor)
    stubFileReader()
    const file = new File(['x'], 'broken.png', { type: 'image/png' })
    const pending = encodeImage(file)
    await new Promise(resolve => setTimeout(resolve, 0))
    image.onerror?.(new Event('error'))
    await expect(pending).rejects.toThrow(/decode failed/)
  })
})
