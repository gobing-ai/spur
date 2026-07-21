---
template: feature-impl
schema_version: 1
name: "Implement envelope invalidation, progressive disclosure, and attribution instrumentation"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-2", "context-envelope", "invalidation", "feature-O"]
dependencies: []
created_at: "2026-07-20T03:32:22.455Z"
updated_at: "2026-07-21T03:37:48.531Z"
---

## 0306. Implement envelope invalidation, progressive disclosure, and attribution instrumentation

### Background

Wave-2 of feature O (0284 R3-R6, dependency tier 2). Per-layer invalidation, reference routing that keeps safety/gate contracts mandatory-inline, and fresh-vs-reused attribution. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0284) and docs/tasks2/0284_*.md.

### Requirements
R1. Implement per-layer, fingerprint-driven invalidation triggers for corpus updates (mtime+hash), git changes (worktree SHA), config/model changes (config hash + model id), skill/reference version changes (manifest version), gate results (verdict-artifact hash), and tool outputs (never cached across stages) (0284 R3).
R2. Implement reference routing / progressive disclosure where optional references go through handles with explicit triggers and budgets, but safety, authorization, requirements-traceability, and mutation-gate contracts are mandatory inline layers that a cheap model cannot defer or omit (0284 R4).
R3. Enforce session/subprocess boundaries: inline stages may reuse captured stable layers within one dispatch; subprocess (`spur agent run`) stages start fresh and may only cross the boundary via fingerprinted on-disk artifacts whose invalidation fingerprint still matches (0284 R5).
R4. Implement instrumentation attributing fresh vs reused Spur layers by content-hash comparison, labeling provider cache dimensions only from verified raw usage (0281), never fabricating host cache hits when telemetry is absent (0284 R6).
### Acceptance Criteria
```gherkin
Feature: Envelope invalidation, progressive disclosure, and attribution (0284 R3-R6)

  @core
  Scenario: R5 - Layered context envelopes are cache-stable and safe
    Given an envelope layer captured with a stored content hash (task R1, R3)
    When a fresh invalidation trigger is computed for the same source
    Then corpus updates fingerprint on mtime+hash, git changes on worktree SHA, config/model on config hash + model id, version changes on manifest version, and gate results on verdict hash
    And tool outputs return a null fingerprint and are never cached across stages
    And a layer whose stored hash differs from the fresh fingerprint is reported stale with a named reason
    And inline stages reuse captured stable layers within one dispatch while fresh; volatile layers are never captured
    And subprocess stages reuse only fingerprinted on-disk artifacts whose fingerprint still matches fresh process state

  @core
  Scenario: Progressive disclosure preserves quality gates
    Given a canonical stage assembles its context envelope (task R2, R4)
    When optional layers are routed through disclosure handles
    Then safety, authorization, requirements-traceability, and mutation-gate contract layers remain mandatory inline
    And optional layers carry an explicit disclosure trigger and size budget
    And a cheap model cannot defer or omit a required layer
    And fresh-vs-reused attribution classifies each layer by content-hash comparison
    And provider cache dimensions are labeled only from verified raw usage, never fabricated when telemetry is absent
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
#### R1: Per-layer fingerprint-driven invalidation (`packages/domain/src/envelope/invalidation.ts`)
- **`computeInvalidationFingerprint(trigger: InvalidationTrigger): string | null`** — `invalidation.ts:47-72`. Computes SHA-256 fingerprint from any invalidation trigger source (corpus-update mtime+hash, git-change worktree SHA, config-change config hash+model id, version-change manifest version+source, gate-result verdict hash). Tool-output triggers return `null` — never cached across stages.
- **`checkLayerStale(layer: EnvelopeLayer, freshFingerprint: string | null): LayerStalenessResult`** — `invalidation.ts:107-136`. Returns staleness verdict for a single layer: stable layer with matching fingerprint = fresh; mismatched = stale (fingerprint-mismatch); null fingerprint = always stale (never-cached); volatile layer = always stale by contract (volatile-layer).
- **`identifyStaleLayers(layers, freshFingerprints): LayerStalenessResult[]`** — `invalidation.ts:155-172`. Batch stale-layer identification. Layers without a fresh fingerprint entry are conservatively treated as stale.
- **`artifactFingerprintsMatch(capturedHashes, freshFingerprints): boolean`** — `invalidation.ts:189-200`. Subprocess boundary check: every captured hash must have a matching fresh fingerprint.

#### R2: Progressive disclosure (`packages/domain/src/envelope/assemblies.ts`)
- Required safety, authorization, requirements-traceability, and mutation-gate contracts remain mandatory inline layers per the `STAGE_LAYER_DISCLOSURE` required split (`assemblies.ts:133-154`), surfaced by `getStageLayerSelection()` (`assemblies.ts:166-168`). The named contracts map to canonical layers: safety→`harness-policy`, authorization→`project-authority`, requirements-traceability→`task-state` + `stage-contract`, mutation-gate→`stage-contract`.
- Optional layers (`indexed-evidence`, `tool-observations`) route through disclosure handles via `appendDisclosurePlaceholders()` (`assemblies.ts:291-318`) — each placeholder carries an explicit `disclosure_handle` (trigger) and `size_budget` (`DEFAULT_DISCLOSURE_BUDGET_BYTES`, `assemblies.ts:270`). The cheap model cannot defer or omit required layers.

#### R3: Session/subprocess boundaries (`packages/domain/src/envelope/boundary.ts`)
- **`InlineContext` class** — `boundary.ts:52-121`. Captures stable-prefix-eligible layers within one dispatch. Provides `captureLayer()` (`boundary.ts:73-77`), `isStableLayerFresh()` (`boundary.ts:101-105`), and `reset()` (`boundary.ts:111-113`). Volatile layers are never captured.
- **`verifySubprocessArtifact(artifact, fingerprints): boolean`** — `boundary.ts:152-157`. Verifies on-disk artifact fingerprints match fresh process state before crossing subprocess boundary.
- **`createBoundaryContext(kind, dispatchId): InlineContext | null`** — `boundary.ts:170-174`. Returns `InlineContext` for inline, `null` for subprocess (no in-process state).

#### R4: Attribution instrumentation (`packages/domain/src/envelope/attribution.ts`)
- **`attributeFreshVsReused(layers, captured, ...): AttributionReport`** — `attribution.ts:117-185`. Compares content hashes to classify each layer as fresh or reused; an empty content hash is never classified as reused. Provider telemetry fields default to `null`/`'unavailable'` — never fabricates host cache hits.
- **`attributeWithoutTelemetry(layers, captured): AttributionReport`** — `attribution.ts:199-210`. Safety wrapper that sets all provider fields to unavailable. Invariant: cannot accidentally claim a cache hit.
- Attribution records evidence kind (`documented`, `locally-observed`, `inferred`, `unavailable`) per layer and per provider dimension (`attribution.ts:32`).
### Testing
#### Verification commands (re-audit, post-fix)
- `bun run lint` (biome `--error-on-warnings` + per-workspace `tsc --noEmit`) — **clean**, all 7 workspaces exit 0
- `bun run test` — **3326 pass, 3 fail** across 212 files. The 3 failures are sandbox `Bun.serve` port-bind / `ps` EPERM denials (`createServerContext > processInventory`, `rpc client > fetchWithTimeout`, `rpc client > apiFetchWithTimeout`), not regressions — envelope suites all pass.
- `bun run apps/cli/src/index.ts task check 0306 --strict-core` — **pass: true**, no findings
- Fix-pass mutation: `.spur/run/0306-verdict.json` (regenerated, aggregate recomputed). Code fixes in `packages/domain/src/envelope/attribution.ts` (empty-hash guard, dispatchId note), `packages/domain/src/envelope/assemblies.ts` (`DEFAULT_DISCLOSURE_BUDGET_BYTES` + placeholder `size_budget`), tests `attribution.test.ts` / `disclosure.test.ts`. Citation corrections written to `## Solution` via `spur task update --section Solution`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (per-layer fingerprint invalidation) | MET | `invalidation.ts:47-72` (fingerprint), `:107-136` (staleness), `:155-172` (batch), `:189-200` (artifact match); `invalidation.test.ts` 44 tests pass |
| R2 (progressive disclosure / mandatory-inline contracts) | MET | `assemblies.ts:133-154` (required split), `:166-168` (`getStageLayerSelection`), `:291-318` (`appendDisclosurePlaceholders`), `:270` (`DEFAULT_DISCLOSURE_BUDGET_BYTES`); `disclosure.test.ts` passes incl. new budget assertion |
| R3 (session/subprocess boundaries) | MET | `boundary.ts:52-121` (InlineContext), `:152-157` (verifySubprocessArtifact), `:170-174` (createBoundaryContext); `boundary.test.ts` 13 tests pass |
| R4 (fresh-vs-reused attribution, no fabrication) | MET | `attribution.ts:117-185` (attributeFreshVsReused + empty-hash guard), `:199-210` (attributeWithoutTelemetry), `:32` (EvidenceKind); `attribution.test.ts` 15 tests pass |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R5: per-trigger fingerprints (corpus/git/config/version/gate); tool-output null | MET | test | `invalidation.test.ts:16-98` |
| R5: stale layer reported with named reason | MET | test | `invalidation.test.ts:102-121` |
| R5: inline reuse while fresh; volatile never captured; subprocess artifact match | MET | test | `boundary.test.ts` (InlineContext capture/freshness/reset + verifySubprocessArtifact) |
| Progressive disclosure: mandatory-inline contracts survive | MET | test | `disclosure.test.ts:24-56` (required/optional split, no-overlap, unknown-stage-fails-closed) |
| Progressive disclosure: optional layers carry explicit trigger + size budget | MET | test | `disclosure.test.ts:82-95` (handle + `size_budget.max_bytes > 0` assertion) |
| Progressive disclosure: fresh-vs-reused attribution; telemetry unavailable not fabricated | MET | test | `attribution.test.ts` (classification, empty-hash guard, `providerCacheHit` `'unavailable'`, `attributeWithoutTelemetry`) |

**Coverage**
- `envelope/attribution.ts`: 100% functions, 100% lines
- `envelope/boundary.ts`: 100% functions, 100% lines
- `envelope/invalidation.ts`: 100% functions, 100% lines
- `envelope/assemblies.ts`: 90.78% lines (uncovered: 189,199,315,327-336 — unrelated helpers)
### Review
| Priority | Finding | Disposition |
|----------|---------|-------------|
| P1 | Re-audit (`--force`) found all four requirements implemented with full test coverage; no unresolved implementation blocker after fix pass. | PASS |
| P2 | `## Solution` `file:line` anchors were stale (~5 lines low; R2 cited `:166-168` for a split defined at `:133-154`). Corrected via `spur task update --section Solution`. | Fixed |
| P2 | Progressive-disclosure placeholders omitted `size_budget`; spec 0284 R4 requires explicit triggers **and** budgets. Added `DEFAULT_DISCLOSURE_BUDGET_BYTES` + placeholder budget + test. | Fixed |
| P3 | `attributeFreshVsReused` could classify an empty `content_hash` pair as "reused". Added empty-hash guard + regression test. | Fixed |
| P3 | `## Acceptance Criteria` was an empty placeholder; objective AC had been claimed "satisfied" with none authored. Derived AC from 0284 R3–R6. | Fixed |
| P4 | `attributeFreshVsReused` returns `dispatchId: ''`; documented that callers stamp the dispatch id. Provider `providerCacheHit` defaults to `'unavailable'`, satisfying 0284 R6 no-fabrication. | Accepted by design |

**Review outcome: PASS** — All requirements implemented and re-verified; AC now authored; strict-core gate `pass: true`; verdict artifact `.spur/run/0306-verdict.json` = PASS.
### References
- Parent feature: **O** — sp plugin token-efficient reliable execution architecture (`docs/features/O_sp-plugin-token-efficient-reliable-execution-architecture.md`)
- Source spec: `.spur/run/wayfinder-O/implementation-evidence.md` (ticket 0284, R3–R6)
- 0284 design/AC: `.spur/run/wayfinder-O/0284-design.md`, `.spur/run/wayfinder-O/0284-ac.md`
- Sibling spec task: `docs/tasks2/0284_*.md`
- Upstream dependency: ticket 0281 (verified raw provider usage) governs the R4 no-fabrication invariant
### History
- 2026-07-21T02:50:16.390Z todo → wip (system)
- 2026-07-21T02:58:22.858Z wip → testing (system)
- 2026-07-21T02:59:20.505Z testing → done (system)
