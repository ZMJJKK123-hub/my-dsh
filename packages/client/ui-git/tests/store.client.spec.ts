/**
 * The panel's write set, one tab at a time.
 *
 * The load-bearing facts: `statusReady` retires a selected file that the
 * refreshed status no longer reports (its diff must not survive the file),
 * and `forget` removes the bucket so a late settlement has nowhere to write.
 */
import { describe, expect, it } from 'vitest'
import { createGitStore } from '../src/client/store.ts'
import type { GitRemoteStatusView } from '@dsh-custom/dsh-git-remote/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const TAB = 'tab-1' as TabId

const VIEW: GitRemoteStatusView = {
  root: '/work/app',
  ahead: 1,
  behind: 0,
  initial: false,
  detached: false,
  branch: 'main',
  upstream: 'origin/main',
  entries: [
    { code: 'M ', path: 'src/a.ts', staged: true, unstaged: false, untracked: false },
    { code: ' M', path: 'src/b.ts', staged: false, unstaged: true, untracked: false },
    { code: '??', path: 'new.txt', staged: false, unstaged: true, untracked: true },
  ],
}

describe('createGitStore', () => {
  it('mints an independent instance per call', () => {
    const first = createGitStore().create()
    const second = createGitStore().create()
    first.actions.start(TAB)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('seeds a tab in the loading state with no selection', () => {
    const store = createGitStore().create()
    store.actions.start(TAB)
    expect(store.getSnapshot().byTab[TAB]).toEqual({
      status: { kind: 'loading' },
      selected: undefined,
      selectedStaged: false,
      diff: { kind: 'idle' },
      busy: false,
      notice: undefined,
      generating: false,
      generated: undefined,
    })
  })

  it('walks the status through ready and failed', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.start(TAB)
    actions.statusReady(TAB, VIEW)
    expect(store.getSnapshot().byTab[TAB]?.status).toEqual({ kind: 'ready', view: VIEW })
    actions.statusFailed(TAB, 'not a git repository', false)
    expect(store.getSnapshot().byTab[TAB]?.status).toEqual({ kind: 'failed', message: 'not a git repository', denied: false })
  })

  it('retires a selected file the refreshed status no longer reports', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.start(TAB)
    actions.statusReady(TAB, VIEW)
    actions.select(TAB, 'new.txt', false)
    expect(store.getSnapshot().byTab[TAB]?.diff).toEqual({ kind: 'loading' })
    const withoutNew: GitRemoteStatusView = { ...VIEW, entries: VIEW.entries.slice(0, 2) }
    actions.statusReady(TAB, withoutNew)
    const tab = store.getSnapshot().byTab[TAB]
    expect(tab?.selected).toBeUndefined()
    expect(tab?.diff).toEqual({ kind: 'idle' })
  })

  it('keeps a selected file the refreshed status still reports', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.start(TAB)
    actions.statusReady(TAB, VIEW)
    actions.select(TAB, 'src/a.ts', true)
    actions.diffReady(TAB, '+hello', false)
    actions.statusReady(TAB, VIEW)
    expect(store.getSnapshot().byTab[TAB]?.diff).toEqual({ kind: 'ready', patch: '+hello', truncated: false })
  })

  it('records busy and notice, and forget drops the bucket', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.start(TAB)
    actions.busy(TAB, true)
    expect(store.getSnapshot().byTab[TAB]?.busy).toBe(true)
    actions.busy(TAB, false)
    actions.notice(TAB, 'Committed abcd123 first')
    expect(store.getSnapshot().byTab[TAB]?.notice).toBe('Committed abcd123 first')
    actions.forget(TAB)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('tracks message generation through generating and generated', () => {
    const store = createGitStore().create()
    const { actions } = store
    actions.start(TAB)
    actions.generating(TAB, true)
    expect(store.getSnapshot().byTab[TAB]?.generating).toBe(true)
    actions.generating(TAB, false)
    actions.generated(TAB, 'Add feature')
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ generating: false, generated: 'Add feature' })
  })
})
