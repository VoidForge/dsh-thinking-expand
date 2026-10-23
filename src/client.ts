/**
 * Thinking Focus — browser half.
 *
 * The Chat thinking disclosure keeps its open state in local React state and the
 * shipped plugin surface cannot change it (the reasoning Body Slot only exists
 * while the row is open). This client half therefore drives the disclosure from
 * its rendered DOM: it keeps only the latest thinking block expanded, closes
 * superseded blocks after a configurable delay unless the reader opened them,
 * and renders its settings form on the Plugins page.
 *
 * Bundles are served as classic scripts, so the build emits one self-contained
 * IIFE: a second execution of the bundle in the same page (HMR rebuild or a
 * plugin re-enable) must not collide with global bindings.
 */
import type * as ReactNS from 'react'

import {
  LOCALE_NAMESPACE,
  PACKAGE_NAME,
  SETTINGS_ENTRY_ID,
} from './constants.ts'
import type {
  ClientContext,
  ClientPlugin,
  ConfigForm,
  ConfigSnapshot,
  RequireFn,
} from './types/dsh.ts'
import {
  COLLAPSE_DELAY_MAX_SECONDS,
  COLLAPSE_DELAY_MIN_SECONDS,
  editedAcceptedUnchanged,
  formatBlockIdentity,
  normalizeConfigSnapshot,
  parseCollapseDelay,
  planCollapses,
  planSettingsWrite,
  reconcileSettingsDraft,
  settingsDraftFromValue,
  shouldAutoExpand,
  type BlockRecord,
  type EditedFields,
  type EffectiveConfig,
  type ManualChoice,
  type SettingsDraft,
} from './rules.ts'

type ReactModule = typeof ReactNS

const THINK_ROOT_SELECTOR = '[data-variant="think"]'
const DISCLOSURE_ROW_SELECTOR = '[data-disclosure-row][aria-expanded]'
const CHAT_COLUMN_SELECTOR = '[data-slot="main.conversation"] [data-slot="conversation.view"] [data-chat-flow]'
const CHAT_CONTENT_SELECTOR = '[data-conversation-content][data-conversation-region="chat"]'
const CHAT_COLUMN_EXCLUSION = '[data-sidebar-right-session], [data-sidebar-chat], [data-step-process-body]'
const CHAT_CONTENT_EXCLUSION = '[data-sidebar-right-session], [data-sidebar-chat]'
const SESSION_ATTRIBUTE = 'data-conversation-session'
const NODE_KEY_ATTRIBUTE = 'data-chat-node-key'
const EXPANDED_ATTRIBUTE = 'data-expanded'

const CLICK_RETRY_MS = 500
const CLICK_ATTEMPT_LIMIT = 2
const DRAG_SLOP_PX = 4
const RULE_RECHECK_MS = 600
const MAX_REMEMBERED_BLOCKS = 512

/** A thinking block plus the element it was derived from in this pass. */
interface DomBlockEntry {
  id: string
  expanded: boolean
  isLatest: boolean
  element: Element
}

/** A pointer press that could still become a disclosure click. */
interface PendingPointer {
  readonly row: Element
  readonly x: number
  readonly y: number
}

/** A disclosure row and the thinking root that owns it. */
interface DisclosureHit {
  readonly row: Element
  readonly root: Element
}

/** Engine lifecycle controls returned to the client plugin. */
interface EngineControls {
  start(): void
  applyConfig(): void
  dispose(): void
}

/** Props DSH passes to a `plugins.bundle.config` page component. */
interface SettingsPanelProps {
  view: 'summary' | 'page'
  configForm: ConfigForm
  t?: (key: string) => string
}

/**
 * Record one edited field without rebroadcasting a state change when the field
 * is already marked.
 * @param current Current edited set.
 * @param field Edited field.
 * @returns Edited set containing the field.
 */
function markEdited(current: EditedFields, field: keyof EditedFields): EditedFields {
  if (current[field] === true) return current
  const next: EditedFields = { ...current }
  next[field] = true
  return next
}

// ---------------------------------------------------------------------------
// Copy for the settings panel (registered as a client locale namespace).
// ---------------------------------------------------------------------------

const DICTIONARIES: Record<string, Record<string, string>> = {
  en: {
    loading: 'Loading settings…',
    unavailable: 'These settings are not available in this profile.',
    readOnly: 'This profile stores settings read-only; the plugin keeps its current configuration.',
    enabled: 'Auto-expand the current thinking block',
    enabledHint: 'Only the latest thinking block stays open.',
    collapseDelay: 'Collapse delay (seconds)',
    delayHint: 'An older thinking block closes this many seconds after a newer thinking block appears.',
    manualOpenProtection: 'Keep blocks I opened manually',
    manualOpenProtectionHint: 'When off, manually opened older blocks also close after the delay.',
    invalidDelay: 'Enter a whole number from 0 to 60 seconds.',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'The Host did not accept the change. Review the current values and retry.',
  },
  zh: {
    loading: '正在加载设置…',
    unavailable: '当前配置档无法使用这些设置。',
    readOnly: '当前配置档以只读方式存储设置；插件保持现有配置。',
    enabled: '自动展开当前思考块',
    enabledHint: '只有最新的思考块保持展开。',
    collapseDelay: '收起延迟（秒）',
    delayHint: '出现更新的思考块后，较早的思考块在该秒数后收起。',
    manualOpenProtection: '保留我手动展开的思考块',
    manualOpenProtectionHint: '关闭后，手动展开的较早思考块也会在延迟后收起。',
    invalidDelay: '请输入 0 到 60 之间的整数秒。',
    save: '保存',
    saving: '正在保存…',
    saveFailed: 'Host 未接受该修改，请检查当前值后重试。',
  },
}

const SETTINGS_CSS = `
.te-panel { display:flex; flex-direction:column; gap:10px; max-width:560px; font-size:13px; line-height:1.5; color:var(--dsw-alias-label-primary); }
.te-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.te-row:last-of-type { border-bottom:0; }
.te-row-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.te-label { font-weight:500; }
.te-hint { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.te-note { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
.te-error { margin:0; font-size:12px; line-height:1.5; color:var(--dsw-alias-state-error-primary); }
.te-check { width:16px; height:16px; margin:0; accent-color:var(--dsw-alias-brand-primary); flex:none; }
.te-number { width:88px; flex:none; padding:5px 8px; font:inherit; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); border-radius:6px; }
.te-number:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
.te-footer { display:flex; align-items:center; gap:10px; padding-top:4px; }
.te-save { appearance:none; border:1px solid transparent; border-radius:6px; padding:5px 14px; font:inherit; font-size:13px; line-height:1.5; cursor:pointer; background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-base); }
.te-save:disabled { opacity:0.4; cursor:default; }
.te-save:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
`

// ---------------------------------------------------------------------------
// Browser engine.
// ---------------------------------------------------------------------------

/**
 * Create the Chat DOM engine.
 * @param readConfig Reads the live policy.
 * @returns Engine controls.
 */
function createEngine(readConfig: () => EffectiveConfig): EngineControls {
  const records = new Map<string, BlockRecord>()
  // Body mutations only matter for the Chat column appearing, being replaced,
  // or changing session; in-scope row changes are handled by the scope observer
  // bound below, so this callback avoids scheduling duplicate passes.
  const bodyObserver = new MutationObserver(mutations => {
    if (disposed) return
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') { requestPass(); return }
      const target = mutation.target
      if (observedScope !== undefined && observedScope.isConnected) {
        // Sidebar chats and in-scope rows are handled elsewhere: the former are
        // out of scope by definition, and the bound scope observer already
        // covers its own subtree.
        if (target instanceof Element && target.closest(CHAT_CONTENT_EXCLUSION) !== null) continue
        if (target instanceof Node && observedScope.contains(target)) continue
        requestPass()
        return
      }
      // Nothing is bound yet: only a Chat column or content wrapper appearing
      // can make the engine relevant.
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.matches(CHAT_CONTENT_SELECTOR) || node.matches(CHAT_COLUMN_SELECTOR)
          || node.querySelector(CHAT_CONTENT_SELECTOR) !== null
          || node.querySelector(CHAT_COLUMN_SELECTOR) !== null) {
          requestPass()
          return
        }
      }
    }
  })

  let observedScope: Element | undefined
  let scopeObserver: MutationObserver | undefined
  let frame = 0
  let timer = 0
  let disposed = false
  let pendingPointer: PendingPointer | null = null
  let autoClicking = false

  /** @returns Monotonic now. */
  function now(): number { return performance.now() }

  /** Coalesce one evaluation into the next animation frame. */
  function requestPass(): void {
    if (disposed || frame !== 0) return
    frame = requestAnimationFrame(pass)
  }

  function clearFrame(): void {
    if (frame !== 0) { cancelAnimationFrame(frame); frame = 0 }
  }

  function clearTimer(): void {
    if (timer !== 0) { clearTimeout(timer); timer = 0 }
  }

  /**
   * Whether an element is actually displayed. Used only to choose the active
   * Chat column, never to decide whether a hidden thinking block may be opened.
   * @param element Candidate element.
   * @returns True when browser CSS makes it visible.
   */
  function displayed(element: Element): boolean {
    if (!element.isConnected) return false
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false })
    }
    return element.getClientRects().length > 0
  }

  /**
   * Locate the main Chat flow column, excluding the right-sidebar subagent Chat
   * and nested process-body columns. Falls back to the conversation content
   * wrapper when the slot anchors are not rendered.
   * @returns Main Chat column, or undefined when absent.
   */
  function mainChatRoot(): Element | undefined {
    const columns = document.querySelectorAll(CHAT_COLUMN_SELECTOR)
    for (const column of columns) {
      if (column.closest(CHAT_COLUMN_EXCLUSION) !== null) continue
      if (displayed(column)) return column
    }
    const contents = document.querySelectorAll(CHAT_CONTENT_SELECTOR)
    for (const content of contents) {
      if (content.closest(CHAT_CONTENT_EXCLUSION) !== null) continue
      if (!displayed(content)) continue
      const column = content.querySelector('[data-chat-flow]')
      return column !== null ? column : content
    }
    return undefined
  }

  /**
   * Rebind the fine-grained observer when the active Chat column changes.
   * @param scope Current main Chat column.
   */
  function rebindScope(scope: Element | undefined): void {
    if (scope === observedScope) return
    if (scopeObserver !== undefined) scopeObserver.disconnect()
    observedScope = scope
    if (scope === undefined) { scopeObserver = undefined; return }
    scopeObserver = new MutationObserver(() => { requestPass() })
    scopeObserver.observe(scope, {
      childList: true, subtree: true, attributes: true, attributeFilter: [EXPANDED_ATTRIBUTE],
    })
  }

  /**
   * Resolve the disclosure row and thinking root a DOM event target belongs to.
   * @param target Event target.
   * @returns Disclosure hit, or undefined when the target is not a thinking row.
   */
  function disclosureHit(target: EventTarget | null): DisclosureHit | undefined {
    if (!(target instanceof Element)) return undefined
    const row = target.closest(DISCLOSURE_ROW_SELECTOR)
    if (row === null || row.getAttribute('role') !== 'button') return undefined
    const root = row.closest(THINK_ROOT_SELECTOR)
    return root === null ? undefined : { row, root }
  }

  /**
   * Stable identity for one thinking root.
   * @param root Thinking root.
   * @returns Identity.
   */
  function identityFor(root: Element): string {
    const sessionElement = root.closest('[' + SESSION_ATTRIBUTE + ']')
    const nodeElement = root.closest('[' + NODE_KEY_ATTRIBUTE + ']')
    const scopeSession = sessionElement === null ? '' : (sessionElement.getAttribute(SESSION_ATTRIBUTE) ?? '')
    const nodeKey = nodeElement === null ? '' : (nodeElement.getAttribute(NODE_KEY_ATTRIBUTE) ?? '')
    let ordinal = 0
    if (nodeElement !== null) {
      const siblings = nodeElement.querySelectorAll(THINK_ROOT_SELECTOR)
      for (let index = 0; index < siblings.length; index += 1) {
        if (siblings[index] === root) { ordinal = index; break }
      }
    }
    return formatBlockIdentity(scopeSession, nodeKey, ordinal)
  }

  /**
   * Get or create the state record for one block identity.
   * @param id Block identity.
   * @returns Mutable record.
   */
  function recordFor(id: string): BlockRecord {
    let record = records.get(id)
    if (record === undefined) {
      record = {
        manual: undefined,
        everSuperseded: false,
        supersededAt: 0,
        manualOpenedAt: 0,
        attempts: 0,
        lastExpandAt: -Infinity,
        lastCollapseAt: -Infinity,
        lastExpanded: false,
        giveUp: false,
      }
      records.set(id, record)
    }
    return record
  }

  /**
   * Click the disclosure row once, with retry spacing and a bounded number of
   * attempts so a replaced handler cannot turn into a toggle storm.
   * @param root Thinking root.
   * @param record Per-block state.
   * @param wantExpanded Desired state after the click.
   * @returns True when a click was issued.
   */
  function clickRow(root: Element, record: BlockRecord, wantExpanded: boolean): boolean {
    if (record.giveUp === true || !root.isConnected) return false
    const clock = now()
    const lastAttempt = wantExpanded ? record.lastExpandAt : record.lastCollapseAt
    if (clock - lastAttempt < CLICK_RETRY_MS) return false
    if (record.attempts >= CLICK_ATTEMPT_LIMIT) { record.giveUp = true; return false }
    const row = root.querySelector<HTMLElement>(DISCLOSURE_ROW_SELECTOR)
    if (row === null) { record.giveUp = true; return false }
    if (row.getAttribute('aria-expanded') === (wantExpanded ? 'true' : 'false')) return false
    record.attempts += 1
    if (wantExpanded) record.lastExpandAt = clock
    else record.lastCollapseAt = clock
    autoClicking = true
    try {
      row.click()
    } catch (error) {
      record.giveUp = true
      console.warn('thinking-expand: could not toggle a thinking block', error)
    } finally {
      autoClicking = false
    }
    return true
  }

  /**
   * Record a real user toggle before React handles it.
   * @param root Thinking root whose row was activated.
   * @param manual User intent.
   */
  function commitManual(root: Element, manual: ManualChoice): void {
    const record = recordFor(identityFor(root))
    record.manual = manual
    // With manual-open protection off, the collapse delay must restart from the
    // reader's own open instead of an old supersession timestamp.
    if (manual === 'open') record.manualOpenedAt = now()
    record.attempts = 0
    record.giveUp = false
    requestPass()
  }

  function onPointerDown(event: PointerEvent): void {
    if (disposed || event.button !== 0 || event.isPrimary === false) return
    const hit = disclosureHit(event.target)
    pendingPointer = hit === undefined
      ? null
      : { row: hit.row, x: event.clientX, y: event.clientY }
  }

  function onPointerCancel(): void {
    pendingPointer = null
  }

  function onClick(event: MouseEvent): void {
    // Ignore only the plugin's own synthetic click; any other activation —
    // including an assistive-technology click that has no preceding pointer
    // gesture — is a real user decision and is recorded as manual.
    if (disposed || autoClicking || event.button !== 0) return
    // A click without a real pointer gesture (keyboard or assistive
    // activation) must not be compared against a stale pointerdown position.
    if (event.detail === 0) pendingPointer = null
    const hit = disclosureHit(event.target)
    if (hit === undefined) { pendingPointer = null; return }
    if (pendingPointer !== null) {
      if (pendingPointer.row !== hit.row) { pendingPointer = null; return }
      const dx = event.clientX - pendingPointer.x
      const dy = event.clientY - pendingPointer.y
      pendingPointer = null
      if (Math.hypot(dx, dy) > DRAG_SLOP_PX) return
    }
    commitManual(hit.root, hit.root.hasAttribute(EXPANDED_ATTRIBUTE) ? 'closed' : 'open')
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (disposed || autoClicking || event.repeat) return
    if (event.key !== ' ' && event.key !== 'Enter') return
    const hit = disclosureHit(event.target)
    if (hit === undefined) return
    commitManual(hit.root, hit.root.hasAttribute(EXPANDED_ATTRIBUTE) ? 'closed' : 'open')
  }

  /** One evaluation of the rules against the current DOM and policy. */
  function pass(): void {
    frame = 0
    if (disposed) return
    const config = readConfig()
    if (config.ready !== true || config.enabled !== true) { clearTimer(); return }
    const scope = mainChatRoot()
    rebindScope(scope)
    if (scope === undefined) { clearTimer(); return }

    const rootElements = scope.querySelectorAll(THINK_ROOT_SELECTOR)
    if (rootElements.length === 0) { clearTimer(); return }

    const entries: DomBlockEntry[] = []
    for (const element of rootElements) {
      entries.push({
        element,
        id: identityFor(element),
        expanded: element.hasAttribute(EXPANDED_ATTRIBUTE),
        isLatest: false,
      })
    }
    entries[entries.length - 1].isLatest = true
    const clock = now()

    // Reset the bounded click retry budget whenever a block's rendered state
    // changed since the previous pass (a successful toggle or a user toggle).
    for (const entry of entries) {
      const record = recordFor(entry.id)
      if (record.lastExpanded !== entry.expanded) {
        record.lastExpanded = entry.expanded
        record.attempts = 0
        record.giveUp = false
      }
    }

    for (const entry of entries) {
      const record = recordFor(entry.id)
      if (entry.isLatest) {
        record.supersededAt = 0
        if (shouldAutoExpand(entry, record, config)) clickRow(entry.element, record, true)
      } else {
        // Once a block has been observed with a newer block after it, it never
        // becomes the auto-expansion target again, even if the newer root is
        // briefly absent during a remount or retry.
        record.everSuperseded = true
        if (entry.expanded && record.supersededAt === 0) record.supersededAt = clock
      }
    }

    const plan = planCollapses(entries, records, config, clock)
    for (const id of plan.dueIds) {
      const entry = entries.find(candidate => candidate.id === id)
      const record = entry === undefined ? undefined : records.get(id)
      if (entry !== undefined && record !== undefined) clickRow(entry.element, record, false)
    }

    clearTimer()
    let nextAt = plan.nextDue
    if (plan.dueIds.length > 0) {
      const retryAt = clock + RULE_RECHECK_MS
      nextAt = nextAt === undefined ? retryAt : Math.min(nextAt, retryAt)
    }
    // A lost expand click must not leave the current block collapsed until an
    // unrelated mutation happens; retry once per CLICK_RETRY_MS window.
    const latestEntry = entries[entries.length - 1]
    const latestRecord = records.get(latestEntry.id)
    if (latestRecord !== undefined && latestRecord.giveUp !== true
      && shouldAutoExpand(latestEntry, latestRecord, config)) {
      const expandRetryAt = clock + CLICK_RETRY_MS + 100
      nextAt = nextAt === undefined ? expandRetryAt : Math.min(nextAt, expandRetryAt)
    }
    if (nextAt !== undefined) {
      timer = setTimeout(() => { timer = 0; requestPass() }, Math.max(16, nextAt - now()))
    }
    if (records.size > MAX_REMEMBERED_BLOCKS) {
      const live = new Set(entries.map(entry => entry.id))
      for (const id of [...records.keys()]) if (!live.has(id)) records.delete(id)
    }
  }

  if (document.body !== null) {
    bodyObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: [SESSION_ATTRIBUTE],
    })
  } else {
    // Defensive for a carrier that activates plugins before the body exists.
    document.addEventListener('DOMContentLoaded', () => {
      if (!disposed && document.body !== null) {
        bodyObserver.observe(document.body, {
          childList: true, subtree: true, attributes: true, attributeFilter: [SESSION_ATTRIBUTE],
        })
      }
    }, { once: true })
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointercancel', onPointerCancel, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeyDown, true)

  /** Stop observing and release every resource owned by the engine. */
  function dispose(): void {
    if (disposed) return
    disposed = true
    clearFrame()
    clearTimer()
    bodyObserver.disconnect()
    if (scopeObserver !== undefined) scopeObserver.disconnect()
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointercancel', onPointerCancel, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    records.clear()
  }

  return {
    start() { requestPass() },
    applyConfig() { requestPass() },
    dispose,
  }
}

// ---------------------------------------------------------------------------
// Client plugin: settings panel, locale, configuration subscription, engine.
// ---------------------------------------------------------------------------

/**
 * Browser plugin factory registered with the client module loader.
 * @param require Client module table resolver.
 * @returns Client plugin.
 */
function factory(require: RequireFn): ClientPlugin {
  const React = require('react') as ReactModule
  const { useEffect, useId, useState } = React

  /**
   * Plugins-page configuration form for this bundle.
   * @param props Slot props.
   * @returns Rendered form.
   */
  function SettingsPanel(props: SettingsPanelProps): ReactNS.ReactNode {
    const { view, configForm } = props
    const t = typeof props.t === 'function' ? props.t : (key: string) => key
    const [snapshot, setSnapshot] = useState<ConfigSnapshot>(() => configForm.getSnapshot())
    const [draft, setDraft] = useState<SettingsDraft | null>(null)
    const [edited, setEdited] = useState<EditedFields>({})
    const [baseRevision, setBaseRevision] = useState<number | undefined>(undefined)
    const [baseAccepted, setBaseAccepted] = useState<unknown>(null)
    const [saving, setSaving] = useState(false)
    const [failed, setFailed] = useState(false)
    const delayInputId = useId()

    useEffect(() => {
      setSnapshot(configForm.getSnapshot())
      return configForm.subscribe(() => { setSnapshot(configForm.getSnapshot()) })
    }, [configForm])

    // Adopt externally accepted values for fields the reader did not edit while
    // keeping their staged edits for the fields they did edit. If a concurrent
    // write only touched untouched fields, the write fence can advance: the
    // fields this save protects were not changed, so it no longer needs to
    // refuse the stale revision.
    useEffect(() => {
      if (snapshot.status !== 'ready' || snapshot.value === undefined) return
      setDraft(previous => reconcileSettingsDraft(previous, snapshot.value, edited))
      if (baseRevision !== undefined && baseAccepted !== null
        && snapshot.revision !== baseRevision
        && editedAcceptedUnchanged(edited, snapshot.value, baseAccepted)) {
        setBaseRevision(snapshot.revision)
        setBaseAccepted(snapshot.value)
      }
    }, [snapshot, edited, baseRevision, baseAccepted])

    if (view !== 'page') return null
    const styleElement = React.createElement('style', {
      dangerouslySetInnerHTML: { __html: SETTINGS_CSS },
    })
    const panel = (children: ReactNS.ReactNode[]): ReactNS.ReactNode =>
      React.createElement('div', { className: 'te-panel' }, styleElement, ...children)

    if (snapshot.status === 'loading') {
      return panel([React.createElement('p', { className: 'te-note', role: 'status' }, t('loading'))])
    }
    if (snapshot.status !== 'ready') {
      return panel([React.createElement('p', { className: 'te-note', role: 'status' }, t('unavailable'))])
    }

    const accepted = snapshot.value
    const writable = snapshot.writable !== false
    const settings = draft ?? settingsDraftFromValue(accepted)
    const operations = accepted === undefined ? [] : planSettingsWrite(settings, accepted, edited)
    const delaySeconds = parseCollapseDelay(settings.delayText)
    const disabled = !writable || saving
    const blocked = disabled || delaySeconds === undefined || operations.length === 0

    const editField = (field: keyof EditedFields, patch: Partial<SettingsDraft>): void => {
      setFailed(false)
      setDraft(current => ({ ...(current ?? settingsDraftFromValue(accepted)), ...patch }))
      setEdited(current => markEdited(current, field))
      if (baseRevision === undefined) {
        setBaseRevision(snapshot.revision)
        setBaseAccepted(accepted ?? null)
      } else if (baseAccepted === null) {
        setBaseAccepted(accepted ?? null)
      }
    }

    const fail = (): void => {
      // Keep the staged edits so a refused or failed save is not destructive;
      // the fence advances to the current revision so a retry is not forced to
      // repeat the same stale-revision refusal.
      setSaving(false)
      setFailed(true)
      const current = configForm.getSnapshot()
      setBaseRevision(current.revision)
      setBaseAccepted(current.value ?? null)
    }

    const save = (): void => {
      if (blocked) return
      setSaving(true)
      setFailed(false)
      configForm.mutate(operations, baseRevision ?? snapshot.revision).then(acceptedChange => {
        if (acceptedChange === true) {
          setSaving(false)
          setEdited({})
          setBaseRevision(undefined)
          setBaseAccepted(null)
          return
        }
        fail()
      }, fail)
    }

    const checkboxRow = (
      label: string,
      hint: string,
      checked: boolean,
      onChecked: (checked: boolean) => void,
    ): ReactNS.ReactNode => React.createElement('div', { className: 'te-row' },
      React.createElement('div', { className: 'te-row-main' },
        React.createElement('span', { className: 'te-label' }, label),
        React.createElement('p', { className: 'te-hint' }, hint)),
      React.createElement('input', {
        className: 'te-check', type: 'checkbox', checked, disabled,
        'aria-label': label,
        onChange: event => { onChecked(event.target.checked) },
      }))

    return panel([
      writable ? null : React.createElement('p', { className: 'te-note', role: 'status' }, t('readOnly')),
      checkboxRow(t('enabled'), t('enabledHint'), settings.enabled, value => { editField('enabled', { enabled: value }) }),
      React.createElement('div', { className: 'te-row' },
        React.createElement('div', { className: 'te-row-main' },
          React.createElement('label', { className: 'te-label', htmlFor: delayInputId }, t('collapseDelay')),
          React.createElement('p', { className: 'te-hint' }, t('delayHint'))),
        React.createElement('input', {
          id: delayInputId,
          className: 'te-number',
          type: 'number',
          min: COLLAPSE_DELAY_MIN_SECONDS,
          max: COLLAPSE_DELAY_MAX_SECONDS,
          step: 1,
          value: settings.delayText,
          disabled,
          'aria-invalid': delaySeconds === undefined || undefined,
          onChange: event => { editField('delayText', { delayText: event.target.value }) },
        })),
      delaySeconds === undefined
        ? React.createElement('p', { className: 'te-error', role: 'status' }, t('invalidDelay'))
        : null,
      checkboxRow(t('manualOpenProtection'), t('manualOpenProtectionHint'),
        settings.manualOpenProtection, value => { editField('manualOpenProtection', { manualOpenProtection: value }) }),
      React.createElement('div', { className: 'te-footer' },
        failed ? React.createElement('p', { className: 'te-error', role: 'status' }, t('saveFailed')) : null,
        React.createElement('button', {
          type: 'button', className: 'te-save', disabled: blocked, onClick: save,
        }, saving ? t('saving') : t('save'))),
    ])
  }

  return {
    inject: ['slots', 'locale', 'configForms'],
    apply(ctx: ClientContext): void {
      const configForm = ctx.configForms.get(SETTINGS_ENTRY_ID)
      let config = normalizeConfigSnapshot(configForm.getSnapshot())
      const engine = createEngine(() => config)

      ctx.effect(() => {
        const stop = configForm.subscribe(() => {
          config = normalizeConfigSnapshot(configForm.getSnapshot())
          engine.applyConfig()
        })
        return () => { stop(); engine.dispose() }
      }, 'thinking-expand: configuration')

      // The locale service keeps no ownership of registered dictionaries: a
      // plain registration would throw on the browser's re-apply after a
      // disable/enable cycle, so the disposer must be a fiber effect.
      ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES), 'thinking-expand: locale')

      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE_NAME,
        locale: LOCALE_NAMESPACE,
        inject: () => ({ configForm }),
      }, SettingsPanel))

      engine.start()
    },
  }
}

// ---------------------------------------------------------------------------
// Registration: the browser loader executes the built bundle as a classic
// script. Node never loads this file; the rules are tested from `rules.ts`.
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
  window.__ModuleLoader__.load({ id: PACKAGE_NAME, factory })
}
