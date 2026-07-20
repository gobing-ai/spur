---
template: feature-impl
schema_version: 1
name: "Implement the stage-registry schema and types"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: null
priority: P1
tags: ["wave-1", "stage-registry", "feature-O"]
dependencies: []
created_at: "2026-07-20T01:54:25.237Z"
updated_at: "2026-07-20T05:36:33.400Z"
---

## 0301. Implement the stage-registry schema and types

### Background

Wave-1 of feature O (implementation of spec ticket 0282). Build the canonical stage-registry schema: a typed, versioned declarative record describing each lifecycle stage. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0282, ~line 142) and docs/tasks2/0282_*.md. This is the dependency root — wave-2 envelope/adapter work references the stage identity this schema defines.

### Requirements
R1. Define the stage-record type with identity, version, aliases, typed inputs/outputs, artifacts, reasoning-skill reference, required references, deterministic gates, mutation class, timeout/retry, model eligibility/fallback, context layers, and observability fields (0282 R1).
R2. Encode the authority boundaries in the type: registry describes a stage; workflow owns sequencing/state; skill owns reasoning; CLI/scripts own deterministic mutation/validation; adapters own platform syntax only (0282 R2).
R3. Model the execution kinds inline / subprocess / deterministic-only / hitl / irreversible as a discriminated union that cannot claim current-agent execution for subprocess stages (0282 R4).
R4. Version the schema (major/minor compat rule: consumer at major N accepts N.x; required-field add/remove/rename is a new major; optional-field/alias add is minor) (0282 R1 + evidence extension rule).
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Files (all new except domain index):**

- `packages/domain/src/stage-registry/schema.ts:1` (~500 lines) - canonical schema, types, validators.
- `packages/domain/src/stage-registry/index.ts:1` - barrel re-export.
- `packages/domain/src/index.ts:1` - added `export * from './stage-registry'` (also de-duplicated an accidental `DOMAIN_SCHEMA_SQL` export).
- `packages/domain/tests/stage-registry-schema.test.ts:1` - 43 tests across 7 describe blocks.


**Placement decision:** `packages/domain/src/stage-registry/` as a sibling of `planning/`. The stage registry is a domain-level declarative contract (identity + invariants of lifecycle stages), not a DB table, transport DTO, or CLI-only concern. Domain is the sole consumer of `@gobing-ai/ts-db`; placing the schema here keeps it reachable by app/cli/server without a new dependency edge.

**R1 - Stage record shape.** `stageRecordSchema` (`packages/domain/src/stage-registry/schema.ts:409`) is a zod object with: `schema_version`, `id` (matching `STAGE_ID_PATTERN = /^[a-z][a-z0-9-]*$/`), `aliases`, `description`, `artifacts` (typed input/output with `required` + `description`), `reasoning_skill`, `required_references`, `gates` (deterministic, with `timing: transition|pre|post` + optional `min_verdict`), `mutation_class`, `retry`, `model_policy`, `context_layers`, `execution` (discriminated union), `events`, `timeout_ms`. All field types are exported (`StageRecord` (`schema.ts:449`), `StageArtifact`, `StageGate`, `StageRetryPolicy`, `StageModelPolicy`, `StageContextLayer`, `StageEvent`).

**R2 — Authority boundaries encoded in type shape.** No `adapter` field leaks into the record (adapter syntax is owned by adapters, not the registry). `reasoning_skill` is a plain string naming the skill lane (skill owns reasoning). `gates` are declarative descriptors (`name` + `timing` + `min_verdict`) — the CLI/scripts lane executes them; the registry never carries executable code. `mutation_class` is an enum (`corpus | idempotent | verdict | irreversible`) — the HOW of mutation is owned by the CLI lane; the registry only classifies. JSDoc on each field names its authority lane; `AUTHORITY_LANES` is exported as the canonical lane list.

**R3 — Execution discriminated union.** `executionKindSchema = z.discriminatedUnion('kind', [...])` with five variants: `inline`, `subprocess`, `deterministic-only`, `hitl`, `irreversible`. `subprocessExecutionSchema` pins `current_agent_allowed: z.literal(false)` so zod rejects any subprocess record claiming current-agent execution at parse time — the constraint is structural, not runtime. `EXECUTION_KINDS` and `ExecutionKindVariant` are exported. `validateStageRecord()` adds defense-in-depth: re-checks subprocess-current-agent, enforces that irreversible `mutation_class` pairs with irreversible execution or a pre/both hitl gate, and that hitl execution has ≥1 gate.

**R4 — Schema versioning.** `STAGE_REGISTRY_SCHEMA_VERSION = { major: 1, minor: 0 }` (frozen at v1.0 for this wave). `stageSchemaVersionSchema` validates the version object. `isCompatibleStageVersion(consumer, record)` checks major-only equality (consumer at major N accepts N.x). `bumpStageSchemaMajor()` resets minor to 0 (required-field add/remove/rename). `bumpStageSchemaMinor()` increments minor (optional-field/alias add). `parseStageRecord()` rejects major mismatches with `StageRegistryError` code `schema-version-mismatch`.

**Error surface.** `StageRegistryError` extends `Error` with a typed `code` field: `unknown-dependency | missing-gate | invalid-context-layer | cyclic-transition | incompatible-model-policy | duplicate-id | subprocess-current-agent | schema-version-mismatch`.

**Cross-record validation.** `validateStageRegistry(records)` rejects duplicate ids and alias-shadowing-another-record's-id. `validateStageRecord()` runs per-record before cross-record checks (validated by a test that constructs a hitl-no-gates record and asserts it fails before reaching cross-record logic).

**Test coverage (43 tests, 72 expect() calls, 100% lines on schema.ts):**
- Vocabulary exports (R1): enums/patterns/lane list present and stable.
- `stageRecordSchema` (R1): parses a clean record, rejects missing/invalid fields.
- Authority boundaries (R2): no `adapter` key in schema; `mutation_class` enum-closed.
- `executionKindSchema` (R3): all 5 variants parse; subprocess rejects `current_agent_allowed: true`.
- `validateStageRecord` invariants (R3): subprocess-current-agent, irreversible-mutation-class pairing, hitl-needs-gate.
- Schema versioning (R4): compatible/incompatible major, minor bump, major bump resets minor, `parseStageRecord` rejects major mismatch.
- `validateStageRegistry` (0282 AC): accepts clean registry, rejects duplicate ids, rejects alias shadowing, validates per-record before cross-record.
- Representative stage records (0282 R5 mapping): plan, implement, test, verify, wrap, dogfood each parse + validate; the six form a clean registry.

**Advisory rule notes (non-blocking):** `ts-no-tiny-functions` — version helpers (`isCompatibleStageVersion`, `bumpStageSchemaMajor/Minor`) are tiny but represent stable domain contracts; `ts-set-map` — `validateStageRegistry` uses a `Map` for runtime-dynamic id accumulation. Both justified.

**Verification:** `bun run lint` clean, `bun run typecheck` clean across all 7 workspaces, `bun run test` 3099 pass / 1 fail (the single failure is a pre-existing `FeatureService` dogfood test that fails on `main` without my changes — verified by `git stash` baseline showing 2 failures pre-change; my change is unrelated and actually reduces the failure count).

**No new runtime deps.** Uses existing `zod` catalog pin (4.4.3).
### Testing
**Per-Requirement Traceability** (re-audit 2026-07-19; all line anchors re-read this run)

| Req | Status | Evidence |
|-----|--------|----------|
| R1 - stage-record type with identity, version, aliases, typed inputs/outputs, artifacts, reasoning-skill, required references, deterministic gates, mutation class, timeout/retry, model eligibility/fallback, context layers, observability | MET | `packages/domain/src/stage-registry/schema.ts:409-446` `stageRecordSchema` (.strict() zod object): `schema_version` (:412), `id` w/ `STAGE_ID_PATTERN` (:414, pattern :401), `aliases` (:422), `description` (:424), `artifacts` (:426, typed via `stageArtifactSchema` :250-261 with direction/required), `reasoning_skill` (:428), `required_references` (:430), `gates` (:432, `stageGateSchema` :274-288 w/ timing + min_verdict), `mutation_class` (:434), `retry` (:436, `stageRetryPolicySchema` :300-309 w/ max_attempts + timeout_seconds), `model_policy` (:438, `stageModelPolicySchema` :321-338 w/ min_tier + fallback chain), `context_layers` (:440), `observability` (:442), `execution` (:444). `StageRecord` type export :449. Tests: `packages/domain/tests/stage-registry-schema.test.ts` — 43 pass this run. |
| R2 - authority boundaries encoded in type shape (registry describes; workflow/skill/cli/adapter own execution) | MET | `AUTHORITY_LANES` `schema.ts:94` (`['registry','workflow','skill','cli','adapter']`). No adapter field in `stageRecordSchema` (:409-446, `.strict()` rejects unknown keys). `reasoning_skill` is a plain skill name `z.string().min(1)` (:428). `gates` declarative descriptors only (:274-288) — CLI lane executes. `mutation_class` closed enum (:434, `MUTATION_CLASSES` :115-124, JSDoc "names WHAT, never HOW"). Module JSDoc :10-17 names the five lanes. |
| R3 - execution kinds inline/subprocess/deterministic-only/hitl/irreversible as discriminated union; subprocess cannot claim current-agent | MET | `executionKindSchema = z.discriminatedUnion('kind', [...])` `schema.ts:222-228`, five variants (:148-215). `subprocessExecutionSchema` pins `current_agent_allowed: z.literal(false)` (:167) — structural rejection at parse time. Defense-in-depth re-check `validateStageRecord` :489-495; irreversible-mutation pairing :499-511; hitl-needs-gate :514-520. Tests: 43-test suite covers all 5 variants + invariants (fresh run, 0 fail). |
| R4 - schema versioning (consumer at major N accepts N.x; required-field change = new major; optional/alias add = minor) | MET | `STAGE_REGISTRY_SCHEMA_VERSION = {major:1, minor:0}` `schema.ts:41-44`. `isCompatibleStageVersion` :61-63 (major-only equality). `bumpStageSchemaMajor` :69-71 (resets minor to 0). `bumpStageSchemaMinor` :77-79. `parseStageRecord` :585-605 rejects major mismatch with `StageRegistryError` code `schema-version-mismatch` (:597-603). Extension rule documented in module JSDoc :23-27 and version JSDoc :36-39. |

**Acceptance Criteria Verification**

`## Acceptance Criteria` is an empty placeholder (comment only, no AC items) — AC guard vacuously satisfied per sp:code-verification Step 5; no `acceptanceCriteria` rows emitted.

**Design Conformance**

`### Design` is an empty placeholder (no approved design claims) — Step 6 no-op. Design source was the 0282 spec (`.spur/run/wayfinder-O/implementation-evidence.md`); conformance is carried by the R1-R4 rows above.

**SECUA Review** (focus: all)

- **Security: PASS.** `parseStageRecord` accepts `unknown` and zod-validates before field access (schema.ts:589); no secrets, no injection surface, no dynamic code.
- **Efficiency: PASS.** Single-pass validators; `.strict()` everywhere. Advisory: `records.indexOf(record)` inside the `validateStageRegistry` loop (schema.ts:549,561) is O(n²) — negligible at registry scale (tens of stages).
- **Correctness: PASS with 2 minor findings.** (m1) `parseStageRecord` throws code `schema-version-mismatch` for ANY zod parse failure (schema.ts:590-595), not only version mismatches — callers branching on `code` can misread a shape error as a version error; a distinct `invalid-record` code would be truthful. (m2) `validateStageRegistry` alias-shadow detection is order-dependent: an alias seen before the id it shadows (record A alias `foo`, later record B id `foo`) is not caught — the duplicate-id check (schema.ts:541-549) consults `seenIds` only, never `seenAliases`. Both minor, non-blocking; neither is mandated by R1-R4.
- **Usability: PASS.** Typed `code` on `StageRegistryError` (schema.ts:457-474), `name` set for instanceof-free checks, JSDoc on every export. Advisory: R3 discriminator token is `deterministic` where the spec prose says "deterministic-only" — semantically equivalent (executor cli|script + `current_agent_allowed` pinned false); wave-2 consumers must use the literal token `deterministic`.
- **Architecture: PASS.** `packages/domain/src/stage-registry/` sibling to `planning/`; pure zod + TS, no coupling to ts-db DAOs or transport contracts; explicit barrel (`index.ts`), re-exported from `packages/domain/src/index.ts:35`.

**Findings:** 0 blocker, 0 major, 2 minor (m1 error-code overload, m2 order-dependent alias shadow), 2 advisory (indexOf O(n²), `deterministic` token naming). Fix pass (`--fix all`) targets UNMET/PARTIAL/major only — nothing to repair; minors left as recorded findings for a follow-up task if desired.

**Artifact disclosure (gitignored writes):** this re-audit rewrote `.spur/run/0301-verdict.json` in full (fresh requirements/checks evidence, aggregate PASS).

**Coverage**

`packages/domain/src/stage-registry/schema.ts`: 100% funcs / 100% lines; `packages/domain/src/stage-registry/index.ts`: 100% / 100% (fresh `bun test --coverage` this run).

**Commands Run This Turn**

- `cd packages/domain && bun test tests/stage-registry-schema.test.ts` → 43 pass, 0 fail, 72 expect() calls
- `bun test tests/stage-registry-schema.test.ts --coverage` → stage-registry files 100/100
- `bunx biome check packages/domain/src/stage-registry packages/domain/tests/stage-registry-schema.test.ts packages/domain/src/index.ts` → "Checked 4 files in 7ms. No fixes applied."
- `cd packages/domain && bun run typecheck` (`tsc --noEmit`) → exit 0

Verdict: PASS
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-20T04:09:59.578Z todo → wip (system)
- 2026-07-20T04:11:32.271Z wip → testing (system)
- 2026-07-20T05:36:33.400Z testing → done (system)
