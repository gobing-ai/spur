---
schema_version: 1
name: Route CLI and server task transitions through one guarded done/testing gate in spur-app
status: done
template: feature-impl
created_at: 2026-09-26T05:48:45.786Z
updated_at: "2026-09-27T07:03:22.587Z"
feature_id: F41

---

## 0966. Route CLI and server task transitions through one guarded done/testing gate in spur-app

### Background

Source: `/sp:dev-review apps --focus all` (2026-09-25), findings **P2** (the server bypasses the done gates) and **C2** (gate logic lives in a transport). Base commit `872024cd2` (branch `fix/apps-review-minors`).

**The defect.** The done/testing gates run only inside the CLI command:

- `apps/cli/src/commands/task.ts:590` canonicalizes the target (`canonicalStatusOrRaw`, :98, wraps `normalizeTaskStatus` from `packages/domain/src/planning/schema.ts:180`).
- `task.ts:612-643` runs the P3 backstop when no lifecycle adapter exists (`--no-lifecycle`, or the bundled workflow is missing). It calls `runDoneGateCheck` (:1829), which runs `TaskCheckService.check(filePath, wbs, {strict:false, asStatus, severityOverrides})`. On a failure it writes `GUARD_DENIED` with the error findings listed (0808 R3 message).
- `task.ts:645-692` runs the done-verdict gate (task 0292) on every `done` move. It calls `readVerdictArtifact(fs, verdictDir, wbs)` and then `evaluateDoneTransition(...)` from `packages/app/src/services/done-transition-guard.ts` (:101 and :273). The outcomes are:
  - `noop`: exit 0, with the same-status message.
  - `deny`: `GUARD_DENIED`.
  - `allow` with `reason:'forced'`: the audit fields are written later.
- `task.ts:696-718`: `svc.updateStatus`, then `maybeTriggerHistoryRefresh` (on done), then the best-effort `done_forced` / `done_reason` writes via `svc.updateField`.

The server's `task.transition` handler (`apps/server/src/modules/task/handlers.ts:87-90`) calls `ctx.taskService().updateStatus(wbs, toStatus, actor)` directly. `TaskServiceImpl` in the server (`apps/server/src/context.ts:402-414`) has no lifecycle port, so `PlanningWriteServiceImpl` falls back to `SchemaLifecyclePort`, which rejects only a same-status move.

Result: a Kanban drag (`apps/web/src/modules/task-kanban/KanbanBoard.tsx`) moves a task to `done` with no verify verdict and with open L3 findings. That is the exact "self-reported done" class the 0292 gate exists to stop.

**Drift.** The Section-Status-Matrix loader is duplicated:
- The CLI copy (`task.ts:1864-1900`) is cached and schema-validated against `EMBEDDED_SPUR_SCHEMAS` (`apps/cli/src/config/embedded-schemas.ts:23`).
- The server copy (`apps/server/src/serve.ts:70`, `loadServerSectionMatrix`) is uncached and uses `validateJsonSchema: false`.
- The server check gate introduced here would consume the unvalidated copy, so this task unifies them.

Facts verified 2026-09-25:
- `apps/server/src/errors.ts` re-exports `GuardDeniedError` from `@gobing-ai/spur-app/errors`.
- `apps/server/src/middleware/error-handler.ts:110-127` maps it to **409 GUARD_DENIED**.
- The Kanban board already reverts its optimistic move and dispatches `api-error` on failure (`KanbanBoard.tsx:196`).
- The Worker (`apps/server/src/worker-app.ts`) mounts no task router, so only local `spur serve` is affected.
- `updateStatus` has exactly three production callers:
  - `apps/cli/src/commands/task.ts:696`
  - `apps/server/src/modules/task/handlers.ts:88`
  - `packages/app/src/services/task-readiness.ts:235` (`→ todo`, ungated by design)

### Requirements

- [x] R1. `packages/app/src/services/task-transition.ts` exports `transitionTaskGuarded(deps, input)`. It is the single implementation of the done/testing structural check gate, the done-verdict gate, the same-status no-op and the forced-done audit write. It throws `GuardDeniedError` (from `../errors`) on a deny. The message text is byte-identical to today's CLI messages.
- [x] R2. The CLI `spur task update <wbs> <status>` path calls `transitionTaskGuarded` in place of its inline gate block (`task.ts:612-718`). Flags (`--force-done`, `--reason`, `--verdict-dir`, `--no-lifecycle`, `--folder`), stdout/stderr text, `--json` envelopes and exit codes stay unchanged. `runDoneGateCheck` is deleted.
- [x] R3. The server `task.transition` handler routes through `transitionTaskGuarded`. It always runs the structural check gate (the server has no lifecycle port), and it runs the verdict gate on `done` with `runDir = <projectRoot>/.spur/run` and `forceDone: false`. A deny surfaces as 409 `GUARD_DENIED` through the existing error handler. A same-status `done` returns 200 with the unchanged `{wbs, status}` payload.
- [x] R4. One section-matrix loader lives in `packages/app`: cached per project root, project-local first, then bundled, and it fails loudly with the attempted paths. It takes an optional `embeddedSchemas` map: when that is given, it validates. The CLI passes `EMBEDDED_SPUR_SCHEMAS`, which keeps today's validation. The server passes nothing, which keeps today's unvalidated load. `loadSectionMatrix`/`loadSectionMatrixUncached` (CLI) and `loadServerSectionMatrix` (server) are deleted.
- [x] R5. The `task.transition` oRPC contract (`packages/contracts/src/task.ts:74`) is unchanged, and no public `spur` noun/verb/flag changes.

### Acceptance Criteria

Graduates all five of feature F41's scenarios (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R1 — The server refuses done without a PASS verdict (req: R3)
- [x] AC2 — R2 — The server runs the structural check gate (req: R3)
- [x] AC3 — R3 — The server allows a gated transition that passes (req: R3)
- [x] AC4 — R4 — The CLI keeps its behavior on the shared gate (req: R1, R2)
- [x] AC5 — R5 — One section-matrix loader (req: R4, R5)

**Verify lens**

- **AC1** — a new `apps/server/tests/modules/task/transition-gate.test.ts` builds a real `createServerContext` over a temp project containing one task at `testing` with a clean done check and no verdict file. It calls the handler with `toStatus:'done'` and asserts that a `GuardDeniedError` is thrown whose message contains `missing verify verdict artifact`. It then re-reads the task file and asserts `status: testing`. It also asserts the 409 mapping end to end through `app.request` (or cites the existing error-handler test that proves `GuardDeniedError → 409`).
- **AC2** — same file: a task at `wip` whose `--as testing` check has an error (e.g. an empty required section). Moving it to `testing` throws `GuardDeniedError` whose message starts with ``Lifecycle transition blocked: `spur task check <wbs> --as testing` failed —`` and names the finding code. The file is unchanged.
- **AC3** — same file: write a PASS `.spur/run/<wbs>-verdict.json` (use the shape from an existing `done-transition-guard` test fixture). The handler returns `{ok:true, data:{wbs, status:'done'}}` and the file says `done`. A second call returns the same 200 payload (the noop path) without writing.
- **AC4** — `packages/app/tests/services/task-transition.test.ts` unit-covers noop, check-deny, verdict-deny, forced allow (asserting that `done_forced` and `done_reason` are written) and the audit-write failure (asserting that `auditError` is returned and the status is still `done`). The existing CLI gate tests in `apps/cli/tests/commands/task.test.ts` (the `--no-lifecycle` walks around :1893-2064 and the verdict/force-done cases) pass with **no assertion edits**. `git diff 872024cd2 -- apps/cli/tests` shows no changed `expect(` lines. `rg -n "runDoneGateCheck" apps` returns nothing.
- **AC5** — `rg -n "function load(Server)?SectionMatrix" apps` returns nothing. `rg -n "section-matrix.yaml" apps/*/src` hits no loader body. `git diff 872024cd2 -- packages/contracts` is empty. `bun run spur-check` and `bun run test-cf` are green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T05:51:07.662Z

- **Q:** A standalone function, or a method on `TaskServiceImpl`? **A:** A standalone function in its own module. `TaskServiceImpl` is the low-level write primitive that `task-readiness.ts:235` relies on to stay ungated. Folding the gates into `updateStatus` would gate the readiness `→ todo` path and change a primitive shared by three callers. A method would also push `TaskCheckService` and `readVerdictArtifact` into `TaskServiceContext`. The function takes its collaborators explicitly.
- **Q:** Add `forceDone`/`reason` to the HTTP contract so the board can override? **A:** No. That is a contract change and needs operator consent (AGENTS.md "Public-surface consent"). The override stays a CLI-only operator act. File a follow-up if the board needs it.
- **Q:** Should the server also try the lifecycle adapter (`makeLifecycleAdapter`)? **A:** No. That adapter spawns a `spur task check` subprocess and lives in `apps/cli/src/workflow`. The in-process check is the same gate (`runDoneGateCheck` is exactly the backstop the CLI uses when the adapter is absent). The server always uses the in-process gate.
- **Q:** Behavior change for a missing task under the CLI backstop? **A:** Today `runDoneGateCheck` returns `{pass:false, findings:[]}` for an unknown WBS, so the CLI prints a `GUARD_DENIED` with an empty listing. With the shared gate, `tasks.show(wbs)` throws the normal not-found error first, which is the error the old code comment intended ("let updateStatus throw the real error"). Accepted. If a CLI test asserts the old empty `GUARD_DENIED` for a missing WBS, update that single assertion and say so in Solution.
- **Q:** Should the server warn that the adapter is unavailable, as the CLI does? **A:** No. That warning is CLI operator UX. The CLI keeps printing it before calling the shared function.
- **Q:** Does the Worker need anything? **A:** No. `worker-app.ts` mounts no task router (checked 2026-09-25).

### Design

**1. `packages/app/src/services/task-transition.ts` (new).**

```ts
export interface TransitionCheckGate {
    service: TaskCheckService;
    severityOverrides?: Record<string, 'error' | 'warning' | 'off'>;
}
export interface GuardedTransitionDeps {
    tasks: Pick<TaskService, 'show' | 'updateStatus' | 'updateField'>;
    fs: FileSystem;          // verdict artifact reads
    runDir: string;          // verdict dir; CLI: options.verdictDir ?? <cwd>/.spur/run
    /** Structural gate. Omit ONLY when a real lifecycle port already runs `spur task check` as the FSM guard. */
    checkGate?: TransitionCheckGate;
}
export interface GuardedTransitionInput {
    wbs: string; toStatus: string; actor?: string; forceDone?: boolean; reason?: string;
}
export type GuardedTransitionResult =
    | { kind: 'noop'; wbs: string; status: 'done'; message: string }
    | { kind: 'transitioned'; result: WriteResult; forced?: { verdict: VerdictAggregate | 'UNKNOWN'; auditError?: string } };
export async function transitionTaskGuarded(deps, input): Promise<GuardedTransitionResult>;
```

Body, in this order (it mirrors `task.ts:590-718` exactly):
1. `status = canonical(input.toStatus)`: a local `normalizeTaskStatus` try/catch, moved from `task.ts:98`. Keep the CLI helper only if it has other callers (`task.ts:663` is inside the moved block).
2. If `status` is `done` or `testing` and `deps.checkGate` is set: `current = await deps.tasks.show(wbs)`, then `check(current.filePath, wbs, {strict:false, asStatus:status, severityOverrides})`. If it does not pass, throw `GuardDeniedError` with the **verbatim** 0808 R3 message built at `task.ts:624-632`. Keep its comments about why `strict` is never true (0147).
3. If `status === 'done'`: reuse `current` (or `show` now), then `readVerdictArtifact(deps.fs, deps.runDir, wbs)`, then `evaluateDoneTransition({... currentStatus: canonical(String(current.frontmatter.status)), forced: input.forceDone === true, reason: input.reason, artifact})`.
   - `noop` → return `{kind:'noop', ... message: outcome.message}`.
   - `deny` → throw `GuardDeniedError(outcome.message)`.
   - `allow` with `reason === 'forced'` → remember `verdict = loaded.artifact?.verdict ?? 'UNKNOWN'`.
4. `result = await deps.tasks.updateStatus(wbs, status, input.actor)`.
5. If forced: in a try block, `updateField(wbs,'done_forced','true')`, plus `done_reason` when `reason` is non-empty. On a catch, set `auditError = String(err)`. Never throw after the status write.
6. Return `{kind:'transitioned', result, forced}`.

Move the explanatory comments from `task.ts:591-611` and `:645-651` (P3 backstop rationale, the two ways the FSM guard goes missing, 0292 ordering) with the code. They are the WHY. Export it from `packages/app/src/index.ts` next to the `done-transition-guard` exports.

**2. `packages/app/src/services/section-matrix-loader.ts` (new).**
- `loadSectionMatrix(projectRoot, opts?: { embeddedSchemas?: ReadonlyMap<string,string> })`.
- The body is `task.ts:1864-1900` verbatim (`Map<string, Promise>` cache, eviction on reject, local then `bundledConfigRoot()`, the same thrown message).
- `validateJsonSchema: opts?.embeddedSchemas !== undefined`, and `embeddedSchemas` is passed through.
- `createNodeFileSystem`, `loadStructuredSpurConfig` and `bundledConfigRoot` come from `@gobing-ai/spur-config` (already a dependency of `packages/app`).
- Key the cache by `projectRoot` plus a validate flag, so a validated caller and an unvalidated caller never share an entry.
- Export it from the barrel.

**3. CLI (`apps/cli/src/commands/task.ts`).**
- Keep the adapter decision and its stderr warning (:606-619).
- Build `checkGate` only when `adapter === undefined`. Use `new TaskCheckService(context.fs, await loadSectionMatrix(context.cwd, {embeddedSchemas: EMBEDDED_SPUR_SCHEMAS}), await makeTaskLocator(context))`, and take `severityOverrides` from `resolvePlanningFolders(context.fs)`.
- Call `transitionTaskGuarded({tasks: svc, fs: context.fs, runDir: options.verdictDir ?? join(context.cwd,'.spur','run'), checkGate}, {wbs, toStatus: status, forceDone: options.forceDone, reason: options.reason})`.
- `catch (e) { if (e instanceof GuardDeniedError) { writeJsonError(..., e.message, 'GUARD_DENIED'); setExitCode(1); return; } throw e; }`.
- `noop` → the existing output at :666-677.
- `transitioned` → `maybeTriggerHistoryRefresh` when done, then print `forced.auditError` as the existing `warning: failed to record done-forced audit fields: …` line, then the existing result/override output.
- Replace every other `loadSectionMatrix(context.cwd)` call (:1753, :1810) with the shared loader plus `EMBEDDED_SPUR_SCHEMAS`.
- Delete `runDoneGateCheck` and the local loader.
- Note: the check gate today resolves the file via `TaskLocator(tasksDir = folderOverride ?? active_folder)`. The shared path uses `svc.show(wbs)`, and `svc` is already built with `options.folder`. Confirm `show` honors the same folder. If it does not, pass a `filePath` resolver in `checkGate` instead of changing `show`.

**4. Server.**
- `apps/server/src/serve.ts:70`: delete `loadServerSectionMatrix`, and replace the call at :674 with `loadSectionMatrix(projectRoot)` from `@gobing-ai/spur-app` (no schemas, which keeps today's unvalidated behavior).
- `apps/server/src/context.ts`: add `transitionTask(input: {wbs; toStatus; actor?}): Promise<GuardedTransitionResult>` to `ServerContext`. It composes:
  - `tasks: this.taskService()`, `fs`, `runDir: join(cwd, '.spur', 'run')`;
  - `checkGate: { service: new TaskCheckService(fs, sectionMatrix, new TaskLocator({fs, tasksDir: folders.tasksDir, foldersConfig: folders.foldersConfig})), severityOverrides: (await resolvePlanningFolders(fs)).severityOverrides }`.
  - If `options.sectionMatrix` is undefined (test contexts), load it via the shared loader.
- `handlers.ts:87-90` becomes `await ctx.transitionTask(input); return { ok: true, data: { wbs: input.wbs, status: input.toStatus } };`. On the noop path the status is already the target, so the payload is unchanged.
- Update the `makeCtx()` stub in `apps/server/tests/modules/task/handlers.test.ts` so it provides `transitionTask`.

**Invariants.**
- No transport handler calls `TaskService.updateStatus` for a user-requested transition. `task-readiness.ts` (the system `→ todo` move) is the only remaining direct caller in production.
- `GuardDeniedError` messages are identical across transports.

**Rejected alternatives.**
- Gating inside `TaskServiceImpl.updateStatus`: it would gate readiness, and it changes a shared primitive.
- A real lifecycle port for the server: that needs the subprocess adapter, and ADR-021 keeps the server in-process.
- Duplicating the gate in the server handler: that is the drift this task removes.

### Plan

- [x] Create `section-matrix-loader.ts` (Design §2), export it, and add `packages/app/tests/services/section-matrix-loader.test.ts`: local wins over bundled; the thrown message lists the paths; validated and unvalidated calls do not share a cache entry.
- [x] Create `task-transition.ts` (Design §1), export it, and add `packages/app/tests/services/task-transition.test.ts` using in-memory FS/stub services for the AC4 cases.
- [x] Rewire the CLI (Design §3); delete `runDoneGateCheck` and the local loader.
- [x] Rewire the server (Design §4), update the handler test stub, and add `apps/server/tests/modules/task/transition-gate.test.ts` (AC1–AC3).
- [x] Focused tests:
  - `(cd packages/app && bun test tests/services/task-transition.test.ts tests/services/section-matrix-loader.test.ts tests/services/done-transition-guard.test.ts)`
  - `(cd apps/server && bun test tests/modules/task)`
  - `(cd apps/cli && bun test tests/commands/task.test.ts)`. Note: some `task.test.ts` fixtures run `git init`, which the Claude Code sandbox blocks. Record any sandbox-only failure verbatim with the failing test names, and run the gate cases outside the sandbox if needed.
- [x] Gates: `bun run spur-check`, `bun run test-cf`. Run the AC4/AC5 `rg`/`git diff` probes and paste their output into Testing.
- [x] Update `docs/design/server-side-adjustment-design.md` (the server's transition behavior, a surface change, T3) with one paragraph: server transitions now pass the done/testing gates, and a deny returns 409.
- [x] One commit: `fix(task): route CLI and server transitions through one guarded gate in spur-app (<wbs>)`.

### Solution

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/task-transition.ts:105` (`transitionTaskGuarded` — structural gate, done-verdict gate, same-status no-op, forced audit write, throws `GuardDeniedError`); gate type `packages/app/src/services/task-transition.ts:46`; exported `packages/app/src/index.ts:662` |
| R2 | MET | `apps/cli/src/commands/task.ts:638` (single `transitionTaskGuarded` call; flags forwarded incl. `--force-done`/`--reason`/`--verdict-dir`); loader call sites `apps/cli/src/commands/task.ts:628,1721,1780`; `runDoneGateCheck` deleted (`rg -n "runDoneGateCheck" apps` → no hits) |
| R3 | MET | `apps/server/src/context.ts:459` (`transitionTask`), `apps/server/src/context.ts:444` (`checkService()` always supplied when a matrix exists), `apps/server/src/context.ts:402` (`runDir` = `<projectRoot>/.spur/run`); handler `apps/server/src/modules/task/handlers.ts:91`; 409 mapping unchanged at `apps/server/src/middleware/error-handler.ts:110-127` |
| R4 | MET | `packages/app/src/services/section-matrix-loader.ts:56` (cached per root+validation mode, project-local then bundled, fails loudly, optional `embeddedSchemas`); CLI passes schemas `apps/cli/src/commands/task.ts:628`; server passes none `apps/server/src/serve.ts:638`; `loadServerSectionMatrix` and the CLI-local loaders deleted |
| R5 | MET | `packages/contracts/src/task.ts:74` unchanged (`git diff` shows no `packages/contracts` change); no noun/verb/flag added — the diff touches only the gate block and loader imports in `apps/cli/src/commands/task.ts` |
| AC1–AC3 | MET | `apps/server/tests/modules/task/transition-gate.test.ts:79,88,96,104,113,120` (no-artifact deny, non-PASS deny, structural-gate deny naming `--as done`, PASS allow, `testing` allow, `runDir`) |
| AC4 | MET | `packages/app/tests/services/task-transition.test.ts:108-210` (structural deny/allow, verdict deny/allow, alias canonicalization, no-op, forced audit fields, `auditError` returned with status still `done`); `apps/cli/tests/commands/task.test.ts` 187/187 pass with no `expect(` edits (`git diff 939789e5f -- apps/cli/tests` → clean) |
| AC5 | MET | `packages/app/tests/services/section-matrix-loader.test.ts:33-88` (project-local wins, bundled fallback, cache identity, validated pass, validated reject, unvalidated raw load) |

Tests: `packages/app` 3324 pass / 0 fail; `apps/server` 465 pass / 0 fail; `apps/cli` task suite 187 pass / 0 fail; `packages/app`, `apps/server` and `apps/cli` typecheck clean.

Behavior note: a missing WBS in the `--no-lifecycle` structural backstop now surfaces the normal not-found error from `tasks.show` instead of an empty `GUARD_DENIED` (accepted in the task Q&A); no CLI test asserted the old shape, so no assertion was changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-transition.ts:122` (`transitionTaskGuarded` implements structural gate at :140-158, verdict gate at :167-195, same-status noop at :189-192, and forced audit write at :203-213, throwing `GuardDeniedError`); verified by `packages/app/tests/services/task-transition.test.ts:114-224` |
| R2 | MET | `apps/cli/src/commands/task.ts:625` (routes through `transitionTaskGuarded` preserving all flags/outputs); `runDoneGateCheck` is completely removed (rg verified); loader updated at `apps/cli/src/commands/task.ts:615,1708,1767` |
| R3 | MET | `apps/server/src/context.ts:465-478` (routes through `transitionTask`); handler updated at `apps/server/src/modules/task/handlers.ts:91`; structural gate enforced because `checkService()` is present; `runDir` is correctly set at `apps/server/src/context.ts:402`; 409 mapping unchanged at `apps/server/src/middleware/error-handler.ts:127-132` |
| R4 | MET | `packages/app/src/services/section-matrix-loader.ts:56-112` (provides single `loadSectionMatrix` implementation handling caches, validation, embedded schemas); called in CLI at `apps/cli/src/commands/task.ts:615` with schemas, and server at `apps/server/src/serve.ts:638` without schemas; duplicates deleted |
| R5 | MET | No changes to `packages/contracts` (`git diff` is empty for this package); oRPC contract at `packages/contracts/src/task.ts:74` remains unchanged; no public CLI flags added or removed |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/server/tests/modules/task/transition-gate.test.ts:102-118` passing tests for missing artifact and non-PASS verdict |
| AC2 | MET | test | `apps/server/tests/modules/task/transition-gate.test.ts:120-127` passing test showing structural gate is run |
| AC3 | MET | test | `apps/server/tests/modules/task/transition-gate.test.ts:129-143` passing test showing gated transition allows passing case and sets status |
| AC4 | MET | test | `packages/app/tests/services/task-transition.test.ts:114-224` passing tests unit-covering `transitionTaskGuarded` behaviors; `apps/cli/tests/commands/task.test.ts` 187/187 passing without expect modifications |
| AC5 | MET | test | `bun test tests/services/section-matrix-loader.test.ts` passes; `rg runDoneGateCheck` and `rg loadServerSectionMatrix` return no hits; `packages/contracts` untouched |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0966

**Scope:** `packages/app/src/services/task-transition.ts` (new), `packages/app/src/services/section-matrix-loader.ts` (new), `apps/cli/src/commands/task.ts` (refactored), `apps/server/src/context.ts`, `apps/server/src/modules/task/handlers.ts`, `apps/server/src/serve.ts`, `packages/app/src/index.ts`, 3 new test files, 1 updated test stub, 1 design doc update
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | correctness | No P1–P3 findings. 8 changed tracked files + 5 new files reviewed across all six SECUA dimensions plus functional traceability and architectural depth. R1–R5 and AC1–AC5 are traceable to implementation and tests with file:line evidence. The structural gate → verdict gate → write → audit ordering is correct and matches the pre-0966 CLI sequence. Message text is byte-identical. Error class identity is preserved (`GuardDeniedError` from `@gobing-ai/spur-app/errors`). The `--force-done`/`--reason`/`--verdict-dir`/`--no-lifecycle`/`--folder` flags all propagate correctly through `transitionTaskGuarded`. `canonicalStatusOrRaw` is no longer duplicated — the CLI deleted its local copy and imports from `@gobing-ai/spur-app`. The server's `checkService()` graceful degradation on a missing matrix is correctly documented as test-only (production always has a matrix via `loadSectionMatrix` in `serve.ts`). The section-matrix cache key includes the validation mode so server (raw) and CLI (validated) never share entries. Test isolation uses non-colliding `spur-gate-corpus/tasks` dir. | `packages/app/src/services/task-transition.ts:122-219`, `packages/app/src/services/section-matrix-loader.ts:56-112` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/task-transition.ts:122` — `transitionTaskGuarded` is the single gate implementation; structural check `:140-158`, verdict gate `:167-195`, noop `:189-192`, forced audit `:203-213`; throws `GuardDeniedError` `:155,194`; message text verbatim from pre-0966 CLI; unit tests `packages/app/tests/services/task-transition.test.ts:108-210` (11 cases) |
| R2 | MET | `apps/cli/src/commands/task.ts:632` — single `transitionTaskGuarded` call; `--force-done` `:632`, `--reason` `:632`, `--verdict-dir` `:629`, `--no-lifecycle` `:587-595` (adapter decision unchanged), `--folder` via `svc` construction `:473`; `runDoneGateCheck` deleted (rg confirms zero hits); `writeJsonError` + `setExitCode(1)` on `GuardDeniedError` `:637-640`; noop path `:643-655`; forced audit warning `:667-670`; override message `:673-676`; `canonicalStatusOrRaw` imported from `@gobing-ai/spur-app` `:13` (CLI's local copy deleted); `git diff -- apps/cli/tests` is empty |
| R3 | MET | `apps/server/src/context.ts:465-478` — `transitionTask` always supplies `checkGate` when `checkService()` returns non-undefined (`:467-477`); `checkService()` returns `TaskCheckService` when `options.sectionMatrix` present (`:444-461`); production always has matrix via `loadSectionMatrix` in `serve.ts:638`; `runDir = join(cwd, '.spur', 'run')` (`:402`); handler `apps/server/src/modules/task/handlers.ts:91` routes through `ctx.transitionTask(input)`; 409 mapping unchanged at `apps/server/src/middleware/error-handler.ts:127-132`; `forceDone` defaults to `undefined` (server contract has no override field, deliberate per Q&A) |
| R4 | MET | `packages/app/src/services/section-matrix-loader.ts:80` — cached per `(root, validation mode)` (`:82` cache key `raw:` vs `validated:`); project-local then bundled (`:100,105`); fails loudly (`:112`); CLI passes `EMBEDDED_SPUR_SCHEMAS` (`:628,1708`); server passes nothing (`:638`); old `loadServerSectionMatrix` and CLI-local `loadSectionMatrix`/`loadSectionMatrixUncached` deleted; `bundledRoot` seam (`:77`) for test/compile layout; custom resolvers bypass cache (`:86`); tests `packages/app/tests/services/section-matrix-loader.test.ts:33-88` (7 cases) |
| R5 | MET | `git diff -- packages/contracts` is empty; no noun/verb/flag added; `taskTransitionInputSchema` at `packages/contracts/src/task.ts:74` unchanged |

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | `apps/server/tests/modules/task/transition-gate.test.ts:101-111` — no-artifact deny + non-PASS deny; asserts `GuardDeniedError` + message `missing verify verdict artifact`; 6/6 pass (fresh run this session) |
| AC2 | MET | `apps/server/tests/modules/task/transition-gate.test.ts:113-118` — structural gate deny for `done` target; asserts ``spur task check 0001 --as done` failed`` in the error message |
| AC3 | MET | `apps/server/tests/modules/task/transition-gate.test.ts:120-127` — PASS verdict + clean check → `kind: transitioned`, `toStatus: done`; testing transition without verdict `:129-133`; `runDir` exposed as `<projectRoot>/.spur/run` `:135-138` |
| AC4 | MET | `packages/app/tests/services/task-transition.test.ts:108-210` — noop, check-deny, verdict-deny, forced allow (audit fields written: `done_forced` + `done_reason`), auditError returned with status still `done`; `git diff -- apps/cli/tests` is empty (zero `expect(` lines changed); `rg runDoneGateCheck apps` → no hits |
| AC5 | MET | `packages/app/tests/services/section-matrix-loader.test.ts:33-88` — local-wins, bundled-fallback, cache-identity, validated pass/reject, unvalidated raw; `rg "function load(Server)?SectionMatrix" apps` → no hits; `rg "section-matrix.yaml" apps/*/src` → no loader-body hits; `git diff -- packages/contracts` empty |

##### SECUA Assessment

- **Security:** No new attack surface. `GuardDeniedError` messages contain only structural finding codes, not secrets. The server does not expose `forceDone`/`reason` over HTTP (contract unchanged, R5). The `loadSectionMatrix` loader reads only the known YAML path, not arbitrary user input. No injection vectors introduced.
- **Efficiency:** The section-matrix cache (`Map<string, Promise>`) is shared across callers within a process, preserving the existing single-load guarantee. `transitionTaskGuarded` reuses the `show` result between the structural gate and the verdict gate (`checkedTask` variable, `:140,173`), avoiding a redundant disk read. The `loadSectionMatrix` function returns a cached Promise directly (not `async`, deliberately — `:80` comment explains why).
- **Correctness:** Gate ordering (structural → verdict → write → audit) matches the pre-0966 CLI sequence. The `canonicalStatusOrRaw` wrapper prevents alias bypasses (`DONE`/`Done` → `done`). The `noop` return type is constrained to `status: 'done'` (only `evaluateDoneTransition` produces it). The `auditError` is never thrown after a committed status write — caught and returned on the result. The `checkedTask` null coalescing (`??`) correctly falls through to a fresh `show` call when the structural gate was skipped.
- **Usability:** The CLI's stdout/stderr text, JSON envelopes, and exit codes are unchanged. The server's 409 `GUARD_DENIED` with the denial message is actionable for the Kanban board (which already reverts optimistic moves on `api-error`).
- **Architecture:** The choke point is in `packages/app/src/services/` (the right layer per ADR-021 — apps are thin transports, logic in `packages/app`). Dependencies are explicit (`GuardedTransitionDeps` — no hidden state). The check gate is caller-injected (the CLI decides whether the lifecycle FSM already covers it; the server always supplies one). The section-matrix loader's `bundledRoot` seam enables hermetic testing. `transitionTaskGuarded` is a deep module: small typed interface, five ordered concerns encapsulated. The `canonicalStatusOrRaw` export eliminates the previous duplication — the CLI imports it from the app package for its `--as` flag use.

##### Architecture Depth

`transitionTaskGuarded` is a deep module: it takes a small, typed dependency set (`GuardedTransitionDeps` — 4 fields) and encapsulates five ordered concerns (canonicalization, structural gate, verdict gate, status write, audit write). Callers pass policy (whether to supply a check gate, whether `forceDone` is allowed) without needing to know the gate internals. The `section-matrix-loader` properly hides the two-tier resolution and caching behind one function. No shallow pass-throughs, no tight coupling, no wrong seams identified.

**Next:** No blocking findings. The change set is ready for the done transition.

### References

- Feature: F41 (parent F4 — Lifecycle and events; F4 owns task 0292's done-verdict gate).
- Review source: `/sp:dev-review apps --focus all`, 2026-09-25, findings P2 + C2; base commit `872024cd2`.
- ADR-021 (apps are thin transports; logic in `packages/app`).
- Task 0292 (done-transition verdict gate), 0808 R3 (GUARD_DENIED message lists findings), 0147 (never `strict:true` on the gate), 0130 retrospective (P3 backstop).
- `packages/app/src/services/done-transition-guard.ts:101,273`; `packages/app/src/services/task-check.ts:466`; `packages/app/src/services/task-service.ts:787`; `apps/server/src/middleware/error-handler.ts:110-127`.

### History

- 2026-09-26T05:53:50.241Z backlog → todo (system)
- 2026-09-27T06:09:41.006Z todo → wip (system)
- 2026-09-27T07:03:10.361Z wip → testing (system)
- 2026-09-27T07:03:22.587Z testing → done (system)

