---
schema_version: 1
name: Wrapup repair step must tolerate a missing learnings status file
status: todo
template: issue
created_at: 2026-10-10T02:50:01.484Z
updated_at: "2026-10-10T16:25:39.380Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 1
---

## 1152. Wrapup repair step must tolerate a missing learnings status file

### Background

Filed from the active-session review of the 2026-10-09/10 batch session.

`wrapup-pipeline`'s `repair` state is the ADR-118 pilot's contract-violation lane: when `doc-sync`'s
`agent.run` exits cleanly but misses its declared post-condition, the wrap records the miss and
**proceeds** to `doc-tripwire` and `metrics-record` instead of paying for a second dispatch. That is
its documented intent (`config/workflows/wrapup-pipeline.yaml`, `repair` description: "wrap-up
proceeds through the doc-tripwire hop (1037) to metrics-record").

Observed **once** in that session (task 1136's wrap, run `3ec77cc1-da7f-45ec-8e57-79080c433927`): the
`doc-sync` `agent.run` exited 0 with an empty `-wrapup-learnings.md`, the contract-violation edge
routed to `repair`, and `repair`'s shell exited 1 — ending the whole wrap as
`workflow failed: wrapup-pipeline -> repair`. The wrap then had to be completed a second time on the
documented fast route (`mode=fast`), costing an extra dispatch cycle.

Evidence, quoted from the recorded tool output of that session rather than from memory:

```
✗ doc-sync/agent.run (1m 49s) · agent.run (coder) exited 0 but produced an empty answer for
  answerFile: .spur/run/3ec77cc1-…-wrapup-learnings.md
↪ doc-sync → repair [contract-violation]
workflow failed: wrapup-pipeline -> repair — Command "mkdir -p .spur/run && R=".spur/run/$__runId-wrapup-repair.status"
  && V="$(cat .spur/run/$__runId-wrapup-learnings.status 2>/dev/null)" && if [ "$V" = invalid-learnings-shape ]; then
  … fi && exit 0" exited with 1
```

**Not evidence for this defect:** the session's other failed wrap (task 1140/1141's batch) died before
reaching `repair` — its `doc-sync` agent failed with `402 … requires more credits` and the run
terminated `failed-check`. Only the `repair`-entered case above exercises the missing-status-file path.

**Refinement 2026-10-09 — the defect is deterministic, not intermittent.** The only writer of
`.spur/run/<run>-wrapup-learnings.status` is `learnings-validate`'s shell
(`config/workflows/wrapup-pipeline.yaml:278`). The `doc-sync → repair` contract-violation edge
(`:529`) bypasses `learnings-validate`, so on that edge the status file **never** exists and the
`repair` shell exits 1 on **every** entry — the ADR-118/0871 repair lane has never completed for its
primary input. Only the `learnings-validate → repair` (invalid-shape) entry, which always has the file,
works today. Reproduced in isolation:

```sh
sh -c 'V="$(cat /nonexistent 2>/dev/null)" && echo ok'           # prints nothing, exit 1
sh -c 'V="$(cat /nonexistent 2>/dev/null || true)" && echo ok'   # ok
```

The existing pin `packages/app/tests/workflow/wrapup-pipeline.test.ts` › "0871 contract-first routing"
› "repair is cheap (shell only)…" only asserts the command *text* (`toContain('wrapup-repair.status')`)
and never executes it, which is why the regression shipped green.

**Refine corrections (2026-10-10)**
- Rechecked repair at wrapup-pipeline.yaml:369–389: the fatal cat substitution is still present and fi is chained with &&, so write failures remain loud after the read-only || true fix. Historical run output is reported evidence, not a newly recovered run receipt.
- The existing suite already executes repair for the invalid-shape path in its 0986 group (:782); only the 0871 pin is text-only. Reuse that runShell pattern and retain the existing behavioral check.
- Permission-based output failure is platform/privilege-dependent → use a directory at the exact repair-status output filename to force redirection failure.
- A shipped config/workflows edit is within normal task implementation scope and is not a .github/workflows edit; remove the invented additional authorization gate. Source config remains authoritative and bundle:config regenerates the CLI copy.

### Requirements

- [ ] R1. **A missing learnings status file is not a step failure.** With
  `.spur/run/<run>-wrapup-learnings.status` absent (the `doc-sync → repair` contract-violation entry),
  the `repair` shell writes `.spur/run/<run>-wrapup-repair.status` with the `contract-violation:` line
  and exits 0, so the wrap proceeds to `doc-tripwire` as the state description declares.
- [ ] R2. **Both reachable entries keep their distinct outcomes.** Absent file → `contract-violation:`
  line; `invalid-learnings-shape` (the `learnings-validate → repair` entry) → `invalid-learnings-shape:`
  line. Any other value (not reachable today: `PASS` routes to `learnings-append`) falls to the
  `contract-violation:` line. All exit 0.
- [ ] R3. **The pin executes the shell, not its text.** A test runs the `repair` `onEnter` command via
  `sh -c` in a temp cwd with `__runId` in env (the existing 0783 R2 `runGuard` pattern in the same file)
  for the absent and `invalid-learnings-shape` cases, asserting exit 0 and the status line. Shown red
  against the current chain before the fix.
- [ ] R4. **Write failure stays loud.** If the repair status cannot be written (a directory at `.spur/run/<run>-wrapup-repair.status`),
  the shell still exits non-zero — the `|| true` applies to the read only.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An absent learnings status file does not fail the repair lane (req: R1, R3)
  Given a temp cwd with no ".spur/run/r1-wrapup-learnings.status"
  When the repair state's onEnter shell runs with __runId=r1
  Then it exits 0
  And ".spur/run/r1-wrapup-repair.status" starts with "contract-violation:"
```

```gherkin
Scenario: AC2 — The narration-only shape is still distinguished (req: R2, R3)
  Given ".spur/run/r2-wrapup-learnings.status" contains "invalid-learnings-shape"
  When the repair shell runs with __runId=r2
  Then it exits 0
  And ".spur/run/r2-wrapup-repair.status" starts with "invalid-learnings-shape:"
```

```gherkin
Scenario: AC3 — The pin was red before the fix (req: R3)
  Given the pre-fix wrapup-pipeline.yaml
  When the AC1 test runs
  Then it fails on exit status 1
```

```gherkin
Scenario: AC4 — A failed status write is still loud (req: R4)
  Given a directory exists at ".spur/run/r4-wrapup-repair.status"
  When the repair shell runs
  Then it exits non-zero
```

### Q&A

- Closed: || true belongs inside the cat substitution only; absent/empty/whitespace values take the existing contract-violation branch.
- Closed: output-path directory collision is the deterministic write-failure fixture; avoid chmod.
- Closed: use the existing 0986 runShell helpers and authoritative source YAML; bundle:config generates the CLI copy. No additional authorization beyond the implementation task is required for this source config edit.
- Closed: 1147 doc-sync scopes and onEnter error narration remain outside this task.

### Design

**Smallest complete change.** In config/workflows/wrapup-pipeline.yaml repair.onEnter only, use V="$(cat .spur/run/$__runId-wrapup-learnings.status 2>/dev/null || true)". Keep the following && if ... fi && exit 0 chain and status vocabulary. No new API, command, dependency or workflow state. Do not attach || true to the write or whole command.

**Test layer.** Extend packages/app/tests/workflow/wrapup-pipeline.test.ts beside the existing 0986 runShell/repairCmd execution helpers. Extract the actual parsed YAML onEnter command, execute sh -c with a temporary cwd and __runId, and assert numeric process status and output contents. Table cases: absent file, empty file, whitespace, PASS/other content → contract-violation; exact invalid-learnings-shape (with normal trailing newline) → invalid-learnings-shape. For AC4 mkdir the precise repair-status output path as a directory while leaving .spur/run writable: redirection must fail with nonzero status. Test both branch writes if cheap. Do not substitute a handwritten shell into the test. Retain existing repair→doc-tripwire routing pins.

**Verification/owners.** Test missing input red before changing YAML, then all branch cases green. Run bun run bundle:config (root command exists) to regenerate apps/cli/config, never hand-edit that generated directory; validate the authoritative workflow with spur workflow validate per the CLI reference and run the focused app suite and required pipeline gate. Historical 1147 owns separate doc-sync scope/error reporting; its behavior is already present, so no new prerequisite or sibling code change is required. No .github/workflows mutation or extra approval step is part of this task.

### Plan

1. [ ] R1–R3: add absent/empty/whitespace/other and exact-invalid-shape cases using the actual repair command and the existing 0986 shell fixture. Demonstrate absent-input exit 1 before the fix.
2. [ ] R4: add directory-collision output tests and prove nonzero status; keep writable parent directories.
3. [ ] R1/R2: add || true only to the cat substitution at repair.onEnter, preserving fi && exit 0 and routing.
4. [ ] Run the app wrapup-pipeline suite inside packages/app, validate the workflow, and regenerate via bun run bundle:config.
5. [ ] Run the required task gate, review/verify/record actual red-green evidence and commit only the task's source config/tests/evidence.

### Root Cause

The step's shell is a single `&&` chain whose second command is

```sh
V="$(cat .spur/run/$__runId-wrapup-learnings.status 2>/dev/null)" &&
```

`2>/dev/null` silences the message but not the exit status. On the empty-capture path that file was
never written, so `cat` exits 1, the chain aborts before the `if`, and the step exits 1 — before it
can write its own `-wrapup-repair.status` or reach `doc-tripwire`. The step's declared behaviour
("the miss is recorded … and wrap-up proceeds") therefore only holds when the status file happens to
exist.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 4.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History
