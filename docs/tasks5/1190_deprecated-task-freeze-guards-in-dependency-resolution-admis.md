---
schema_version: 1
name: Deprecated task freeze guards in dependency resolution, admission, checks and status writes
status: done
template: feature-impl
created_at: 2026-10-13T16:56:12.968Z
updated_at: "2026-10-14T05:49:51.421Z"
feature_id: F43
priority: P2
estimate_hours: 6

dependencies: ["1189"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1190-verdict.json
---

## 1190. Deprecated task freeze guards in dependency resolution, admission, checks and status writes

### Background

Implements: R3 — New dependency links onto a deprecated task are refused before any write; R4 — A deprecated task never starts, advances or gets routed; R5 — Checks flag live dependents and section writes are warned about; R9 — Only status-moving writes are frozen, and existing edges are never rewritten.

Design: docs/design/task-deprecated-status.md §3.1 S6-S10, §3.2 (the exempt write set), §4.2; ADR-137.

Ordering: depends on the vocabulary slice — every guard names the status it refuses on.

### Requirements

- [x] R1. Refuse a new dependency edge onto a deprecated task in the ready-set resolver before any `depends_on` frontmatter is written (`packages/app/src/workflow/idea-handoff.ts:148,221` — the resolver that maps `depends_on_names` to WBS); the error names the deprecated task and the un-deprecate command (`spur task update <wbs> todo`).
- [x] R2. Refuse pipeline admission for a deprecated task: `quickReadiness` in `plugins/sp/scripts/batch-preflight.ts` reports it as non-runnable with its own code, and a deprecated task in the `--dep-status` set never reads as a satisfied dependency.
- [x] R3. Refuse the status move and name the exit: a `spur task update <wbs> <status>` that targets neither `todo` nor `cancelled` fails through the graph (ADR-135) with the un-deprecate hint added to the refusal message; confirm the auto-walk chain (`packages/app/src/services/task-service.ts:1834-1915`) finds no hop from `deprecated` and therefore performs no write.
- [x] R4. Emit a new warning `L4.task-deprecated` (`packages/config/src/finding-codes.ts:47,145`; raised in `packages/app/src/services/task-check.ts:1176` beside `L4_FEATURE_DEPRECATED`) for a live dependent of a deprecated task, naming re-point or un-deprecate; a terminal dependent gets no finding; `--strict` elevates per the existing policy.
- [x] R5. Make a section write on a deprecated task succeed with a freeze note in the returned `warnings[]` (`packages/app/src/services/task-service.ts:1470`, channel at :1550/:1589/:1649/:1663) instead of failing the write.
- [x] R6. Honour the exempt write set (`docs/design/task-deprecated-status.md` §3.2) and prove the freeze is prospective: the record hop, anchor migration and the verdict write still work on a deprecated task, while a pre-existing dependency edge onto a newly deprecated task is reported by R4 and never rewritten.

### Acceptance Criteria

- [x] AC3 — New dependency links onto a deprecated task are refused before any write
- [x] AC4 — A deprecated task never starts, advances or gets routed
- [x] AC5 — Checks flag live dependents and section writes are warned about
- [x] AC9 — Only status-moving writes are frozen, and existing edges are never rewritten

Task-local checks: the refusal messages name the un-deprecate command; a refused write leaves the task file byte-identical.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: attach each guard where the surface actually exists instead of mirroring F42 file-for-file.

Why: grounding the design against the tree found three mismatches with a literal mirror. (1) There is no `spur task advance` verb — the task-side forward path is the graph-mediated status write plus the auto-walk chain at `task-service.ts:1834-1915`, so the refusal and its hint belong there, and adding a verb only to have somewhere to refuse would be a public-surface expansion for no operator benefit. (2) `depends_on` has no write guard in `task-service.ts` at all; edges are authored at handoff time as `depends_on_names` (`idea-handoff.ts:148,221`) and consumed by the preflight, so the dependency freeze attaches at the resolver and the preflight. (3) `FeatureService.updateSection` already returns warnings, and `TaskService.updateSection` has the same channel — so the advisory belongs in the service, not in the CLI.

Rejected: refusing every write on a deprecated task. It would strand the evidence trail and the corpus-integrity hops (record, anchor migration, verdict), turn a mistaken freeze into a data-loss event, and contradict F42's own 'warnings, not errors' treatment.

Invariants: the freeze is prospective — an edge recorded before the deprecation is reported, never deleted or rewritten; admission refusal is reported by code, never by silence; a warning never turns a legal write into an error.

Key surfaces and signatures: `resolveReadySet(...)`-side refusal in `packages/app/src/workflow/idea-handoff.ts`; `quickReadiness(...)` + `FINDING_CODES` entry in `plugins/sp/scripts/batch-preflight.ts`; `L4_TASK_DEPRECATED = 'L4.task-deprecated'` in `packages/config/src/finding-codes.ts`; the deprecated-task branch in `packages/app/src/services/task-check.ts`; the `warnings.push(...)` branch in `TaskService.updateSection`.

Test-first note: write the failing cases before the code — dependency refusal on create/update/batch-create, admission refusal, refused status move with the hint, the finding for a live dependent, the warning on a section write, and the exempt hops that must still succeed.

### Plan

1. Write the failing cases for each guard (dependency refusal, admission, refused status move, finding, section-write warning, exempt hops).
2. Add the dependency refusal at the handoff resolver.
3. Add the preflight admission refusal and its code.
4. Add the un-deprecate hint to the status-write refusal and assert no write happens.
5. Add `L4.task-deprecated` plus the task-check branch.
6. Add the section-write warning.
7. Prove the exempt hops and the never-rewritten pre-existing edge.
8. Run the focused service, preflight and finding-code tests.

### Solution

- `packages/config/src/finding-codes.ts:48,154` — registered `L4.task-deprecated` in `ALL_FINDING_CODES` and `FINDING_CODES.L4_TASK_DEPRECATED`: one stable identity for the freeze finding, warning-severity by default so `--strict` elevates it and `tasks.severity` can override it like every other advisory.

- `packages/app/src/services/task-freeze.ts:10,15` — `isTaskFrozen` (case-insensitive, missing → false) and `undeprecateTaskCommand`: the one freeze predicate and exit command every guard below shares (review remediation P3, replacing duplicated `=== 'deprecated'` literals). Import-free so the plugin bundle of `planning-admission.ts` stays free of the domain barrel.

- `packages/app/src/services/task-check.ts:1225,1244` — `runL4`'s dependency-edge loop emits that finding for a LIVE dependent whose declared dependency resolves to `deprecated`, naming re-point or un-deprecate (`spur task update <dep> todo`); a terminal dependent is skipped, and the pre-existing edge is only read — never rewritten (the freeze is prospective).

- `packages/app/src/services/task-service.ts:1520,1587,1602` — `sectionWriteFreezeWarning` plus one `noteFreeze` at each exit: a section write on a deprecated task still lands, with the freeze note appended to the returned `warnings[]` exactly once (design §3.2 exempt write set; the record hop is the same channel).

- `packages/app/src/workflow/lifecycle-adapter.ts:451` — the `deprecated` branch of `formatDenialWithLegalPaths` appends the exit to the graph refusal: `spur task update <wbs> todo` (un-deprecate) or `cancelled` (remove), with the feature twin `spur feature update <id> active`. No new edge, no new verb — the refusal itself still comes from `task-lifecycle.yaml` through ADR-135.

- `packages/app/src/workflow/idea-handoff.ts:276` — the ready-set resolver probes each resolved dependency's status once per WBS and refuses the item before any `spur task deps set`, naming the deprecated task and the un-deprecate command; an unreadable probe yields no fabricated refusal.

- `packages/app/src/services/planning-admission.ts:151,195,315` — `quickReadiness` returns `skipped/DEPRECATED` for a deprecated task (including `verify --force`), a deprecated `--dep-status` value never reads as a satisfied dependency and the block carries the remedy, and `preflightTask` stops routing a deprecated task into the pipeline.

- `packages/app/src/services/task-service.ts:1155,1225,1391` — the reachable-writer half of the dependency freeze: `mutateDependencies` refuses a NEW edge whose target resolves to `deprecated` (`DependencyMutationError` code `deprecated`) before any write, naming the un-deprecate exit. The check is prospective — an edge already present in the current array is neither dropped nor rewritten — and `readTaskStatus` reads the sibling file's frontmatter status.

- `apps/cli/src/commands/task.ts:809` — the `spur task deps` help text names the ADR-137 freeze among the validations that run before any write.

- Generated twins — `plugins/sp/lib/plan-projection.generated.mjs`, `plugins/sp/scripts/batch-preflight.mjs` and `plugins/sp/scripts/batch-plan.mjs` carry the admission guard, and `plugins/sp/lib/{quality-gate,inline-run}.generated.mjs` plus `plugins/sp/scripts/quality-gate.mjs` carry the new finding code; all regenerated with `bun run build:scripts` (`bun run plugin-smoke` PASS, no `bun:sqlite` in the admission bundle).

Tests: `packages/app/tests/services/task-check.test.ts` (live dependent warns / terminal silent / edge byte-identical), `packages/app/tests/services/task-service.test.ts` (section-write freeze note exactly once; new edge onto deprecated refused, existing edge kept), `packages/app/tests/services/task-record.test.ts` (no forward hop; refusal writes nothing; the record hop is exempt), `packages/app/tests/workflow/idea-handoff.test.ts` (dependency refusal before any deps write), `packages/app/tests/workflow/lifecycle-adapter.test.ts` (denial hint), `plugins/sp/tests/batch-preflight.test.ts` (admission code + deprecated dep). The throws stay typed (`GuardDeniedError`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | A new dependency edge onto a deprecated task is refused before the write by `mutateDependencies` (`packages/app/src/services/task-service.ts:1228`, prospective — edges already present are skipped) and by the handoff resolver (`packages/app/src/workflow/idea-handoff.ts:276`). Tests green this run: `packages/app/tests/services/task-service.test.ts:1650`, `apps/cli/tests/commands/task.test.ts:1701` (exit 3, file unwritten), `packages/app/tests/workflow/idea-handoff.test.ts:159`. |
| R2 | MET | Admission skips a deprecated task and never reads a deprecated dependency as satisfied, naming the un-deprecate command (`packages/app/src/services/planning-admission.ts:161,205,325`). Tests green: `plugins/sp/tests/batch-preflight.test.ts:98,205,223` (35 pass / 0 fail). |
| R3 | MET | The denial message names the un-deprecate and remove exits for a deprecated source (`packages/app/src/workflow/lifecycle-adapter.ts:451`); the forward chain has no deprecated hop (`packages/app/src/services/pipeline-run-link.ts:19`). The record auto-walk to done is refused and the status stays deprecated (`packages/app/tests/services/task-record.test.ts:3255`). |
| R4 | MET | `L4.task-deprecated` is registered (`packages/config/src/finding-codes.ts:48,154`) and emitted for a live dependent of a deprecated task (`packages/app/src/services/task-check.ts:1251`). Tests green: `packages/app/tests/services/task-check.test.ts:2862,2886,2900`. |
| R5 | MET | A section write on a deprecated task lands with the freeze note (`packages/app/src/services/task-service.ts:1523,1605`). Tests green: `packages/app/tests/services/task-service.test.ts:2543,2563`. |
| R6 | MET | Exempt hops land on a deprecated task: record (`packages/app/tests/services/task-record.test.ts:3292`), body write (`packages/app/tests/services/task-service.test.ts:2572`), anchor migration (`apps/cli/tests/commands/task.test.ts:3732`). Existing edges are never rewritten (`packages/app/tests/services/task-service.test.ts:1664`, `packages/app/tests/services/task-check.test.ts:2913`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC3 — New dependency links onto a deprecated task are refused before any write | MET | test | `apps/cli/tests/commands/task.test.ts:1701` (deps add exits 3, file unwritten) and `packages/app/tests/services/task-service.test.ts:1650`; guard at `packages/app/src/services/task-service.ts:1228`. |
| AC4 — A deprecated task never starts, advances or gets routed | MET | test | `packages/app/tests/services/task-record.test.ts:3255` (walk to done refused, status unchanged); `plugins/sp/tests/batch-preflight.test.ts:98,205`; admission at `packages/app/src/services/planning-admission.ts:161,325`. |
| AC5 — Checks flag live dependents and section writes are warned about | MET | test | `packages/app/tests/services/task-check.test.ts:2862`; `packages/app/tests/services/task-service.test.ts:2543`; code `packages/app/src/services/task-check.ts:1251`, `packages/app/src/services/task-service.ts:1605`. |
| AC9 — Only status-moving writes are frozen, and existing edges are never rewritten | MET | test | `packages/app/tests/services/task-service.test.ts:1664,2572`; `packages/app/tests/services/task-record.test.ts:3292`; `apps/cli/tests/commands/task.test.ts:3732`; `packages/app/tests/services/task-check.test.ts:2913`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review Report — 1190 (round 3, closure pass)**
**Scope:** batch-2 commits `22fd7e968` (shared freeze predicate), `6c85fd472` (satellite anchors) plus this round's working-tree remediation on main (`packages/app/src/services/task-check.ts`, `packages/app/src/services/task-service.ts`, the record/handoff/migrate-anchors tests, satellite re-anchors). Supersedes round 2 below; every round-2 finding re-checked on the artifact.
**Dimensions:** functional traceability · SECUA · architectural depth · test quality
**Verdict:** PASS
**Confidence:** HIGH

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | architecture | Round 2 #1 — freeze literals duplicated across 8 sites. Converged: one predicate and one exit command, imported by every guard (admission, check, service, handoff); import-free so the plugin bundle stays free of the domain barrel. | `packages/app/src/services/task-freeze.ts:10` | RESOLVED (`22fd7e968`; users at `packages/app/src/services/planning-admission.ts:161`, `packages/app/src/services/task-check.ts:1251`, `packages/app/src/services/task-service.ts:1228`, `packages/app/src/workflow/idea-handoff.ts:276`) |
| 2 | P4 (advisory) | documentation | Round 2 #2 — satellite §2 denied the `task-service.ts` branch. Now names both writers and the refusal lines. | `docs/design/task-deprecated-status.md:54` | RESOLVED |
| 3 | P4 (advisory) | documentation | Round 2 #3 — `## Solution` anchor-subject mismatch. Re-pointed; `spur task check 1190` carries no anchor warning. | `docs/design/task-deprecated-status.md:79` | RESOLVED |
| 4 | P4 (advisory) | correctness | Round 2 #4 — `readTaskStatus` compared without lower-casing. Every comparison now routes through the case-insensitive predicate. | `packages/app/src/services/task-freeze.ts:11` | RESOLVED |
| 5 | P4 (advisory) | efficiency | Round 2 #5 — each dependency resolved twice. The check reads the already-resolved path; `mutateDependencies` keeps the step-2 resolution in a map for step 6. | `packages/app/src/services/task-check.ts:1246`; `packages/app/src/services/task-service.ts:1197` | RESOLVED |
| 6 | P4 (advisory) | test quality | Round 2 #6 — record test asserted a constant; handoff test mocked an "unreachable" state. The record test now drives a real PASS-verdict walk to `done` and asserts refusal plus an unchanged `deprecated` status; the handoff state is reachable (an agent step runs between batch-create and finalize, so a resumed run can meet an operator deprecation) and the test documents that. | `packages/app/tests/services/task-record.test.ts:3255`; `packages/app/tests/workflow/idea-handoff.test.ts:155` | RESOLVED |
| 7 | P4 (advisory) | test quality | Round 2 R6 gap — anchor migration had no direct proof on a deprecated task. Added: migrate-anchors qualifies a citation on a deprecated task and leaves the status `deprecated`. | `apps/cli/tests/commands/task.test.ts:3732` | RESOLVED |
| 8 | P4 (advisory) | functional | Design S10's "deprecated task's own advisory" not emitted — only a live dependent warns. Judged correct: F42's twin `L4.feature-deprecated` has one emission site, and a frozen record must not fail its own check. | `packages/app/src/services/task-check.ts:1251` | ACCEPTED |
| 9 | P4 (advisory) | functional | `preflightTask`'s `deprecated` branch is in scope, not creep: without it a deprecated task falls through to `run` (AC4). | `packages/app/src/services/planning-admission.ts:325` | ACCEPTED |
| 10 | P3 (minor) | documentation | Found by this round's post-check rule gate: the shared-predicate import landed between the module header and the exported status type, leaving the export without a doc comment (`every-export-has-tsdoc`). Doc comment added; the type also names `deprecated` now. | `packages/app/src/services/planning-admission.ts:14` | RESOLVED (`bun run test-post-check` → all rules pass) |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/task-service.ts:1228` refuses a NEW edge onto a deprecated target before the write; `packages/app/src/workflow/idea-handoff.ts:276` refuses in the handoff resolver. Tests `packages/app/tests/services/task-service.test.ts:1650`, `apps/cli/tests/commands/task.test.ts:1701`, `packages/app/tests/workflow/idea-handoff.test.ts:159` |
| R2 | MET | `packages/app/src/services/planning-admission.ts:161,205,325` |
| R3 | MET | graph refusal + hint; `packages/app/tests/services/task-record.test.ts:3255` walks the real chain |
| R4 | MET | `packages/app/src/services/task-check.ts:1251`; tests `packages/app/tests/services/task-check.test.ts:2862,2886,2900` |
| R5 | MET | `packages/app/src/services/task-service.ts:1523,1605`; test `packages/app/tests/services/task-service.test.ts:2543` |
| R6 | MET | record hop `packages/app/tests/services/task-record.test.ts:3292`; body hop `packages/app/tests/services/task-service.test.ts:2572`; anchor migration `apps/cli/tests/commands/task.test.ts:3732`; edge never rewritten `packages/app/tests/services/task-check.test.ts:2913` |

#### Dimension notes

- **SECUA.** No new input path; refusals precede every write; every refusal names the un-deprecate command. Efficiency improved (finding 5).
- **Architecture.** One predicate module at the seam all guards share; weak-locality signal from round 2 closed.
- **Test quality.** Each freeze test fails if its guard is removed; the prospective-edge test guards over-refusal.

#### Evidence (fresh, this round)

- `packages/app`: feature-service, task-service, task-check, task-record, task-freeze, idea-handoff suites → 582 pass / 0 fail.
- `apps/cli` task + embedded-schemas → 211 pass / 0 fail; migrate-anchors subset 6/6.
- `bun run test-pre-check` (51 rules) and `bun run test-post-check` pass.
- Biome clean; `bunx tsc -p packages/app --noEmit` clean; `bun run plugin-smoke` PASS.

**Next:** none — no open finding.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-13T20:25:09.335Z todo → wip (system)
- 2026-10-13T22:41:40.309Z wip → testing (system)
- 2026-10-13T22:43:15.286Z testing → done (system)

