---
template: feature-impl
schema_version: 1
name: "Implement the CLI-safe canonical task-section verb"
description: ""
status: done
type: task
profile: standard
feature_id: H5
parent_wbs: null
priority: P1
tags: ["wave-1", "cli", "sections", "feature-O"]
dependencies: []
created_at: "2026-07-20T01:54:25.288Z"
updated_at: "2026-08-18T04:42:47.667Z"
---

## 0304. Implement the CLI-safe canonical task-section verb

### Background

Wave-1 of feature O (0290 R4). Provide a CLI-safe way to initialize/add canonical (wayfinder) task sections or an approved template/variant, so corpus sections are created through the gate rather than hand-authored. Spec: .spur/run/wayfinder-O/implementation-evidence.md (## 0290) and docs/tasks2/0290_*.md.

### Requirements
R1. Add a validated CLI path to initialize or add canonical task sections (or an approved template/variant) without direct file edits (0290 R4).
R2. Enforce the section matrix and task-write guard on the new path; reject unknown or out-of-order sections (0290 R5).
R3. Keep JSON schema, runtime, and help text in sync so the SSOT cannot drift (0290 R6).
R4. Provide acceptance tests and record how feature O sequencing is represented until the gap ships (0290 R8).
### Acceptance Criteria
**Given** a task with variant `feature-impl` and status `todo`
**When** the CLI runs `spur task sections <wbs> list --json`
**Then** exit code is 0, and JSON output includes `op: "list"`, the `matrix` object with `required`/`optional`/`forbidden` arrays, `present` (sections in file), and `missing` (required sections not yet present).

**Given** a task where some required sections for its current status are absent
**When** the CLI runs `spur task sections <wbs> init`
**Then** exit code is 0, every missing required section is added to the file with guidance comments, and `added` lists the sections that were written.

**Given** a task where all required sections are already present
**When** the CLI runs `spur task sections <wbs> init`
**Then** exit code is 0, `added` is an empty array, and warnings note that all sections are already present.

**Given** a task where canonical section `Notes` is not yet present
**When** the CLI runs `spur task sections <wbs> add Notes`
**Then** exit code is 0, `Notes` appears in the task file with its guidance comment, and `added` includes `Notes`.

**Given** any task
**When** the CLI runs `spur task sections <wbs> add "Bogus Section"`
**Then** exit code is 3 (validation error), and the error message includes `unknown-section`.

**Given** a task where canonical section `Notes` is already present
**When** the CLI runs `spur task sections <wbs> add Notes`
**Then** exit code is 0, `added` is empty, and warnings note the section is already present.

**Given** any valid task
**When** the CLI runs `spur task sections <wbs> frobnicate` (unknown op), `spur task sections <wbs> add` (missing name), or `spur task sections <wbs> init Background` (extra arg)
**Then** each exits with code 2 and an appropriate usage error message.

**Given** a WBS that does not correspond to any task file
**When** the CLI runs `spur task sections 7777 list`
**Then** exit code is 1 (generic error).

**Given** the shipped `section-matrix.yaml`
**When** `TASK_CANONICAL_SECTIONS`, `FEATURE_CANONICAL_SECTIONS`, or `sectionNameSchema` change
**Then** `bun run lint` (Biome + tsc) catches the drift because the matrix schema, runtime types, and help descriptions share the same source-of-truth constants from `@gobing-ai/spur-domain`.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

**D1. Follow `deps` command pattern (0303).** The `sections` command mirrors the proven `deps` CLI structure: argument parsing → op validation → `TaskService` method → JSON output → exit codes (0/1/2/3). Zero novel patterns.

**D2. Service-layer ops: `init`, `add`, `list`.**
- `init` — idempotent: add all missing required sections for the task's current variant/status.
- `add <name>` — single section: reject unknown sections, reject forbidden-by-matrix sections, idempotent if already present.
- `list` — read-only: resolve the section matrix entry for the current variant/status and return `required`/`optional`/`forbidden`, `present`, and `missing`.

**D3. Write pipeline inheritance.** All writes go through `planning-write-service.updateSection`, inheriting phantom-section guards, atomic writes, history timestamps, and PlanningEvent emissions. No new write path.

**D4. Universal sections relaxation.** `UNIVERSAL_SECTIONS` (`History`, `References`, `Notes`) are always allowed regardless of matrix declarations. `Notes` is the only universal section not pre-seeded by `buildTaskSkeleton`, making it the natural test target for the `add` path.

**D5. `canonicalSections` getter fix.** `MarkdownDocument.canonicalSections` previously omitted `UNIVERSAL_SECTIONS`, causing `validateSectionName` to reject `Notes`. Fixed to include them (deduped).

**D6. SECTION_GUIDANCE as default body.** When adding a section, the body is the guidance comment from `task-skeleton.ts:SECTION_GUIDANCE`, matching what `buildTaskSkeleton` produces for the same section. This ensures visual consistency between freshly-created tasks and section-initialized tasks.
### Plan
<!-- Already implemented; recorded for audit trail. -->

- [x] 1. Add `SectionMutationError` to `task-service.ts` (after `DependencyMutationError`)
- [x] 2. Add `SectionMutationResult` interface to `task-service.ts`
- [x] 3. Add `mutateSections` method to `TaskService` (init/add/list)
- [x] 4. Export from `packages/app/src/index.ts`
- [x] 5. Add `sections` CLI command in `apps/cli/src/commands/task.ts`
- [x] 6. Fix `canonicalSections` in `markdown-document.ts` to include `UNIVERSAL_SECTIONS`
- [x] 7. Write 15 acceptance tests in `apps/cli/tests/commands/task.test.ts`
- [x] 8. Full test suite: 3177 pass, 0 fail
### Solution
| File | Lines | What |
|------|-------|------|
| `packages/app/src/services/task-service.ts` | 99-115 | `SectionMutationError` class (usage/no-matrix/unknown-section/forbidden) |
| `packages/app/src/services/task-service.ts` | 117-139 | `SectionMutationResult` interface |
| `packages/app/src/services/task-service.ts` | 414-426 | `renderSectionGuidanceBody` helper |
| `packages/app/src/services/task-service.ts` | 695-846 | `mutateSections` method (init/add/list) |
| `packages/app/src/services/task-service.ts` | 22 | `UNIVERSAL_SECTIONS` import |
| `packages/app/src/index.ts` | 175, 186 | Export `SectionMutationResult`, `SectionMutationError` |
| `apps/cli/src/commands/task.ts` | 13, 30 | `SectionMutationError`, `UNIVERSAL_SECTIONS` imports |
| `apps/cli/src/commands/task.ts` | 425-499 | `sections` command (init/add/list, --json, --folder) |
| `packages/domain/src/planning/markdown-document.ts` | 324-328 | `canonicalSections` getter fixed to include `UNIVERSAL_SECTIONS` |
| `apps/cli/tests/commands/task.test.ts` | 842-1102 | 16 CLI acceptance tests |
| `packages/app/tests/services/task-service.test.ts` | 1043-1127 | 2 service-level partial-write tests |

**Verify-pass amendments (2026-07-20, `/sp:dev-verify --fix all`)**

Line anchors were re-derived during verification; the original table cited
`renderSectionGuidanceBody` at `387-401`, which resolves to `stripLeadingSectionHeader` /
`sectionIsBare`. Corrected to `414-426`.

| File | Lines | Change | Finding |
|------|-------|--------|---------|
| `packages/app/src/services/task-service.ts` | 130 | `eventName` doc narrowed: undefined for `list` **and** for `init`/`add` no-ops | P3 |
| `packages/app/src/services/task-service.ts` | 779-791, 806-816 | No-op `add`/`init` no longer claim `eventName: 'task.updated'` — no write occurred, so no `PlanningEvent` was emitted | P3 |
| `packages/app/src/services/task-service.ts` | 817-845 | `init` write loop now reports which sections landed when a write fails part-way; the raw throw previously discarded that progress. Batching into one atomic write would require a new pipeline kind, which D3 rules out — so the loop stays, but partial state is now observable and recoverable via idempotent re-run | P4 |
| `apps/cli/src/commands/task.ts` | 30, 440 | Help text interpolates `UNIVERSAL_SECTIONS.join(', ')` instead of hardcoding "History, References, Notes", closing a prose-drift vector tsc cannot type-check | P4 |
| `apps/cli/tests/commands/task.test.ts` | 899-955 | New test: `init` adds every missing required section with guidance comments (AC2 positive path, previously uncovered) | AC2 |
| `apps/cli/tests/commands/task.test.ts` | 1026-1028 | New assertion: no-op `add` reports `eventName: undefined` | P3 |
| `packages/app/tests/services/task-service.test.ts` | 1043-1127 | New `mutateSections` block: mid-loop write failure names the landed sections; idempotent re-run completes the remainder | P4 |
### Testing
**Commands run** (verify pass, 2026-07-20)

```bash
bun test apps/cli/tests/commands/task.test.ts --test-name-pattern "sections"
# 16 pass, 0 fail

bun test packages/app/tests/services/task-service.test.ts --test-name-pattern "partial-write"
# 2 pass, 0 fail

bun run test    # 3177 pass, 3 fail (pre-existing, see below), 204 files
bun run lint    # biome 503 files clean + tsc green across 7 workspaces
bun run build   # all workspaces exit 0
bun run apps/cli/src/index.ts task check 0304 --strict-core   # 0304 (done): PASS
```

**On the 3 suite failures.** `createServerContext > processInventory()` and two `rpc client >
fetchWithTimeout` cases fail in this sandbox (port-bind / EPERM denials). Confirmed
**pre-existing and unrelated** by stashing all 0304 files and re-running: baseline is
3161 pass / **the same 3 fail**. With 0304 applied: 3177 pass / same 3 fail — net +16 passing,
zero new failures. The original Testing claim of "3177 pass, 0 fail" was not reproducible in this
environment and has been corrected to observed numbers.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — validated CLI path to init/add canonical sections, no direct file edits | MET | `apps/cli/src/commands/task.ts:425-499`; `packages/app/src/services/task-service.ts:695-846`. Live probe on a minimal fixture: `sections 0001 init --json` → exit 0, `added: ["Acceptance Criteria","Design","Plan"]`, guidance comments written. |
| R2 — enforce section matrix + task-write guard; reject unknown/out-of-order | MET | Unknown/forbidden rejection `packages/app/src/services/task-service.ts:770-778`; all writes route through `writeService.updateSection` (`task-service.ts:791,827`), inheriting phantom-section guards + atomic writes. Ordering enforced by construction via `CANONICAL_INDEX` (`packages/domain/src/planning/task-skeleton.ts:108`) — probe emitted Background → Acceptance Criteria → Design → Plan in canonical order, not append order. |
| R3 — JSON schema, runtime, help text share SSOT so it cannot drift | MET | `sectionNameSchema = z.enum(TASK_CANONICAL_SECTIONS)` (`packages/domain/src/planning/task-skeleton.ts:25`) feeds `matrixEntrySchema`. **Drift experiment executed this run:** renamed `'Root Cause'` → `'Root Causes'` in `packages/domain/src/planning/markdown-document.ts:40`; `bun run typecheck` failed TS2353 in 4 workspaces (domain, spur, app, server); reverted and lint re-confirmed green. Help text now interpolates `UNIVERSAL_SECTIONS` (`task.ts:440`) rather than hardcoding the names — the last prose-drift vector is closed. |
| R4 — acceptance tests + record feature O sequencing | MET | 16 CLI tests `apps/cli/tests/commands/task.test.ts:842-1102` + 2 service tests `packages/app/tests/services/task-service.test.ts:1043-1127`, all passing. Feature O sequencing recorded in `### References` + `### Background`. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| `list --json` → exit 0, `op:"list"`, matrix/present/missing | MET | test | `apps/cli/tests/commands/task.test.ts:844`; live probe returned all five keys |
| `init` adds every missing required section, `added` lists them | MET | test | `apps/cli/tests/commands/task.test.ts:899-955` — **added by this verify pass**; previously UNMET (no test exercised the positive path) |
| `init` when all present → `added: []` + warnings | MET | test | `apps/cli/tests/commands/task.test.ts:867`, `:884` |
| `add Notes` → exit 0, `Notes` in file with guidance, `added:["Notes"]` | MET | test | `apps/cli/tests/commands/task.test.ts:958-977` |
| `add "Bogus Section"` → exit 3, message includes `unknown-section` | MET | test | `apps/cli/tests/commands/task.test.ts:998-1010` |
| `add Notes` when present → exit 0, `added: []`, warning | MET | test | `apps/cli/tests/commands/task.test.ts:979-996`, `:1012-1030` |
| unknown op / `add` w/o name / `init` w/ extra arg → exit 2 | MET | test | `apps/cli/tests/commands/task.test.ts:1032`, `:1043`, `:1054`, `:1068` |
| `sections 7777 list` → exit 1 | MET | test | `apps/cli/tests/commands/task.test.ts:1097-1102` |
| matrix/runtime/help stay in sync; `bun run lint` catches drift | MET | command | Drift experiment above — TS2353 across 4 workspaces, then reverted |

**SECUA findings — all closed**

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | P2 | Solution table cited `renderSectionGuidanceBody` at `387-401`; those lines hold `stripLeadingSectionHeader`/`sectionIsBare`. Actual: `414-426`. | FIXED — all anchors re-derived in `### Solution` |
| 2 | P3 | No-op `add`/`init` returned `eventName: 'task.updated'` despite performing no write and emitting no `PlanningEvent` — misleading to any consumer treating the field as write proof. | FIXED — `task-service.ts:779-791,806-816`; doc narrowed at `:130`; regression assertion `apps/cli/tests/commands/task.test.ts:1026-1028` |
| 3 | P4 | CLI help prose hardcoded "History, References, Notes"; a change to `UNIVERSAL_SECTIONS` would drift silently since tsc cannot check a string literal. | FIXED — `task.ts:30,440` interpolate `UNIVERSAL_SECTIONS.join(', ')`; verified via `task sections --help` |
| 4 | P4 | `init` wrote one section per `updateSection` call, so a mid-loop failure left the file partially initialized and the raw throw discarded which sections had landed. | FIXED — `packages/app/src/services/task-service.ts:817-845` reports the landed set and points at the idempotent re-run. A single batched write would need a new pipeline kind, which D3 forbids, so the loop is retained by design. Covered by `packages/app/tests/services/task-service.test.ts:1043-1127`. |

**Coverage**

18 tests total: 16 CLI integration + 2 service-level. Cover list/init/add, all four exit codes
(0/1/2/3), idempotency on both write ops, the positive init write loop, mid-loop write failure and
recovery, JSON envelope shape, and human-readable output.

| Operation | Tests | Scenarios |
|-----------|-------|-----------|
| list | 4 | JSON shape, human output, usage error (extra arg), non-existent task |
| init | 6 | Positive multi-section write, idempotent fully-seeded, across status transitions, extra-arg usage, partial-write reporting, idempotent recovery |
| add | 6 | New section (Notes), idempotent, pre-seeded universal no-op + `eventName` contract, unknown-section rejection, missing-name usage |
| error paths | 2 | Unknown op, missing name |

Gitignored fix-pass writes: `.spur/run/0304-verdict.json` (verdict artifact only).
### Review

| Priority | Status | Note |
|----------|--------|------|
| P1 | DONE | `SectionMutationError` with stable codes maps to CLI exit codes |
| P1 | DONE | Task-write guard inherited from `planning-write-service.updateSection` |
| P2 | DONE | `canonicalSections` fix is backward-compatible (558 domain tests green) |
| P2 | DONE | Section matrix SSoT integrity (R6): `sectionNameSchema`, `TASK_CANONICAL_SECTIONS`, and `section-matrix.yaml` share the same constant exports |
| P3 | DONE | 0303 pattern reuse: zero novel patterns, same error/result shapes |
| P4 | ACCEPTED | Bundled `spur.js` is stale; `sections` command available via `bun run apps/cli/src/index.ts task sections ...`. Will be resolved on next `build:bundle`. |


None. The implementation is a thin CLI facade over existing `planning-write-service.updateSection`; all validation is at the service layer, and all edge cases (unknown sections, forbidden sections, idempotency, usage errors) have dedicated tests.


**PASS** — mergeable.
### References

O

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-21T00:38:02.725Z todo → wip (system)
- 2026-07-21T00:38:08.828Z wip → testing (system)
- 2026-07-21T00:38:21.572Z testing → done (system)
