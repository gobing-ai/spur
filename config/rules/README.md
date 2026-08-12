# Spur Rules

This directory is the **single source of truth** for Spur's quality-gate ruleset.
It is self-contained and authoritative — `spur rule run` resolves all categories
and presets from local `.spur/rules/**/*.yaml` with no fallback to a global
install or to ts-libs.

## Categories

| Category | Dir | Purpose |
|---|---|---|
| `typescript` | `typescript/` | TypeScript tooling, output boundaries, biome-suppression ban, no `debugger` |
| `strict` | `strict/` | Opt-in strict rules (runtime boundaries, HTTP boundaries, structural) |
| `boundary` | `boundary/` | DB/DAO boundary enforcement |
| `structure` | `structure/` | File layout, protected files, no focused/skipped tests |
| `quality` | `quality/` | Post-test gates (coverage) |
| `surface` | `surface/` | CLI surface consistency (registerXxxCommand wiring, --json serialization) |
| `migration` | `migration/` | Transitional helpers for the regex → `rg` evaluator move (`rg-dialect`) |
| `ui` | `ui/` | Web UI seam boundaries (import seam, daisyUI class leak) |

## Presets

| Preset | When | Extends |
|---|---|---|
| `recommended-pre-check` | Before tests | `typescript`, `structure`, `boundary`, `surface`, `ui`, `strict` |
| `recommended-post-check` | After tests | `quality` |
| `strict-check` | Opt-in single-category cherry-pick (strict only) | `strict` |
| `rg-migration` | On-demand during the regex → `rg` evaluator migration | `migration` |

## Relationship to ts-libs

Rules originally authored in `ts-libs/.spur/rules/` were **absorbed and adapted**
(here, not copied verbatim). Each absorbed file carries an `Absorbed from
ts-libs/.spur/rules/...` header documenting what was re-scoped, omitted, or
tuned for Spur's app-repo layout. After absorption, ts-libs and spur-new
maintain their rulesets independently.

## Transitional helpers

- `migration/rg-dialect` (category `migration/`) and the `rg-migration` preset
  are **shipped and live**: run `spur rule run --preset rg-migration` on demand
  during the regex → `rg` evaluator migration. They are intentionally excluded
  from the standing pre/post-check gates (transitional, not a permanent gate).

## Not absorbed (Spur-irrelevant)

- `typescript/esm-build-conventions` — governs ts-libs' library publish/dist
  flow. Spur apps don't publish libraries this way.
