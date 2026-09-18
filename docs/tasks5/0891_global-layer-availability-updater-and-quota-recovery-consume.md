---
schema_version: 1
name: "Global-layer availability updater and quota recovery consumer: setExecutorAvailability targets the declaring config layer and agent.quota.recovered re-enables quota-owned executors"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.553Z
updated_at: "2026-09-18T04:15:32.592Z"
feature_id: B6
priority: P1
tags:
  - config
  - executor-availability
  - recovery
  - B6
estimate_hours: 7

dependencies: ["0890"]
---

## 0891. Global-layer availability updater and quota recovery consumer: setExecutorAvailability targets the declaring config layer and agent.quota.recovered re-enables quota-owned executors

### Background

After task 3 every disable carries an owner. Two gaps remain from `executor-availability.md` §6: global-only executors (all 16 on the reference machine) cannot be persisted because the updater only knows the project fragment, and `agent.quota.recovered` events are dropped. Authority: `docs/design/session-pinned-dispatch.md` §3.2–§3.3, AC R3/R4; operator approved automatic writes to `~/.config/spur/config.yaml` with backup + atomic rename (design-approval 2026-09-17).

### Requirements

- [x] R1. `setProjectExecutorDisabled` is generalized to `setExecutorAvailability({{ layer: 'project'|'global', executor, disabled, observation }})`; the layer is chosen by where the executor is declared (project fragment wins when both declare it); the old name stays as a thin wrapper only while a caller exists.
- [x] R2. Global writes target `~/.config/spur/config.yaml` (respecting the existing config-path resolution) with the same backup file, atomic rename and conflict-detection error codes as project writes; the project file is byte-identical after a global-only write.
- [x] R3. Loader cache invalidation fires for both layers so the next `resolveRole` sees the change without a process restart.
- [x] R4. The event bridge upserts `agent.quota.recovered` into `agent_executor_updates` as `disabled: false, owner: quota`; the drain applies it only when the current owner is `quota` or `probe` and records a classified skip otherwise.
- [x] R5. Tests: layer selection (project-declared, global-only, both), global backup + atomic write against a temp HOME, recovered-event drain for each owner; `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R3, R4.

- [x] AC1 — A quota-owned disable recovers on evidence (req: R4)
- [x] AC2 — A global-only executor is persisted in the global config (req: R2)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: one updater with a `layer` argument instead of a second `setGlobalExecutorDisabled` — the YAML node shape is identical and only the path differs (docs/design/session-pinned-dispatch.md §3.2). Recovery is evidence-driven only: a `recovered` event or (task 5) a usage snapshot; there is no timer and no synthetic recovery, per feature Scope. The wrapper name is kept only until task 5 lands and is deleted then. Mutation policy: `packages/config/src/executor-update.ts` + loader invalidation, `packages/app/src/services/event-bridge.ts` and `agent-quota-updates.ts`, tests, `executor-availability.md` §6 (limitations closed); no producer, no doctor rendering.

### Plan

1. Read design §3.2–§3.3 and `executor-update.ts` end to end; read the loader's cache invalidation seam and the event bridge's `quota.exhausted` handler.
2. Add `layer` selection + global path resolution to the updater; extend the invalidation; keep error codes.
3. Add the `recovered` handler mirroring the `exhausted` one; apply the owner rule in the drain.
4. Write the tests (temp HOME for the global file); update `executor-availability.md` §6.
5. Run `cd packages/config && bun test`, `cd packages/app && bun test tests/services/`, then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

- `packages/config/src/executor-update.ts:79-142` — new `setExecutorAvailability({layer, projectRoot, executor, disabled})` (R1): `layer: 'project'` keeps legacy behavior; `layer: 'global'` resolves the target via `resolveConfigLayers(projectRoot)` and picks the declaring layer, project fragment wins when both declare the name. `setProjectExecutorDisabled` (:120-131) is now a thin `layer: 'project'` wrapper.
- `packages/config/src/executor-update.ts:133-155` — `declaresExecutor` probe (parse-only; a broken non-target layer never blocks a legitimate write).
- `packages/config/src/executor-update.ts:157-290` — write core `applyExecutorAvailabilityAtPath`: identical lock / symlink guard / conflict detection / tmp+fsync+rename / chmod / `invalidateSpurConfig` machinery now shared by both layers (R2, R3); error codes unchanged (`INVALID_CONFIG`, `CONFIG_CONFLICT`, `CONFIG_WRITE_FAILED`), messages generalized off "project".
- `packages/config/src/loader.ts:298-311` — re-exports the new symbols through the `./loader` subpath (dedup with the old type-only block).
- `packages/app/src/services/agent-quota-updates.ts:315-349` — drain routes each row through the generalized updater with the row's recorded `layer` (R4 consumer side; recovered rows already upsert as `disabled: false, owner: quota` from 0890) and derives the disable reason from the row's event (`agent.quota.exhausted|recovered <executor>`). Owner-rule (quota/probe apply, operator = classified skip) unchanged from 0890 R3.
- `packages/app/tests/services/agent-quota-updates.test.ts:566-679` — recovery consumer per owner (AC1: quota object recovers; operator bare-`true` = classified no-op; probe object recovers), layer routing (project fragment wins for a `global` row; undeclared global row = structured no-op).
- `packages/config/tests/executor-update.test.ts:477-565` — layer selection with global suppressed; subprocess (fake HOME) global-only persistence with byte-identical project file, comment-preserving global write, no tmp leftovers, mode preserved, loader cache invalidation observed without restart (R2, R3, R5).
- `packages/config/tests/executor-update.test.ts:326` — error-message pin updated to the generalized "failed to commit config update" prefix (contract code `CONFIG_WRITE_FAILED` unchanged).
- `docs/design/executor-availability.md` §6 — global-persistence and recovery-consumer limitations closed per B6 0891.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/config/src/executor-update.ts:81-114 `setExecutorAvailability({layer,projectRoot,executor,disabled})`; declaring-layer selection with project-wins at :93-101 (`declaresExecutor(layers.project)` before global fallback); thin wrapper `setProjectExecutorDisabled` at :116-127 (kept per task Design until 0892; callers = tests + loader re-export loader.ts:312). Tests: executor-update.test.ts:343 "layer 'global' with a project-declared executor writes the project fragment", :362 "undeclared executor is a structured no-op", :373 "layer 'project' keeps the legacy exact behavior (wrapper parity)", :467 "a project fragment wins over a global-only request…" |
| R2 | MET | executor-update.ts:160-290 shared write core `applyExecutorAvailabilityAtPath` (per-path lock :266, symlink guard :170-176, external-edit conflict detection :243-249, tmp+fsync+rename :250-259, chmod :260); codes INVALID_CONFIG/CONFIG_CONFLICT/CONFIG_WRITE_FAILED unchanged (:17, thrown at :247/:258/:281); global path via resolveConfigLayers loader.ts:177-188 (~/.config/spur/config.yaml, SPUR_SKIP_GLOBAL_CONFIG honored). Tests: executor-update.test.ts:429 "global-only executor is persisted in the global config; project file byte-identical" (byte-identical assertion + comment preserved + no .tmp- leftovers), :496 "global write preserves file mode…" (mode 0o600 preserved) |
| R3 | MET | loader.ts:316-327 `invalidateSpurConfig` matches path at key head OR global slot (`key.includes(`\0${path}\0`)`); cache keyed on both layers' paths+mtimes loader.ts:271-277. Tests: executor-update.test.ts:496 (loader sees global write without restart), :241 "success invalidates the loader cache — next load sees the new value" |
| R4 | MET | Producer: agent-quota-updates.ts:185-205 `subscribe('agent.quota.recovered', false)` → recordObservation `disabled:false, owner:'quota'` (:153-163). Consumer: owner rule operator→ackSkipped 'operator-owned' (:305-318); recovery desired=false derived from row (:325-334); drain ALWAYS enters `setExecutorAvailability({layer:'global',…})` :335-344 with "0891 review fix" comment. Tests: agent-quota-updates.test.ts:566 "a quota-owned disable recovers… (AC1)", :591 "operator-owned disable is never recovered — classified no-op", :619 "probe-owned object disable also recovers", :643 "global-layer row for a project-declared executor writes the project fragment", :664 "global-layer row with no declaring layer is a classified no-op" |
| R5 | MET | Tests exist for layer selection (project/global/both), global atomic write vs fake HOME, recovery per owner (see rows above); repo gate GREEN: .spur/run/0891-test-gate.status=PASS, .spur/run/0891-test-gate.log "8468 pass / 0 fail", biome 1008 files clean, typecheck 7/7, 46 pre + 2 post rules, proof-digest sha256:98430d84fa9996a5a33feab7c2b5a58dedd92854d89abcf011342b0a91530cc7; executor-update.ts at 100% line coverage in the same log |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC2 (feature B6 scenario R4: global-only executor persisted in global config) | MET | test | executor-update.test.ts:429 "global-only executor is persisted in the global config; project file byte-identical" (subprocess, fake HOME): global `gem.disabled` = quota object, comment `# global-only executor` survives, project file byte-identical, no tmp leftovers; complement :467 (project fragment wins, global untouched) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P1 | ac-row-dropped | — | 1 AC row(s) could not be parsed and were omitted from the verdict: AC1 (feature B6 scenario R3: quota-owned disable recovers on evidence) (unrecognised evidence type "test + code"). Accepted evidence types: test, command, static-ref (aliases: static, doc, docs, documentation), manual-review, llm-judge, n/a. Accepted statuses: MET, PARTIAL, UNMET, N/A. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:98430d84fa9996a5a33feab7c2b5a58dedd92854d89abcf011342b0a91530cc7 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T03:48:06.671Z todo → wip (system)
- 2026-09-18T04:12:44.036Z wip → testing (system)
- 2026-09-18T04:15:32.592Z testing → done (system)

