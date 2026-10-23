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
/** Accepted bounds for the configurable collapse delay. */
export const COLLAPSE_DELAY_SECONDS = Object.freeze({ min: 0, max: 60, default: 2 });
/**
 * Effective settings. Only `.volatile()` leaves reach the browser: the settings
 * service projects the form from them, and edits apply without remounting the
 * plugin row.
 */
export const Config = z.object({
    enabled: z.boolean()
        .default(true)
        .description('Automatically expand the current thinking block in chat.')
        .volatile(),
    collapseDelay: z.number()
        .step(1)
        .min(COLLAPSE_DELAY_SECONDS.min)
        .max(COLLAPSE_DELAY_SECONDS.max)
        .default(COLLAPSE_DELAY_SECONDS.default)
        .description('Seconds to wait before collapsing a previous thinking block.')
        .volatile(),
    manualOpenProtection: z.boolean()
        .default(true)
        .description('Never auto-collapse a thinking block the user opened manually.')
        .volatile(),
});
/**
 * Announce the bundle's own Plugins-page configuration page. The slot
 * registration in the browser half is what renders that page; `auto: false`
 * additionally tells schema-driven clients to generate no page.
 * @param ctx Host plugin context. The settings service is optional so the
 *   bundle still loads in compositions without it.
 */
export function apply(ctx) {
    ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'thinking-expand: settings presentation'));
}
