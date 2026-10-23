/**
 * Minimal local declarations of the DSH plugin contracts this bundle uses.
 *
 * These are the exact slices of the DSH 0.2.1-rc.2 Host and Client plugin
 * surfaces that Thinking Focus depends on. They are declared locally because
 * the matching type packages are release candidates of the harness itself, not
 * part of the public plugin toolchain; the mental-debug note in the workspace
 * verifies each shape against the pinned DSH source.
 */
import type { SettingsWrite } from '../rules.ts'

/** Cleanup callback returned by `ctx.effect` and DSH service registrations. */
export type Disposable = () => void

/** Resolver for platform modules (`react`) and this bundle's own modules. */
export type RequireFn = (name: string) => unknown

/** Client plugin object consumed by the browser module loader. */
export interface ClientPlugin {
  inject: string[]
  apply(ctx: ClientContext): void
}

/** Registration passed to `window.__ModuleLoader__.load`. */
export interface ClientPluginRegistration {
  id: string
  factory: (require: RequireFn) => ClientPlugin
}

/** Browser classic-script module loader (`window.__ModuleLoader__`). */
export interface ModuleLoader {
  load(registration: ClientPluginRegistration): void
}

/** Snapshot of one settings configuration form. */
export interface ConfigSnapshot {
  status: 'loading' | 'ready' | 'unavailable' | (string & {})
  value: unknown
  revision?: number
  writable?: boolean
}

/** The `configForms` client service for one profile entry. */
export interface ConfigForm {
  getSnapshot(): ConfigSnapshot
  subscribe(listener: () => void): Disposable
  mutate(operations: readonly SettingsWrite[], expectedRevision?: number): Promise<boolean>
}

/** Registration options for a keyed `slots` root slot. */
export interface SlotRegistration {
  name: string
  key: string
  locale: string
  inject: () => Record<string, unknown>
}

/** The `slots` client service, limited to what this bundle registers. */
export interface SlotsService {
  inject(name: string, callback: () => Disposable): Disposable
  register<Props>(registration: SlotRegistration, component: (props: Props) => unknown): Disposable
}

/** The `locale` client service, limited to dictionary registration. */
export interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): Disposable
}

/** The `configForms` client service. */
export interface ConfigFormsService {
  get(entryId: string): ConfigForm
}

/** The client plugin context services this bundle injects. */
export interface ClientContext {
  slots: SlotsService
  locale: LocaleService
  configForms: ConfigFormsService
  effect(execute: () => Disposable | void, label?: string): Disposable
}

declare global {
  interface Window {
    __ModuleLoader__?: ModuleLoader
  }
}
