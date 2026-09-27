---
schema_version: 1
name: Make the feature-lifecycle R4 (0872) guard test load-deterministic
status: todo
template: feature-impl
created_at: 2026-09-27T07:11:02.973Z
updated_at: "2026-09-27T16:45:12.633Z"
feature_id: D63

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 2
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

**Refine corrections (2026-09-27)**

- The 5001 ms boundary is Bun's default per-test timeout (`bun test --help`); the planned fix is a test-local override, not a production guard change.

### Requirements

- [ ] R1. The R4 (0872) and R4 (0418) integration tests have a test-local timeout large enough for the real CLI guard under full-suite CPU load.
- [ ] R2. The real guard still executes, and the existing denial assertions stay meaningful. Production guard timeouts and workflow definitions are unchanged.
- [ ] R3. The 5001 ms boundary is identified from the test runner and recorded in Solution; no engine timeout is changed without separate evidence.

### Acceptance Criteria

- [ ] AC1 — The two named integration tests pass under a loaded test run with explicit test-local timeouts (req: R1)
- [ ] AC2 — Missing or FAIL feature receipts still deny the hop, while a current PASS receipt allows it (req: R2)
- [ ] AC3 — Solution names Bun's test timeout and shows the scoped override (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The failure duration was 5001 ms, matching Bun's default per-test timeout. The fixture adapter has no timeout setting, and the workflow guard has no 5 s bound. Set the third `test(..., ..., timeout)` argument on the R4 (0872) and R4 (0418) tests only, with a measured margin (initially 20_000 ms). Keep the live CLI guard and its PASS/FAIL assertions. If a longer local timeout still kills the child at 5 s, locate that second bound before changing production code.

### Plan

- [ ] Confirm the boundary by running the R4 tests with a test-local timeout override under load.
- [ ] Add the measured timeout to the two tests; keep their guard assertions unchanged.
- [ ] Run the focused file under load and one `bun run spur-check`; record durations.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T16:45:12.633Z backlog → todo (system)

