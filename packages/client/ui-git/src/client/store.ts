/**
 * The source-control panel's view state, one bucket per tab.
 *
 * Status, the selected file's diff, and one notice line are state the tab
 * owns — so they live in a Slot-standard exclusive store (one instance per
 * session), bucketed by tab id because two tabs of this kind in one session
 * select independently. Writers run between `start` and `forget`: the tab
 * record's `signal` is what ends a bucket's life.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { GitRemoteStatusView } from '@dsh-custom/dsh-git-remote/types'

/** What the tab knows about the repository status. */
export type GitStatusState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly view: GitRemoteStatusView }
  | { readonly kind: 'failed'; readonly message: string; readonly denied: boolean }

/** What the tab knows about the selected file's diff. */
export type GitDiffState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly patch: string; readonly truncated: boolean }
  | { readonly kind: 'failed'; readonly message: string }

/** One tab's panel state. */
export interface GitTabState {
  status: GitStatusState
  /** Repository-relative path whose diff is open, when one is. */
  selected: string | undefined
  /** Whether the open diff reads the staged side. */
  selectedStaged: boolean
  diff: GitDiffState
  /** A mutation is in flight; action buttons rest. */
  busy: boolean
  /** The last settled action's one-line result. */
  notice: string | undefined
  /** A commit-message draft is being generated. */
  generating: boolean
  /** The latest generated draft; a change fills the commit box. */
  generated: string | undefined
}

/** Every tab's state, keyed by tab id. */
export interface GitState {
  byTab: Record<TabId, GitTabState>
}

/**
 * One tab's bucket, which every writer after `start` relies on.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's state.
 */
function bucket(state: GitState, tabId: TabId): GitTabState {
  const tab = state.byTab[tabId]
  if (tab === undefined) throw new Error(`ui-git: no bucket for tab "${tabId}"`)
  return tab
}

/** The panel store's write set; every action names the tab it writes. */
type GitActions = {
  start: (draft: GitState, tabId: TabId) => void
  statusLoading: (draft: GitState, tabId: TabId) => void
  statusReady: (draft: GitState, tabId: TabId, view: GitRemoteStatusView) => void
  statusFailed: (draft: GitState, tabId: TabId, message: string, denied: boolean) => void
  select: (draft: GitState, tabId: TabId, path: string, staged: boolean) => void
  diffLoading: (draft: GitState, tabId: TabId) => void
  diffReady: (draft: GitState, tabId: TabId, patch: string, truncated: boolean) => void
  diffFailed: (draft: GitState, tabId: TabId, message: string) => void
  busy: (draft: GitState, tabId: TabId, on: boolean) => void
  notice: (draft: GitState, tabId: TabId, text: string) => void
  generating: (draft: GitState, tabId: TabId, on: boolean) => void
  generated: (draft: GitState, tabId: TabId, text: string) => void
  forget: (draft: GitState, tabId: TabId) => void
}

/**
 * Declare the panel's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createGitStore(): EngineStoreHandle<GitState, GitActions> {
  return defineStore({
    init: (): GitState => ({ byTab: {} }),
    actions: {
      start: (d, tabId: TabId) => {
        d.byTab[tabId] = { status: { kind: 'loading' }, selected: undefined, selectedStaged: false, diff: { kind: 'idle' }, busy: false, notice: undefined, generating: false, generated: undefined }
      },
      statusLoading: (d, tabId: TabId) => {
        bucket(d, tabId).status = { kind: 'loading' }
      },
      statusReady: (d, tabId: TabId, view: GitRemoteStatusView) => {
        const tab = bucket(d, tabId)
        tab.status = { kind: 'ready', view }
        // A refresh can retire the selected file; drop a diff that no longer
        // belongs to the reported entries.
        if (tab.selected !== undefined && !view.entries.some(entry => entry.path === tab.selected)) {
          tab.selected = undefined
          tab.diff = { kind: 'idle' }
        }
      },
      statusFailed: (d, tabId: TabId, message: string, denied: boolean) => {
        bucket(d, tabId).status = { kind: 'failed', message, denied }
      },
      select: (d, tabId: TabId, path: string, staged: boolean) => {
        const tab = bucket(d, tabId)
        tab.selected = path
        tab.selectedStaged = staged
        tab.diff = { kind: 'loading' }
      },
      diffLoading: (d, tabId: TabId) => {
        bucket(d, tabId).diff = { kind: 'loading' }
      },
      diffReady: (d, tabId: TabId, patch: string, truncated: boolean) => {
        bucket(d, tabId).diff = { kind: 'ready', patch, truncated }
      },
      diffFailed: (d, tabId: TabId, message: string) => {
        bucket(d, tabId).diff = { kind: 'failed', message }
      },
      busy: (d, tabId: TabId, on: boolean) => {
        bucket(d, tabId).busy = on
      },
      notice: (d, tabId: TabId, text: string) => {
        bucket(d, tabId).notice = text
      },
      generating: (d, tabId: TabId, on: boolean) => {
        bucket(d, tabId).generating = on
      },
      generated: (d, tabId: TabId, text: string) => {
        bucket(d, tabId).generated = text
      },
      forget: (d, tabId: TabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}
