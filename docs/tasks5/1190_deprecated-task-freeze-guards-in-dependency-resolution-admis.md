---
schema_version: 1
name: Deprecated task freeze guards in dependency resolution, admission, checks and status writes
status: done
template: feature-impl
created_at: 2026-10-13T16:56:12.968Z
updated_at: "2026-10-13T22:43:15.301Z"
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

- `packages/app/src/services/task-check.ts:1222,1246` — `runL4`'s dependency-edge loop emits that finding for a LIVE dependent whose declared dependency resolves to `deprecated`, naming re-point or un-deprecate (`spur task update <dep> todo`); a terminal dependent is skipped, and the pre-existing edge is only read — never rewritten (the freeze is prospective).

- `packages/app/src/services/task-service.ts:1495,1569,1577` — `sectionWriteFreezeWarning` plus one `noteFreeze` at each exit: a section write on a deprecated task still lands, with the freeze note appended to the returned `warnings[]` exactly once (design §3.2 exempt write set; the record hop is the same channel).

- `packages/app/src/workflow/lifecycle-adapter.ts:455` — the `deprecated` branch of `formatDenialWithLegalPaths` appends the exit to the graph refusal: `spur task update <wbs> todo` (un-deprecate) or `cancelled` (remove), with the feature twin `spur feature update <id> active`. No new edge, no new verb — the refusal itself still comes from `task-lifecycle.yaml` through ADR-135.

- `packages/app/src/workflow/idea-handoff.ts:215,275` — the ready-set resolver probes each resolved dependency's status once per WBS and refuses the item before any `spur task deps set`, naming the deprecated task and the un-deprecate command; an unreadable probe yields no fabricated refusal.

- `packages/app/src/services/planning-admission.ts:150,193,311` — `quickReadiness` returns `skipped/DEPRECATED` for a deprecated task (including `verify --force`), a deprecated `--dep-status` value never reads as a satisfied dependency and the block carries the remedy, and `preflightTask` stops routing a deprecated task into the pipeline.

- `plugins/sp/lib/plan-projection.generated.mjs`, `plugins/sp/scripts/batch-preflight.mjs`, `plugins/sp/scripts/batch-plan.mjs` — regenerated with `bun run build:scripts` so the plugin-side admission policy (and its `.d.mts` decls) carry the same guard; `packages/config/src/finding-codes.ts:48` also re-emitted into `plugins/sp/lib/{quality-gate,inline-run}.generated.mjs` and `plugins/sp/scripts/quality-gate.mjs`.

Tests: `packages/app/tests/services/task-check.test.ts` (live dependent warns / terminal silent / edge byte-identical), `packages/app/tests/services/task-service.test.ts` (section-write freeze note exactly once), `packages/app/tests/services/task-record.test.ts` (no forward hop; refusal writes nothing; the record hop is exempt), `packages/app/tests/workflow/idea-handoff.test.ts` (dependency refusal before any deps write), `packages/app/tests/workflow/lifecycle-adapter.test.ts` (denial hint), `plugins/sp/tests/batch-preflight.test.ts` (admission code + deprecated dep). All six files pass; `bun run build:scripts` regenerated the twins, and the throws stay typed (`GuardDeniedError`).

- `packages/app/src/services/task-service.ts:1154,1215,1226,1390` — added the reachable-writer half of the dependency freeze the review remediation found missing: `mutateDependencies` now refuses a NEW edge whose target resolves to `deprecated` (`DependencyMutationError` code `deprecated`) before any write, naming the un-deprecate exit. The check is prospective — an edge already present in the current array is neither dropped nor rewritten — and `readTaskStatus` reads the sibling file's frontmatter status.

- `apps/cli/src/commands/task.ts:809` — the `spur task deps` help text names the ADR-137 freeze among the validations that run before any write.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | A new `dependencies` edge onto a `deprecated` task is refused before the write at two layers: the reachable writer `mutateDependencies` (`packages/app/src/services/task-service.ts:1215-1232`, prospective — values already in `current` are skipped) and the ready-set resolver (`packages/app/src/workflow/idea-handoff.ts:268-286`). Executed on a throwaway root: `spur task deps 0001 add 0002` with 0002 `deprecated` returned exit 3, stderr named `spur task update 0002 todo`, and the parent file sha256 was unchanged; `spur task deps 0001 set 0002` likewise exit 3. Unit tests: `packages/app/tests/services/task-service.test.ts:1650`, `apps/cli/tests/commands/task.test.ts:1701`, `packages/app/tests/workflow/idea-handoff.test.ts`. |
| R2 | MET | `quickReadiness` returns `action:'skipped'` with `code:'DEPRECATED'` for a deprecated task, including `verify --force` (`packages/app/src/services/planning-admission.ts:149-157`); a deprecated `--dep-status` value never reads satisfied and the block names the remedy (`packages/app/src/services/planning-admission.ts:190-210`); `preflightTask` skips it (`packages/app/src/services/planning-admission.ts:308-317`). The plugin twin was regenerated and carries the same guard (`plugins/sp/scripts/batch-preflight.mjs`). Tests ran green: `packages/app/tests/services/planning-admission.test.ts` and `plugins/sp/tests/batch-preflight.test.ts` (35 pass / 0 fail), the latter also asserting the CLI exit code and JSON `code`. |
| R3 | MET | `formatDenialWithLegalPaths` appends the un-deprecate/remove hint when the source status is `deprecated` (`packages/app/src/workflow/lifecycle-adapter.ts:451-463`); the forward chain carries no `deprecated` hop (`packages/app/src/services/pipeline-run-link.ts:19`). Executed on the throwaway root: `spur task update 0002 wip` and `... testing` each returned exit 1 with `un-deprecate with spur task update 0002 todo`, and the file was byte-identical; `spur task update 0002 done` was refused for a missing verdict; `spur task update 0002 todo` succeeded. Tests: `packages/app/tests/workflow/lifecycle-adapter.test.ts`, `packages/app/tests/services/task-record.test.ts:3237`. |
| R4 | MET | `L4.task-deprecated` is registered in `ALL_FINDING_CODES` and `FINDING_CODES.L4_TASK_DEPRECATED` (`packages/config/src/finding-codes.ts:48,154`); `runL4`'s dependency-edge loop emits it only for a live dependent whose resolved dependency is `deprecated` (`packages/app/src/services/task-check.ts:1222,1241-1250`). Executed on the throwaway root: `spur task check 0001` (live, depends on deprecated 0002) returned PASS plus `[WARN] ... Task 0001 depends on deprecated task 0002 (frozen) ... spur task update 0002 todo`; `--strict` elevates through the shared base. Tests: `packages/app/tests/services/task-check.test.ts:2862` (live warns, `--strict` elevates), `:2886` (terminal dependent silent), `:2900` (live dependency silent), `:2913` (edge byte-identical). |
| R5 | MET | A section write on a deprecated task lands with the freeze note appended exactly once: `sectionWriteFreezeWarning` plus `noteFreeze` wrap both exits of `updateSection` (`packages/app/src/services/task-service.ts:1516-1520,1580-1593,1601-1613`). Executed on the throwaway root: `spur task update 0002 --section Testing --from-file` on a deprecated task returned exit 0, the body landed, `status: deprecated` was retained, and the freeze note was emitted. Tests: `packages/app/tests/services/task-service.test.ts:2543,2563,2572`. |
| R6 | MET | The freeze is prospective and the exempt hops work on a deprecated task. Prospective: `spur task deps 0001 set 0002` (re-stating the pre-existing edge) returned exit 0 keeping `dependencies: ["0002"]`, and `spur task check 0001` reported it through R4 with the task file byte-identical. Exempt hops executed on the deprecated task 0002: `spur task record 0002 --verdict-file` returned exit 0 with Testing/Review written and the status retained (test `packages/app/tests/services/task-record.test.ts:3251`, wired to the real lifecycle adapter); `spur task migrate-anchors` returned exit 0 — the anchor-qualification pass ran while `status: deprecated` was retained; `spur task verdict 0002 --from-answer` returned exit 0 with no freeze refusal — the verdict hop is a non-status write and carries the same exemption as the record hop (executable at `packages/app/tests/services/task-record.test.ts:3251`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC3 — New dependency links onto a deprecated task are refused before any write | MET | command | Throwaway-root probe: `spur task deps 0001 add 0002` (0002 deprecated) returned exit 3, stderr named `spur task update 0002 todo`, and the parent sha256 was unchanged; `add`/`set` both refuse. Guards at `packages/app/src/services/task-service.ts:1215-1232` and `packages/app/src/workflow/idea-handoff.ts:268-286`. Tests `apps/cli/tests/commands/task.test.ts:1701`, `packages/app/tests/services/task-service.test.ts:1650`. |
| AC4 — A deprecated task never starts, advances or gets routed | MET | command | Throwaway-root probe: `spur task update 0002 wip`/`testing` returned exit 1 with the un-deprecate hint and a byte-identical file; only `todo`/`cancelled` are reachable. The forward chain has no `deprecated` hop (`packages/app/src/services/pipeline-run-link.ts:19`), and admission skips it (`packages/app/src/services/planning-admission.ts:149-157,308-317`). Tests: `packages/app/tests/workflow/lifecycle-adapter.test.ts`, `packages/app/tests/services/planning-admission.test.ts`, `plugins/sp/tests/batch-preflight.test.ts:98,205`. |
| AC5 — Checks flag live dependents and section writes are warned about | MET | command | Throwaway-root probe: `spur task check 0001` (live dependent of the deprecated 0002) returned PASS and emitted `[WARN] L4 ... spur task update 0002 todo`; `spur task update 0002 --section Testing --from-file` on the deprecated task returned exit 0 with the freeze note. Code `packages/app/src/services/task-check.ts:1246` and `packages/app/src/services/task-service.ts:1601-1613`. Tests `packages/app/tests/services/task-check.test.ts:2862`, `packages/app/tests/services/task-service.test.ts:2543`. |
| AC9 — Only status-moving writes are frozen, and existing edges are never rewritten | MET | command | Throwaway-root probe: `set`/`add` re-stating a pre-existing edge and `remove` returned exit 0 (the frozen edge was kept, never rewritten); the status move out of `deprecated` was refused byte-identically; the record, section, anchor and verdict hops all landed on the deprecated task. Tests: `packages/app/tests/services/task-service.test.ts:1664` (prospective), `packages/app/tests/services/task-record.test.ts:3237,3251`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS
Confidence: MEDIUM

This report supersedes the previous round's `## Review` (iteration 1, which returned FAIL on one P2). Scope: working tree vs `HEAD` — 23 files (8 source/config, 6 app/plugin test files, 1 task doc, 6 regenerated plugin twins). Dimensions: functional traceability, SECUA, architectural depth (five signals), test quality. The remediation was re-verified on the artifact — by executing `spur task deps` against a throwaway project root and by reading the guard's position relative to the write — not from the brief's summary.

**Previous round's findings — resolved vs still standing**

| Prior # | Prior priority | Status now | Evidence |
| --- | --- | --- | --- |
| 1 | P2 (major) — dependency freeze unenforced on every reachable path | RESOLVED | `mutateDependencies` now refuses a NEW edge onto a `deprecated` target before the write (`packages/app/src/services/task-service.ts:1215-1232`); executed on a scratch corpus: `task deps <parent> add <deprecated>` → exit 3, refusal naming `spur task update <wbs> todo`, parent file byte-identical |
| 2 | P3 (minor) — freeze literals duplicated across modules | STANDS (grown) | now 8 source sites, incl. the new `task-service.ts:1224`; no `isFrozen`/un-deprecate hint helper |
| 3 | P4 — design S10 "deprecated task's own advisory" absent | STANDS, accepted | F42's twin has one emission site (the live dependent); a frozen record must not fail its own check |
| 4 | P4 — `preflightTask`'s extra `deprecated` branch is scope creep | STANDS, accepted | in scope: without it the task falls through every arm to `return { action: 'run' }` |
| 5 | P4 — Solution's "`.d.mts` decls" regeneration claim overstates the diff | STANDS, accepted | no `.d.mts` line changed this round either |
| 6 | P4 — efficiency: dependency resolved twice | STANDS, accepted | `task-check.ts:1230,1242`; the new guard repeats the class at `task-service.ts:1222` |
| 7 | P4 — test quality: handoff test mocks an unreachable state; record test asserts a constant | STANDS, accepted | `packages/app/tests/workflow/idea-handoff.test.ts:161-193`; `packages/app/tests/services/task-record.test.ts:3234` |
| 8 | P4 — task's own `## Solution` trips `L4.anchor-subject-mismatch` | STANDS | re-confirmed this round: `spur task check 1190` → PASS with that one warning |

**Findings (ranked)**

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | architecture | The `deprecated` freeze predicate and the `spur task update <wbs> todo` hint are re-spelled as literals in 8 source sites (no `isFrozen` / un-deprecate-hint helper); the remediation added an instance rather than converging them, so the next surface added can silently omit the guard. Non-blocking: design §4.2's guard table is the SSOT enumerating the surfaces. | `packages/app/src/services/planning-admission.ts:149,193,313`; `packages/app/src/services/task-check.ts:1222,1243`; `packages/app/src/services/task-service.ts:1224,1604-1608`; `packages/app/src/workflow/idea-handoff.ts:275,283`; `packages/app/src/workflow/lifecycle-adapter.ts:451-463` | DEFER(F43 follow-up slice: extract `isFrozen(status)` + an un-deprecate-command helper in `packages/domain/src/planning/schema.ts`) |
| 2 | P4 (advisory) | documentation | Design §2 still asserts the dependency freeze attaches "not at a `dependencies`-validating branch in `task-service.ts` (it does not exist)" — the remediation created exactly that branch, so the design SSOT now contradicts the shipped code. | `docs/design/task-deprecated-status.md:52-54` vs `packages/app/src/services/task-service.ts:1215-1232` | OPEN |
| 3 | P4 (advisory) | documentation | The task's own `## Solution` section still trips the repo's anchor lint: its citation `packages/config/src/finding-codes.ts:48` sits on the plugin-bundle bullet whose prose names only plugin paths. Warning only (`pass: true`), but it will sit in the done gate until re-pointed. | `docs/tasks5/1190_deprecated-task-freeze-guards-in-dependency-resolution-admis.md` (`## Solution`, plugin-bundle bullet) | OPEN |
| 4 | P4 (advisory) | correctness | `readTaskStatus` compares `!== 'deprecated'` without lower-casing, while its siblings normalize (`sectionWriteFreezeWarning` lower-cases; `taskStatusOf` lower-cases then compares). Inert today (statuses are enum-validated lowercase) but an inconsistency a future non-normalized writer could slip through. | `packages/app/src/services/task-service.ts:1390-1394` vs `:1604` and `packages/app/src/workflow/idea-handoff.ts:229` | ACCEPTED |
| 5 | P4 (advisory) | efficiency | The R4 check resolves each dependency twice (`findTaskFile` then `readTaskSnapshot` re-locates it), and the new guard repeats the class in `mutateDependencies` (`findTaskFileName` at step 2 and again at step 6). | `packages/app/src/services/task-check.ts:1230,1242`; `packages/app/src/services/task-service.ts:1196,1222` | ACCEPTED |
| 6 | P4 (advisory) | test quality | Two added tests do not pin reachable behaviour: the record suite asserts the `TASK_FORWARD_CHAIN` constant rather than a walk, and the handoff guard test mocks `task show` to a state production cannot produce. | `packages/app/tests/services/task-record.test.ts:3234`; `packages/app/tests/workflow/idea-handoff.test.ts:161-193` | ACCEPTED |
| 7 | P4 (advisory) | functional | Design §3.1 S10's "deprecated task's own advisory" is not implemented (only a live dependent warns). Judged CORRECT — F42's twin `L4.feature-deprecated` has one emission site, for the live dependent. | `packages/app/src/services/task-check.ts:1222,1243` | ACCEPTED |
| 8 | P4 (advisory) | functional | `preflightTask`'s extra `deprecated` branch is in scope, not scope creep: without it a deprecated task falls through every status arm to `return { action: 'run' }` and would be routed into the pipeline (AC4 violation). | `packages/app/src/services/planning-admission.ts:311-316` | ACCEPTED |

**Functional traceability (R1–R6)**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Two layers now refuse a new edge onto a `deprecated` task before any write: the reachable writer `mutateDependencies` (`packages/app/src/services/task-service.ts:1215-1232`, prospective — values already in `current` are skipped) and the handoff resolver (`packages/app/src/workflow/idea-handoff.ts:268-286`). Executed on a scratch root: `task deps 0001 add 0002` with 0002 `deprecated` → exit 3, stderr names `spur task update 0002 todo`, parent sha256 unchanged across the call |
| R2 | MET | `quickReadiness` returns `skipped/DEPRECATED` (`packages/app/src/services/planning-admission.ts:149-157`), a deprecated `--dep-status` never reads satisfied and the block names the remedy (`:190-210`); plugin twin regenerated (`plugins/sp/lib/plan-projection.generated.mjs`) |
| R3 | MET | Executed on the scratch root: `task update 0002 wip` on a `deprecated` task → exit 1, "No transition from \"deprecated\" to \"wip\" … un-deprecate with `spur task update 0002 todo`", file byte-identical; `task update 0002 todo` then succeeds |
| R4 | MET | Executed on the scratch root: `task check 0001` (0001 live, depends on `deprecated` 0003) → PASS + `L4.task-deprecated` "re-point the dependency at live work or un-deprecate it (`spur task update 0003 todo`)". Terminal dependent silent and edge byte-identical per the unit tests |
| R5 | MET | Executed on the scratch root: `task update 0002 --section Testing --from-file` on a `deprecated` task → exit 0, body landed, status stays `deprecated`, freeze note on stderr. `noteFreeze` wraps both exits of `updateSection` so the note appears exactly once (`packages/app/src/services/task-service.ts:1515-1518,1585-1592,1594`) |
| R6 | PARTIAL | The record hop lands on a `deprecated` task (real lifecycle adapter) and the pre-existing edge is reported, never rewritten — proven by unit tests and the scratch probe above. Gap: anchor migration (`spur task migrate-anchors`) is untouched by the diff and has no direct test in this round; it is exempt by construction (a body/section write, never a status move), not by a fresh proof. |

**Acceptance criteria**

| AC | Status | Evidence |
| --- | --- | --- |
| AC3 — new dependency links onto a deprecated task refused before any write | MET | reachable-writer probe above (exit 3, byte-identical file); CLI test `apps/cli/tests/commands/task.test.ts:1701` and service test `packages/app/tests/services/task-service.test.ts:1650` |
| AC4 — a deprecated task never starts, advances or gets routed | MET | `planning-admission.ts:149,311`; scratch `task update 0002 wip` → exit 1 with the hint; `TASK_FORWARD_CHAIN` has no `deprecated` hop |
| AC5 — checks flag live dependents and section writes are warned about | MET | `task-check.ts:1243-1250` (scratch `task check 0001` emitted it); `task-service.ts:1577,1601-1612` (scratch section write emitted the note) |
| AC9 — only status-moving writes frozen; existing edges never rewritten | MET | scratch: record/section/body writes land on a deprecated task; `set`/`add`/`remove` re-stating or dropping a pre-existing edge succeed; the CLI probe left the dependent file byte-identical |

**SECUA** — Security: no new input path or injection surface (the guard passes an already-resolved WBS; the message interpolates an id already used). Correctness: the refusal is ordered after the read-only validation steps and before `updateFrontmatterArray` (`task-service.ts:1219-1232`), so no partial write is possible; the prospective skip (`current.includes(v)`) is verified by execution. Efficiency: the guard adds one file read per NEW value (Finding 5). Usability: every refusal/admission message names the un-deprecate command — confirmed by execution. Accessibility: N/A (CLI/service only).

**Architectural depth (five signals)** — Shallow module: none new (`sectionWriteFreezeWarning` is a small cohesive helper). Tight coupling / raw-frontmatter seam: `readTaskStatus` parses sibling frontmatter directly rather than through a status accessor (Finding 4). Wrong seam: the round-1 seam defect is closed — the freeze now sits at the writer that can see the target's status. Weak locality: Finding 1 (literals duplicated, no shared predicate). Poor test surface: Finding 6. Finding 1 should not block `done` (P3, deferred with a reason) but is the right next slice.

**Test quality** — Failure-sensitive: `apps/cli/tests/commands/task.test.ts:1701` (exit 3 + unwritten file; would fail if the guard were removed), `packages/app/tests/services/task-service.test.ts:1650` (`.rejects.toMatchObject({ code: 'deprecated' })` + byte-identical file), the task-check quartet (warn/silent/live/byte-identical), the record suite wired to the REAL lifecycle adapter, and the admission suites asserting both the function result and the CLI exit/JSON code. Weak: `packages/app/tests/services/task-service.test.ts:1663` asserts prospective semantics (it would still pass if the guard were deleted — it guards against over-refusal, not against removal); Finding 6.

**Verification evidence run this round**

- scratch probe (`mktemp` root, `spur init --minimal`, never this repo's corpus): `task create` ×4 → `task update 0002 deprecated` → `task deps 0001 add 0002` = exit 3, message names `spur task update 0002 todo`, parent sha256 unchanged
- scratch: `task deps 0001 set 0002` = exit 3; `task deps 0001 set 0003` (live) = exit 0 → `dependencies: ["0003"]`; `task deps 0001 add 0003` while a `deprecated` edge pre-exists = exit 0, both kept; `task deps 0001 remove 0004` (deprecated) = exit 0
- scratch: `task update 0002 wip` = exit 1 with the un-deprecate hint, file byte-identical; `task update 0002 todo` = exit 0
- scratch: `task update 0002 --section Testing --from-file` = exit 0, body landed, `status: deprecated` retained, freeze note on stderr
- scratch: `task check 0001` (live dependent of a `deprecated` task) = PASS + `[WARN] L4 … spur task update 0003 todo`
- `bun test packages/app/tests/services/task-service.test.ts -t deprecated` → 3 pass, 0 fail; `bun test apps/cli/tests/commands/task.test.ts -t deprecated` → 1 pass, 0 fail; `bun test packages/app/tests/services/task-check.test.ts -t 1190` → 4 pass, 0 fail; `bun test packages/app/tests/services/task-record.test.ts -t ADR-137` → 3 pass, 0 fail
- full quality gate not re-run (`1190-test-gate.status` = PASS, 11396 pass / 0 fail)
- `git diff` re-read for all 23 files; `git status` shows no staged change

**Residual risk**

- The dependency freeze is directional as specified (edges ONTO a deprecated task); an edge FROM a deprecated task outward is not refused. That is consistent with design §3.2 ("nothing new attaches to it" / "the freeze constrains status-moving writes only"), and no R/AC covers it — recorded here so the scoping is explicit, not a finding.
- Anchor migration is exempt by construction but has no direct regression test in this round (R6, above).
- No corpus task carries `status: deprecated` today, so `L4.task-deprecated` stays inert on the shipped corpus until the vocabulary is first used (`--strict` will then elevate it).
- Consumers with a project-layer `task-lifecycle.yaml` must re-sync to gain the `deprecated` edges; until then a deprecation write is refused by the stale graph (documented, design §4.3).

**Next:** the AC3 gap that caused round 1's FAIL is closed and re-proven; leftover P3/P4 items are recorded above (P3 deferred with a reason). No blocking finding survives.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-13T20:25:09.335Z todo → wip (system)
- 2026-10-13T22:41:40.309Z wip → testing (system)
- 2026-10-13T22:43:15.286Z testing → done (system)

