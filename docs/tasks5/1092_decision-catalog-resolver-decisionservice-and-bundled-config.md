---
schema_version: 1
name: Decision catalog resolver, DecisionService and bundled config/decisions
status: done
template: feature-impl
created_at: 2026-10-06T17:55:55.420Z
updated_at: "2026-10-07T00:23:04.129Z"
feature_id: P
priority: P1
tags:
  - decision
  - config
  - bundle

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1092-verdict.json
---

## 1092. Decision catalog resolver, DecisionService and bundled config/decisions

### Background

Feature P (ADR-134, docs/design/decision-catalog.md §3.1–3.3). Foundation for the spur decision noun and the decide migration: catalogs in config/decisions resolve through ADR-113-style layers into one DecisionHub owned by packages/app. Covers scenarios R6, R7 and R10.

### Requirements

- [x] R1. Add `@gobing-ai/ts-ai-decision` to packages/app via `catalog:` and measure `build:bundle` and compiled-binary size before and after; record the delta in Solution.
- [x] R2. Add `config/decisions/task-pipeline.yaml` (format version 1, `defaults.minConfidence: 0.8`) holding task-triage, failure-class and review-failure-class with today's choices and fallbacks, so their reliability can be measured with `spur decision run`; no workflow references them yet.
- [x] R3. `bundle-config.ts` `schemaFor()` maps `decisions/` and the upstream decision-catalog schema ships in `apps/cli/schemas/`.
- [x] R4. `DecisionCatalogResolver` resolves project `.spur/decisions` → `decisions.paths` (absolute, project-relative, `bundled:`) → shared `bundledConfigRoot()/decisions`; first layer wins per file basename; duplicate ids across winning files and per-file load failures are reported, not thrown.
- [x] R5. `decisions: { paths?: string[], maker?: string, makers?: Record<decisionId, string> }` added to the packages/config Zod schema and `spur-config.schema.json`; `config/config.global.yaml` documents the section with `maker` set to the safe built-in default and a commented `makers` example.
- [x] R6. `DecisionService` exposes list/describe/decide/status over one cached hub and resolves the effective maker per decision as `--maker` → `decisions.makers.<id>` → `decisions.maker` → catalog entry `maker` → catalog `defaults.maker`, returning the selecting source with it; an unregistered configured maker is a reported error, never a silent fallback.
- [x] R7. No file under `config/workflows/` and no workflow `decide` code path changes in this task.

### Acceptance Criteria

- [x] AC1 — Repository decision catalogs live in config/decisions and ship in the package
- [x] AC2 — Installed CLI resolves shared decisions without a configured path
- [x] AC3 — Global config selects the default DecisionMaker for each decision point
- [x] AC4 — Design record captures the review of the original proposal
- [x] AC5 — Shipped workflows keep their current decide actions in this stage

AC4 is satisfied by ADR-134 and docs/design/decision-catalog.md; this task keeps them in sync with what ships.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-06T17:56:35.544Z

- Runtime resolution: auto-found shared layer plus optional `decisions.paths`; a required absolute global path was rejected (ADR-134, design §5).
- Threshold: catalog `defaults.minConfidence: 0.8` keeps the ADR-125 value over the upstream 0.7 default.
- Bundle growth: measured in R1; if it is material, lazy-load the maker registry behind the switch. Not a blocker for the resolver/service.
- Deferred: outcome history store (feature P out of scope).

#### Q&A entry — 2026-10-06T18:16:29.669Z

- Runtime resolution: auto-found shared layer plus optional `decisions.paths`; a required absolute global path was rejected (ADR-134, design §5).
- Maker selection (operator feedback 2026-10-06): global `decisions.maker` plus per-decision `decisions.makers.<id>`; precedence `--maker` → per-decision config → global config → catalog entry → catalog defaults.
- Threshold: catalog `defaults.minConfidence: 0.8` keeps the ADR-125 value over the upstream 0.7 default.
- Staging (operator feedback 2026-10-06): no workflow changes here; all workflow adoption is postponed to feature P1.
- Existing `~/.config/spur/config.yaml` files are never overwritten by init; without the keys the catalog maker applies, and `status` shows that source.
- Deferred: outcome history store; per-decision model selection in config.

### Design

Mirror workflow-resolver.ts rather than invent a new resolver shape. Pick winning files before hub load because the upstream hub throws on duplicate ids (reject: loading all layers and catching). Operator config outranks the shipped catalog for maker choice because only the machine owner knows which backends exist there (laya-local needs Apple Silicon); per-decision config outranks the global config default. Makers are constructed lazily so `list`/`show`/`status` never build one; if R1 shows material bundle growth, gate the maker registry import as well. The service does not read `workflow.decideDecisionMaker`: that switch governs workflow decide only, and `spur decision run` is an explicit operator call used to measure reliability. Invariants: no required global path; shared layer works with an empty config; workflows untouched (P1 owns adoption).

### Plan

1. Write failing E2E for resolver layers + duplicate id + broken catalog.
2. Add dependency and size measurement.
3. Resolver, config schema, service.
4. Catalog YAML + bundle mapping + shipped schema.
5. `bun run spur-check`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/schemas/spur-config.schema.json:290` |
| `config/config.global.yaml:152` |
| `docs/features/INDEX.md:180` |
| `docs/features/P_decision-catalogs-and-the-spur-decision-noun.md:133` |
| `docs/features/P_decision-catalogs-and-the-spur-decision-noun.md:140` |
| `docs/features/P_decision-catalogs-and-the-spur-decision-noun.md:5` |
| `docs/features/P_decision-catalogs-and-the-spur-decision-noun.md:9` |
| `packages/app/package.json:34` |
| `packages/config/src/index.ts:1001` |
| `packages/config/src/index.ts:1096` |
| `packages/config/src/index.ts:817` |
| `plugins/sp/lib/idea-handoff.generated.mjs:249` |
| `plugins/sp/lib/inline-run.generated.mjs:1554` |
| `plugins/sp/lib/inline-run.generated.mjs:1585` |
| `scripts/commands/bundle-config.ts:52` |
| `apps/cli/schemas/decision-catalog.schema.json:1` |
| `config/decisions/task-pipeline.yaml:1` |
| `packages/app/src/decision/decision-catalog-resolver.ts:1` |
| `packages/app/src/decision/decision-service.ts:1` |
| `packages/app/tests/decision/decision-catalog-resolver.test.ts:1` |
| `packages/app/tests/decision/decision-service.test.ts:1` |

R1 bundle measurement (build:bundle, spur.js): BEFORE = 5,289,222 B, AFTER = 5,290,597 B, delta = +1,375 B (+0.026%) — the `@gobing-ai/ts-ai-decision` catalog dep's bundled cost (`packages/app/package.json:35`).


R1 compiled-binary measurement (`bun build --compile apps/cli/src/index.ts`, darwin-arm64, re-verify 2026-10-06): BEFORE (`5d678e179~1`) = 68,762,978 B, AFTER (`5d678e179`, this task) = 68,762,978 B, delta = 0 B — no CLI entry imports the decision modules until task 1093, so the dependency tree-shakes out. With 1093 wired in (HEAD `b8c8e9a54`) = 68,845,538 B (+82,560 B, +0.12% vs BEFORE). Growth is not material; the maker-registry lazy-load gate from Design is not needed.

**Re-verify fix (2026-10-06):** `getDecisionService` now caches per cwd + shared root, so a call with a different shared root never receives a service built from another catalog set (`packages/app/src/decision/decision-service.ts:303`; regression check `packages/app/tests/decision/decision-catalog-resolver.test.ts:116`). `decide` resolves the effective maker once and reuses its source (`packages/app/src/decision/decision-service.ts:206`). The duplicate-id rejection assertion is now awaited, so it can fail (`packages/app/tests/decision/decision-catalog-resolver.test.ts:100`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/package.json:35` adds the dependency via `catalog:`; build:bundle 5,289,222 → 5,290,597 B and compiled binary 68,762,978 → 68,762,978 B at `5d678e179` (re-measured this run, +82,560 B at HEAD with 1093) recorded in Solution |
| R2 | MET | `config/decisions/task-pipeline.yaml:12-30` version 1, defaults.minConfidence 0.8, task-triage/failure-class/review-failure-class choices+fallbacks equal `config/workflows/task-pipeline.yaml:582-583`, `:621-622`, `:690-691` |
| R3 | MET | `scripts/commands/bundle-config.ts:52` maps decisions/ to the catalog schema; build:bundle this run wrote `$schema` into apps/cli/config/decisions/task-pipeline.yaml; `apps/cli/schemas/decision-catalog.schema.json:1` ships |
| R4 | MET | `packages/app/src/decision/decision-catalog-resolver.ts:64-85` layer order; `:135-137` first layer wins per basename; `:147-151` load errors reported; `:156-174` duplicate ids; test `packages/app/tests/decision/decision-catalog-resolver.test.ts:64` passes |
| R5 | MET | `packages/config/src/index.ts:824-828` decisions schema (paths/maker/makers); `apps/cli/schemas/spur-config.schema.json:290-314`; `config/config.global.yaml:164-168` maker typesafe + commented makers example |
| R6 | MET | `packages/app/src/decision/decision-service.ts:261-276` precedence flag → makers.<id> → maker → catalog entry → catalog defaults with source; `:199` unregistered maker throws before backend; `:230-236` status reports unregistered config makers; tests `packages/app/tests/decision/decision-service.test.ts:68` pass |
| R7 | MET | `git diff --name-only 5d678e179~1 HEAD -- config/workflows/` returns 0 files |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | build:bundle this run: apps/cli/config/decisions/task-pipeline.yaml present with `$schema` pointing at shipped `apps/cli/schemas/decision-catalog.schema.json:1` |
| AC2 | MET | test | shared layer defaults to bundledConfigRoot() `packages/app/src/decision/decision-catalog-resolver.ts:65`; `spur decision list --json` in repo lists the 3 shared decisions with no decisions config; test `packages/app/tests/decision/decision-catalog-resolver.test.ts:85` bare-config list |
| AC3 | MET | test | `packages/app/src/decision/decision-service.ts:261-276`; scratch project with decisions.maker typesafe + makers.task-triage laya-local: show task-triage → laya-local/config-decision, failure-class → typesafe/config-default (this run) |
| AC4 | MET | command | `grep -n "Deviations from the original proposal" docs/design/decision-catalog.md` → `docs/design/decision-catalog.md:227-231` deviation table with reasons; ADR-134 at `docs/00_ADR.md:2155` |
| AC5 | MET | command | `git diff --name-only 5d678e179~1 HEAD -- config/workflows/` returns 0 files |
| R6 — Repository decision catalogs live in config/decisions and ship in the package | MET | command | build:bundle this run copied config/decisions with injected `$schema`; schema at `apps/cli/schemas/decision-catalog.schema.json:1` |
| R7 — Installed CLI resolves shared decisions without a configured path | MET | test | `packages/app/src/decision/decision-catalog-resolver.ts:65` shared default; registered layer ahead of shared `:76-82`; test `packages/app/tests/decision/decision-catalog-resolver.test.ts:54` |
| R8 — Global config selects the default DecisionMaker for each decision point | MET | test | `packages/app/src/decision/decision-service.ts:261-276`; tests `packages/app/tests/decision/decision-service.test.ts:68` + live scratch-project show (this run) |
| R9 — Design record captures the review of the original proposal | MET | command | grep this run: deviations table `docs/design/decision-catalog.md:227-231`; closed vocabulary + declared fallback, model output not deterministic `docs/00_ADR.md:2178-2180`; staging into P1 behind `spur decision run` reliability evidence `docs/00_ADR.md:2169` |
| R10 — Shipped workflows keep their current decide actions in this stage | MET | command | `git diff --name-only 5d678e179~1 HEAD -- config/workflows/` returns 0 files |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T18:58:32.492Z todo → wip (system)
- 2026-10-06T19:52:53.801Z wip → testing (system)
- 2026-10-06T19:53:33.603Z testing → done (system)

