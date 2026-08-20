// @vitest-environment jsdom
/**
 * BackgroundRow: renders the title/upload/remove controls, applies the
 * stored image on mount, uploads through the hidden file input (encode
 * stubbed), and removes the applied background.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '../src/client/index.ts'
import {
  applyBackground, clearAppliedBackground, loadBackground, saveBackground,
} from '../src/client/background.ts'
import { BackgroundRow, type BackgroundRowProps } from '../src/client/BackgroundRow.tsx'
import { zh } from '../src/client/locales.ts'

vi.mock('../src/client/background.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/background.ts')>()
  return {
    ...actual,
    // The encode pipeline is covered by background.client.spec.ts; here the
    // row hands the encoded URL straight back.
    encodeImage: vi.fn(async () => 'data:image/jpeg;base64,new'),
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  clearAppliedBackground()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

function props(): BackgroundRowProps {
  return { t } as unknown as BackgroundRowProps
}

describe('BackgroundRow', () => {
  it('renders the title and upload button without a preview when nothing is stored', () => {
    render(<BackgroundRow {...props()} />)
    expect(screen.getByText('背景图片')).toBeDefined()
    expect(screen.getByText('上传照片')).toBeDefined()
    expect(screen.queryByTestId('background-preview')).toBeNull()
  })

  it('restores the persisted background on mount', () => {
    saveBackground('data:image/jpeg;base64,old')
    render(<BackgroundRow {...props()} />)
    expect(document.body.dataset.dshBg).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-bg-url')).toBe('url("data:image/jpeg;base64,old")')
    expect(screen.getByTestId('background-preview')).toBeDefined()
  })

  it('uploads a picked file, persists it, and shows the preview', async () => {
    render(<BackgroundRow {...props()} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] } })
      await Promise.resolve()
    })
    expect(loadBackground()).toBe('data:image/jpeg;base64,new')
    expect(document.body.dataset.dshBg).toBe('')
    expect(screen.getByTestId('background-preview')).toBeDefined()
    expect(screen.getByText('移除背景')).toBeDefined()
  })

  it('removes the background and its preview', async () => {
    saveBackground('data:image/jpeg;base64,old')
    applyBackground('data:image/jpeg;base64,old')
    render(<BackgroundRow {...props()} />)
    await act(async () => {
      fireEvent.click(screen.getByText('移除背景'))
      await Promise.resolve()
    })
    expect(loadBackground()).toBeNull()
    expect(document.body.dataset.dshBg).toBeUndefined()
    expect(screen.queryByTestId('background-preview')).toBeNull()
    expect(screen.queryByText('移除背景')).toBeNull()
  })
})
