---
schema_version: 1
name: Feature status writes must not degrade to an unguarded mutation (feature-check fallback and the lifecycle-less server write service)
status: done
template: feature-impl
created_at: 2026-10-09T05:34:58.340Z
updated_at: "2026-10-10T04:12:38.645Z"
feature_id: F21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1137-verdict.json
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

- [x] R1. **`feature check --fix` performs no raw status write.** Delete the `else` branch at `packages/app/src/services/feature-check.ts:281-286`. With no `transitionPort`, the reopen is not applied. The check reports an error finding `feature-reopen-unavailable`, which names the missing port and gives the recovery ("run `spur feature check <id> --fix` from the CLI, or call `spur feature update <id> active`"). The feature file stays byte-identical, and no `feature-reopen` repair entry is reported. Structural repairs (headings, R-item checkboxes) still apply.
- [x] R2. **The server validates feature transitions in-process.** Add `transitionFeatureGuarded` in `packages/app/src/services/feature-transition.ts`, mirroring `transitionTaskGuarded`, and route `apps/server/src/modules/feature/handlers.ts:63-67` and the reopen hook at `apps/server/src/context.ts:500-503` through it. It:
  - (a) loads the `feature-lifecycle` graph with the existing `loadWorkflowDef`/`resolveWorkflowFile` (no spawn), and refuses an edge that is not declared;
  - (b) runs the in-process `FeatureCheckService.check(id, { as: to })` for every edge whose YAML guard is `kind: shell`, and denies on error findings;
  - (c) refuses a target state that declares `onEnter` actions (today: `verifying`), with the message "entering `verifying` runs feature verification; use `spur feature update <id> verifying` from the CLI";
  - (d) throws `GuardDeniedError` for every refusal, which the handler already maps to HTTP 409 `GUARD_DENIED`.

  `always` edges, including the `verifying → active` reopen, pass unchanged.
- [x] R3. **One raw status writer is not reintroduced.** Add a static pin test that fails when a non-test file under `packages/`, `apps/`, `plugins/` or `scripts/` calls `setFrontmatterField('status'` on a feature document. The only status writer is `PlanningWriteServiceImpl.transition`.
- [x] R4. **A missing graph fails loudly.** If `resolveWorkflowFile` cannot find `feature-lifecycle.yaml`, `transitionFeatureGuarded` throws `GuardDeniedError` naming the profile (`feature-lifecycle`) and the searched roots. It never falls back to `SchemaLifecyclePort`.
- [x] R5. **Tests (written first, each shown to fail without its fix).**
  - (a) A no-port `feature check --fix` on a `verifying` feature with a live linked task leaves the file byte-identical and returns the `feature-reopen-unavailable` error.
  - (b) The with-port reopen still yields `active` plus a History line.
  - (c) A server-context `feature.transition` `active → verifying` on a feature whose check has error findings is denied with 409, and the file is unchanged.
  - (d) An undeclared edge is denied.
  - (e) The server reopen hook still reopens `verifying → active` with a History line.
  - (f) The R3 pin.
- [x] R6. **Docs.**
  - `docs/design/planning-record-contracts.md` (feature-check row and the task→feature link section) states that the reopen requires a port and that the raw fallback was removed.
  - The server surface satellite that documents `feature.transition` states the in-process guard and the 409 refusals, including `→ verifying`.
- [x] R7. **Same-change bundle.** Run `bun run --filter @gobing-ai/spur build:bundle`. No plugin script is touched, so `build:scripts` is not required.

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

Feature status writes can no longer degrade to an unguarded mutation on either surface this task
named: `feature check --fix` without a transition port, and the server's HTTP feature write path.

#### Change map

| Change | Anchor |
| --- | --- |
| R1 — deleted the raw `setFrontmatterField('status', 'active')` fallback in the `--fix` reopen; a port-less caller now gets the error finding `feature-reopen-unavailable` (naming the missing port and both CLI recoveries), no `feature-reopen` repair is reported, and the feature file stays byte-identical | `packages/app/src/services/feature-check.ts:281-306` |
| R1 — `findings` hoisted above the `--fix` block so the refusal finding is emitted from the repair phase | `packages/app/src/services/feature-check.ts:227` |
| R1 — new finding code `feature-reopen-unavailable` registered | `packages/config/src/finding-codes.ts:88`, `packages/config/src/finding-codes.ts:194` |
| R2/R4 — new in-process guard `transitionFeatureGuarded`: resolves `feature-lifecycle` project-first via `resolveWorkflowFile` (missing graph → `GuardDeniedError` naming the profile and probed roots, never the permissive port), refuses undeclared edges, refuses `onEnter` targets (`verifying`) with the CLI recovery message, runs `kind: shell` edge guards as the CLI would — YAML `--strict` read off the guard command and `runDir` + the run-store port forwarded so the D63 completion receipt fires at `--as done` — denying on error findings, then commits through `FeatureService.transition` (History + event unchanged) | `packages/app/src/services/feature-transition.ts:95-177` |
| R2 — public export from the app package | `packages/app/src/index.ts:327-331` |
| R2 — `ServerContext.transitionFeature(input)` added (contract) | `apps/server/src/context.ts:212` |
| R2 — server wiring: lazy `FeatureCheckService`, task folders threaded to the check, guard invoked | `apps/server/src/context.ts:577-596` |
| R2 — the 1132 task→feature reopen hook now routes through the guard (`verifying → active` is an `always` edge, so it passes unchanged) | `apps/server/src/context.ts:521-524` |
| R2 — the HTTP `feature.transition` handler calls `ctx.transitionFeature` instead of the unguarded `featureService().transition` | `apps/server/src/modules/feature/handlers.ts:63-71` |
| P2 — shell-guard edge execution mirrors the CLI wiring: the guard command's `--strict` becomes `strict: true` (only where declared), and `runDir` + the run-store port are forwarded so the digest-chained verification-receipt gate fires over HTTP | `packages/app/src/services/feature-transition.ts:63-70`, `packages/app/src/services/feature-transition.ts:145-168` |
| P2 — shared DB-backed `createFeatureReceiptRunPort` factory (`RunDao`/`ArtifactDao` read-only port) reused by both surfaces — no second receipt mechanism | `packages/app/src/services/feature-receipt-run-port.ts:22-56` |
| P2 — CLI `makeReceiptRunPort` now delegates to the shared factory | `apps/cli/src/commands/feature.ts:614-615` |
| P2 — server `transitionFeature` wires `runDir` + the run-store port so the completion receipt is enforced on the HTTP path | `apps/server/src/context.ts:577-596` |
| R3 — static pin: no non-test source under packages/apps/plugins/scripts may call `setFrontmatterField('status', …)` in a feature-domain file | `packages/app/tests/feature-status-writer-pin.test.ts:17` |
| R5(a)/(b) — no-port refusal (byte-identical + finding) and with-port reopen (History line + repair) | `packages/app/tests/services/feature-check-reopen-guard.test.ts:72`, `packages/app/tests/services/feature-check-reopen-guard.test.ts:96` |
| R5(d), AC3/AC4 app-layer, AC7, project-tier precedence (failure inventory) | `packages/app/tests/services/feature-transition.test.ts:145-314` |
| P2 — guard wiring + receipt-gate assertions (strict/runDir/receiptRunPort forwarded; receipt-less denial; valid-receipt pass) | `packages/app/tests/services/feature-transition.test.ts:228-285` |
| R5(c)/(d)/(e) over the server context + handler routing pin | `apps/server/tests/modules/feature/transition-gate.test.ts:182-287` |
| P2 — server-path receipt-gate assertions (receipt-less denial; recorded-receipt pass through the wired run-store port) | `apps/server/tests/modules/feature/transition-gate.test.ts:219-249` |
| Handler mock updated for the new `transitionFeature` context member | `apps/server/tests/modules/feature/handlers.test.ts:61-67` |
| R6 — feature-check row + task→feature link row state the port requirement and the removed raw fallback | `docs/design/planning-record-contracts.md:110`, `docs/design/planning-record-contracts.md:39` |
| R6 — server surface satellite documents the in-process guard and the 409 refusals (incl. `→ verifying`) | `docs/design/server-side-adjustment-design.md:275-286` |
| R7 — bundle rebuilt (regenerated plugin bundles carry the new finding code) | `plugins/sp/lib/idea-handoff.generated.mjs`, `plugins/sp/lib/inline-run.generated.mjs`, `plugins/sp/lib/quality-gate.generated.mjs` |

#### Decisions within the approved design

- **Guard order follows the frozen Design steps:** declared-edge check → `onEnter` refusal →
  shell-guard check. For `active → verifying` the `onEnter` refusal fires before the check runs, so
  AC3's denial is the `GuardDeniedError` → 409 either way and AC4's CLI recovery message is exact.
- **`resolveFile` test seam** on `GuardedFeatureTransitionDeps` (defaults to `resolveWorkflowFile`):
  the bundled tier always finds `feature-lifecycle.yaml` in a dev checkout, so AC7's missing-graph
  refusal is exercised through this injection point rather than by monkey-patching module state.
- **Missing feature** surfaces the write service's own not-found error (the guard does not invent a
  denial for an entity it cannot read), mirroring the 0966 task-gate Q&A.
- Server check invocations thread `featuresDir` + all registered task folders so the in-process
  `--as <to>` check evaluates the same L3/L4 corpus rules as the CLI shell guard.
- **P2 remediation — receipt gate parity:** the HTTP shell guard must not be weaker than the CLI
  shell guard. `strict` is read from the YAML guard command (`feature check $featureId --strict --as
  done`) rather than passed unconditionally, so warning-only edges are not over-denied; `runDir` and
  the run-store port are wired so the D63 digest-chained completion receipt (`FeatureCheckService`
  `--as done` block) fires over oRPC exactly as it does from the CLI. `runDir` is a required member
  of `GuardedFeatureTransitionDeps` (mirroring the task-side `GuardedTransitionDeps`), making a
  future caller that forgets it a compile error instead of a silent bypass.

#### Fail-first evidence (R5)

- `feature-check-reopen-guard.test.ts` AC1/R5(a): pre-fix the file was mutated (`status: verifying → active`)
  with no finding — failed as `expect(after).toBe(before)`; passes post-fix.
- `feature-status-writer-pin.test.ts`: pre-fix flagged `packages/app/src/services/feature-check.ts:283`; passes post-fix.
- `feature-transition.test.ts`: pre-fix the module did not exist (import error); all pass post-fix.
- `transition-gate.test.ts` (server): pre-fix `ctx.transitionFeature is not a function` and the handler used
  the unguarded path (4 failures); all pass post-fix.
- P2 remediation: reverting the guard's `strict`/`runDir`/`receiptRunPort` forwarding fails the app
  wiring test (`strict` was `undefined`) and the app/server receipt-less denials (the hop resolved
  instead of rejecting); restoring the wiring makes all pass.
- Regression pins that passed before and after (behavior preserved): R5(b) with-port reopen, AC5 server reopen.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The `else` raw `setFrontmatterField('status','active')` fallback is deleted; a port-less `--fix` now pushes the `feature-reopen-unavailable` error finding and applies no status write — `packages/app/src/services/feature-check.ts:281-306`; finding code registered `packages/config/src/finding-codes.ts:88,194`; test `packages/app/tests/services/feature-check-reopen-guard.test.ts:72-93` (byte-identical file + finding names the port and both recoveries; `result.pass === false`; no `feature-reopen` repair). |
| R2 | MET | `transitionFeatureGuarded` in-process guard: project-first graph resolve, undeclared-edge refusal, `onEnter` refusal with CLI recovery, `kind: shell` check execution, commit via `FeatureService.transition` — `packages/app/src/services/feature-transition.ts:95-177`; exported `packages/app/src/index.ts:327-331`; HTTP handler routed `apps/server/src/modules/feature/handlers.ts:63-71`; reopen hook routed `apps/server/src/context.ts:518-524`; server wiring `apps/server/src/context.ts:577-596`. Tests: `apps/server/tests/modules/feature/transition-gate.test.ts:183-287`, `packages/app/tests/services/feature-transition.test.ts:146-201`. |
| R3 | MET | Static pin walks `packages`, `apps`, `plugins`, `scripts` over `**/*.{ts,mjs}`, skips tests, asserts zero feature-domain raw status writers — `packages/app/tests/feature-status-writer-pin.test.ts:17-39` (passes, 0 violations). Independent grep this pass: 0 non-test `setFrontmatterField('status'…` hits across the four roots. |
| R4 | MET | Missing graph throws `GuardDeniedError` naming `feature-lifecycle` and the probed roots; no `SchemaLifecyclePort` fallback anywhere in the module — `packages/app/src/services/feature-transition.ts:102-110`; test `packages/app/tests/services/feature-transition.test.ts:204-227`. |
| R5 | MET | All six required tests present and green: R5(a)/(b) `packages/app/tests/services/feature-check-reopen-guard.test.ts:72,96`; R5(d) + AC3-app `packages/app/tests/services/feature-transition.test.ts:146,176`; R5(c)/(e) `apps/server/tests/modules/feature/transition-gate.test.ts:183,247`; R5(f) pin `packages/app/tests/feature-status-writer-pin.test.ts:17`; fail-first evidence recorded in the task Solution. |
| R6 | MET | feature-check row + task→feature link row state the port requirement and the removed raw fallback — `docs/design/planning-record-contracts.md:39,110`; server satellite documents the in-process guard and 409 refusals incl. `→ verifying` — `docs/design/server-side-adjustment-design.md:275-286`. |
| R7 | MET | Bundles rebuilt with the new finding code: `plugins/sp/lib/idea-handoff.generated.mjs`, `plugins/sp/lib/inline-run.generated.mjs`, `plugins/sp/lib/quality-gate.generated.mjs`, `plugins/sp/scripts/quality-gate.mjs` each carry `feature-reopen-unavailable` (grep count 1); `spur-check`/bundle gates captured in `.spur/run/1137-test-gate.log` (PASS). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — No port means no status write and an actionable finding (req: R1) | MET | test | `packages/app/tests/services/feature-check-reopen-guard.test.ts:72-93` — file byte-identical, `feature-reopen-unavailable` error finding naming CLI recovery, no `feature-reopen` repair (fresh run pass). |
| AC2 — With a port the reopen still goes through the transition (req: R1) | MET | test | `packages/app/tests/services/feature-check-reopen-guard.test.ts:96-116` — feature is `active`, exactly one `verifying → active` History line, repair kind `feature-reopen`. |
| AC3 — The server denies a guarded edge whose check fails (req: R2) | MET | test | `apps/server/tests/modules/feature/transition-gate.test.ts:183-192` (denial + file unchanged) with 409 mapping pinned at `apps/server/tests/middleware/error-handler.test.ts:70-80`; the check-findings denial path is exercised at the `verifying → done` shell edge `packages/app/tests/services/feature-transition.test.ts:176-189`. |
| AC4 — The server refuses undeclared edges and onEnter targets (req: R2) | MET | test | `apps/server/tests/modules/feature/transition-gate.test.ts:194-217` — `undeclared edge backlog → done` named, and `→ verifying` refused with the exact CLI recovery message; 409 mapping `apps/server/tests/middleware/error-handler.test.ts:70-80`. |
| AC5 — The server reopen keeps working (req: R2) | MET | test | `apps/server/tests/modules/feature/transition-gate.test.ts:247-263` — task create against a `verifying` feature leaves it `active` with exactly one `verifying → active` History line. |
| AC6 — No second raw status writer exists (req: R3) | MET | test | `packages/app/tests/feature-status-writer-pin.test.ts:17-39` — scans the four roots, 0 violations; independent grep this pass agrees. |
| AC7 — A missing lifecycle graph is a loud refusal (req: R4) | MET | test | `packages/app/tests/services/feature-transition.test.ts:204-227` — `GuardDeniedError` naming `feature-lifecycle` and the searched root; file unchanged. |
| AC8 — Tests fail without their fixes and the gates pass (req: R5, R6, R7) | MET | command | `.spur/run/1137-test-gate.status` = PASS (log `10759 pass / 0 fail`, digest sha256:239179e0e09e…); fail-first evidence (pre-fix mutation, pin hit at `packages/app/src/services/feature-check.ts:281-306`, import errors, P2 receipt-hop resolved-instead-of-rejecting) recorded in the task Solution (manual review of recorded evidence — the reversion drill is not independently re-run in this observe-only pass). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 1137 (re-review after P2 remediation)
**Scope:** working-tree diff — 8 modified + 6 new files (new `feature-transition` guard + shared `feature-receipt-run-port`, `feature-check` raw-fallback deletion, server context/handler routing, pin test, 4 test files, 2 design docs, regenerated bundles)
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — prior P2 genuinely closed, R1–R7 / AC1–AC8 still met, no open P1–P3 findings. Fresh focused suites re-run this pass: 17 pass / 0 fail (packages/app, 4 files), 24 pass / 0 fail (apps/server, 2 files); certified gate `.spur/run/1137-test-gate.status` = PASS (10759 tests / 634 files, digest sha256:239179e0e09e…).

##### Prior review disposition

- **Prior P2 (receipt-less HTTP `verifying → done`) — CLOSED.** `transitionFeatureGuarded` now reads `--strict` off the edge's YAML guard command and forwards `runDir` + `receiptRunPort` (`packages/app/src/services/feature-transition.ts:153,159,160`); `runDir` is a required `GuardedFeatureTransitionDeps` member (`:63-70`); the server wires both (`apps/server/src/context.ts:586-595`; port factory `packages/app/src/services/feature-receipt-run-port.ts:22-56`). The receipt gate fires at `asStatus === 'done'` (`packages/app/src/services/feature-check.ts:349-356`) and every rejection is an error finding, which the guard denies on (`feature-transition.ts:164-172`). Fresh evidence: a strict-clean receipt-less `verifying → done` over the server path is denied `completion evidence rejected (missing)` (`apps/server/tests/modules/feature/transition-gate.test.ts:219-233`); a current PASS receipt (run row + registered artifact) commits to `done` (`:235-245`); the app wiring test asserts `strict===true`, `asStatus==='done'`, `runDir` and `receiptRunPort` are forwarded (`packages/app/tests/services/feature-transition.test.ts:228-262`); the same denial is pinned at the app layer (`:263-272`). No receipt-less `verifying → done` can pass over the server path.
- **Strict elevation is scoped correctly — no over-denial.** `strict` is derived from the guard command (`/(^|\s)--strict(\s|$)/`, `feature-transition.ts:153`) rather than passed unconditionally. In the live graph only `verifying → done` declares `--strict` (`config/workflows/feature-lifecycle.yaml`); the other shell edge (`active → verifying`) is refused at Step 3 (`onEnter`) before the check runs, so no warning-only edge is over-elevated. Project/CLI tier YAMLs are byte-identical (`diff` clean).
- **Prior P3 (change-map citation drift) — RESOLVED.** The Solution table now cites `apps/server/tests/modules/feature/transition-gate.test.ts` (`docs/tasks5/1137_feature-status-writes-must-not-degrade-to-an-unguarded-mutat.md:227-228`).
- **Prior P4s (pin `.mjs` coverage; doc `as`→`asStatus` drift) — RESOLVED.** The pin now scans `**/*.{ts,mjs}` (`packages/app/tests/feature-status-writer-pin.test.ts:21`); the `ServerContext.transitionFeature` docblock and the server satellite now say `asStatus` (`apps/server/src/context.ts:209`, `docs/design/server-side-adjustment-design.md:281-283`).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness/testing | Receipt-gate parity is now equivalent across surfaces, but both share a residual weakness: `createFeatureReceiptRunPort.readRunRow` always returns `varsJson: null`, so the run-integrity cross-check of the recorded effective `verificationCmd` is vacuously skipped (the CLI's former inline port did the same — pre-existing, not a remediation regression; the digest + artifact-registration checks still enforce). | `packages/app/src/services/feature-receipt-run-port.ts:33-44`; consumer `packages/app/src/workflow/feature-verification-receipt.ts:423-431` | ACCEPTED |
| 2 | P4 (advisory) | efficiency | `ServerContext.transitionFeature` caches `FeatureCheckService` but rebuilds the `RunDao`/`ArtifactDao` receipt port on every call (`createFeatureReceiptRunPort(await this.getDb(), fs)`); a transition is rare, so the cost is negligible. | `apps/server/src/context.ts:584,594` | ACCEPTED |
| 3 | P4 (advisory) | usability/docs | AC3's server denial (`active → verifying`) is produced by the Step-3 `onEnter` refusal, which fires before the shell check — outcome-equal (409 GUARD_DENIED) and a documented Design decision, but causally different from the AC's "check has error findings" Given. The `→ verifying` refusal is unconditional. | `packages/app/src/services/feature-transition.ts:136-144`; task Decisions ("Guard order follows the frozen Design steps") | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | raw `else` fallback deleted; port-less reopen emits error finding `feature-reopen-unavailable` (names the port + both CLI recoveries), no `feature-reopen` repair, file byte-identical — `packages/app/src/services/feature-check.ts:284-306`; code registered `packages/config/src/finding-codes.ts:88,194`; test `packages/app/tests/services/feature-check-reopen-guard.test.ts:72-93` (passes) |
| R2 | MET | `transitionFeatureGuarded` resolves the graph project-first, refuses undeclared edges (`:125-134`), refuses `onEnter` targets with the exact CLI recovery (`:136-144`), runs `kind: shell` edges in-process with `--strict`/`runDir`/`receiptRunPort` (`:146-174`), commits via `FeatureService.transition` (`:176`); handler + reopen hook routed — `apps/server/src/modules/feature/handlers.ts:63-71`, `apps/server/src/context.ts:518-524,577-595` |
| R3 | MET | pin walks packages/apps/plugins/scripts, skips tests, scans `**/*.{ts,mjs}`, asserts zero feature-domain raw status writers — `packages/app/tests/feature-status-writer-pin.test.ts:17-39` (0 violations; pre-fix flagged `feature-check.ts:283`) |
| R4 | MET | missing graph → `GuardDeniedError` naming `feature-lifecycle` + probed roots, no permissive-port fallback anywhere in the module — `packages/app/src/services/feature-transition.ts:102-110`; test `packages/app/tests/services/feature-transition.test.ts:169-192` |
| R5 | MET | all six tests present and green: app 17 pass / 0 fail, server 24 pass / 0 fail (fresh runs this pass); fail-first evidence recorded in the task Solution (pre-fix mutation, pin hit at `:283`, import errors, P2 receipt-hop resolved instead of rejecting) |
| R6 | MET | feature-check row + task→feature link row state the port requirement and the removed fallback — `docs/design/planning-record-contracts.md:39,110`; server satellite documents the guard and 409 refusals incl. `→ verifying` — `docs/design/server-side-adjustment-design.md:275-286` |
| R7 | MET | bundles regenerated: `feature-reopen-unavailable` present in all 3 `plugins/sp/lib/*.generated.mjs` + `plugins/sp/scripts/quality-gate.mjs`; 0 raw `setFrontmatterField('status'` hits in non-test `packages/apps/plugins/scripts` |
| AC1, AC2 | MET | `packages/app/tests/services/feature-check-reopen-guard.test.ts:72-93` (byte-identical + finding), `:96-116` (active + one History line + repair) |
| AC3, AC4 | MET | `apps/server/tests/modules/feature/transition-gate.test.ts:183-192` (409-mapped denial, file unchanged), `:194-217` (undeclared edge named; `→ verifying` CLI recovery) |
| AC5 | MET | `apps/server/tests/modules/feature/transition-gate.test.ts:247-263` (reopen via task create: `verifying → active`, exactly one History line) |
| AC6 | MET | pin test (above), 0 violations |
| AC7 | MET | `packages/app/tests/services/feature-transition.test.ts:169-192` (missing graph refusal names profile + searched root) |
| AC8 | MET | four new suites fail-first evidence in the task Solution; gate `.spur/run/1137-test-gate.status` = PASS (10759 tests / 634 files; proof-digest sha256:239179e0e09e…); bundle rebuild included |

**Re-check for regressions introduced by the remediation:** none found. The shared `createFeatureReceiptRunPort` factory is byte-equivalent to the CLI's former inline port (`apps/cli/src/commands/feature.ts:608-615` delegates); the `resolveFile` seam is unchanged; `always` edges (`verifying → active` reopen, `done → active`, blocked↔active, `→ cancelled`) still pass with exactly one History line; no other server call site reaches `featureService().transition` directly (grep clean).

**Gate evidence:** `.spur/run/1137-test-gate.log` tail — "10759 pass / 0 fail, Ran 10759 tests across 634 files", post-check 2/2 rules passed, proof-digest sha256:239179e09e54ac432ea140cee2a1964c7d3e3d96816a36b101f97060389d5076, status file PASS. The preserved FAIL receipt `.spur/run/1137-check-receipt.false-fail-sigterm.json` shares the same `inputDigest`; it was an external-SIGTERM-induced failure (not a check failure) and is superseded by the certified PASS.

**Architecture:** the guard remains a deep module — one function hides graph resolution, edge validation, `onEnter` policy and shell-guard execution behind a narrow deps interface with a `resolveFile` test seam; it mirrors the 0966 `transitionTaskGuarded` precedent rather than inventing a second pattern; the new `createFeatureReceiptRunPort` removes the CLI/server port duplication (single receipt mechanism). Export surface stays minimal (`packages/app/src/index.ts:309,326-331`). No shallow pass-throughs introduced.

**Next:** none blocking — record this PASS and close; the three P4 advisories are accepted (varsJson parity, per-call port construction, AC3 causal note).

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
- 2026-10-10T01:34:16.087Z todo → wip (system)
- 2026-10-10T04:11:56.042Z wip → testing (system)
- 2026-10-10T04:12:38.639Z testing → done (system)

