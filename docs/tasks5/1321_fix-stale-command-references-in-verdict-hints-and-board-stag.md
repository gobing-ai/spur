---
schema_version: 1
name: Fix stale command references in verdict hints and Board stage fallback
status: testing
template: issue
created_at: 2026-11-09T02:39:17.956Z
updated_at: "2026-11-09T03:12:38.365Z"

ac_altitude: task-local
ac_numbering: task-local
---

## 1321. Fix stale command references in verdict hints and Board stage fallback

### Background

Found by `/sp:dev-find-conflict --scope packages,apps,plugins,scripts --pillar all --mode full --resolve --auto` (2026-11-08). Two source strings point operators at command surfaces that do not exist:

- CF-1: `packages/app/src/services/task-record.ts` verdict-diagnostic messages tell the operator to run `spur task verify <wbs>`. No `task verify` verb exists (`spur task --help`); the verdict artifact `.spur/run/<wbs>-verdict.json` is produced by `/sp:dev-verify <wbs>` (which derives it via `spur task verdict`).
- CF-2: `apps/web/src/modules/settings/AgentsView.tsx` `DEFAULT_STAGE_DEFS` labels the brainstorm stage alias `/sp:brainstorm`. The shipped command is `/sp:dev-brainstorm` (`plugins/sp/commands/dev-brainstorm.md`; canonical alias `dev-brainstorm` in `packages/domain/src/stage-registry/schema.ts`).

### Requirements

- [x] R1. Every `readVerdictClassified` remediation hint names `/sp:dev-verify <wbs>` instead of the nonexistent `spur task verify <wbs>`.
- [x] R2. The Board fallback brainstorm stage alias reads `/sp:dev-brainstorm`.
- [ ] R3. Every Board fallback stage `skill` equals the canonical registry `reasoning_skill` the live server path renders.

### Acceptance Criteria

```gherkin
ac_altitude: task-local
ac_numbering: task-local

Scenario: AC1 — missing verdict hint names a real command (req: R1)
  Given a task with no verdict artifact
  When `spur task record` reads the verdict file
  Then the verdict message contains `/sp:dev-verify` and not `spur task verify`

Scenario: AC2 — Board fallback alias names the shipped command (req: R2)
  Given the Board renders default stages
  When the brainstorm stage is shown
  Then its alias is `/sp:dev-brainstorm`

Scenario: AC3 — Board fallback skills mirror the registry (req: R3)
  Given the Board renders default stages
  When the stage skill badges are shown
  Then each names the registry `reasoning_skill` and none names a stale agent or doc skill
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

- `packages/app/src/services/task-record.ts:205,214,227,236,254,266`: the hint text hard-coded `spur task verify`, a verb that was never registered under `apps/cli/src/commands/task/`.
- `apps/web/src/modules/settings/AgentsView.tsx:25-113`: a hand-maintained fallback copy of the stage table drifted from the canonical registry (`packages/domain/src/stage-registry/schema.ts:726`). The alias was `/sp:brainstorm` instead of `dev-brainstorm`. The `skill` values named agents or docs skills instead of the `reasoning_skill` that the server renders as `skill` (`apps/server/src/modules/health/index.ts:363`).

### Solution

- `packages/app/src/services/task-record.ts:205,214,227,236,254,266`: all six verdict hints now name `/sp:dev-verify ${fallbackWbs}`.
- `apps/web/src/modules/settings/AgentsView.tsx:51`: the fallback brainstorm alias is now `/sp:dev-brainstorm`.
- `apps/web/src/modules/settings/AgentsView.tsx:39,47,63,79,103,111`: the fallback `skill` values now equal the registry `reasoning_skill`. plan/refine/wrap → `sp:spur-dev`, implement → `sp:code-implementation`, review → `sp:code-verification`, changelog → `inline`. The registry is the authority because the live path's tooltip reads "Reasoning skill" and the server fills it from `reasoning_skill`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-record.ts:205` six hints now name `/sp:dev-verify` (lines 205,214,227,236,254,266); `packages/app/tests/services/task-record.test.ts:2526-2527` asserts presence and absence; bun test task-record.test.ts 148 pass / 0 fail |
| R2 | MET | `apps/web/src/modules/settings/AgentsView.tsx:51` alias `/sp:dev-brainstorm`; `apps/web/tests/modules/settings/agents-view.test.ts:68-75`; bun test agents-view.test.ts 3 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — missing verdict hint names a real command (req: R1) | MET | test | `packages/app/tests/services/task-record.test.ts:2526` — 148 pass / 0 fail; fails 1 with source fix reverted |
| Scenario: AC2 — Board fallback alias names the shipped command (req: R2) | MET | test | `apps/web/tests/modules/settings/agents-view.test.ts:73` — 3 pass / 0 fail; fails 1 with source fix reverted |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | full-suite | — | 12532 pass / 10 fail — all 10 are 1279 process-table fixtures; sandbox blocks `ps`; unrelated to this diff |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-09T02:39:38.631Z todo → wip (system)
- 2026-11-09T02:55:32.722Z wip → testing (system)

