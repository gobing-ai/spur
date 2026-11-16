# Board module starter

A native Spur Board module built from the shared UI kit. Copy this directory into a project, then
follow the authoring guide — this file only says what the files are.

| File | What it is |
| --- | --- |
| `src/index.tsx` | The entry: exports `webModule` (`apiVersion: 1`, `component`) and renders the shell from `@gobing-ai/spur/board/ui`. |
| `src/module.css` | Module-private styles, scoped to classes you own. The host stylesheet already carries every kit class. |
| `vite.config.ts` | Library build externalizing exactly the specifiers the installed `board-runtime.json` advertises. Never edit the list by hand. |
| `module.yaml` | The `bootstrap.modules` declaration to paste into the project `.spur/config.yaml` (validated by the serve preflight). |

Owners: shell rules — root `DESIGN.md` § Product UI — Module Shell; declaration, build and runtime
rules — `docs/design/downstream-board-modules.md` §6; kit specifier, exports and versions —
`docs/design/board-module-ui-kit.md`.

Build with `bun install && bun run build`, then declare the built `dist/` directory and restart
`spur self serve`.
