---
schema_version: 1
name: Feature status writes must not degrade to an unguarded mutation (feature-check fallback and the lifecycle-less server write service)
status: todo
template: feature-impl
created_at: 2026-10-09T05:34:58.340Z
updated_at: "2026-10-09T05:36:13.165Z"
feature_id: F21

ac_altitude: task-local
ac_numbering: task-local
---

## 1137. Feature status writes must not degrade to an unguarded mutation (feature-check fallback and the lifecycle-less server write service)

### Background

**Origin.** Found by independent review passes during run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132, 2026-10-08) and re-confirmed in this session's review. Task 1132 R2/R3 introduced "reopen the parent feature through the guarded feature transition" as a contract, and the CLI honours it — but two paths in the same change silently do not.

**Defect 1 — `feature check --fix` degrades to a raw frontmatter write when no transition port is supplied.** `packages/app/src/services/feature-check.ts:278-286`:
```ts
if (options?.transitionPort !== undefined) {
    await options.transitionPort(featureId, 'active');
    raw = await this.fs.readFile(filePath);
} else {
    const docToReopen = MarkdownDocument.parse(raw, 'feature');
    docToReopen.setFrontmatterField('status', 'active');
    raw = docToReopen.serialize();
    await this.fs.writeFile(filePath, raw);
}
```
The `else` branch is the contract violation: it changes a feature's lifecycle status with **no** lifecycle validation, no history line, and no event — exactly what R3's Design said must not happen ("through the existing feature transition service, not a raw frontmatter write"). The CLI wires the port (`apps/cli/src/commands/feature.ts:477`), so today the branch is unreachable from the CLI; it is reachable from any in-process caller that passes `fix: true` without a port, and it will silently succeed. A "transition port optional" shape in a service whose *purpose* is to mutate lifecycle state is a silent-bypass hazard, not a convenience.

**Defect 2 — the server's feature service has no lifecycle adapter, so the HTTP reopen is unguarded too.** `apps/server/src/context.ts:558-565` builds `FeatureServiceImpl` with `writeService: new PlanningWriteServiceImpl({ fs, projectName: 'spur', emitter: lazyEmitter })` — **no `lifecycle`**, so `FeatureService.transition` runs through the permissive `SchemaLifecyclePort` fallback. The HTTP task→feature reopen is wired to exactly that service (`apps/server/src/context.ts:501`), so R2's "guarded transition" is CLI-strength only: over HTTP the same reopen is an unvalidated status change. (The server also has no lifecycle adapter for task transitions, where the same permissive fallback applies to a *task* status write.)

**Why this matters now.** Both defects sit on the write path 1132 created, and both are invisible to the current tests: the CLI e2e passes (port supplied), the service tests pass (port supplied), and the server test asserts the reopen's *result* without asserting the *route*. The failure mode is a lifecycle-invalid feature state that no history, event or gate recorded — and the operator has no signal.

**Current code facts (verified 2026-10-08).** CLI wires a FEATURE-profile port at `apps/cli/src/commands/task.ts:1980-1998` (`new FeatureService({..., writeService: new PlanningWriteService({ fs, lifecycle: makeLifecycleAdapter(context, FEATURE_LIFECYCLE_PROFILE), ... }) })`) and the feature command wires the same at `apps/cli/src/commands/feature.ts:655`; `FeatureService.transition` (`packages/app/src/services/feature-service.ts:250`) delegates to `writeService.transition`, which is exactly where the profile matters (a task-profile write service raises `FSMError: … undeclared state "verifying"` — the failure 1132 hit in cycle 3).

### Requirements

- [ ] R1. **`feature check --fix` must not perform a raw frontmatter status write.** Remove the `else` fallback at `packages/app/src/services/feature-check.ts:281-286`: the reopen either goes through a lifecycle-backed transition, or the command fails loudly with an actionable, non-zero result naming the missing capability and the recovery ("configure/repair the feature lifecycle adapter, or supply a transition port"). A silent unvalidated write is never an acceptable degradation.
- [ ] R2. **The server path must be as guarded as the CLI path.** `apps/server/src/context.ts:558-565` must build the feature service with a lifecycle-capable write service (or an equivalent guarded transition funnel), so the HTTP task→feature reopen in `apps/server/src/context.ts:501` validates the transition, records history, and emits the normal event, instead of riding the permissive `SchemaLifecyclePort`.
- [ ] R3. **One funnel for feature status mutation.** Every feature-status write (CLI verbs, task-link reopen, `feature check --fix` repair, `feature sync`, wrapup transition) must route through a single funnel that (a) validates against the feature lifecycle profile, (b) appends the history line, and (c) is the only code allowed to set a feature's `status`. Direct `setFrontmatterField('status', …)` calls outside that funnel are removed or converted.
- [ ] R4. **Fail loudly at the seam, not at the outcome.** A service that can mutate feature status must refuse construction (or refuse the mutation) when its write service cannot validate the transition, with a named error class and a message that names the profile it expected. "Optional port, silent fallback" is replaced by "required capability, loud failure".
- [ ] R5. **Tests.** (a) a no-port `feature check --fix` on a `verifying` feature with linked live tasks leaves the file unchanged and exits non-zero with the actionable message; (b) the same call with a port reopens through the guarded transition (history line asserted); (c) a server-context test asserts the *route* (the guarded funnel was used, not a direct status write) for the HTTP reopen; (d) a construction/mutation test for R4's loud failure.
- [ ] R6. **Docs.** The design satellite owning the feature lifecycle (`docs/design/planning-record-contracts.md` § feature check row, and the task-creation/link surface section) must state the single funnel and that the optional-port shape was transitional; the `feature check --fix` runbook entry must name the requirement instead of implying a bare status write.
- [ ] R7. **Same-change bundle** — `bun run --filter @gobing-ai/spur build:bundle` plus `bun run build:scripts` when a plugin script is touched.

### Acceptance Criteria

```gherkin
Scenario: AC1 — No port means no write, and a loud failure instead (req: R1)
  Given a verifying feature with one linked live todo task
  When "feature check <id> --fix" runs through a caller that supplies no transition port
  Then the feature file is byte-identical afterwards
  And the result is a non-zero failure naming the missing lifecycle capability and the recovery
  And no repair entry claims a reopen
```

```gherkin
Scenario: AC2 — With a port the reopen still goes through the guarded transition (req: R1)
  Given the same feature and a transition port bound to the feature lifecycle profile
  When "feature check <id> --fix" runs
  Then the feature is active and carries the transition history line
  And the reported repair is kind feature-reopen
```

```gherkin
Scenario: AC3 — The HTTP reopen is guarded, not permissive (req: R2)
  Given the server context and a verifying parent feature
  When a task is created through the server context against that feature
  Then the reopen is performed by the guarded funnel
  And the feature history line exists
  And the permissive fallback path is not taken
```

```gherkin
Scenario: AC4 — Status mutation has one owner (req: R3)
  Given the implemented change
  When feature status writes across the CLI, task-link, feature-check and sync paths are inspected
  Then each routes through the single funnel
  And no other module sets a feature status field directly
```

```gherkin
Scenario: AC5 — A capability-less service fails loudly (req: R4)
  Given a caller that constructs a status-mutating feature service without a lifecycle-capable write service
  When the mutation is attempted
  Then it fails with the named error class and a message naming the expected profile
  And no file is written
```

```gherkin
Scenario: AC6 — The regression tests fail without their fixes (req: R5)
  Given the four new tests
  When each corresponding fix is reverted in an isolated copy
  Then the test fails
  And with the fix in place they pass inside "bun run spur-check"
```

```gherkin
Scenario: AC7 — Owning docs and bundle reflect the single funnel (req: R6, R7)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass
  And the design satellite documents the funnel and the removed transitional port shape
  And the feature-check runbook entry names the lifecycle requirement
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **The optional port is the defect, not the fallback code.** A service whose purpose is to mutate lifecycle state must not accept "no way to validate this transition" as an input. Make the capability required: either the caller supplies a lifecycle-backed writer (as the CLI does with `FEATURE_LIFECYCLE_PROFILE`) or the mutation refuses with a named error. That inverts today's default from *succeed silently* to *fail loudly*, which is the only safe direction for a status write.

- **One funnel (R3) rather than three patched paths.** Today feature status can be set by: `FeatureService.transition` (guarded, history), the `feature-check` repair (guarded *or* raw), `feature sync` (derived status), and direct frontmatter edits in tests/scripts. The task consolidates the first three onto one funnel and removes the raw path. `FeatureService.transition` (`packages/app/src/services/feature-service.ts:250`) is already the right seam; the work is to make every caller use it and to stop any other writer from touching `status`.

- **Server parity (R2) is a wiring fix with a design question.** The server has no lifecycle adapter today, so *task* transitions also ride the permissive `SchemaLifecyclePort`. Two candidate fixes: (a) construct the server's `PlanningWriteService` with the same lifecycle adapter the CLI builds (`makeLifecycleAdapter(context, FEATURE_LIFECYCLE_PROFILE)` — it needs `bundledConfigRoot`/config resolution to be available in the worker context), or (b) inject a guarded transition funnel that the server owns. Decide with the server's actual constraints (Cloudflare worker runtime, no filesystem config root) and record the choice in the design satellite; if (a) is impossible in the worker, (b) plus the loud-failure rule from R4 is the answer — never the permissive fallback.

- **Boundaries.** Do not change the feature lifecycle FSM's states or guards; do not add a new public CLI verb or flag; do not make `feature check --fix` stop repairing *structure* (headings, R-item checkboxes) — only the status mutation is affected; do not re-open the `L4.verifying-incomplete-tasks` severity decision; do not touch the corpus-owned `## Testing`/`## Review` write path.

- **Failure inventory to write before code:** (a) requiring the port breaks a legitimate in-process caller (the operator's own scripts/testing) — the loud failure must name the recovery; (b) the server fix (a) being impossible in the worker and the fallback silently returning; (c) the funnel refactor double-writing history (one line from `transition`, one from the caller); (d) `feature sync`'s derived status change being forced through a lifecycle guard it does not need; (e) removing the raw path breaking a test that relied on it (must be re-pointed at the funnel, not re-added); (f) the loud failure surfacing as an unhandled throw in a pipeline state instead of a classified finding.

### Plan

1. **Failure inventory first** (Design's list), one row per way this change can be wrong.
2. **Tests before implementation**: the no-port refusal (file byte-identical + non-zero + message), the with-port guarded reopen (history line asserted), a server-context route test, and the construction/mutation failure test — each demonstrated to fail before its fix.
3. **Implement R1** — delete the raw fallback in `packages/app/src/services/feature-check.ts`; make the port (or a lifecycle-capable write service) required for the reopen; add the named error and its message.
4. **Implement R2** — decide and implement the server wiring (adapter, or a server-owned guarded funnel), asserting the route in a test.
5. **Implement R3/R4** — route every feature status write through the funnel; convert remaining direct `status` writes; add the construction/mutation refusal.
6. **Docs (R6) + bundle (R7)**; then `bun run --filter @gobing-ai/spur build:bundle`.
7. **Acceptance drill** — reproduce the original shape: `task create --feature <verifying>` over HTTP (server context) and via the CLI must both reopen through the funnel with a history line, and a `feature check --fix` run without a port must change nothing. Record the commands and outputs in Testing.
8. `bun run spur-check` once on the final tree; record the evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Found by review passes in run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132, 2026-10-08); re-confirmed in the session review of the same day.
- Raw-write fallback: `packages/app/src/services/feature-check.ts:278-286`; port wired by the CLI at `apps/cli/src/commands/feature.ts:477`.
- Unguarded server path: `apps/server/src/context.ts:558-565` (`FeatureServiceImpl` without a lifecycle adapter), reopen wired at `apps/server/src/context.ts:501`.
- Guarded reference implementation: `apps/cli/src/commands/task.ts:1980-1998` (FEATURE lifecycle profile port) and `apps/cli/src/commands/feature.ts:655` (`makeLifecycleAdapter(context, FEATURE_LIFECYCLE_PROFILE)`); `packages/app/src/services/feature-service.ts:250` (`transition`).
- The profile-mismatch failure this design exists to prevent: cycle 3 of the 1132 run, `FSMError: Cannot reseed run … to undeclared state "verifying"` when the task-profile write service was reused for a feature transition.
- Related tasks/features: 1132 (origin), F21 (owner of the task→feature link surface), B7 (run-scoped executor session), ADR-021 (apps are thin transports; logic in `packages/app`).

### History

- 2026-10-09T05:36:13.165Z backlog → todo (system)

