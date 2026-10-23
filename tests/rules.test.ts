/**
 * Pure-rule tests for the Thinking Focus decision layer.
 *
 * These import `src/rules.ts` directly: no DOM, React, or DSH service is
 * emulated, because the rules are the whole of the browser engine's policy.
 * The shipped classic-script bundle is covered separately by
 * `classic-script.test.ts`, and the manifest invariants by `manifest.test.ts`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import * as rules from '../src/rules.ts'
import type {
  BlockEntry,
  BlockRecord,
  EffectiveConfig,
  SettingsDraft,
} from '../src/rules.ts'

const READY: EffectiveConfig = Object.freeze({
  ready: true,
  status: 'ready',
  enabled: true,
  collapseDelaySeconds: 2,
  manualOpenProtection: true,
})

/** @returns A block record with the given overrides. */
function record(overrides: Partial<BlockRecord> = {}): BlockRecord {
  return {
    manual: undefined,
    everSuperseded: false,
    supersededAt: 1000,
    manualOpenedAt: 0,
    attempts: 0,
    lastExpandAt: -Infinity,
    lastCollapseAt: -Infinity,
    lastExpanded: true,
    giveUp: false,
    ...overrides,
  }
}

/** @returns An entry descriptor with the given overrides. */
function entry(overrides: Partial<BlockEntry> = {}): BlockEntry {
  return { id: 'block', expanded: true, isLatest: false, ...overrides }
}

test('a loading snapshot never activates the engine', () => {
  const config = rules.normalizeConfigSnapshot({ status: 'loading', value: undefined })
  assert.equal(config.ready, false)
  assert.equal(config.enabled, true)
  assert.equal(config.collapseDelaySeconds, 2)
  assert.equal(config.manualOpenProtection, true)
})

test('a ready snapshot applies defaults for missing fields', () => {
  assert.deepEqual(rules.normalizeConfigSnapshot({ status: 'ready', value: {} }), READY)
  assert.deepEqual(
    rules.normalizeConfigSnapshot({
      status: 'ready',
      value: { enabled: false, collapseDelay: 30, manualOpenProtection: false },
    }),
    { ...READY, enabled: false, collapseDelaySeconds: 30, manualOpenProtection: false },
  )
  assert.deepEqual(
    rules.normalizeConfigSnapshot({ status: 'unavailable', value: undefined }),
    { ready: false, status: 'unavailable', enabled: true, collapseDelaySeconds: 2, manualOpenProtection: true },
  )
})

test('delay values are clamped and invalid input is rejected, not coerced', () => {
  assert.equal(rules.clampCollapseDelay(-5), 0)
  assert.equal(rules.clampCollapseDelay(999), 60)
  assert.equal(rules.clampCollapseDelay(2.6), 3)
  assert.equal(rules.clampCollapseDelay(Number.NaN), 2)
  assert.equal(rules.clampCollapseDelay('7'), 2)
  assert.equal(rules.parseCollapseDelay('0'), 0)
  assert.equal(rules.parseCollapseDelay('60'), 60)
  assert.equal(rules.parseCollapseDelay('02'), 2)
  assert.equal(rules.parseCollapseDelay('2.0'), 2)
  assert.equal(rules.parseCollapseDelay('61'), undefined)
  assert.equal(rules.parseCollapseDelay('2.5'), undefined)
  assert.equal(rules.parseCollapseDelay(''), undefined)
  assert.equal(rules.parseCollapseDelay('  '), undefined)
  assert.equal(rules.parseCollapseDelay('abc'), undefined)
})

test('block identity distinguishes session, node, and ordinal', () => {
  const base = rules.formatBlockIdentity('session-a', 'node-1', 0)
  assert.notEqual(base, rules.formatBlockIdentity('session-b', 'node-1', 0))
  assert.notEqual(base, rules.formatBlockIdentity('session-a', 'node-2', 0))
  assert.notEqual(base, rules.formatBlockIdentity('session-a', 'node-1', 1))
  assert.equal(base, rules.formatBlockIdentity('session-a', 'node-1', 0))
})

test('only the collapsed, non-manually-closed current block auto-expands', () => {
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: true, expanded: false }), record({ manual: undefined }), READY), true)
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: true, expanded: false }), record({ manual: 'closed' }), READY), false)
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: false, expanded: false }), record({ manual: undefined }), READY), false)
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: true, expanded: true }), record({ manual: undefined }), READY), false)
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: true, expanded: false }), record({ giveUp: true }), READY), false)
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: true, expanded: false }), record({ everSuperseded: true }), READY), false)
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: true, expanded: false }), record(), { ...READY, enabled: false }), false)
  assert.equal(rules.shouldAutoExpand(entry({ isLatest: true, expanded: false }), record(), { ...READY, ready: false }), false)
})

test('an older block is due only after its delay, and manual opens are protected', () => {
  const due = (
    entryOverrides: Partial<BlockEntry>,
    recordOverrides: Partial<BlockRecord>,
    configOverrides: Partial<EffectiveConfig>,
  ): number | undefined => rules.collapseDueAt(
    entry(entryOverrides), record(recordOverrides), { ...READY, ...configOverrides },
  )
  assert.equal(due({}, {}, {}), 3000)
  assert.equal(due({ isLatest: true }, {}, {}), undefined)
  assert.equal(due({ expanded: false }, {}, {}), undefined)
  assert.equal(due({}, { supersededAt: 0 }, {}), undefined)
  assert.equal(due({}, { giveUp: true }, {}), undefined)
  assert.equal(due({}, { manual: 'open' }, {}), undefined)
  assert.equal(due({}, { manual: 'open' }, { manualOpenProtection: false }), 3000)
  assert.equal(due({}, {}, { collapseDelaySeconds: 0 }), 1000)
  // A manual reopen (protection off) restarts the delay from the reopen.
  assert.equal(due({}, { manualOpenedAt: 2100 }, { manualOpenProtection: false }), 4100)
  assert.equal(due({}, { manualOpenedAt: 500 }, { manualOpenProtection: false }), 3000)
})

test('collapse plans separate due blocks from the next future deadline', () => {
  const entries: BlockEntry[] = [
    entry({ id: 'older-a' }),
    entry({ id: 'older-b' }),
    entry({ id: 'current', isLatest: true, expanded: false }),
  ]
  const records = new Map<string, BlockRecord>([
    ['older-a', record({ supersededAt: 500 })],
    ['older-b', record({ supersededAt: 1000 })],
    ['current', record({ supersededAt: 0, lastExpanded: false })],
  ])
  // older-a is due at 500 + 2000 ms; older-b at 1000 + 2000 ms.
  const future = rules.planCollapses(entries, records, READY, 1500)
  assert.deepEqual(future.dueIds, [])
  assert.equal(future.nextDue, 2500)
  const due = rules.planCollapses(entries, records, READY, 2600)
  assert.deepEqual(due.dueIds, ['older-a'])
  assert.equal(due.nextDue, 3000)
  assert.deepEqual(rules.planCollapses([], new Map(), READY, 0), { dueIds: [], nextDue: undefined })
})

test('settings drafts mirror accepted values and report dirtiness', () => {
  const draft: SettingsDraft = { enabled: true, delayText: '2', manualOpenProtection: true }
  assert.deepEqual(rules.settingsDraftFromValue({}), draft)
  assert.deepEqual(
    rules.settingsDraftFromValue({ enabled: false, collapseDelay: 9, manualOpenProtection: false }),
    { enabled: false, delayText: '9', manualOpenProtection: false },
  )
  assert.equal(rules.settingsDraftIsDirty(draft, { enabled: true, collapseDelay: 2, manualOpenProtection: true }), false)
  assert.equal(rules.settingsDraftIsDirty({ ...draft, delayText: '3' }, { collapseDelay: 2 }), true)
  assert.equal(rules.settingsDraftIsDirty({ ...draft, enabled: false }, { collapseDelay: 2 }), true)
})

test('external accepted changes are adopted only for untouched fields', () => {
  const draft: SettingsDraft = { enabled: true, delayText: '5', manualOpenProtection: true }
  const accepted = { enabled: false, collapseDelay: 2, manualOpenProtection: true }
  assert.deepEqual(
    rules.reconcileSettingsDraft(draft, accepted, { delayText: true }),
    { enabled: false, delayText: '5', manualOpenProtection: true },
  )
  assert.deepEqual(
    rules.reconcileSettingsDraft(draft, accepted, {}),
    { enabled: false, delayText: '2', manualOpenProtection: true },
  )
  assert.deepEqual(
    rules.reconcileSettingsDraft(draft, accepted, { enabled: true, delayText: true }),
    { enabled: true, delayText: '5', manualOpenProtection: true },
  )
})

test('settings write plans only edited fields that differ from accepted values', () => {
  const accepted = { enabled: true, collapseDelay: 2, manualOpenProtection: true }
  assert.deepEqual(
    rules.planSettingsWrite({ enabled: false, delayText: '2', manualOpenProtection: true }, accepted, { enabled: true }),
    [{ op: 'set', path: ['enabled'], value: false }],
  )
  assert.deepEqual(
    rules.planSettingsWrite({ enabled: true, delayText: '2', manualOpenProtection: true }, accepted, { enabled: true }),
    [],
  )
  assert.deepEqual(
    rules.planSettingsWrite({ enabled: true, delayText: '9', manualOpenProtection: false }, accepted,
      { delayText: true, manualOpenProtection: true }),
    [
      { op: 'set', path: ['manualOpenProtection'], value: false },
      { op: 'set', path: ['collapseDelay'], value: 9 },
    ],
  )
  // Invalid delay text produces no write; the form blocks Save instead.
  assert.deepEqual(
    rules.planSettingsWrite({ enabled: true, delayText: 'x', manualOpenProtection: true }, accepted, { delayText: true }),
    [],
  )
  // Re-typing the accepted delay produces no write either.
  assert.deepEqual(
    rules.planSettingsWrite({ enabled: true, delayText: '2', manualOpenProtection: true }, accepted, { delayText: true }),
    [],
  )
  // An invalid delay alongside another edited field still plans that other op.
  assert.deepEqual(
    rules.planSettingsWrite({ enabled: false, delayText: 'x', manualOpenProtection: true }, accepted,
      { enabled: true, delayText: true }),
    [{ op: 'set', path: ['enabled'], value: false }],
  )
})

test('a stale write fence may advance when only untouched fields changed externally', () => {
  const base = { enabled: true, collapseDelay: 2, manualOpenProtection: true }
  const external = { enabled: false, collapseDelay: 2, manualOpenProtection: true }
  assert.equal(rules.editedAcceptedUnchanged({ delayText: true }, external, base), true)
  assert.equal(rules.editedAcceptedUnchanged({ enabled: true }, external, base), false)
  assert.equal(rules.editedAcceptedUnchanged({}, external, base), true)
  const delayExternal = { enabled: true, collapseDelay: 5, manualOpenProtection: true }
  assert.equal(rules.editedAcceptedUnchanged({ delayText: true }, delayExternal, base), false)
})
