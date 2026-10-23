/**
 * Thinking Focus — Host half.
 *
 * Owns the durable configuration schema shown on the Plugins page and marks the
 * bundle as carrying its own configuration page so no schema-generated page is
 * offered. The browser half (`client.ts`) reads these values through the
 * settings configuration form and owns every display behavior; this half
 * registers no model-facing, Session-facing, or tool behavior.
 */
import z from '@deepseek-ai/schemastery';
/** Cleanup callback returned by `ctx.effect`. */
export type Disposable = () => void;
/** The subset of the DSH settings service that this bundle uses. */
export interface SettingsService {
    configure(options: {
        auto: boolean;
    }, fiber: unknown): Disposable;
}
/** The subset of the DSH Host plugin context that this bundle uses. */
export interface HostContext {
    readonly fiber: unknown;
    effect(execute: () => Disposable | void, label?: string): Disposable;
    inject(names: readonly string[], callback: (ctx: HostContext & {
        settings: SettingsService;
    }) => void): void;
}
/** Accepted bounds for the configurable collapse delay. */
export declare const COLLAPSE_DELAY_SECONDS: Readonly<{
    min: 0;
    max: 60;
    default: 2;
}>;
/**
 * Effective settings. Only `.volatile()` leaves reach the browser: the settings
 * service projects the form from them, and edits apply without remounting the
 * plugin row.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    collapseDelay: z<number, number, "volatile-defined">;
    manualOpenProtection: z<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    collapseDelay: z<number, number, "volatile-defined">;
    manualOpenProtection: z<boolean, boolean, "volatile-defined">;
}>>, "plain">;
/**
 * Announce the bundle's own Plugins-page configuration page. The slot
 * registration in the browser half is what renders that page; `auto: false`
 * additionally tells schema-driven clients to generate no page.
 * @param ctx Host plugin context. The settings service is optional so the
 *   bundle still loads in compositions without it.
 */
export declare function apply(ctx: HostContext): void;
