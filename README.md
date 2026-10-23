# Thinking Focus

A DeepSeek Harness plugin for **DSH Desktop** that keeps only the current
thinking block expanded in Chat, closes older ones after a configurable delay,
and exposes its settings on the Plugins page.

## Behavior

- The **latest** thinking block in the main Chat flow auto-expands (full text,
  no click), including while it is still streaming.
- Tool calls, assistant text, commands, and every other non-thinking row do
  **not** close a thinking block above them; only the appearance of a newer
  thinking block supersedes the previous one.
- A superseded thinking block collapses after the configured delay, unless the
  reader opened it manually (then it stays open while the protection option is
  on). The delay starts at the first evaluation that sees the block superseded
  (normally within a frame of the newer block appearing), or from the reader's
  own open when protection is off; if a newer block briefly disappears so that
  an older block is momentarily the flow's last row, the delay restarts.
- The right-sidebar subagent Chat is not affected; a subagent session opened in
  the main Chat panel is an ordinary Chat and is covered.
- No session data, model context, tools, or prompts are changed; disabling or
  uninstalling the bundle restores the stock behavior.

## Settings

Open the sidebar **Plugins** page, select **Thinking Focus**, and save the form:

| Field | Default | Meaning |
|---|---|---|
| Auto-expand the current thinking block | on | Master switch for the behavior. |
| Collapse delay (seconds) | 2 | Time between a newer thinking block appearing and the older one closing. Whole seconds, 0–60. |
| Keep blocks I opened manually | on | Never auto-collapse a block the reader opened. |

Settings persist in the `desktop` profile through the normal plugin
configuration editor.

## Install (desktop profile)

```
plugin_manager install_bundle -> target: <path-to-plugin-checkout>/auto-expand-thinking
```

The profile links this directory (`link:` install). Because a linked plugin root
resolves package names from its real path, the Host half declares
`@deepseek-ai/schemastery` in `peerDependencies`; the profile's resolver supplies
the running installation's copy. Verify a load with the Host
`Config.listConfigs` inspect query before trusting a change.

If the page does not pick up a freshly installed bundle, reload the DSH Desktop
window or restart the app.

## Notes and limits

- The plugin drives the thinking disclosure from its rendered DOM because the
  shipped plugin surface does not expose the disclosure's open state (the
  reasoning Body Slot exists only while the row is open).
- DSH itself folds a completed Turn's process rows away; after a Turn completes
  the current block stays expanded in state and is visible again as soon as the
  Turn is opened. While streaming it is visible directly.
- Older blocks that were already expanded before the plugin first saw them are
  treated as superseded (provenance is unknown) and close after the delay unless
  the reader opens them again with manual-open protection on.
- Manual choices are remembered per block while the page stays open, including
  across session switches. The disclosure's open state itself is owned by DSH
  and remounts with the Chat view, so a manually opened older block comes back
  collapsed after a session switch; only the latest block is re-expanded
  automatically. Nothing survives a full page reload.
- Settings writes are minimal and revision-fenced: only fields the reader edited
  are written, and a concurrent write from another client makes the Host refuse
  the stale save instead of overwriting it. A refused or failed save keeps your
  staged edits and reports it so you can retry. If the settings namespace is not
  served, the plugin stays idle (it never acts on guessed defaults).
- Verified against DSH `0.2.1-rc.2`; the bundle is wrapped in one classic-script
  IIFE so a disable/enable cycle or HMR rebuild can execute it again safely.
