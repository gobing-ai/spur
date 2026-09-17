# Focus auto-detection

Authority: `docs/design/dev-refactor-command.md` §8. Lens selection is **deterministic globs, not
model judgment**, so a misroute is auditable: re-running detection on the same tree yields the same
set.

## Classification

First matching table row per file; the lens set is the **union** across all files in `--scope`.

| Order | Glob | Lens |
| --- | --- | --- |
| 1 | `**/tests/**`, `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**` | tests |
| 2 | `apps/web/**`, `**/*.astro`, `**/*.tsx`, `**/*.jsx`, `**/*.css`, `**/*.vue` | ui |
| 3 | `packages/contracts/**`, `**/routes/**`, `**/openapi*`, `**/*.proto`, `**/*.graphql`, `apps/cli/src/commands/**`, `apps/server/src/**` | api |
| 4 | anything else (fallback) | architect |

Rules:

- Evaluate rows in order; a file matching an earlier row is never classified by a later one
  (a `*.test.tsx` file is a **tests** file, not ui).
- Every file in scope resolves to exactly one lens; the scope set is the union of resolved lenses.
- An empty scope set (no files matched anything) collapses to the `architect` fallback for the
  whole scope only when scope itself is non-empty; an empty scope is a resolve-phase error.

## `--focus` flag

| Value | Behavior |
| --- | --- |
| `auto` (default) | Run detection above and use its lens set. |
| single lens (`api` \| `architect` \| `tests` \| `ui`) | Run only that lens. |
| comma list (`api,tests`) | Run exactly the listed lenses, in the operator's order. |

## Report before run

The resolved lens set **must be reported before any lens runs** — one line naming the chosen
lenses and, for `auto`, the per-file counts that selected them, e.g.:

```text
focus=auto → lenses: tests (14 files), api (3 files)
```

Under `--auto` this line is still written (to the report and the session output); what `--auto`
skips is only the *interactive* confirmation of scope and lens set, never the report.
