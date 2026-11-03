# Thinking Focus

A DeepSeek Harness plugin for **DSH Desktop**, written in TypeScript, that keeps
only the current thinking block expanded in Chat, closes older ones after a
configurable delay, and exposes its settings on the Plugins page.

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

The built entry points in `lib/` are committed and referenced by the package
`exports`, so neither a linked checkout nor a git install has to run a build
script (and no pnpm build allowance is needed):

```
dsh plugin --profile desktop add github:VoidForge/dsh-thinking-expand
```

If the page does not pick up a freshly installed bundle, reload the DSH Desktop
window or restart the app.

## Development

Requires Node.js 24+ (the test suite runs the TypeScript sources directly through
Node's type stripping).

```
npm install
npm run build      # tsc: Host half -> lib/index.js; esbuild: browser half -> lib/client.js
npm run typecheck  # check src/ and tests/ under strict TypeScript
npm test           # build, then node --test on the TypeScript tests
npm run check      # typecheck + test
```

```
src/
  index.ts       Host half: volatile config schema + own-settings-page marker
  client.ts      Browser half: Chat DOM engine + Plugins-page settings form
  rules.ts       Pure decision rules (no DOM, React, or DSH imports)
  constants.ts   Package identity shared by the patch, slots, and tests
  types/dsh.ts   Minimal local DSH 0.2.1-rc.2 plugin-contract declarations
tests/           TypeScript tests (rules, manifest invariants, classic script)
lib/             Committed build output: the entry points the manifest exports
```

`lib/` is committed because DSH loads a linked checkout or a git install exactly
as it is: nothing runs a build script on the user's machine. After changing a
source file, run `npm run build` and commit the updated `lib/` output with it.
`tsconfig.build.json` emits the Host half with declarations; `esbuild` bundles
the browser half as one self-contained classic-script IIFE.

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
- Verified against DSH `0.2.1-rc.2`; the browser half ships as one classic-script
  IIFE so a disable/enable cycle or HMR rebuild can execute it again safely.

## License

Thinking Focus is licensed under the **GNU Lesser General Public License,
version 3** (SPDX: `LGPL-3.0-only`).

- Full license text: [LICENSE.txt](./LICENSE.txt)
- Canonical text: <https://www.gnu.org/licenses/lgpl-3.0.txt>
- License overview: <https://www.gnu.org/licenses/lgpl-3.0.html>

LGPLv3 incorporates the terms and conditions of the GNU General Public
License, version 3 (GPLv3) by reference, supplemented by the additional
permissions listed in the license; see
<https://www.gnu.org/licenses/gpl-3.0.html>.

## Disclaimer

This software is provided **as-is**, without warranty of any kind, express or
implied, including but not limited to the warranties of merchantability,
fitness for a particular purpose, and non-infringement. In no event shall the
authors or copyright holders be liable for any claim, damages, or other
liability, whether in an action of contract, tort, or otherwise, arising from,
out of, or in connection with the software or the use or other dealings in the
software.

## Credit

This plugin was created with **DeepSeek V4.1 Flash**.
