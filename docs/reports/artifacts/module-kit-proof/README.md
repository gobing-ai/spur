# Board module UI kit — browser proof snapshot

Evidence for A81: a starter module built from
`plugins/sp/skills/spur-composer/templates/board-module/`, installed from the packed CLI tarball and
rendered by the installed Board's own distribution.

| File | What it shows |
| --- | --- |
| `module-light.png` / `module-dark.png` | The module route in each theme: kit header, tab strip, empty state, host shell around it. |
| `builtin-light.png` / `builtin-dark.png` | The built-in Observability shell the computed styles are compared against, same themes. |
| `report.json` | Measured computed styles per theme (module vs built-in), the emitted external specifiers, `uiKitVersion`, browser version. |

Produced by `apps/web/tests/modules/module-kit-template-browser.heavy.test.ts` (part of
`bun run test:heavy`), which writes to the gitignored `.spur/run/module-kit-proof/` because a test
that rewrites tracked files moves the working tree and fails a feature-verification digest. To refresh
this snapshot, run that test and copy the directory's contents here.
