---
schema_version: 1
name: Make the feature-lifecycle R4 (0872) guard test load-deterministic
status: backlog
template: feature-impl
created_at: 2026-09-27T07:11:02.973Z
updated_at: "2026-09-27T07:11:50.409Z"
feature_id: D63

ac_numbering: task-local
ac_altitude: task-local
---

## 0981. Make the feature-lifecycle R4 (0872) guard test load-deterministic

### Background

`packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:408` — *"R4 (0872): verifying→done refuses until the feature-scoped pass records PASS"* — failed at **5001 ms** during a loaded full-suite run:

```text
error: Guard "shell" denied transition from "verifying" to "done" — {"stdout":"","stderr":"","exitCode":null}
(fail) FeatureLifecycleAdapter (engine integration) > R4 (0872): ... [5001.06ms]
```

`exitCode: null` is a killed process, so the guard's spawned work did not complete inside a ~5 s bound while the suite saturated the CPU. Evidence it is load-sensitivity, not a defect of the change under test: the same test passes 11/11 in isolation (4.30 s / 3.63 s), it passed in the same-digest gate re-run (9267/0), and it was observed failing three times across one worktree run (`bun run spur-check` at 4:03 and a slower 6:29 run). The failing test file belongs to feature D63 (0872/0915 lineage) and already documents a *different* instability it fixed (`writeFileSync('.gitignore', '.spur/')` to stop "self-referential instability" in the digest capture), so this surface is recognised as fragile.

The 5 s bound was not found in `LifecycleAdapterOptions` (`makeFixtureAdapter`, `:183-197`) nor in `config/workflows/feature-lifecycle.yaml`; it is most likely an engine/adapter default for spawned guard shells.

### Requirements

- [ ] R1. The R4 (0872) test and its 0418 sibling are deterministic under full-suite CPU load (no 5 s wall-clock cliff on a spawned guard).
- [ ] R2. Guard semantics are preserved: the test still fails when the real guard denies a hop (the R4 mutation check stays meaningful).
- [ ] R3. The located bound is named in Solution with its file and symbol, and any test-only override is scoped to the fixture (no production guard timeout is weakened without a stated reason).

### Acceptance Criteria

- [ ] AC1 — R1 — two consecutive full-suite `bun run spur-check` runs under load are green, with the R4 test's duration reported (test)
- [ ] AC2 — R2 — a deliberately denying fixture still fails the hop, pinned by an existing or added assertion (test)
- [ ] AC3 — R3 — the bound's location is named in `## Solution` (static-ref)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [ ] Locate the bound: grep the engine/adapter for the guard-shell timeout that produces the 5001 ms kill (`packages/app/src/workflow/lifecycle-adapter.ts` → engine `ActionRunner`/guard options); confirm by instrumenting the fixture with a slow guard.
- [ ] Fix at the narrowest correct layer (fixture-scoped override if the bound is an engine default; definition change only if the shipped guard is genuinely under-provisioned).
- [ ] Verify: run `bun run spur-check` twice, and reproduce the loaded condition (e.g. two concurrent suite runs) once to confirm the cliff is gone.
- [ ] Record the before/after durations in `## Testing`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
