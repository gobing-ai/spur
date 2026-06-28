---
template: standard
schema_version: 1
name: "Fix lifecycle-adapter loading + strict fallback done-gate inconsistency (surfaced by 0144 cold-spawn)"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-28T22:30:16.767Z"
updated_at: 2026-06-28T22:31:02.190Z
---

## 0147. Fix lifecycle-adapter loading + strict fallback done-gate inconsistency (surfaced by 0144 cold-spawn)

### Background
Two environment/tooling issues surfaced during the 0144 cold-spawn verification of `sp:super-coder`.
Both are independent of the agent contract — they bit every `testing→done` transition this session.

**Issue A — lifecycle adapter does not load though the workflow YAMLs exist on disk.**
`spur workflow list --json` returns `[]`, and `spur task update <wbs> {testing,done}` prints
`warning: lifecycle adapter unavailable — running 'spur task check' inline as the <status> gate.`
Yet the bundled workflows are present:
- `.spur/workflows/{task-lifecycle,task-pipeline,...}.yaml` (runtime-loaded path) and
- `config/workflows/*.yaml` (canonical)
both list six workflows. So the files exist but are not registered/resolved by the adapter. Effect:
the real FSM guard (`task-lifecycle.yaml`) never runs; every guarded transition falls back to the
inline backstop in `apps/cli/src/commands/task.ts:185-200` (the 0130 retrospective P3 backstop).

**Issue B — the inline fallback done-gate runs STRICT, blocking `pass:True`-with-warnings tasks.**
`apps/cli/src/commands/task.ts:192` calls `runDoneGateCheck(context, wbs, folder, status === 'done')`
— the 4th arg makes the `done` gate **strict**. Under strict, L3/L4 **warnings become errors**, so a
task whose plain `spur task check` reports `pass: True` (warnings only) is **blocked** at
`testing→done` with `Lifecycle transition blocked: 'spur task check <wbs>' failed`.

Concrete repro (0144): `spur task check 0144` → `pass: True` (4 warnings); `spur task update 0144 done`
→ blocked. The block is driven by L4 "Missing feature_id" (DD-07) promoted to an error under strict.

The inconsistency: the **real** FSM guard uses `--strict-core` (L3/L4 stay warnings), but the
**fallback** uses full `--strict` (L3/L4 become errors). The fallback is therefore *stricter* than the
guard it stands in for — a standalone task that the real guard would pass, the fallback rejects.
### Acceptance Criteria

```gherkin
Feature: Fix lifecycle-adapter loading + strict fallback done-gate inconsistency (surfaced by 0144 cold-spawn)

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Plan
- [ ] P1 — Diagnose Issue A: why `spur workflow list` is empty though `.spur/workflows/` +
      `config/workflows/` hold six YAMLs. Check the registry/loader path (`config.yaml`
      `workflows.paths`), the adapter resolution in `makeLifecycleAdapter`, and init/seed order.
- [ ] P2 — Fix Issue A so the real `task-lifecycle` FSM guard runs (no more "adapter unavailable"
      fallback in a correctly-initialized project). Verify `spur workflow list` shows the six.
- [ ] P3 — Fix Issue B: align the inline fallback done-gate with the real guard — run
      `--strict-core`, not full `--strict` (`apps/cli/src/commands/task.ts:192` →
      `runDoneGateCheck` strict-core). The backstop must not be harsher than the FSM it replaces.
- [ ] P4 — Regression test: a standalone task with `pass:True` + warnings (e.g. only L4 feature_id)
      transitions `testing→done` under the fallback gate (strict-core), and a task with a real L3
      core error is still blocked. Encode both directions.
- [ ] P5 — Gate: `bun run lint && bun run test && bun run test-cf && bun run build` green.
### Solution

### Root Cause

**Issue A (adapter not loading)** — `makeLifecycleAdapter(context, TASK_LIFECYCLE_PROFILE)` returns
`undefined` (`apps/cli/src/commands/task.ts:186-187`) even though the YAMLs are present. Candidate
causes to confirm during the fix: the adapter resolves workflows by registry/name and the registry
is empty (`spur workflow list` → `[]`), so the lookup of the `task-lifecycle` profile misses. Whether
the registry is empty because of a config-path mismatch (`config.yaml` `workflows.paths`), a missing
migration/seed, or an init-order bug is the first thing to determine — `spur workflow list` returning
`[]` while six YAMLs sit in the resolved paths is the smoking gun.

**Issue B (strict fallback)** — intentional-looking but mis-calibrated: `task.ts:192` passes
`status === 'done'` as the strict flag to `runDoneGateCheck`. The real `task-lifecycle.yaml`
`testing→done` guard uses `spur task check <wbs> --strict-core` (`config/workflows/task-lifecycle.yaml:61`).
`--strict` ≠ `--strict-core`: strict promotes ALL findings (incl. L4 traceability) to errors;
strict-core promotes only the core deliverable findings. The fallback should mirror the guard it
replaces — i.e. run `--strict-core`, not `--strict` — so the backstop is not harsher than the FSM.

### Testing

### Review

### References

### History
