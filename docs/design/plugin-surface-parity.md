---
doc: design/plugin-surface-parity
feature_id: I2
owns: SURFACE — parity harness contract between agent-facing surfaces and the live monorepo CLI
authority: derived (ADR wins on conflict)
updated_at: 2026-08-11
---

# Plugin-Surface Parity Harness — design

Surface contract for the `sp:spur-dev` / `sp:spur-cli` parity-first drift audit (feature I2;
ADR-053/054, amended 2026-08-11). Shapes only — rationale lives in `00 ADR-053/054` and `03 §15`.

## 1. Surfaces under contract

| # | Surface | File | Diff target |
| --- | --- | --- | --- |
| S1 | Facade noun routing + Tier C exclusions | `plugins/sp/skills/spur-cli/SKILL.md` | live CLI noun inventory + per-noun verbs |
| S2 | Per-noun verb/flag inventories | `plugins/sp/skills/spur-cli/references/<noun>.md` (+ `references/<noun>/verbs.md` where present) | `<noun> --help` / `--json` (where supported) |
| S3 | Spine step-routing table | `plugins/sp/skills/spur-dev/SKILL.md` § Step routing | CLI-routed rows' noun/verb existence |
| S4 | AGENTS.md noun table | `AGENTS.md` § Spur CLI surface | live CLI noun set |
| S5 | README index | `plugins/sp/README.md` § Command index | shipped command/skill/agent surfaces |
| S6 | Cross-links | plugin surfaces + AGENTS.md doc map | target file/section/command existence |

## 2. CLI resolution and provenance (R13)

- Invoke `bun run apps/cli/src/index.ts <noun> --help` — never a bare PATH `spur` (stale global binaries silently validate the wrong surface).
- Record the resolved binary + `@gobing-ai/spur` version as a provenance header in every harness run.
- npm skew (R9) is a documented drift source: published `spur` can lag the monorepo CLI, and the tests validate the monorepo surface only — they cannot catch skew on end-user installs.

## 3. CLI-surface capture: `--help`-primary, narrow adapter (R1/R2/R13)

- `<noun> --help` is the primary, universal capture surface; `--json` is used only where the noun actually exposes a machine-readable inventory — never assumed.
- Human `--help` parsing is a **narrow adapter** with fixtures and explicit exclusions (§4), not a general parser.
- Parse each surface inventory into noun/verb/flag sets; bidirectional report: `documented-not-on-CLI` and `on-CLI-not-documented` are both findings (R1).
- Unmarked stale rows fail; exclusions must be explicit (§4) — never suppressed by absence of a match.

## 4. Exclusions

| Rule | Applies to | Effect |
| --- | --- | --- |
| Tier C / outside-facade marker | nouns the facade marks excluded in its Tier C table, each with a stated reason | not reported as missing docs (R11) |
| Inline / slash-command rows | spine rows dispatching `/sp:dev-*` or inline session execution | not reported as stale CLI rows (R12) |
| `--help`-only long-tail | nouns the facade explicitly defers to `<noun> --help` | not reported (R11) |

## 5. Boundary assertion (R8) — ownership-defined

- `sp:spur-cli` owns CLI noun/verb/flag semantics — including task and feature status-transition verbs.
- `sp:spur-dev` owns multi-step lifecycle orchestration.
- The CLI is the validator.
- Parity tests assert each surface documents its owned scope and fail on inversion (facade owning orchestration, spine owning verb inventories). They do **not** assert the facade contains no "lifecycle steps" — status-transition verbs are CLI semantics, owned by the facade.
- The boundary is asserted, not redesigned (ADR-054).

## 6. Content-pass assertions (R5–R7)

- Every README index entry resolves to a shipped command/skill/agent surface; every shipped surface is indexed (R5).
- Every cross-link resolves to an existing file, section, or command (R6).
- Duplication checks are limited to **exact catalogs and structured inventories** (verb lists, routing rows, noun tables). Each duplicated catalog lives in exactly one surface; other surfaces link to it. Arbitrary prose duplication is not mechanically detected (R7).

## 7. Test layout — extend, don't multiply

- Extend the existing parity suite first: `command-flag-parity.test.ts`, `flag-contract-parity.test.ts`, `routing-table-parity.test.ts`, `skill-structure.test.ts` (ADR-031/038).
- Add at most **one shared CLI-surface helper** (e.g. `plugins/sp/tests/helpers/cli-surface.ts`) exposing the captured noun/verb/flag inventory plus the provenance header.
- Add at most **one new focused parity test** where no existing test owns the assertion.
- No pre-allocated multi-file test layout.

## 8. Constraint (R10)

- No new runtime, dependency, schema, or transport — `bun:test` + the monorepo CLI only.
- The change set touches plugin surfaces, tests, and documentation only.

## 9. Planning-workflow dogfood amendment (R14)

Running this feature through `idea-pipeline.yaml` exposed four spine integration gaps that belong in
the same maintenance pass:

- Feature creation must keep Goal and Scope as feature intent; decomposition notes and checklists do
  not belong in Goal.
- A rejected design needs persistent feedback that the revision step reads, and corrected design
  decisions must be reconciled with feature AC before decomposition.
- Batch ordering must be encoded with existing `spur task deps` after creation when the batch schema
  cannot express it; prose-only ordering is not a dependency.
- Handoff refreshes the feature roster and routes check-failing tasks to
  `/sp:dev-refineall --feature <id> --depth ready` before any `/sp:dev-runall` recommendation.

These are workflow/skill/test changes only. Adding fields to the task-batch schema or changing the
public CLI surface remains out of scope and requires separate operator consent.
