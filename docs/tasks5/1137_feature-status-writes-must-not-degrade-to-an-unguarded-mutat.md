---
schema_version: 1
name: Feature status writes must not degrade to an unguarded mutation (feature-check fallback and the lifecycle-less server write service)
status: todo
template: feature-impl
created_at: 2026-10-09T05:34:58.340Z
updated_at: "2026-10-09T18:11:04.203Z"
feature_id: F21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
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

**Refine corrections (2026-10-09)**

- **Defect 1 confirmed unchanged.** `packages/app/src/services/feature-check.ts:278-286` still carries the raw `else` fallback; `:283` is the **only** non-test `setFrontmatterField('status', …)` in `packages/`, `apps/`, `plugins/` and `scripts/` (`rg`, 2026-10-09). `feature sync` does not write status directly. R3's "one funnel across five paths" therefore shrinks to: delete that one raw write and pin that no other non-test module adds one.
- **Defect 2 restated — the reopen was the wrong symptom.** `PlanningWriteServiceImpl.transition` appends the `## History` line (`planning-write-service.ts:490`) and emits `feature.transitioned` (`:512`) whatever the port is. Also, `verifying → active` is an `always` edge in `config/workflows/feature-lifecycle.yaml:89-93`. So the HTTP **reopen** through `apps/server/src/context.ts:500-503` already gets the same verdict, history and event as the CLI. The real hole is the generic **HTTP `feature.transition`** handler (`apps/server/src/modules/feature/handlers.ts:63-67`). It reaches `FeatureService.transition` over the permissive `SchemaLifecyclePort` (`planning-write-service.ts:86-95`), so a client can push `active → verifying` or `verifying → done` without the `feature check --as` guard, or reach an edge that does not exist (for example `backlog → done`).
- **Server design follows the 0966 precedent.** Task transitions on the server already run an in-process gate (`transitionTaskGuarded`, `packages/app/src/services/task-transition.ts:229`, wired at `apps/server/src/context.ts:532-551`) instead of the CLI's spawning `LifecycleAdapter`. `makeLifecycleAdapter` (`apps/cli/src/workflow/make-lifecycle-adapter.ts:23`) needs `CliContext`, `resolveSpurBin` and shell guards, and `verifying` has a nested-workflow `onEnter`. Porting it to the server is the wrong fix.
- Citation drift: the server feature service is still built at `apps/server/src/context.ts:558-565`; the reopen hook moved from `:501` to `:500-503`.

### Requirements

- [ ] R1. **`feature check --fix` performs no raw status write.** Delete the `else` branch at `packages/app/src/services/feature-check.ts:281-286`. With no `transitionPort`, the reopen is not applied. The check reports an error finding `feature-reopen-unavailable`, which names the missing port and gives the recovery ("run `spur feature check <id> --fix` from the CLI, or call `spur feature update <id> active`"). The feature file stays byte-identical, and no `feature-reopen` repair entry is reported. Structural repairs (headings, R-item checkboxes) still apply.
- [ ] R2. **The server validates feature transitions in-process.** Add `transitionFeatureGuarded` in `packages/app/src/services/feature-transition.ts`, mirroring `transitionTaskGuarded`, and route `apps/server/src/modules/feature/handlers.ts:63-67` and the reopen hook at `apps/server/src/context.ts:500-503` through it. It:
  - (a) loads the `feature-lifecycle` graph with the existing `loadWorkflowDef`/`resolveWorkflowFile` (no spawn), and refuses an edge that is not declared;
  - (b) runs the in-process `FeatureCheckService.check(id, { as: to })` for every edge whose YAML guard is `kind: shell`, and denies on error findings;
  - (c) refuses a target state that declares `onEnter` actions (today: `verifying`), with the message "entering `verifying` runs feature verification; use `spur feature update <id> verifying` from the CLI";
  - (d) throws `GuardDeniedError` for every refusal, which the handler already maps to HTTP 409 `GUARD_DENIED`.

  `always` edges, including the `verifying → active` reopen, pass unchanged.
- [ ] R3. **One raw status writer is not reintroduced.** Add a static pin test that fails when a non-test file under `packages/`, `apps/`, `plugins/` or `scripts/` calls `setFrontmatterField('status'` on a feature document. The only status writer is `PlanningWriteServiceImpl.transition`.
- [ ] R4. **A missing graph fails loudly.** If `resolveWorkflowFile` cannot find `feature-lifecycle.yaml`, `transitionFeatureGuarded` throws `GuardDeniedError` naming the profile (`feature-lifecycle`) and the searched roots. It never falls back to `SchemaLifecyclePort`.
- [ ] R5. **Tests (written first, each shown to fail without its fix).**
  - (a) A no-port `feature check --fix` on a `verifying` feature with a live linked task leaves the file byte-identical and returns the `feature-reopen-unavailable` error.
  - (b) The with-port reopen still yields `active` plus a History line.
  - (c) A server-context `feature.transition` `active → verifying` on a feature whose check has error findings is denied with 409, and the file is unchanged.
  - (d) An undeclared edge is denied.
  - (e) The server reopen hook still reopens `verifying → active` with a History line.
  - (f) The R3 pin.
- [ ] R6. **Docs.**
  - `docs/design/planning-record-contracts.md` (feature-check row and the task→feature link section) states that the reopen requires a port and that the raw fallback was removed.
  - The server surface satellite that documents `feature.transition` states the in-process guard and the 409 refusals, including `→ verifying`.
- [ ] R7. **Same-change bundle.** Run `bun run --filter @gobing-ai/spur build:bundle`. No plugin script is touched, so `build:scripts` is not required.

### Acceptance Criteria

```gherkin
Scenario: AC1 — No port means no status write and an actionable finding (req: R1)
  Given a verifying feature with one linked live todo task
  When feature check runs with fix enabled and no transition port
  Then the feature file is byte-identical afterwards
  And the result carries the error finding "feature-reopen-unavailable" naming the CLI recovery
  And no repair entry of kind feature-reopen is reported
```

```gherkin
Scenario: AC2 — With a port the reopen still goes through the transition (req: R1)
  Given the same feature and a transition port bound to the feature lifecycle profile
  When feature check runs with fix enabled
  Then the feature is active and its History section gains one verifying → active line
  And the reported repair is kind feature-reopen
```

```gherkin
Scenario: AC3 — The server denies a guarded edge whose check fails (req: R2)
  Given the server context and an active feature whose "feature check --as verifying" has error findings
  When the HTTP feature.transition moves it to verifying
  Then the response is 409 GUARD_DENIED
  And the feature file is byte-identical afterwards
```

```gherkin
Scenario: AC4 — The server refuses undeclared edges and onEnter targets (req: R2)
  Given the server context and a backlog feature
  When the HTTP feature.transition moves it to done
  Then the response is 409 GUARD_DENIED naming the undeclared edge
  And a clean active feature moved to verifying over HTTP is refused with the CLI recovery message
```

```gherkin
Scenario: AC5 — The server reopen keeps working (req: R2)
  Given the server context and a verifying feature
  When a task is created against that feature through the server context
  Then the feature is active with one verifying → active History line
```

```gherkin
Scenario: AC6 — No second raw status writer exists (req: R3)
  Given the implemented change
  When the static pin test scans non-test sources under packages, apps, plugins and scripts
  Then no call to setFrontmatterField with "status" on a feature document is found
```

```gherkin
Scenario: AC7 — A missing lifecycle graph is a loud refusal (req: R4)
  Given a server context whose workflow roots contain no feature-lifecycle.yaml
  When any feature transition is requested
  Then GuardDeniedError names the feature-lifecycle profile and the searched roots
  And no file is written
```

```gherkin
Scenario: AC8 — Tests fail without their fixes and the gates pass (req: R5, R6, R7)
  Given the six new tests
  When each fix is reverted in an isolated copy
  Then the corresponding test fails
  And with the fixes in place "bun run spur-check" and the bundle rebuild pass
  And the owning design satellites state the port requirement and the server guard
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:11:02.990Z

- **Q: Port the CLI `LifecycleAdapter` to the server (Design option a) or add an in-process guard?** A (closed 2026-10-09): use an in-process guard, `transitionFeatureGuarded`. The adapter spawns `spurBin` guards and runs the nested `feature-verification` workflow `onEnter`; neither belongs in the server/Worker transport (ADR-021). Task transitions already use the in-process precedent (0966 R3).
- **Q: Should the server run the `verifying` onEnter itself?** A: no. It refuses `→ verifying` with the CLI recovery. Starting a nested verification run from an HTTP handler is out of scope; revisit only if the Board needs a "send to verification" button.
- **Q: Does R1 make `feature check --fix` fail as a whole?** A: no. It is one error finding, so the exit is non-zero as for any error finding. Structural repairs still apply. Only the status mutation is withheld.
- **Q: Is a construction-time refusal (old R4) needed?** A: no. The single raw writer is deleted and pinned (R3), and the server path gets its own guard (R2). A required-port constructor change would ripple through every `FeatureServiceImpl` caller for no added safety.

### Design

- **R1, `feature-check.ts`.** Replace the `else` branch with `findings.push({ severity: 'error', code: 'feature-reopen-unavailable', message })` and skip the reopen repair. Keep the `transitionPort` branch byte-for-byte.
- **R2, new `packages/app/src/services/feature-transition.ts`.** Signature:

  ```ts
  transitionFeatureGuarded(
      deps: { features: FeatureService; check: FeatureCheckService; cwd: string },
      input: { id: string; to: string; actor?: string },
  ): Promise<WriteResult>
  ```

  Steps:
  1. Resolve the graph: `resolveWorkflowFile(cwd, 'feature-lifecycle')`, then `loadWorkflowDef(path, { validateSchema: false })`. A `null` path throws `GuardDeniedError`, which covers R4.
  2. Read the current status and find the matching `transitions[]` entry for `from → to`. No match throws (`undeclared edge <from> → <to>`).
  3. If the target state's `onEnter` is non-empty, throw with the CLI recovery.
  4. If `guard.kind === 'shell'`, run `check.check(id, { as: to })`. Any error finding throws `GuardDeniedError` carrying the finding messages.
  5. Otherwise call `features.transition(id, to, actor)`. History and event come from the write service as today.

  Server wiring:
  - Add `transitionFeature(input)` on the server context next to `transitionTask`.
  - The `feature.transition` handler and the 1132 reopen hook call it.
  - Export it from the `@gobing-ai/spur-app` index.
- **R3 pin.** Add `packages/app/tests/feature-status-writer-pin.test.ts`. It walks the four roots with `Bun.Glob`, skips `**/tests/**`, and asserts that no `setFrontmatterField('status'` call appears in a file that also references the `'feature'` domain. The 0 matches after the R1 deletion are the baseline.
- **Boundaries.**
  - No FSM state or guard edits.
  - No new public CLI verb or flag; the HTTP contract shape is unchanged (409 is already mapped).
  - The CLI path is untouched.
  - `feature sync` is untouched.
- **Failure inventory (write as tests first).**
  - A shell-guard edge accidentally treated as `always`, which lets `verifying → done` through.
  - The `as`-status not passed to the check, which re-creates the 0418 one-active-goal deadlock.
  - The reopen hook double-writing History.
  - A refused transition leaving a partial write.
  - The YAML resolved from the bundled tier instead of the project tier (`resolveWorkflowFile` is project-first; assert the precedence).

### Plan

1. Write the R5 tests (a)–(f) and the failure-inventory cases. Confirm each fails on the current tree.
2. R1: delete the raw fallback and add the `feature-reopen-unavailable` finding.
3. R2/R4: add `feature-transition.ts`, export it, add `transitionFeature` to the server context, and route the handler and the reopen hook through it.
4. R3: add the pin test.
5. R6: update the docs. R7: rebuild the bundle.
6. Acceptance drill:
   - over the server context: `active → verifying` with a failing check gives 409; `backlog → done` gives 409; reopen through task create gives `active` plus History;
   - via the CLI: `spur feature check <id> --fix` still reopens.
   - Record the commands and outputs.
7. Run `bun run spur-check` once on the final tree.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Raw-write fallback: `packages/app/src/services/feature-check.ts:278-286`. The CLI wires the port at `apps/cli/src/commands/feature.ts:477`.
- Server:
  - generic transition handler: `apps/server/src/modules/feature/handlers.ts:63-67`;
  - feature service without a lifecycle adapter: `apps/server/src/context.ts:558-565`;
  - 1132 reopen hook: `apps/server/src/context.ts:500-503`;
  - in-process task-gate precedent: `apps/server/src/context.ts:532-551` and `packages/app/src/services/task-transition.ts:229`.
- Permissive port: `packages/app/src/services/planning-write-service.ts:86-95`. History and event emission: `:490` and `:512`.
- Feature graph: `config/workflows/feature-lifecycle.yaml`.
  - The `verifying` onEnter is at `:38-53`.
  - The `verifying → active` reopen is an `always` edge at `:89-93`.
- Graph loading: `packages/app/src/workflow/lifecycle-adapter.ts:362-375` (`loadWorkflowDef`). CLI adapter: `apps/cli/src/workflow/make-lifecycle-adapter.ts:23`.
- Origin: run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132). Related: F21 (task→feature link surface), 0966 R3 (server task guard), ADR-021.

### History

- 2026-10-09T05:36:13.165Z backlog → todo (system)

