---
schema_version: 1
name: Make the feature-lifecycle R4 (0872) guard test load-deterministic
status: done
template: feature-impl
created_at: 2026-09-27T07:11:02.973Z
updated_at: "2026-09-28T19:42:29.073Z"
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

- [x] R1. The R4 (0872) and R4 (0418) integration tests have a test-local timeout large enough for the real CLI guard under full-suite CPU load.
- [x] R2. The real guard still executes, and the existing denial assertions stay meaningful. Production guard timeouts and workflow definitions are unchanged.
- [x] R3. The 5001 ms boundary is identified from the test runner and recorded in Solution; no engine timeout is changed without separate evidence.

### Acceptance Criteria

- [x] AC1 — The two named integration tests pass under a loaded test run with explicit test-local timeouts (req: R1)
- [x] AC2 — Missing or FAIL feature receipts still deny the hop, while a current PASS receipt allows it (req: R2)
- [x] AC3 — Solution names Bun's test timeout and shows the scoped override (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The failure duration was 5001 ms, matching Bun's default per-test timeout. The fixture adapter has no timeout setting, and the workflow guard has no 5 s bound. Set the third `test(..., ..., timeout)` argument on the R4 (0872) and R4 (0418) tests only, with a measured margin (initially 20_000 ms). Keep the live CLI guard and its PASS/FAIL assertions. If a longer local timeout still kills the child at 5 s, locate that second bound before changing production code.

### Plan

- [x] Confirm the boundary by running the R4 tests with a test-local timeout override under load.
- [x] Add the measured timeout to the two tests; keep their guard assertions unchanged.
- [x] Run the focused file under load and one `bun run spur-check`; record durations.

### Solution

Test-local budget only — no production or workflow change.

- `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:199-205` — `CLI_GUARD_TIMEOUT_MS = 20_000` plus the one-line `testCliGuard` wrapper. The comment records the observed 5001 ms failure and that the child is the real CLI guard.
- `:289` — R4 (0418) runs via `testCliGuard(...)`.
- `:366` — R4 (0872) runs via `testCliGuard(...)`.

**R3 boundary.** `bun test --help` documents "Set the per-test timeout in milliseconds, default is 5000"; the 5001 ms failure is that default. Neither `LifecycleAdapterOptions` (`makeFixtureAdapter`) nor `config/workflows/feature-lifecycle.yaml` declares a timeout, so no engine/workflow change is warranted. The wrapper passes `CLI_GUARD_TIMEOUT_MS` as Bun's third `test(label, fn, timeout)` argument; the real guard still executes and the PASS/FAIL denial assertions are unchanged.

**Why a wrapper.** Biome only hugs a function argument when it is last; a trailing timeout argument forces a full call break that re-indents both test bodies (279 lines changed). Keeping the callback last holds the diff to 10 insertions / 2 deletions. Mutation check: setting `CLI_GUARD_TIMEOUT_MS = 1` made R4 (0418) fail, proving the wrapper's timeout is live; reverted to `20_000`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:199-205` — `CLI_GUARD_TIMEOUT_MS = 20_000` + `testCliGuard`; applied at `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:289` (R4 0418) and `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:366` (R4 0872); re-run 2026-09-28 (force re-verify): 11 pass / 0 fail isolated (2.65s), 4x parallel load 11/0 each (3.94–4.01s) |
| R2 | MET | `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:399-416` — missing/FAIL receipts deny, PASS allows; `git show --stat 433b56010` touches only the test file + task file (workflow YAML and production guard unchanged) |
| R3 | MET | `bun test --help` → "Set the per-test timeout in milliseconds, default is 5000."; Solution records the boundary and scoped override |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `(cd packages/app && bun test tests/workflow/feature-lifecycle-adapter.test.ts)` → 11 pass / 0 fail; 4 concurrent runs → 11 pass / 0 fail each |
| AC2 | MET | test | `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:399-416` (missing → deny, FAIL → deny, PASS → allow) |
| AC3 | MET | command | `bun test --help` default 5000 ms; Solution names Bun's default and `CLI_GUARD_TIMEOUT_MS` at `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:202` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (self-review of the two-file-line change)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | Maintainability | `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:203-205` | `testCliGuard` exists only to keep the callback last for Biome's hug rule. Accepted: 10-line diff beats a 279-line re-indentation. |
| P4 | Risk | `:202` | 20 s is a load-margin estimate, not a measured worst case. Accepted: 4x parallel load ran 3.35–3.71 s, ~5x headroom. |

No P1–P3 findings. Production guard timeouts and `config/workflows/feature-lifecycle.yaml` are unchanged; the denial assertions remain load-bearing.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-27T16:45:12.633Z backlog → todo (system)
- 2026-09-28T05:43:31.006Z todo → wip (system)
- 2026-09-28T05:43:31.685Z wip → testing (system)
- 2026-09-28T05:43:32.017Z testing → done (system)

