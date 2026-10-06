---
schema_version: 1
name: Decision catalog resolver, DecisionService and bundled config/decisions
status: todo
template: feature-impl
created_at: 2026-10-06T17:55:55.420Z
updated_at: "2026-10-06T18:16:29.669Z"
feature_id: P
priority: P1
tags:
  - decision
  - config
  - bundle

---

## 1092. Decision catalog resolver, DecisionService and bundled config/decisions

### Background

Feature P (ADR-134, docs/design/decision-catalog.md §3.1–3.3). Foundation for the spur decision noun and the decide migration: catalogs in config/decisions resolve through ADR-113-style layers into one DecisionHub owned by packages/app. Covers scenarios R6, R7 and R10.

### Requirements

- [ ] R1. Add `@gobing-ai/ts-ai-decision` to packages/app via `catalog:` and measure `build:bundle` and compiled-binary size before and after; record the delta in Solution.
- [ ] R2. Add `config/decisions/task-pipeline.yaml` (format version 1, `defaults.minConfidence: 0.8`) holding task-triage, failure-class and review-failure-class with today's choices and fallbacks, so their reliability can be measured with `spur decision run`; no workflow references them yet.
- [ ] R3. `bundle-config.ts` `schemaFor()` maps `decisions/` and the upstream decision-catalog schema ships in `apps/cli/schemas/`.
- [ ] R4. `DecisionCatalogResolver` resolves project `.spur/decisions` → `decisions.paths` (absolute, project-relative, `bundled:`) → shared `bundledConfigRoot()/decisions`; first layer wins per file basename; duplicate ids across winning files and per-file load failures are reported, not thrown.
- [ ] R5. `decisions: { paths?: string[], maker?: string, makers?: Record<decisionId, string> }` added to the packages/config Zod schema and `spur-config.schema.json`; `config/config.global.yaml` documents the section with `maker` set to the safe built-in default and a commented `makers` example.
- [ ] R6. `DecisionService` exposes list/describe/decide/status over one cached hub and resolves the effective maker per decision as `--maker` → `decisions.makers.<id>` → `decisions.maker` → catalog entry `maker` → catalog `defaults.maker`, returning the selecting source with it; an unregistered configured maker is a reported error, never a silent fallback.
- [ ] R7. No file under `config/workflows/` and no workflow `decide` code path changes in this task.

### Acceptance Criteria

- [ ] AC1 — Repository decision catalogs live in config/decisions and ship in the package
- [ ] AC2 — Installed CLI resolves shared decisions without a configured path
- [ ] AC3 — Global config selects the default DecisionMaker for each decision point
- [ ] AC4 — Design record captures the review of the original proposal
- [ ] AC5 — Shipped workflows keep their current decide actions in this stage

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
