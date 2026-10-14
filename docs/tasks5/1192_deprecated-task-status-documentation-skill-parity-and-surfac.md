---
schema_version: 1
name: Deprecated task status documentation, skill parity and surface-review closure
status: done
template: meta
created_at: 2026-10-13T16:56:12.970Z
updated_at: "2026-10-14T05:38:26.334Z"
feature_id: F43
priority: P3
estimate_hours: 3

dependencies: ["1189", "1190", "1191"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1192-verdict.json
---

## 1192. Deprecated task status documentation, skill parity and surface-review closure

### Background

Implements: R8 — Owner docs and skills record the vocabulary change and its affected surfaces.

Design: docs/design/task-deprecated-status.md §3.1 S13-S15; ADR-137; docs/00_ADR.md, docs/04_DESIGN.md. The design stage already wrote the ADR entry, the satellite and the 04 index row; this slice closes the remaining owners and the audit.

Ordering: last slice — it records what the earlier three landed, so its content depends on them.

### Requirements

- [x] R1. Update the status vocabulary and the lifecycle graph in `docs/design/planning-record-contracts.md` so the TASK_STATUSES list and the task graph match the shipped YAML, and keep `docs/design/rd3-migration-design.md` §2.3 consistent if it enumerates the task statuses.
- [x] R2. Update the `sp:spur-cli` task reference (`plugins/sp/skills/spur-cli/references/tasks.md`) with the `deprecated` status, its legal edges, the freeze guards and the exempt write set from the satellite's §3.2.
- [x] R3. Close the audit rows the design marked 'audit only' (`docs/design/task-deprecated-status.md` §3.1 S14): `plugins/sp/scripts/wrapup-steps.ts` and `plugins/sp/scripts/quality-gate.mjs` either need an explicit terminal-set review or an evidence-backed no-edit note, and S2/S15 (contracts, persistence, init template) get the same treatment with a verified result rather than an assumption.
- [x] R4. Confirm the design satellite's affected-surface table still matches the tree after the three implementation slices — update any anchor that moved and mark the ADR-137 status line from 'implementation pending' to implemented once the slices are verified.

### Acceptance Criteria

- [x] AC8 — Owner docs and skills record the vocabulary change and its affected surfaces

Task-local checks: every 'no edit needed' audit row names the command or read that proves it; no doc restates a status list that can drift from the enum.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: close the documentation owners and re-verify the satellite anchors rather than restating the design in new docs.

Why: the ADR entry, the satellite and the design index row already exist from the idea-pipeline design stage, so this slice must not duplicate them — duplicating a design record is how two sources of truth appear. What the design stage could not do is verify the 'audit only' rows against post-implementation reality, and anchors drift when the guards land.

Rejected: writing a second status-vocabulary list into the skills reference. Link to the satellite and state only the operator-facing facts (which statuses exist, what the freeze refuses, which hops stay permitted).

Invariants: no new authoritative claim without a file anchor; every 'no edit needed' row carries the command or read that proves it; the ADR status line never claims 'implemented' before the slices are verified.

Verification: a keyword scan of the touched docs and skills for a stale status list, plus a read-back of each updated owner section.

### Plan

1. Update the planning record contracts and any other status enumeration.
2. Update the task CLI skill reference with the frozen semantics and the exempt write set.
3. Audit the S14/S2/S15 rows and record the verified result for each.
4. Re-verify the satellite anchors against the tree and flip the ADR-137 status line.
5. Scan the touched docs for a stale status list.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

- `docs/design/planning-record-contracts.md:220` — §7.3.3's canonical `TaskStatus` vocabulary now lists `deprecated` (ADR-137) and matches `TASK_STATUSES` in `packages/domain/src/planning/schema.ts:20`; `:226` scopes the identity-alias note to ADR-136 (feature) / ADR-137 (task).

- `docs/design/rd3-migration-design.md:153` — §2.3's `TaskStatus` line gains `deprecated`, and the task graph at `:162-163` now matches the shipped `config/workflows/task-lifecycle.yaml`: admitted from `backlog`/`todo`/`wip`/`testing`/`blocked`/`done`, leaving only to `todo` (un-deprecate) or `cancelled` (removed), non-terminal (`:169`). The graph is the section's own subject, so the YAML is restated there rather than in the skill.

- `plugins/sp/skills/spur-cli/references/tasks.md:129` — the `backlog · todo · … · cancelled` enumeration is gone: the skill points at `TASK_STATUSES` (`packages/domain/src/planning/schema.ts`), the shipped graph and the design satellite, so no status list in the reference can drift from the enum.

- `plugins/sp/skills/spur-cli/references/tasks.md:140` — records only the operator-facing facts: `deprecated` is non-terminal and frozen, its legal edges (every status except `cancelled` → `deprecated`; `deprecated` → `todo`/`cancelled`), the two freeze guards (a new dependency edge is refused; a live dependent gets `L4.task-deprecated`), and the exempt write set from the satellite §3.2 (`record`, `migrate-anchors`/verdict writes, and `update --section`, which lands with a freeze warning).

- `docs/design/task-deprecated-status.md:72` — S2 closed as audit-only: all four contract status fields are `z.enum(TASK_STATUSES)` (`packages/contracts/src/task.ts:12,44,79,87`), the package owns no task-status list, and OpenAPI is built at runtime, so nothing regenerates.

- `docs/design/task-deprecated-status.md:84` — S14 closed as audit-only: `plugins/sp/scripts/wrapup-steps.ts:171` is its sole task-status terminal set and correctly excludes the non-terminal `deprecated`; `plugins/sp/scripts/quality-gate.mjs` is generated output whose only terminal set is run statuses (`plugins/sp/lib/quality-gate.generated.mjs:27498`) and whose bundled `TASK_STATUSES` already carries `deprecated`, so hand-editing it would desync the committed twin.

- `docs/design/task-deprecated-status.md:85` — S15 closed as audit-only: no `tasks` table exists in `drizzle/`, no DAO owns task status, and the status is frontmatter-only (`packages/domain/src/planning/schema.ts:20`).

- `docs/design/task-deprecated-status.md:74` — S4's init-template claim re-verified with its evidence: `apps/cli/src/config/scaffold-manifest.ts:33` lists no workflow entry and `apps/cli/src/commands/init.ts:152` seeds the bundled config copy wholesale, so the only task-lifecycle YAML an init produces is a copy of the canonical one.

- `docs/design/task-deprecated-status.md:43` — the satellite's anchors repointed after the 1190/1191 line shifts (`task-service.ts` auto-walk `1834–1915` → `1883–1964`, `idea-handoff.ts` resolver `221` → `256`, `feature-service.ts` closure `486` → `490` at `:56`), including rows S1 `:71`, S5 `:75`, S6 `:76`, S7 `:77`, S8 `:78` and S10 `:80`.

- `docs/design/task-deprecated-status.md:79` — rows S9/S11/S12 now name the files the slices actually touched: `packages/app/src/services/planning-admission.ts` (`:149,193,313`), `plugins/sp/skills/next-router/references/routing-table.md`, and `apps/web/src/modules/task-kanban/TaskCard.tsx:32` / `apps/web/src/modules/task-kanban/task-actions.ts:17`.

- `docs/00_ADR.md:2314` — ADR-137's status line reads `Accepted (implemented)`; both guard slices are `done` in this corpus, so the design stage's "implementation pending" no longer applies.

- `docs/design/planning-record-contracts.md:220` — the task's own verification: every `backlog … cancelled` enumeration in the five touched files either carries `deprecated` or is the live-task set (`backlog|todo|wip|testing|blocked`), which correctly excludes the frozen status.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/design/planning-record-contracts.md:220` and `docs/design/rd3-migration-design.md:153` list the eight statuses ending in deprecated, identical to `packages/domain/src/planning/schema.ts:20`; the lifecycle-contract table carries the same set and edges (`docs/design/planning-workflow-contracts.md:30`), matching `config/workflows/task-lifecycle.yaml:168,200,205` and `terminalStates` at `config/workflows/task-lifecycle.yaml:45`. |
| R2 | MET | `plugins/sp/skills/spur-cli/references/tasks.md:129` points at the enum instead of a list; `plugins/sp/skills/spur-cli/references/tasks.md:142` names the exact admitted source set; guards and exempt writes at `plugins/sp/skills/spur-cli/references/tasks.md:146,151`. |
| R3 | MET | Audit rows re-read: S4 cites `apps/cli/src/config/scaffold-manifest.ts:39` (`docs/design/task-deprecated-status.md:75`); the section-matrix status keys now derive from the enum (`packages/domain/src/planning/task-skeleton.ts:40`), so no second list survives. |
| R4 | MET | Satellite anchors re-pointed this run and re-read on subject: `docs/design/task-deprecated-status.md:54` -> `packages/app/src/services/task-service.ts:1228`; `docs/design/task-deprecated-status.md:77` -> `packages/app/src/services/task-service.ts:1498`; `docs/design/task-deprecated-status.md:78` -> `packages/app/src/services/task-service.ts:1930`; `docs/design/task-deprecated-status.md:81` -> `packages/app/src/services/task-check.ts:1251`. ADR status `docs/00_ADR.md:2314` reads Accepted (implemented). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC8 — Owner docs and skills record the vocabulary change and its affected surfaces | MET | command | Run this turn, exit 0: (1) `rg -n 'backlog · todo' docs/design/planning-record-contracts.md docs/design/rd3-migration-design.md docs/design/planning-workflow-contracts.md` → 4 hits, every task-status list ending in deprecated (`docs/design/planning-record-contracts.md:220`, `docs/design/planning-workflow-contracts.md:30`, `docs/design/rd3-migration-design.md:153,162`), equal to `packages/domain/src/planning/schema.ts:20`. (2) `bun apps/cli/src/index.ts workflow validate config/workflows/task-lifecycle.yaml` → `workflow valid: task-lifecycle`. (3) `(cd packages/domain && bun test tests/planning)` → 232 pass / 0 fail, covering the enum-derived section-matrix keys (`packages/domain/src/planning/task-skeleton.ts:40`). Skill reference `plugins/sp/skills/spur-cli/references/tasks.md:142` names the exact admitted set. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review Report — 1192 (round 2, closure pass)**
**Scope:** batch-2 commits `afa8fb1bb` (section-matrix status vocabulary) and `6c85fd472` (satellite anchors) plus this round's satellite re-anchors. Supersedes round 1; each round-1 finding re-checked on the artifact.
**Dimensions:** functional traceability · SECUA (doc truth) · architectural depth (SSOT) · verification quality
**Verdict:** PASS
**Confidence:** HIGH

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | SECUA (doc truth) | Round 1 #1 — lifecycle-contract table listed seven task states. Now carries `deprecated` with its legal edges. | `docs/design/planning-workflow-contracts.md:30` | RESOLVED |
| 2 | P3 (minor) | architecture (SSOT) | Round 1 #2 — `matrixStatusSchema` held a second 7-status list. Now `z.enum(TASK_STATUSES)`; JSON schema regenerated with `deprecated`. | `packages/domain/src/planning/task-skeleton.ts:40` | RESOLVED (`afa8fb1bb`) |
| 3 | P3 (minor) | verification quality | Round 1 #3 — S4 anchor landed on a blank line. Now cites the `SCAFFOLD_MANIFEST` declaration. | `docs/design/task-deprecated-status.md:75` | RESOLVED |
| 4 | P4 (advisory) | functional | Round 1 #4 — "every status except cancelled" shorthand. The reference now names the exact admitted set. | `plugins/sp/skills/spur-cli/references/tasks.md:142` | RESOLVED |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/design/planning-record-contracts.md:220`; `docs/design/rd3-migration-design.md:153` match `packages/domain/src/planning/schema.ts:20` |
| R2 | MET | `plugins/sp/skills/spur-cli/references/tasks.md:142` |
| R3 | MET | satellite audit rows re-read; S4 at `docs/design/task-deprecated-status.md:75` |
| R4 | MET | satellite anchors re-pointed this round to the shifted `packages/app/src/services/task-service.ts` lines (`:1228`, `:1498`, `:1930`) |

#### Evidence (fresh, this round)

- `packages/domain` planning suites → 232 pass / 0 fail; `apps/cli` embedded-schemas included in 211 pass / 0 fail.

**Next:** none — no open finding.

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-10-14T03:19:18.545Z todo → wip (system)
- 2026-10-14T04:29:36.313Z wip → testing (system)
- 2026-10-14T04:32:44.564Z testing → done (system)

