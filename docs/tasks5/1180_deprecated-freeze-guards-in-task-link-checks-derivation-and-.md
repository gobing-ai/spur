---
schema_version: 1
name: Deprecated freeze guards in task link, checks, derivation and advance
status: todo
template: feature-impl
created_at: 2026-10-12T05:21:53.039Z
updated_at: "2026-10-12T05:34:46.924Z"
feature_id: F42
priority: P1
tags:
  - feature-lifecycle
  - app

dependencies: ["1179"]
estimate_hours: 4
---

## 1180. Deprecated freeze guards in task link, checks, derivation and advance

### Background

Implements: R3 — New work cannot be linked to a deprecated feature; R4 — Checks flag live work under a deprecated feature and advise on edits; R5 — Derivation and routing never pull a deprecated feature back into active work.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surfaces S5–S12, S14 and the next-feature skill (S15). Depends on 1179 (enum + graph).

**Refine corrections (2026-10-11)**
- "Extend guard at create, update and batch-create separately" → all three route through `guardParentFeature` (`packages/app/src/services/task-service.ts:825`); batch-create calls it with `noReopen=true` in phase 1 (`:2052`) → one branch in that function covers every caller.
- "`advance` must be taught to refuse" → `advance` already stops because `forwardPath` (`apps/cli/src/commands/feature.ts:190`) has no `deprecated` key, emitting the generic "cannot reach … along the forward path" → only the un-deprecate hint is new.
- "`refresh` must not change status" → `refresh` is docs-only by contract (`apps/cli/src/commands/feature.ts:337`, "Does NOT change feature frontmatter status") → no change; R5 covers sync and `check --fix` only.
- "`check --fix` reopen" → the reopen repair targets only verifying/done (`docs/design/planning-record-contracts.md:110`) → no change needed; asserted in tests.
- "Section-write warning in the CLI" → `FeatureService.updateSection` (`packages/app/src/services/feature-service.ts:256`) already returns `warnings[]` and is shared by CLI and server → add the warning there, not in the CLI.
- Plugin scripts `plugins/sp/scripts/batch-preflight.ts:144,258` and `wrapup-steps.ts` read task statuses / `verifying` only → audited, no change.

### Requirements

- [ ] R1. `guardParentFeature` throws `ParentFeatureStatusError` for a `deprecated` parent regardless of `noReopen`, before any write; the message reads `parent-feature-status: feature <id> is deprecated (frozen); new tasks cannot link to it. Run removal work under its own feature, or un-deprecate: spur feature update <id> active`. Covers `task create --feature`, `task update --feature` and `task batch-create` (whole batch rejected, no task file written, no feature reopened).
- [ ] R2. `task check` emits warning `L4.feature-deprecated` (new `FINDING_CODES.L4_FEATURE_DEPRECATED` in `packages/config/src/finding-codes.ts`) for a live task (backlog/todo/wip/testing/blocked) under a deprecated feature, with guidance to re-parent (`spur task update <wbs> --feature <otherId>`) or cancel; terminal tasks get no finding; `--strict` elevates per existing policy.
- [ ] R3. `FeatureService.updateSection` on a deprecated feature writes the section and appends `Feature <id> is deprecated (frozen); change it only as part of removal` to `warnings[]`; exit code stays 0.
- [ ] R4. `deriveFeatureStatus` returns `{from: 'deprecated', to: 'deprecated', reason: 'Feature is deprecated (frozen)'}` before any task-based rule, so `spur feature sync` (incl. `--all`, `--force`) never changes it; `check --fix` leaves it unchanged.
- [ ] R5. `spur feature advance <id>` on a deprecated feature exits 1 with `<id> is deprecated; un-deprecate first: spur feature update <id> active` (GUARD_DENIED under `--json`) and makes no transition.
- [ ] R6. `plugins/sp/skills/next-feature/SKILL.md:67` drops `deprecated` alongside done/cancelled.
- Out of scope: override flag, Board (1181), docs beyond next-feature (1182).

### Acceptance Criteria

- [ ] AC1 — New work cannot be linked to a deprecated feature (req: R1)
- [ ] AC2 — Checks flag live work under a deprecated feature and advise on edits (req: R2, R3)
- [ ] AC3 — Derivation and routing never pull a deprecated feature back into active work (req: R4, R5, R6)

Verify lens: service tests observe the real guard and derivation (no mocked FeatureService); the E2E transcript observes CLI exit codes and file immutability.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** Put the freeze in the four existing seams so every transport inherits it: the parent link guard (task-service), the L4 feature-edge block (task-check), derivation (feature-service), and the section-write result (feature-service). `advance` only gains a precise message. Why: each seam is already the single funnel for its behavior (1132/1137), so no caller needs its own check.

**Frozen names.** Finding code `L4.feature-deprecated` / `FINDING_CODES.L4_FEATURE_DEPRECATED`, severity `warning`. Reuse `ParentFeatureStatusError` (status `deprecated`, `activeSiblings` still computed for the message). Messages exactly as in Requirements. No new flag, verb or option; `--no-reopen` is irrelevant for deprecated.

**Algorithm.**
- `guardParentFeature`: check `feature.status === 'deprecated'` before the `verifying` branch; throw with the deprecated message variant (extend the error constructor's message by status).
- `task-check.ts` (~`:1124`): sibling branch to `featureTerminal`; deprecated is not terminal, so the existing error branch never fires for it.
- `deriveFeatureStatus`: early return right after `from` is read, before the "no linked tasks" branch.
- `advance`: if `initial.status === 'deprecated'` → `writeJsonError(..., 'GUARD_DENIED')`, exit 1, before the loop.

**Files.** `packages/app/src/services/task-service.ts:207,825`; `packages/app/src/services/task-check.ts:1124`; `packages/config/src/finding-codes.ts:138`; `packages/app/src/services/feature-service.ts:256,452`; `apps/cli/src/commands/feature.ts:197`; `plugins/sp/skills/next-feature/SKILL.md:67`. Tests beside the existing 1132 guard / task-check / sync / advance tests in `packages/app/tests/services/` and `apps/cli/tests/`.

**Anti-patterns.** Do not make the finding an error (red gates on unrelated work). Do not reopen or auto-transition a deprecated parent. Do not block section writes. Do not special-case deprecated in `refresh`. Do not duplicate the guard in CLI handlers.

**Handoff.** Assumes 1179's enum and graph. Leaves message strings and the finding code for 1182 to document verbatim.

### Plan

- [ ] Step 0: 1179 merged (enum includes deprecated); `spur feature update <tmp> deprecated` works.
- [ ] Link guard branch + error message variant (R1); tests for create, update `--feature`, batch-create (no files written).
- [ ] Finding code + task-check branch (R2); tests for live vs terminal task.
- [ ] Section-write warning (R3); test asserts write landed and warning present.
- [ ] Derivation early return (R4); tests: sync with live and terminal tasks, `--force`, `check --fix`.
- [ ] `advance` refusal (R5); CLI test for human and `--json`.
- [ ] next-feature SKILL.md line (R6).
- [ ] E2E: temp project via source CLI covering R1–R5; transcript `.spur/run/1180-e2e.txt`.
- [ ] `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
