# D8-0732 Proportional-Gate Prototype — Route Table, Run-Bound Evidence, Measured vs Structural Deltas

- **Task**: 0732 (`prototype-proportional-gates-on-a-surrounding-workflow`), feature D8.
- **Provenance**: prototype run on commit `86fd36978` (worktree `spur-new-runall-d8-6869`), 2026-09-02, source-local CLI only (`bun run apps/cli/src/index.ts workflow …`). Authority consumed: `docs/inventory/d8-0731-workflow-fit-classification.md` (§5 prerequisite table, §6 pilot ranking — **wrapup-pipeline is the closed prerequisite pilot**), `docs/inventory/d8-0729-workflow-contract-inventory.md` (§F defect register — F-4 continue-drift, F-6 run-id confinement, F-14 dry-run smoke), `docs/analysis/d8-0730-workflow-cost-attention-measurement.md` (no budget established; measured vs structural separation).
- **Method**: R1 pilot selection → R2 closed two-path route table → R3 explicit `workflow validate` preflight + real `workflow run` through the actual engine → R4 prerequisite-repair manifest → R5 run-bound proof in `.spur/spur.db` + `.spur/run/*.log` → R6 structural vs measured deltas separated → R7 root `version` both-forms exercise → R8 retain one fixture + one regression check → R9 this artifact. **No production workflow, public CLI, or task-pipeline definition changed** (AC).

---

## 1. R1 — Pilot selection and closed prerequisites

Top-ranked eligible real-caller surrounding pilot from 0731 §6: **`wrapup-pipeline`** (rank 1 — PRIMARY). Its closed prerequisite table (0731 §5, `docs/inventory/d8-0731-workflow-fit-classification.md`):

| Prerequisite (0729 §F) | wrapup-pipeline status |
| --- | --- |
| F-1 command.gate timeout key | N/A — wrapup uses `agent.run stepTimeoutMs`, not command.gate |
| F-2 nested run | N/A — feature-transition is a CLI verb (`spur feature sync`), no nested `workflow run` |
| F-5 fail-open proof | N/A — wrapup has no proof.fingerprint/fail-open path |
| F-6 run-id confinement | only if `--run-id` passed (dev-wrap doesn't) — prototype omits it |
| F-8 stale expectFile | N/A — doc-sync expectFile gates non-empty capture; soft append by design |
| F-4 continue-drift | **unsafe only on the pause+resume path** (branch-cleanup HITL) — avoided by running the non-pause path (`profile=auto, merge=false`) |

**The prototype therefore runs the non-pause path only**: no branch-cleanup pause is reached (merge=false → metrics-record routes directly to done), so F-4 continue-drift is never exercised. Blast radius: lower than `task-pipeline` (wrap-up consumes completed tasks, never mutates task status; writes learnings/metrics/checkpoint only — 0731 §6).

**Pilot vehicle**: the real `wrapup-pipeline` definition carries an `agent.run` hop (doc-sync) and heavy shell actions, which would require a model and make the route-table demonstration noisy. Per R2 ("smallest closed two-path route table using existing deterministic facts") and the task directive ("a minimal wrapup-like fixture"), the prototype executes a **minimal wrapup-like fixture** that mirrors wrapup's routing shape (task-resolve → conditional branch → done/skipped) with **deterministic note/shell actions only** — same engine, same action kinds, no model, no pause. The fixture is the retained evidence; it is NOT a production definition (lives under `packages/app/tests/fixtures/`, outside the resolved `config/workflows/` layers).

---

## 2. R2 — Closed two-path route table

The fixture (`packages/app/tests/fixtures/d8-0732/d8-0732-gate-fixture.yaml`) routes on two deterministic facts: `tasks` (JSON-encoded task list, wrapup-style) and `mode` (evidence-quality signal). Every input has exactly one route; missing/unknown/conflicting evidence routes to the **safety path** with a **bounded reason** written to `.spur/run/<runId>-reason.txt` (the per-run reason file is a run artifact, never a silent skip).

| Evidence (`tasks`, `mode`) | Route | Bounded reason | Terminal |
| --- | --- | --- | --- |
| `tasks` empty, `mode=fast` | `skipped` | `safety:conflict (fast but no tasks)` — **classifier quirk**: the `elif mode=fast` branch emits a `safety:` label but the transition routes this input to the `skipped` terminal; the reason does not state *why* it skipped (see quirk note below) | `skipped` |
| `tasks` non-empty, `mode=fast` | `fast-path` | `fast:evidence complete+consistent` | `done` |
| `tasks` non-empty, `mode=unknown` | `safety-path` | `safety:unknown evidence quality` | `done` |
| `tasks` non-empty, `mode=conflict` | `safety-path` | `safety:conflicting evidence` | `done` |
| `tasks` non-empty, `mode` empty (missing) | `safety-path` | `safety:missing evidence (mode empty)` | `done` |
| `tasks` non-empty, any other `mode` | `safety-path` | `safety:unrecognized evidence (mode=<value>)` | `done` |

**Closure proof**: the guards are three mutually-exhaustive predicates over `(tasks, mode)`:

- `tasks.length == 0` → `skipped`
- `tasks.length > 0 && mode == fast` → `fast-path`
- `tasks.length > 0 && mode != fast` → `safety-path`

Every `(tasks, mode)` pair satisfies exactly one route (the skip is a genuine terminal, not a safety route). The safety-path `resolve` action classifies the specific missing/unknown/conflicting/unrecognized case and records it as the bounded reason — no route is ever silent. **Classifier quirk (recorded, not fixed in the fixture)**: the `elif [ "$mode" = "fast" ]` branch (fixture `:56-58`) is reachable only when `tasks` is empty, so it emits `safety:conflict (fast but no tasks)` on the `skipped` terminal — a mislabeling of the skip's reason (the skipped run's actual reason file `.spur/run/d8-0732-skipped-reason.txt` reads exactly that). This is a fixture-implementation wart, not a routing error: the route is correct (`skipped`), only the reason string mislabels the class. It is documented here rather than fixed in the retained fixture to keep the executable proof (digest pair) stable; 0733 should read the route table above, not infer from reason labels alone. Guards use the engine's env-var handoff (`$tasks`, `$mode` — task 0435), so values are data, never re-parsed as code.

Route table source: `packages/app/tests/fixtures/d8-0732/d8-0732-gate-fixture.yaml:42-63` (resolve action), `:95-133` (transitions; resolve guards `:101-126`).

---

## 3. R3 — Explicit validation preflight + real engine execution

**Preflight (explicit `workflow validate` — run/validate parity is unresolved per 0729 §E):**

| Command | Result |
| --- | --- |
| `bun run apps/cli/src/index.ts workflow validate packages/app/tests/fixtures/d8-0732/d8-0732-gate-fixture.yaml` | `workflow valid: d8-0732-gate-fixture`, exit 0 (1 composition advisory — shell-lines, warn-only ADR-069, same class as the 42 existing shipped advisories) |
| `bun run apps/cli/src/index.ts workflow validate packages/app/tests/fixtures/d8-0732/d8-0732-gate-fixture-versioned.yaml` | `workflow valid: d8-0732-gate-fixture`, exit 0 (same advisory) |

**Execution (real engine, source-local CLI, real shell via NodeProcessExecutor):** five `workflow run` invocations, all through `packages/app/src/services/workflow-service.ts` `WorkflowAppService.run` → `@gobing-ai/ts-dual-workflow-engine` state machine. No fake/inline interpreter, no production workflow mutation, no new command/DSL (AC). Each run used `--vars '{"mode":...,"tasks":"[...]","profile":"auto","merge":"false","reasonFile":".spur/run/<name>-reason.txt"}'` — `profile=auto, merge=false` (non-pause path per R4/F-4).

| # | Fixture form | Input evidence | Final state | Transitions | Reason recorded |
| --- | --- | --- | --- | --- | --- |
| 1 | unversioned | mode=fast, tasks=["0732"] | `done` | 3 (start→resolve→fast-path→done) | `fast:evidence complete+consistent` |
| 2 | **versioned** (`1.2.3`) | mode=fast, tasks=["0732"] | `done` | 3 (same route) | `fast:evidence complete+consistent` |
| 3 | unversioned | mode=conflict, tasks=["0732"] | `done` | 3 (resolve→safety-path→done) | `safety:conflicting evidence` |
| 4 | unversioned | mode=`` (missing), tasks=["0732"] | `done` | 3 (resolve→safety-path→done) | `safety:missing evidence (mode empty)` |
| 5 | unversioned | mode=fast, tasks=[] | `skipped` | 2 (start→resolve→skipped) | (skipped terminal) |

`workflow run` exit code 0 on every run (`done` → 0). The engine executed the real shell actions (`mkdir`, `echo`, `jq`, `cat`) with the env-var handoff, and the consolidated run log (`.spur/run/<runId>.log`) records the full trace with template-resolved values — see §5.

---

## 4. R4 — Prerequisite-repair manifest

| 0729 §F defect | Prototype disposition | Why |
| --- | --- | --- |
| F-1 command.gate `timeoutMs` | **avoided** | fixture uses no command.gate |
| F-2 nested run | **avoided** | fixture has no nested `workflow run` |
| F-3 spurConfig | **avoided** | fixture has no `agent.run`; no `agent.default` dependence |
| F-4 continue-drift | **avoided** | non-pause path only — no pause, no `continue`; nothing to drift against |
| F-5 fail-open proof | **avoided** | fixture has no proof.fingerprint/fail-open path |
| F-6 run-id confinement | **avoided** | `--run-id` never passed (CLI auto-generates a UUID; no path traversal surface) |
| F-7 suppressed task lookup | **avoided** | fixture never reads a task spec path |
| F-8 stale expectFile | **avoided** | fixture uses no expectFile |
| F-9 run.artifact proof | **avoided** | fixture uses no run.artifact |
| F-14 dry-run smoke | **avoided + compensated** | dry-run never used as run-readiness evidence; **run-readiness proven by real terminal `done` runs** in §3/§5 (the exact thing F-14 says dry-run cannot prove) |

**No known-broken primitive is exercised, and no separate root-cause repair was needed** — the prototype is fully executable on the working surface. The one regression check retained (§8) guards the route table and the version-neutrality claim; it is not a repair, it is the R8 minimum evidence for 0733.

---

## 5. R5 — Trust-boundary and run-bound proof

**Run-bound proof (`.spur/spur.db`, `runs` + `transition_runs`):** all five runs are persisted rows. Pre-run count 69 → post-run 74 (5 new rows, all `done`). `definitionDigest` is stamped per run in `metadata_json` (the engine's best-effort run-start stamp, `workflow-service.ts:171-176`):

| run (id prefix) | fixture form | digest (`metadata_json.definitionDigest`) | status |
| --- | --- | --- | --- |
| `59fba0a0` | unversioned | `sha256:3d5c4d42d14cae073da04e9d94125557e44ade8ee2000109a8cf1c9c2ac5104d` | done |
| `bd8b61b8` | **versioned** | `sha256:60fa187c2473653b09f1d5fc38fd87bd2c6a0a9691848e92680e8169ebc5140b` | done |
| `432fd053` | unversioned | `sha256:3d5c4d42d…` | done |
| `7e449b61` | unversioned | `sha256:3d5c4d42d…` | done |
| `bd62e116` | unversioned | `sha256:3d5c4d42d…` | done |

`transition_runs` records the exact stage timeline (the **route** proof):

```
59fba0a0  start→resolve→fast-path→done     (unversioned fast)
bd8b61b8  start→resolve→fast-path→done     (versioned fast — SAME ROUTE, R7)
432fd053  start→resolve→safety-path→done   (conflict)
7e449b61  start→resolve→safety-path→done   (missing)
bd62e116  start→resolve→skipped            (empty tasks)
```

**Reason artifacts**: `.spur/run/d8-0732-{fast-unversioned,fast-versioned,safety-conflict,safety-missing,skipped}-reason.txt` (per-run bounded reasons) + `.spur/memory/d8-0732-routes.log` (append-only route log). **Consolidated run logs**: `.spur/run/<runId>.log` for all 5 runs record the full trace — start/note/shell actions, template-resolved values (`mode=fast profile=auto merge=false tasks=["0732"]`), transitions, and terminal status (sample: `59fba0a0…log`).

**Trust-boundary preservation (AC)**: no untested timeout, proof binding, consolidated log, or action option is claimed as safety. The route/skip/escalation facts come from `transition_runs` (engine-persisted) + the reason files the fixture's own actions wrote; the digest comes from the run stamp. F-14 is honored — dry-run was never used; these are real terminal runs.

---

## 6. R6 — Measured vs structural deltas (separate planes)

**Structural (graph) facts** — deterministic, from the fixture definition (not "savings"):

| Plane | `wrapup-pipeline` (real, 0731 §3) | prototype fixture |
| --- | --- | --- |
| States | 8 | 6 (`start, resolve, fast-path, safety-path, done, skipped`) |
| Agent.run hops | 1 | 0 (deterministic only) |
| Shell/other actions | 12 shell + 1 hitl.confirm + 3 note | 3 shell + 4 note |
| Pauses | 1 (branch-cleanup, always) | 0 (non-pause by construction) |
| Terminal states | done, skipped | done, skipped |
| Iteration bound | 10 | 5 |
| Composition advisories | 4 | 1 (resolve shell-lines) |

**Measured (run-bound, this prototype — real engine, real wall time)**:

| run | wall (started→completed) |
| --- | --- |
| `59fba0a0` | 2026-09-02T18:03:22.568Z → 18:03:22.744Z (~176 ms) |
| `bd8b61b8` | 18:03:31.625Z → 18:03:31.792Z (~167 ms) |
| `432fd053` | 18:03:39.929Z → 18:03:40.112Z (~183 ms) |
| `7e449b61` | 18:03:43.998Z → 18:03:44.178Z (~180 ms) |
| `bd62e116` | 18:03:47.689Z → 18:03:47.861Z (~172 ms) |

**These wall numbers are NOT comparable to any budget** — 0730 established **no budget** (0 real terminal runs in the prior window; `real-run-cost` reports n/a for all 11 shipped workflows). The prototype numbers are a demonstration that a deterministic shell-only surrounding pipeline completes in ~170ms wall with zero model cost, **not** a measured saving. No token/cost figure is claimed (the fixture has no `agent.run`, so there is nothing to measure). Missing coverage reported honestly: the prototype does not measure the doc-sync model hop (the real wrapup's dominant cost), does not touch pause/resume (F-4), and has no attention/approval data (no HITL in the non-pause path).

---

## 7. R7 — Root `version` exercise (both forms)

**Fixtures**: `d8-0732-gate-fixture.yaml` (omitted `version` → **unversioned**) and `d8-0732-gate-fixture-versioned.yaml` (root `version: "1.2.3"` → **explicit(1.2.3)**), byte-identical except the one `version` line (`diff` confirms only `20a21 > version: "1.2.3"`).

**Both forms prove validate AND execute without behavioral dispatch**:

| Surface | unversioned | explicit(`1.2.3`) |
| --- | --- | --- |
| `workflow validate` | valid (exit 0) | valid (exit 0) |
| `workflow run` (mode=fast) | done, fast-path, reason `fast:…` | done, **fast-path, same reason** |
| `definitionDigest` | `sha256:3d5c4d42d…` | `sha256:60fa187c2…` (differs) |

**`explicit(<literal>)` vs `unversioned` beside source/digest**: the only observable difference is the digest — the `version` field is folded into `computeDefinitionDigest` (composition-baseline.ts:110, canonical whole-def JSON), and a version-only edit changes the digest with zero behavior change. Both run rows (`59fba0a0`, `bd8b61b8`) are recorded beside their exact digests in §5. **No registry and no unsupported-version policy was added** (AC) — `version` is `z.string().optional()`, opaque, no consumers, no minLength.

**Propagation gaps recorded (current surface)**:

- **Empty-string `version: ""`**: validates (exit 0, probe-verified this pass on the fixture — `workflow valid`); consistent with 0729 §H / 0731 §7.
- **`workflow list`**: resolves the 11 shipped layers only; the fixture is outside the resolved layers (correct — production set unchanged), and no version field is emitted per entry.
- **`workflow show --json`**: `0` occurrences of `version` in the rendered output — version is not rendered (matches 0729 §H "not rendered by list/show/trace").
- **`workflow run`**: result JSON carries no `version`; the only version signal is the digest stamp in `metadata_json.definitionDigest`.
- **`workflow trace --json`**: contains neither `version` nor `definitionDigest` (probe: `trace has version: False`, `trace has digest: False`).
- **`continue`**: no digest comparison happens at `continuePaused` (0729 §F-4/S2) — a version edit between run and resume is invisible; only a `definition-drift` progress diagnostic fires (progress-projection.ts:293). The non-pause prototype never touches `continue`, so this gap is recorded, not exercised.
- **progress**: version is absent from the progress projection (0729 §H) — recorded, not exercised.

---

## 8. R8 — What the prototype proves / what remains unproven / constraints inherited by task-pipeline

### What the prototype proves (run-bound)

1. A **closed deterministic two-path route table** works on the real engine: every input routes, unknown/missing/conflicting evidence takes the safety path with a bounded per-run reason, all persisted in `.spur/spur.db` (`runs` + `transition_runs`) and the run logs.
2. **`profile=auto, merge=false` executes to `done` without a pause** on a wrapup-shaped pipeline — the non-pause path is engine-safe and does not touch F-4.
3. **Root `version` is behavior-neutral end-to-end**: both `unversioned` and `explicit(<literal>)` validate and execute identically through the real engine; only the digest differs. No registry/policy needed.
4. The engine stamps a per-run `definitionDigest` and records the exact stage route — run-bound evidence is machine-readable.

### What remains unproven (honest)

- **Pause/resume** (branch-cleanup path, merge=true) — unsafe under F-4; not exercised.
- **Model cost** of the real wrapup's doc-sync `agent.run` hop — the prototype is deterministic-only; no token/cost figure exists for the model path (0730 budget: none).
- **Run→session cost attribution** — `history_run_session` empty; even a model hop would measure cost null today (0730 §G).
- **Scalability/limits** of the route table to the full wrapup (feature-transition, metrics-record shells) — the fixture is minimal, the real wrapup's shell actions (30/22-line) are not re-measured.
- **Version drift at resume** — `continuePaused` does not compare digests (F-4); the fix (0729 Decision 4) subsumes version-based drift, not done here.

### Constraints inherited by `task-pipeline`

- Any proportional-gate strategy for `task-pipeline` must keep the **real engine + real actions** (no new interpreter/DSL/command) — proven viable for a surrounding pipeline.
- The route table pattern (fast path vs risk/uncertainty safety with a bounded reason) is transferable, but `task-pipeline`'s evidence is different (task spec + proof fingerprint + budgets), and its own defects (F-5 fail-open proof, F-7 suppressed lookup, F-8 stale expectFile) remain — the prototype avoided them; task-pipeline cannot without repair.
- **No measured budget exists** to size any proportional gate (fast-path skipping vs safety-path escalation) — 0733 must fund real runs + run-scoped cost attribution before any ceiling.
- Version cannot serve as a dispatch key today (no consumers, no digest-at-resume) — do not build a version-mandate or registry.
- Non-pause assumption holds only while F-4 is unfixed; any pause-based gate (HITL) for task-pipeline stays unsafe.

---

## 9. R8/R9 — Retained evidence and debris policy

**Retained (minimum evidence for 0733)**:

- Fixture (2 version-forms, one conceptual fixture): `packages/app/tests/fixtures/d8-0732/d8-0732-gate-fixture.yaml` (+ `-versioned.yaml`).
- One retained executable regression check: `packages/app/tests/services/d8-0732-gate-prototype.test.ts` — 3 tests (digest differs; both validate; both run to `done` through the same route with the same bounded reason). Runs: `bun test packages/app/tests/services/d8-0732-gate-prototype.test.ts` → **3 pass / 0 fail** (15 expect calls); the workflow-service suite (99 tests incl. these 3) passes.

**Debris removed**: probe fixture for empty-string `version` (`/tmp`, disposable), CLI extraction scripts (`/tmp`), sandbox dirs (`/tmp`). The 5 DB run rows + `.spur/run/*.log` + `.spur/run/d8-0732-*-reason.txt` + `.spur/memory/d8-0732-routes.log` are **kept as run-bound evidence** (§5) — they are the prototype's record, not debris.

**No production change**: `config/workflows/` untouched (11 definitions unchanged), no public CLI surface changed, `task-pipeline` untouched (AC). The retained fixture lives outside the resolved workflow layers.

### Evidence commands (this pass)

- `bun run apps/cli/src/index.ts workflow validate <fixture>` (both forms) — valid, exit 0.
- `bun run apps/cli/src/index.ts workflow run <fixture> --json --vars '{"mode":"fast","tasks":"[\"0732\"]","profile":"auto","merge":"false","reasonFile":"…"}'` ×2 (unversioned + versioned) — done, fast-path.
- `… workflow run <fixture> --json --vars '{"mode":"conflict"…}'` / `{"mode":""…}` / `{"tasks":"[]"…}` — done (safety) / done (safety) / skipped.
- `sqlite3 .spur/spur.db` — `runs` (5 new done rows, digests) + `transition_runs` (14 stage rows) pre/post counts (69 → 74).
- `bun run apps/cli/src/index.ts workflow show <fixture> --json` / `workflow trace <run> --json` — version not rendered.
- `workflow validate /tmp/…-empty-version.yaml` (`version: ""`) — valid (probe removed).
- `bun test packages/app/tests/services/d8-0732-gate-prototype.test.ts` — 3 pass / 0 fail.

## Unknowns (honest gaps)

- Whether the full wrapup (agent.run + 30/22-line shells) keeps the same route-table behavior at scale — the fixture is minimal by design; re-measure with real runs (0730 §G sufficiency not met).
- Pause/resume safety for any gate — until F-4 digest-comparison lands, the pause path stays unproven.
- Run→session cost for a model-bearing surrounding pipeline — importer gap (0730 §C) unchanged.
- `superskill script path` staging for feature-sync-bounded.mjs (0729 §G-4) — not re-tested this pass; the prototype's feature-transition analog is deterministic and avoids it.
