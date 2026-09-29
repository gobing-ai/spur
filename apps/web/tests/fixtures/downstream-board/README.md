# Downstream board fixture (task 0988 R3/R4)

A separately built, separately installed native Board module. `board-runtime-browser.test.ts`
copies this directory OUTSIDE the Spur checkout, installs its own `react`/`react-dom` plus
`@gobing-ai/spur` from a locally packed tarball, type-checks `src/` against the installed
declaration-only `./board` export, and builds the ESM the browser proof loads through the Board's
import map.

What each file proves:

| File | Proof |
| --- | --- |
| `contribution/index.tsx` | Entry exports `webModule` (`BoardModuleContribution`), `useState` interaction, host-context read, lazy chunk, referenced asset, deep path, optional right panel |
| `contribution/lazy.ts` | Separate chunk (`import('./lazy')`) — the module ships more than one file |
| `contribution/own-react.ts` | The fixture's OWN React copy, built without externals: version-equal but instance-distinct from the Board's React |
| `contribution/malformed.ts` | Malformed contribution export (no component) — must be rejected without touching built-ins |
| `contribution/throwing.ts` | Contribution whose component throws during render — must be contained |
| `contribution/styles.css` | Scoped CSS (`.spur-downstream-*` classes only, no global resets) |
| `contribution/logo.svg` | Referenced asset emitted as its own file |
| `vite.config.ts` | Library build that externalizes exactly the specifiers the Board's import map serves |

`__testExports` is a test-only export of the fixture graph (React namespaces + a panel element
factory). The production authoring surface is `webModule`; the test export exists so the harness
adapter can compare strict object/function identity with its own host imports.
