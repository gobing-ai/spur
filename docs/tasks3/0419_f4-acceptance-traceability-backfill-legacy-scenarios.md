---
template: standard
schema_version: 1
name: "F4 acceptance traceability backfill (legacy scenarios)"
description: ""
status: done
type: task
profile: standard
feature_id: F4
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-03T03:08:05.430Z"
updated_at: "2026-08-03T03:25:52.507Z"
---

## 0419. F4 acceptance traceability backfill (legacy scenarios)

### Background
Feature F4's four original acceptance scenarios were delivered by wave-1/2 tasks 0049, 0053,
0055, 0059 (all `done`), but those task files predate the `### Acceptance Criteria` template, so
no linked task covers them. The feature-coverage check (DD-09) stayed dormant until 0418 became
the first modern task under F4; the `/sp:dev-verify 0418 --fix all` shippable step then surfaced
all four scenarios as `L4.uncovered-feature-scenario` errors, blocking F4's `verifying → done`
transition.

Migrating the four legacy files' frontmatter to the current schema is a separate corpus-migration
work item (their `feature-id` hyphen form fails frontmatter validation on write). This task is the
traceability backfill: assert the four scenarios' implementations against their existing,
already-green tests, and carry the DD-09 coverage edge in one modern task so the corpus's own
rules can see what the code already proves.
### Requirements
- R1. **Write-service exclusivity is evidenced.** The 9-step sequence and the
  guard-failure-leaves-file-byte-identical property are located in
  `packages/app/src/services/planning-write-service.ts` and proven by its existing test suite.
- R2. **File-wins rehydration is evidenced.** The DD-04 re-seed of engine state from frontmatter
  and the corrective `workflow.run.reseeded` event are located in the lifecycle adapter and the
  dual-workflow engine, and proven by the existing adapter test.
- R3. **Verifying observability is evidenced.** `spur feature list --status verifying` lists F4,
  and the `verifying → done` edge is guarded by `feature check --strict`.
- R4. **Derived events are evidenced.** The rebuild-from-history path is located in
  `packages/domain/src/planning/rebuild-events.ts` and proven by the drop-DB-rebuild-compare test.
- R5. **The coverage edge is registered.** This task's AC carries the four feature scenario
  titles so `spur feature check F4 --strict` reports no `L4.uncovered-feature-scenario` finding
  for them, with a PASS verdict artifact marking each scenario MET.
### Acceptance Criteria
```gherkin
Feature: F4 acceptance traceability backfill

  Scenario: No mutation bypasses the write service
    Given any task or feature mutation from any transport
    When it executes
    Then it runs the 9-step sequence (lock, parse, mutate, validate, lifecycle, atomic write, history, event, unlock)
    And a failed guard leaves the file byte-identical

  Scenario: The file wins over engine state
    Given a task whose engine run state disagrees with frontmatter status
    When the next transition is requested
    Then the run is re-seeded from the file
    And a corrective event is emitted

  Scenario: Verifying makes feature acceptance observable
    Given a feature whose linked tasks are all done
    When it transitions to verifying
    Then it appears in feature list --status verifying
    And verifying→done requires feature check --strict to pass

  Scenario: Events are derived and rebuildable
    Given a corpus with history sections
    When the events tables are rebuilt from files
    Then deleting the DB loses no planning state
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Chosen approach:** one modern task carries the DD-09 coverage edge for all four legacy F4
scenarios, rather than migrating four legacy task files to the current frontmatter schema.

**Why not migrate the legacy files:** 0049/0053/0055/0059 predate the current schema (`feature-id`
hyphen form, no `schema_version`) and are rejected by the write service on any mutation
(`Frontmatter validation failed: Invalid input: expected 1`). A schema migration is its own
corpus work item with rollback semantics — far beyond a traceability backfill. The legacy tasks
remain the historical record; this task is the compliance edge.

**Why one task, not four:** the coverage rule needs each feature scenario covered by ≥1 linked
task's AC and verified by ≥1 done task with a PASS verdict + MET row. One task with all four
scenarios satisfies both in a single verdict artifact; four tasks would quadruple the ceremony
with no additional evidence.

**Evidence discipline:** no new production code. Every claim cites implementation that already
exists plus the existing test that proves it, re-run in this session (52 pass / 0 fail across the
three suites). Line anchors use full repo-relative paths to satisfy `L4.stale-line-anchor`.
### Plan
- [x] Locate the implementation + proving test for each of the four legacy scenarios (R1–R4).
- [x] Re-run the three proving suites fresh this session (52 pass / 0 fail).
- [x] Register the coverage edge: this task's AC carries the four exact feature scenario titles.
- [x] Emit the PASS verdict artifact with MET rows keyed to the four scenario titles.
- [x] Confirm `spur feature check F4 --strict` drops all four `L4.uncovered-feature-scenario`
      errors and transition F4 `verifying → done`.
### Solution
**Evidence map (no new production code — traceability backfill):**

- R1 (write-service exclusivity): 9-step sequence at `packages/app/src/services/planning-write-service.ts:325-443`
  (Step 1 lock `:335`, Step 2 parse `:353`, Step 3 mutate `:380`, Step 4 validate `:393`, Step 5
  lifecycle `:411`, Step 6 atomic write `:431`, Step 7 history `:435`, Step 8 event `:443`, Step 9
  unlock `:344`). Guard-failure atomicity proven by
  `packages/app/tests/services/planning-write-service.test.ts:417` ("aborts with zero partial writes
  on guard denial (R3)" — byte-identical assertion `:425-430`) and `:532` (lock released on denial).
- R2 (file wins over engine state): re-seed before every transition at
  `packages/app/src/workflow/lifecycle-adapter.ts:184-187` (frontmatter is the SSOT); corrective
  event `workflow.run.reseeded` emitted by the engine's `reseedRun` (ts-libs
  dual-workflow-engine service.ts, lines 140-145 — outside this repo, hence no backtick anchor). Proven by
  `packages/app/tests/workflow/lifecycle-adapter.test.ts:103` ("re-seed makes a fresh run transition
  from the file status, not the initial state").
- R3 (verifying observability): `spur feature list --status <s>` filter at
  `apps/cli/src/commands/feature.ts:212-222`; live run lists F4 as `verifying`. The
  `verifying → done` edge requires the strict check via
  `config/workflows/feature-lifecycle.yaml:60` (`feature check <id> --strict --as done`).
- R4 (derived, rebuildable events): `packages/domain/src/planning/rebuild-events.ts:38`
  (`parseHistoryLine`), `:62` (`historyEntryToEvent`), `:83` (`extractHistoryEvents`) — design §2.5
  rebuild rule (drop DB, recreate, replay history). Proven by
  `packages/domain/tests/planning/rebuild-events.test.ts:94` ("rebuild from corpus: drop DB,
  rebuild, compare — proves derived-only") and `:151` (migration 0003 creates `planning_events`).
- R5 (coverage edge): this task's `### Acceptance Criteria` carries the four exact F4 scenario
  titles; the PASS verdict artifact at `.spur/run/0419-verdict.json` marks each MET.
### Testing
All commands re-run on **2026-08-03** (initial run) and re-audited on **2026-08-03** (`/sp:dev-verify 0419 --force`); every `file:line` anchor re-read at the cited lines in the re-audit.

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/planning-write-service.ts:325-443` — the 9-step sequence (lock `:335`, parse `:353`, mutate `:380`, validate `:393`, lifecycle `:411`, atomic write `:431`, history `:435`, event `:443`, unlock `:344`); `packages/app/tests/services/planning-write-service.test.ts:417-435` proves a denied guard leaves the file byte-identical with zero partial writes; `:532` proves the lock is released on denial. |
| R2 | MET | `packages/app/src/workflow/lifecycle-adapter.ts:184-187` — `reseedRun` forces the engine's state to the file's frontmatter status before every transition; corrective `workflow.run.reseeded` event emitted by the engine's `reseedRun` (ts-libs dual-workflow-engine service.ts, lines 140-145 — outside this repo, hence no backtick anchor); `packages/app/tests/workflow/lifecycle-adapter.test.ts:103` proves a fresh run transitions from the file status, not the engine initial state. |
| R3 | MET | `apps/cli/src/commands/feature.ts:212-222` — `--status` filter, re-verified against the live corpus (`feature list --status done` now returns F4 — it passed through `verifying` observably; F4 History records `2026-08-03T03:13:27.645Z verifying → done (system)`). `config/workflows/feature-lifecycle.yaml:60` — `verifying → done` runs `feature check <id> --strict --as done`. |
| R4 | MET | `packages/domain/src/planning/rebuild-events.ts:38,62,83` — history parse → event conversion → extraction per design §2.5; `packages/domain/tests/planning/rebuild-events.test.ts:94` drops the DB, rebuilds from corpus history, and compares — proving no planning state lives only in the DB; `:151` covers migration 0003. |
| R5 | MET | `spur feature check F4 --strict --json` this session: zero `L4.uncovered-feature-scenario` and zero `L4.scenario-unverified` findings (was 4 + 4 before this task). |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: No mutation bypasses the write service | MET | test | `packages/app/tests/services/planning-write-service.test.ts:417-435,532` — 9-step pipeline + byte-identical-on-guard-denial + lock release. Suite re-run this session: part of 52 pass / 0 fail. |
| Scenario: The file wins over engine state | MET | test | `packages/app/tests/workflow/lifecycle-adapter.test.ts:103` — re-seed from file status before transition; corrective event traced to the engine emit site. Suite re-run this session. |
| Scenario: Verifying makes feature acceptance observable | MET | command | `spur feature list --status verifying --json` → F4 present; `config/workflows/feature-lifecycle.yaml:60` strict guard on `verifying → done` (guard chain exercised live during 0418's F2 `verifying → done` recovery). |
| Scenario: Events are derived and rebuildable | MET | test | `packages/domain/tests/planning/rebuild-events.test.ts:94,151` — drop-DB/rebuild/compare + migration test. Suite re-run this session. |

**Commands run this session**

| Command | Result |
|---------|--------|
| `bun test packages/app/tests/services/planning-write-service.test.ts packages/app/tests/workflow/lifecycle-adapter.test.ts packages/domain/tests/planning/rebuild-events.test.ts` | 52 pass / 0 fail, 146 expect() calls, 3 files |
| `spur feature list --status verifying --json` | F4 listed (`verifying`) |
| `spur feature check F4 --strict --json` | pass=true (after this task's verdict artifact landed) |

Coverage: N/A (traceability backfill — no runtime code path added; the proving suites are the
pre-existing tests cited above).

**Fix-pass writes (gitignored, disclosure).** `.spur/run/0419-verdict.json` written this run
(PASS aggregate, 5 requirement rows + 4 AC rows keyed to the F4 scenario titles). No other
`.spur/**` mutation.
### Review
**Priority findings**

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | Traceability | `docs/tasks/0049_*`, `docs/tasks/0053_*`, `docs/tasks/0055_*`, `docs/tasks/0059_*` | Four legacy F4 tasks predate the current frontmatter schema (`feature-id` hyphen form, no `schema_version`) and are rejected by the write service on mutation (`Frontmatter validation failed: Invalid input: expected 1`). Their scenario coverage had to be backfilled here instead of on the delivering tasks. | Accepted: corpus schema migration is a separate work item with its own rollback semantics; this task is the interim compliance edge. File as follow-up if legacy tasks need future edits. |

No P1, P2, or P3 findings.

**Functional traceability**

All five requirements MET with fresh evidence — see `### Testing` for the per-requirement and
per-AC tables with `file:line` anchors re-read this session. Functional verdict: **PASS**.

**SECUA**

- **Security** — N/A: no production code changed; read-only evidence citations.
- **Efficiency** — N/A: no runtime paths touched.
- **Correctness** — every claim is backed by an existing test re-run this session (52 pass /
  0 fail across the three proving suites), not by inspection alone.
- **Usability** — the four scenario titles are copied verbatim from F4's AC so the DD-09
  normalized matcher resolves the coverage edge without aliases.
- **Architecture** — one task carrying all four scenarios is the minimal corpus mutation that
  satisfies both coverage and verification; four tasks would add ceremony, not evidence.

SECUA verdict: **PASS** — no findings above P4.

**Residual risk**

- The coverage edge is concentrated in this one task: if 0419's verdict artifact is deleted, F4
  reverts to 4× `L4.scenario-unverified`. Mitigant: the artifact lives at the canonical
  `.spur/run/0419-verdict.json` path the feature checker reads, and the evidence it cites is in
  tracked test files.
- Legacy task schema migration remains open; any future edit to 0049/0053/0055/0059 needs it.

**Disposition: PASS — no blocking findings.**
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-03T03:12:59.219Z todo → wip (system)
- 2026-08-03T03:12:59.870Z wip → testing (system)
- 2026-08-03T03:13:14.635Z testing → done (system)
