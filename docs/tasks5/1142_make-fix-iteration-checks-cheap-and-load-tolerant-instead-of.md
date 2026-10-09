---
schema_version: 1
name: Make fix-iteration checks cheap and load-tolerant instead of re-running the full gate
status: todo
template: standard
created_at: 2026-10-09T16:51:44.722Z
updated_at: "2026-10-09T16:52:23.334Z"

ac_numbering: task-local
ac_altitude: task-local
---

## 1142. Make fix-iteration checks cheap and load-tolerant instead of re-running the full gate

### Background

Measured from the 2026-10-08/09 session (see the session review that filed this task): the three
tasks in that session ran **nine full quality gates**, roughly 71 minutes of gate wall clock —
`1130` one run (9m51s), `1131` three (~24m), `1133` five plus a post-rebase run (~32m), and the
integration re-run (~6m). Three of the five gate runs in `1133` failed on classes that are checkable
in seconds: a biome formatter diff on two changed files, the `every-export-has-tsdoc` post-check
rule, and the `R44 — skill BODY budgets` test. One more failed on a load-sensitive test timeout.

The cheap tiers already exist and are fast. `bun run test-pre-check` runs 50 rules in 7.7 s;
`bun run test-post-check` runs 2 rules in about a second; `bunx biome check <changed paths>` finishes
in under two seconds. `packages/app/src/services/quality-gate.ts` also implements a scope-aware
`light` tier derived from the changed files, which preserves the full-tier receipt rather than
overwriting it. The inline driver never invoked any of them during fix iterations; it re-ran the full
gate each time, so every trivial fix cost 6–12 minutes.

`status command > reports project status` (apps/cli/tests/commands/status.test.ts) timed out at its
hard 5000 ms bound twice in that session while three to four worktrees were running full suites. Each
occurrence consumed a complete gate cycle, and the first looked like a failure of the change under
gate. Task 1127 serialized *gates* host-wide (the lock logs `queueWaitMs`), but concurrent *test*
runs still contend for CPU, so the timeout bound remains the defect.

### Requirements

- [ ] R1. During a task's fix iterations the driver runs the cheap tiers first: `bunx biome check` over the changed paths, then both rule presets, then the tests the changed paths own. A full gate runs at the quality boundary and after any post-gate source edit, never as the fix-iteration check.
- [ ] R2. The iteration check uses the existing scope-aware `light` mode in `packages/app/src/services/quality-gate.ts` for the test tier, so the scope comes from the changed files and the full-tier receipt is preserved. No new script, verb or flag is introduced.
- [ ] R3. The classes that cost a full gate in the session above are reproduced by the iteration check with the whole check measured under 30 seconds: a biome formatter diff, a violation of the `recommended-pre-check` rule set, and the tests owned by the changed paths.
- [ ] R4. `status command > reports project status` stops being load-sensitive. Either its timing bound is re-derived from what the command actually needs on a loaded host, or the test is made deterministic (for example by injecting the slow dependency) — a raised constant with no justification is not the fix. The chosen bound is stated with its ground.
- [ ] R5. The driver reference states the iteration order and names the light tier, so a later session does not re-derive the policy from scratch.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a formatter nit never costs a full gate (req: R1, R3)
  Given a change with a biome formatter diff on two files
  When the driver runs its fix-iteration check
  Then the diff is reported within 30 seconds of total check time
  And no full quality gate ran

Scenario: AC2 — the light tier is scope-aware and keeps the full receipt (req: R2)
  Given a change to two files under packages/app
  When the iteration check's test tier runs
  Then it exercises the changed scope and reports the changed file count
  And the full-tier check receipt at the same input digest is byte-identical afterwards

Scenario: AC3 — a rule violation surfaces before the full gate (req: R1, R3)
  Given a change that violates a recommended-pre-check rule, such as raw SQL outside packages/domain
  When the iteration check runs
  Then the rule violation is reported by the preset run
  And the full gate was not invoked

Scenario: AC4 — the status command test survives a loaded host (req: R4)
  Given three concurrent worktrees running full suites
  When apps/cli/tests/commands/status.test.ts runs
  Then it passes without a timeout
  And its timing bound is documented with the ground for the value

Scenario: AC5 — the policy is written down (req: R5)
  Given the inline driver reference
  Then it states the cheap-tier order and names the light mode
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T16:51:53.554Z

- **Why not just make the full gate faster?** That is a different, larger problem (10.6k tests). The
  measured loss here is not gate speed but *repeating* the gate for fixes whose failure class is
  checkable in seconds. Fixing the iteration order removes the loss without touching the gate.
- **Is the light tier trusted for the boundary?** No. It is the iteration check only. The boundary
  still requires the full gate, and a post-gate source edit requires it again (the freeze boundary
  owned by task 1135).
- **Why include a test-timing fix in this task?** It is the same measured cost centre — a load
  artifact that forced a full gate cycle — and the fix is local. Keeping it separate would produce a
  second task for a few lines.
- **Deferred:** any change to gate scheduling or to the host-wide lock (task 1127 already serialized
  gates); any change to the rule set itself.

### Design

**Surface.** Driver policy plus one test bound. The gate script already has the tiers; the defect is
that the driver's iteration loop calls the full tier every time. The fix is an ordered check ladder in
the driver contract, and a rebind of the `status` test's timing.

**Iteration ladder (order is the contract).**
1. `bunx biome check --write` over the changed paths — catches formatter and import-order classes.
2. `bun run test-pre-check` and `bun run test-post-check` — 50 + 2 rules in under 10 seconds
   combined, which is where `raw-sql-only-in-domain`, `every-export-has-tsdoc` and the corpus gates
   live.
3. The tests the changed paths own, run inside the owning workspace so its `bunfig.toml` preload
   applies — or `light` mode, which derives that scope itself.
4. The full gate once, at the boundary, and again after any post-gate source edit.

**Why the light tier rather than a new script.** It already derives scope from changed files, skips
checks that passed at the same digest, and preserves the full-tier receipt (quality-gate service,
`tier: 'light'`). A second implementation would drift from the receipt semantics that the record
stage depends on.

**Timing bound for the status test.** A hard 5 s bound on a command that shells out and reads project
state is a contention-sensitive assertion: it measures host load as much as the command. The fix
either injects the slow dependency so the assertion is about behavior, or derives the bound from a
measured worst case on a loaded host and states that measurement next to the constant. The second
option is acceptable only with the measurement recorded, because an unbounded raise hides real
regressions.

**Rejected alternative.** Skipping the rule presets because "the full gate runs them anyway". The
session evidence shows the presets are 7.7 s and the full gate is 6–12 min; the presets are the
cheapest way to catch the class that actually failed.

**Impacted surfaces.** The inline driver reference and its contract tests; the status command test.
No change to the gate script, the rules, or the CLI surface.

### Plan

1. Reproduce the 30-second claim: time biome over two changed files, both presets, and the light
   tier on a two-file change; record the numbers.
2. Write the iteration ladder into the driver reference and extend the driver contract tests to pin
   the order and the named light mode.
3. Diagnose the status test's slow path, then fix it by dependency injection if the slowness is an
   environmental read, or rebind the constant with a recorded loaded-host measurement if it is not.
4. Verify: run the light tier twice at one digest and confirm the full-tier receipt is unchanged;
   run the presets against a planted rule violation and confirm the reported class; run the status
   test with two concurrent full suites running.
5. Report the measured check time and the bound's ground in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-09T16:52:23.334Z backlog → todo (system)

