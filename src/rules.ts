/**
 * Thinking Focus — pure decision rules.
 *
 * This module never touches the DOM, React, or DSH services. The browser engine
 * in `client.ts` feeds it DOM-derived descriptors and then performs the clicks
 * the rules return; `tests/rules.test.ts` exercises the same functions in Node
 * with no browser emulation.
 */

/** Accepted bounds for the configurable collapse delay, in whole seconds. */
export const COLLAPSE_DELAY_SECONDS = Object.freeze({ min: 0, max: 60, default: 2 })

export const COLLAPSE_DELAY_MIN_SECONDS = COLLAPSE_DELAY_SECONDS.min
export const COLLAPSE_DELAY_MAX_SECONDS = COLLAPSE_DELAY_SECONDS.max
export const COLLAPSE_DELAY_DEFAULT_SECONDS = COLLAPSE_DELAY_SECONDS.default

/** Default engine policy, used until a `ready` settings section is accepted. */
export const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  collapseDelaySeconds: COLLAPSE_DELAY_DEFAULT_SECONDS,
  manualOpenProtection: true,
})

/** Effective engine policy derived from a configuration-form snapshot. */
export interface EffectiveConfig {
  /** True only for an accepted (`ready`) section; other states keep the engine idle. */
  ready: boolean
  /** Snapshot status (`loading`, `ready`, `unavailable`, …). */
  status: string
  enabled: boolean
  collapseDelaySeconds: number
  manualOpenProtection: boolean
}

/** The parts of a configuration-form snapshot that the rules read. */
export interface ConfigSnapshotLike {
  status?: string
  value?: unknown
}

/** One thinking block as seen in the current DOM pass. */
export interface BlockEntry {
  /** Stable identity (`session + node + ordinal`). */
  readonly id: string
  /** Whether the disclosure is currently expanded. */
  readonly expanded: boolean
  /** Whether this block is the last thinking block of the pass. */
  readonly isLatest: boolean
}

/** How a block's disclosure was last toggled by hand. */
export type ManualChoice = 'open' | 'closed'

/** Mutable per-block state owned by the browser engine. */
export interface BlockRecord {
  manual: ManualChoice | undefined
  everSuperseded: boolean
  supersededAt: number
  manualOpenedAt: number
  attempts: number
  lastExpandAt: number
  lastCollapseAt: number
  lastExpanded: boolean
  giveUp: boolean
}

/** A collapse plan: blocks due now plus the next future deadline. */
export interface CollapsePlan {
  dueIds: string[]
  nextDue: number | undefined
}

/** Draft state of the settings form. */
export interface SettingsDraft {
  enabled: boolean
  delayText: string
  manualOpenProtection: boolean
}

/** Fields the reader has edited in the current settings session. */
export interface EditedFields {
  enabled?: boolean
  delayText?: boolean
  manualOpenProtection?: boolean
}

/** One settings write operation accepted by the Host. */
export interface SettingsWrite {
  op: 'set'
  path: string[]
  value: unknown
}

interface ValueRecord {
  [key: string]: unknown
}

/** @returns The value if it is a non-null object, otherwise an empty record. */
function asRecord(value: unknown): ValueRecord {
  return value !== null && typeof value === 'object' ? value as ValueRecord : {}
}

/**
 * Clamp a Host-provided delay into the accepted integer seconds range.
 * @param value Candidate delay.
 * @returns Accepted whole seconds.
 */
export function clampCollapseDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return COLLAPSE_DELAY_DEFAULT_SECONDS
  return Math.min(COLLAPSE_DELAY_MAX_SECONDS, Math.max(COLLAPSE_DELAY_MIN_SECONDS, Math.round(value)))
}

/**
 * Normalize a configuration-form snapshot into the engine's policy. The engine
 * only activates on an accepted (`ready`) section: while loading or when the
 * profile does not serve the namespace there is no trustworthy value, and
 * acting on defaults could contradict a saved `enabled: false`.
 * @param snapshot Form snapshot.
 * @returns Effective policy.
 */
export function normalizeConfigSnapshot(snapshot?: ConfigSnapshotLike): EffectiveConfig {
  const status = typeof snapshot?.status === 'string' ? snapshot.status : 'loading'
  if (status !== 'ready') {
    return { ready: false, status, ...DEFAULT_POLICY }
  }
  const value = asRecord(snapshot?.value)
  return {
    ready: true,
    status,
    enabled: value.enabled !== false,
    collapseDelaySeconds: clampCollapseDelay(value.collapseDelay),
    manualOpenProtection: value.manualOpenProtection !== false,
  }
}

/**
 * Parse the settings form's delay text. Whole seconds (an optional `.0` tail
 * from a number input is accepted); invalid input is rejected instead of being
 * coerced to zero.
 * @param text Input text.
 * @returns Accepted seconds, or undefined for invalid input.
 */
export function parseCollapseDelay(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^\d{1,2}(?:\.0+)?$/.test(trimmed)) return undefined
  const seconds = Number(trimmed)
  return seconds >= COLLAPSE_DELAY_MIN_SECONDS && seconds <= COLLAPSE_DELAY_MAX_SECONDS ? seconds : undefined
}

/**
 * Stable identity of one thinking block across element remounts.
 * @param sessionId Conversation session id.
 * @param nodeKey Chat node key of the owning seat.
 * @param ordinal Position among the seat's thinking roots.
 * @returns Identity string.
 */
export function formatBlockIdentity(sessionId: string, nodeKey: string, ordinal: number): string {
  return sessionId + '\u0000' + nodeKey + '\u0000' + String(ordinal)
}

/**
 * Whether a block should be auto-expanded. A block that ever lost latest status
 * is never auto-expanded again, so a momentarily missing newest row cannot hand
 * the current slot back to an older block.
 * @param entry Block descriptor.
 * @param record Per-block state.
 * @param config Effective policy.
 * @returns True when the block is the collapsed current block to open.
 */
export function shouldAutoExpand(entry: BlockEntry, record: BlockRecord, config: EffectiveConfig): boolean {
  return config.ready
    && config.enabled
    && entry.isLatest
    && entry.expanded === false
    && record.manual !== 'closed'
    && record.giveUp !== true
    && record.everSuperseded !== true
}

/**
 * When an older block becomes eligible for auto-collapse, if ever. Any expanded
 * non-latest block is eligible: provenance of a pre-expanded block is unknown,
 * and the requirement is that older blocks close unless the reader opened them.
 * @param entry Block descriptor.
 * @param record Per-block state.
 * @param config Effective policy.
 * @returns Due time, or undefined when the block is exempt.
 */
export function collapseDueAt(entry: BlockEntry, record: BlockRecord, config: EffectiveConfig): number | undefined {
  if (entry.isLatest || entry.expanded === false) return undefined
  if (record.giveUp === true) return undefined
  if (record.manual === 'open' && config.manualOpenProtection) return undefined
  // The delay runs from whichever came later: losing latest status, or the
  // reader's own open (important when manual-open protection is off).
  const reference = Math.max(record.supersededAt, record.manualOpenedAt)
  if (reference === 0) return undefined
  return reference + config.collapseDelaySeconds * 1000
}

/**
 * Split eligible blocks into those due now and the earliest future due time.
 * @param entries Block descriptors.
 * @param records Per-block state by identity.
 * @param config Effective policy.
 * @param now Current monotonic time.
 * @returns Collapse plan.
 */
export function planCollapses(
  entries: readonly BlockEntry[],
  records: ReadonlyMap<string, BlockRecord>,
  config: EffectiveConfig,
  now: number,
): CollapsePlan {
  const dueIds: string[] = []
  let nextDue: number | undefined
  for (const entry of entries) {
    const record = records.get(entry.id)
    if (record === undefined) continue
    const dueAt = collapseDueAt(entry, record, config)
    if (dueAt === undefined) continue
    if (dueAt <= now) dueIds.push(entry.id)
    else if (nextDue === undefined || dueAt < nextDue) nextDue = dueAt
  }
  return { dueIds, nextDue }
}

/**
 * Draft state of the settings form from accepted values.
 * @param value Accepted section.
 * @returns Draft.
 */
export function settingsDraftFromValue(value: unknown): SettingsDraft {
  const source = asRecord(value)
  return {
    enabled: source.enabled !== false,
    delayText: String(clampCollapseDelay(source.collapseDelay)),
    manualOpenProtection: source.manualOpenProtection !== false,
  }
}

/**
 * Compare two settings drafts.
 * @param left Draft.
 * @param right Draft.
 * @returns True when every field matches.
 */
export function sameSettingsDraft(left: SettingsDraft, right: SettingsDraft): boolean {
  return left.enabled === right.enabled
    && left.manualOpenProtection === right.manualOpenProtection
    && left.delayText === right.delayText
}

/**
 * Whether a draft differs from the accepted section.
 * @param draft Draft.
 * @param value Accepted section.
 * @returns True when saving would write a change.
 */
export function settingsDraftIsDirty(draft: SettingsDraft, value: unknown): boolean {
  return !sameSettingsDraft(draft, settingsDraftFromValue(value))
}

/**
 * Adopt externally accepted values for fields the reader has not edited, while
 * keeping the reader's staged edits for fields they did touch.
 * @param draft Current draft.
 * @param accepted Accepted section.
 * @param edited Fields the reader changed.
 * @returns Reconciled draft.
 */
export function reconcileSettingsDraft(
  draft: SettingsDraft | null,
  accepted: unknown,
  edited: EditedFields,
): SettingsDraft {
  if (draft === null) return settingsDraftFromValue(accepted)
  const acceptedDraft = settingsDraftFromValue(accepted)
  const next: SettingsDraft = { ...draft }
  let changed = false
  if (edited.enabled !== true && next.enabled !== acceptedDraft.enabled) {
    next.enabled = acceptedDraft.enabled
    changed = true
  }
  if (edited.manualOpenProtection !== true && next.manualOpenProtection !== acceptedDraft.manualOpenProtection) {
    next.manualOpenProtection = acceptedDraft.manualOpenProtection
    changed = true
  }
  if (edited.delayText !== true && next.delayText !== acceptedDraft.delayText) {
    next.delayText = acceptedDraft.delayText
    changed = true
  }
  return changed ? next : draft
}

/**
 * Plan the minimal settings write: only fields the reader edited and that differ
 * from the accepted section are written, so inherited values stay inherited.
 * @param draft Draft.
 * @param accepted Accepted section.
 * @param edited Fields the reader changed.
 * @returns Ordered write operations.
 */
export function planSettingsWrite(draft: SettingsDraft, accepted: unknown, edited: EditedFields): SettingsWrite[] {
  const acceptedDraft = settingsDraftFromValue(accepted)
  const operations: SettingsWrite[] = []
  if (edited.enabled === true && draft.enabled !== acceptedDraft.enabled) {
    operations.push({ op: 'set', path: ['enabled'], value: draft.enabled })
  }
  if (edited.manualOpenProtection === true && draft.manualOpenProtection !== acceptedDraft.manualOpenProtection) {
    operations.push({ op: 'set', path: ['manualOpenProtection'], value: draft.manualOpenProtection })
  }
  if (edited.delayText === true) {
    const delay = parseCollapseDelay(draft.delayText)
    if (delay !== undefined && delay !== Number(acceptedDraft.delayText)) {
      operations.push({ op: 'set', path: ['collapseDelay'], value: delay })
    }
  }
  return operations
}

/**
 * Whether every field the reader is editing still has the accepted value it had
 * when editing started. When true, an external write only touched untouched
 * fields, so the write fence can safely advance to the new revision.
 * @param edited Fields the reader changed.
 * @param accepted Current accepted section.
 * @param baseAccepted Accepted section captured at the first edit.
 * @returns True when no edited field's accepted value changed.
 */
export function editedAcceptedUnchanged(
  edited: EditedFields,
  accepted: unknown,
  baseAccepted: unknown,
): boolean {
  const current = settingsDraftFromValue(accepted)
  const base = settingsDraftFromValue(baseAccepted)
  if (edited.enabled === true && current.enabled !== base.enabled) return false
  if (edited.manualOpenProtection === true && current.manualOpenProtection !== base.manualOpenProtection) return false
  if (edited.delayText === true && Number(current.delayText) !== Number(base.delayText)) return false
  return true
}
