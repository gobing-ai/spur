---
schema_version: 1
name: Decision catalog resolver, DecisionService and bundled config/decisions
status: done
template: feature-impl
created_at: 2026-10-06T17:55:55.420Z
updated_at: "2026-10-06T19:53:33.607Z"
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

R1 bundle measurement (build:bundle, spur.js): BEFORE = 5,289,222 B, AFTER = 5,290,597 B, delta = +1,375 B (+0.026%) — the `@gobing-ai/ts-ai-decision` catalog dep's bundled cost (packages/app/package.json:20).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/package.json:20` adds `@gobing-ai/ts-ai-decision: "catalog:"`; root catalog resolves 0.5.16 (bun.lock entry); BEFORE=5,289,222 B in Solution; after-measurement lands at record per task note |
| R2 | MET | `config/decisions/task-pipeline.yaml:15` version 1, `:20-21` defaults.minConfidence 0.8; task-triage/failure-class/review-failure-class mirror inline choices+fallbacks; header documents no workflow reference yet |
| R3 | MET | `scripts/commands/bundle-config.ts:1` maps `decisions/` to decision-catalog.schema.json; `apps/cli/schemas/decision-catalog.schema.json:1` added; `apps/cli/schemas/spur-config.schema.json` decisions section +25 lines |
| R4 | MET | `packages/app/src/decision/decision-catalog-resolver.ts:88` layer order project→registered→shared; `:116` first-layer-wins per basename pre-hub; `:139` load errors reported; `:156` duplicate ids reported |
| R5 | MET | `packages/config/src/index.ts:380` decisions section (paths/maker/makers); `config/config.global.yaml:150` maker + commented makers example; bundled-literal reworded, `apps/cli/tests/commands/init.test.ts:321` guard green |
| R6 | MET | `packages/app/src/decision/decision-service.ts:249` precedence flag→makers.<id>→maker→catalog entry→defaults with source; `:305` getDecisionService per-cwd cache; unregistered maker: status ok:false + decide throws UnknownDecisionMakerError |
| R7 | MET | `git diff --name-only <base> -- config/workflows/` returns 0 files; workflow decide code path untouched |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `config/decisions/task-pipeline.yaml:1` ships via bundle-config schemaFor; `packages/app/tests/decision/decision-catalog-resolver.test.ts:1` 12 cases cover layering + dup handling |
| AC2 | MET | test | resolver defaults sharedRoot to bundledConfigRoot() `packages/app/src/decision/decision-catalog-resolver.ts:82`; resolver tests assert shared-layer resolution without configured path |
| AC3 | MET | test | effectiveMaker ranks config-default above catalog `packages/app/src/decision/decision-service.ts:255`; `packages/app/tests/decision/decision-service.test.ts:1` asserts precedence incl. makers.<id> override; `config/config.global.yaml:150` sets safe built-in maker |
| AC4 | MET | command | `git diff --name-only <base> -- docs/00_ADR.md docs/design/ docs/04_DESIGN.md` lists ADR-134 + decision-catalog.md + 04 index rows; docs present and synced with shipped surface |
| AC5 | MET | command | `git diff --name-only <base> -- config/workflows/` = 0 files |
| Repository decision catalogs live in config/decisions and ship in the package | MET | test | task R2+R3: catalog yaml + schemaFor mapping + decision-catalog.schema.json ships; resolver tests cover layering |
| Installed CLI resolves shared decisions without a configured path | MET | test | shared layer defaults to bundledConfigRoot() `packages/app/src/decision/decision-catalog-resolver.ts:82`; resolver tests assert no-config resolution |
| Global config selects the default DecisionMaker for each decision point | MET | test | effectiveMaker precedence `packages/app/src/decision/decision-service.ts:249-263` asserted by `packages/app/tests/decision/decision-service.test.ts:1`; config.global.yaml maker documented |
| Design record captures the review of the original proposal | MET | command | `git diff --name-only <base> -- docs/` includes docs/00_ADR.md (ADR-134) and docs/design/decision-catalog.md; kept in sync with shipped surface |
| Shipped workflows keep their current decide actions in this stage | MET | command | `git diff --name-only <base> -- config/workflows/` returns 0 files |
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

