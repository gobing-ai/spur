# Workflow shell ownership surface (feature D6, task 0608; amended by 0625)

**Area:** who owns each compound shell program in the shipped pipelines, decided under ADR-051.
**Status:** accepted — decision record plus one landed owner (the `doctor.probe` built-in); current
through the task-0625 wrap-up gate addition.
**Authority:** derived; ADR-050 (corpus gate), ADR-051 (public-surface consent gate), ADR-076 (pipeline2 retirement),
`workflow-composition-contract.md` (deterministic action ownership).

## The decision

Every `onEnter` / `onExit` shell program in `config/workflows/*.yaml` has a decided owner from one
of five options under ADR-051:

| Option | Meaning | Chosen for |
| --- | --- | --- |
| (a) public `spur` verb | a new CLI noun/verb — needs recorded operator consent; noun-first rule | none (no public surface landed) |
| (b) application service | monorepo-only capability in `packages/app` | idea handoff (monorepo half) |
| (c) least-privilege built-in action kind | engine-run capability, portable wherever the `spur` CLI runs | idea-pipeline `start` doctor probe (landed; task-pipeline precheck went doctor-free in 0723 — the built-in stays for callers that elect executors at precheck) |
| (d) workflow-relative external extension | portable standalone script under `plugins/sp/scripts/` invoked from YAML | size precheck, feature sync, pr-reviewing |
| (e) deliberately-stays-shell | inline, with a `#` reason comment beside the action (0775: the recorded-exception snapshot retired) | `qualityGateCmd` / per-project command strings; trivial glue |

## Inventory (measured on this tree, 2026-08-20)

- **58** `onEnter` / `onExit` shell programs, classified individually below.
- **92** transition guards (single boolean predicates, `guard: kind: shell`) — one bulk exception.
- Total **150** shell programs at inventory time. The frozen task scope counted 49 compound + 7
  simple + 92 guards = 148; the re-run finds 58 `onEnter` / `onExit` programs + 92 guards = 150.
  These are the **pre-migration** counts — the numbers this classification was taken over. After
  `doctor.probe` lands (below), the live tree measures 57 + 92 = **149**: this task's own migration
  moves one program out of shell. The 58-row table stays complete; only the live total shifts.
  The +2 are two one-`$spurBin`-call soft-probe idioms with a `; exit 0` tail
  (`wayfinder-resolution record:onEnter:0` / `record:onEnter:1`) that sit on the simple/compound
  boundary. They are classified individually below, so every program has a recorded owner
  regardless of the boundary.

Measurement method: parse each `config/workflows/*.yaml` state-machine definition; collect every
`kind: shell` action in `onEnter` / `onExit` plus every transition `guard.kind === 'shell'`.
Reproducible via any YAML parser over the same files.

**2026-08-21 delta (task 0625):** the shell-program count is unchanged; wrap-up
`feature-transition:onEnter:0` now sequences its existing feature-sync extension with the trusted
project command `featureGateCmd`. Its row below is reclassified `EXT + POLICY`.

## Bulk exceptions

1. **92 transition guards** — single boolean predicates (`test … && $spurBin …`) that decide graph
   routing. No reusable product semantics; stays shell. `ponytail: known ceiling` — if a specific
   guard later proves to hold real policy, promote that one case out of the exception; do not
   re-open all 92.
2. **Single-`$spurBin`-call state actions** — trivial glue around existing `spur` verbs
   (`task check`, `task update`, `task record`, `task verdict`, `workflow validate`). No reusable
   semantics beyond the verb itself; stays shell.

## The two mandatory D5-L cases (feature R5, task 0608 R3)

1. **`qualityGateCmd` / `featureGateCmd` — option (e), deliberate shell exceptions.** The `test` / `test-recheck`
   quality-gate programs (`task-pipeline test:onEnter:0`, `test-recheck:onEnter:0`; the same
   pattern in `basic check:onEnter:0`, `pr-review precheck:onEnter:0` for `preReviewCmd`, and
   `implement:onEnter:2` for `formatCmd`) execute a **per-project command string** via `sh -c`.
   Task 0625 adds the same ownership shape to wrap-up `feature-transition:onEnter:0` for
   `featureGateCmd` after an applied feature sync.
   That override surface **is** the semantic: `command.gate` bans shell strings by design, so
   forcing it into a gate either breaks the documented per-project override or defeats the
   primitive's purpose. It is project-only policy, not reusable product semantics. The
   workflow-relative external extension path (d) is the recorded future home once such a mechanism
   exists; until then the exception is deliberate and recorded, per R3/R4.

2. **`task-pipeline` precheck doctor probe — option (c), landed by 0608 as the `doctor.probe`
   built-in action kind; removed from task-pipeline by 0723.** The ~40-line auth classifier
   (per-agent-family classification: omp/pi env-key misses soft, explicit auth failures hard;
   executor-divergence line) is reusable product semantics — the strongest candidate for the
   application layer. It landed as a least-privilege built-in (option c) rather than a
   monorepo-only service (option b) because a built-in runs in-process in the `spur` CLI and
   therefore resolves in **seeded projects** too (portability rule below). Task 0723 then made
   the task-pipeline precheck deterministic and doctor-free on every execution surface: the
   probe could not prove authentication or quota, duplicated the size precheck's second
   `spur agent doctor` call, and the authoritative liveness/capability checks already run
   fail-closed at the `agent.run` dispatch boundary (0706). The `doctor.probe` built-in stays
   registered for workflows that intentionally elect executors at precheck (idea-pipeline
   `start:onEnter:1`); task-pipeline no longer declares it, and its composition baseline and
   tests assert the doctor-free graph (see `plugins/sp/tests/task-pipeline-resilience.test.ts`).

## Consent posture (feature R4, task 0608 R2)

No public `spur` noun, verb, flag, JSON field, or human-output contract changes in this task, so no
operator consent decision is required to land the work. `doctor.probe` is a workflow **action kind**
— the same internal surface class as `command.gate` and `run.artifact` (shipped in task 0603
without ADR-051 consent). Both mandatory cases were deliberately routed to non-public owners in the
task Design; the alternatives considered are recorded above. The sole future consent trigger is the
`qualityGateCmd` external-extension home (option d), which is deferred until a real extension
mechanism is proposed.

## Individual classification (58 programs)

Dispositions: **BUILTIN** = landed built-in this task; **EXT** = already a portable external
extension under `plugins/sp/scripts/` (shell is wrapper glue); **POLICY** = deliberate shell
exception for a per-project command string; **GLUE** = stays shell as trivial / workflow-local
glue around an existing capability; **DUAL** = app-service + portable shell fallback (R5 steady
state); **SIMPLE** = single `$spurBin` call, bulk exception. A combined label means one shell
program deliberately sequences two independently-owned capabilities.

### pr-review.yaml (8 compound)

| Program | Disposition | Reason |
| --- | --- | --- |
| `preflight:onEnter:0` | EXT | `pr-reviewing.ts preflight` is the reusable capability (portable script, option d); shell = status-file wrapper |
| `hygiene:onEnter:0` | EXT | `pr-reviewing.ts hygiene`; same wrapper pattern |
| `precheck:onEnter:0` | POLICY | executes per-project `preReviewCmd` via `sh -c`; project-only policy, override is the point |
| `push:onEnter:0` | EXT | `pr-reviewing.ts push` |
| `ensure-pr:onEnter:0` | EXT | `pr-reviewing.ts ensure-pr` |
| `request:onEnter:0` | EXT | `pr-reviewing.ts request` + conditional `--force` flag; 0771 adds one extraction of the request record's requestedAt/head into run-scoped `.txt` files |
| `wait:onEnter:0` | EXT | `pr-reviewing.ts wait`; since 0771 the record is read via `file.read.into-var` vars (`prSince`/`prHead`) exported as shell env — no repeated JSON parsing in shell |
| `collect:onEnter:0` | EXT | same pattern, `pr-reviewing.ts collect` + `status`; 0771 pins the same vars and makes a non-empty `--head` mandatory in the script (moved HEAD fails loud) |

### wayfinder-resolution.yaml

0769 deleted the `collect` state (its `task show` capture now happens once at `precheck` and
serves as the investigate input bundle) and replaced the ad-hoc resolution-verdict PASS-word
and the >5-line/>60-word Testing-length proxies with the standard verdict contract.

| Program | Disposition | Reason |
| --- | --- | --- |
| `precheck:onEnter:0` | GLUE | soft probe combining `task check` + `task show` → status file + run-scoped input bundle (reused by investigate — no separate collect re-run) |
| `verify:onEnter:0` | GLUE | `rm -f` stale answer + stale verdict before the fresh-session verifier |
| `verify:onEnter:1` | GLUE | task path extraction (feeds the proof capture; `docs/tasks*` excluded from the digest's git-tree half) |
| `verify:onEnter:5` | SIMPLE | single `task verdict --from-answer` |
| `verify:onEnter:6` | GLUE | proof-digest + runId injection into verdict json (jq mutation; workflow-local proof wiring) |
| `record:onEnter:0` | GLUE | captured `task record --solution-from-diff --transition testing` → `task update done --no-lifecycle` → persisted-status readback; guards consume the captured result (0769: exit 0 never converts a denied record to done) |

### idea-pipeline.yaml (14 compound)

0769: the feature check is measured exactly once per author/revise boundary by the
`idea-ac-check` (end of ac-generate) and `idea-design-check` (end of system-design)
`command.gate` actions — not shell, so they carry no row below — and every sibling guard
consumes the recorded run-scoped PASS/FAIL instead of re-running `spur feature check`.

| Program | Disposition | Reason |
| --- | --- | --- |
| `start:onEnter:1` | **BUILTIN** | `doctor.probe` resolves reserved selectors through `planner`, records the elected executor, and reuses it for dispatch (0718) |
| `feature-create:onEnter:2` | GLUE | `test -s` guard + `feature update --section Goal` |
| `feature-create:onEnter:3` | GLUE | same for Scope |
| `ac-generate:onEnter:0` | GLUE | retry counter + scratch cleanup |
| `ac-generate:onEnter:2` | GLUE | conditional `feature update --section AC` + done marker |
| `system-design:onEnter:0` | GLUE | ensure design-review template exists |
| `system-design:onEnter:2` | GLUE | awk/grep content predicate (operator feedback present?) |
| `design-approval:onEnter:0` | GLUE | reject counter increment |
| `decompose:onEnter:0` | GLUE | retry counter + batch scratch cleanup |
| `decompose:onEnter:2` | GLUE | jq validation of batch order/dep uniqueness (workflow-local predicate) |
| `batch-create-run:onEnter:0` | GLUE | idempotent `task batch-create --skip-ready` + jq verify + done/failed markers |
| `ready-prepare:onEnter:1` | GLUE | normalize absent ready-evidence sidecar to empty + jq fail-closed shape validation (0788) |
| `handoff-finalize:onEnter:0` | EXT | bundled plugin script over the shared `finalizeIdeaHandoff` (0824): the monorepo runs the TS writer directly; seeded projects run the registered `idea-handoff.mjs` twin over the generated `plugins/sp/lib/idea-handoff.generated.mjs`, and a missing script fails closed |
| `handoff:onEnter:2` | GLUE | checkpoint write |

### docs-pipeline.yaml

Docs-only certification is **measured** since task 0704: the pipeline dispatches read-only
`/sp:dev-verify ${wbs} --auto --fix none --focus all` with an answer file, derives the one
standard verdict via `spur task verdict`, and brackets the verifier with a proof-input digest
capture/re-capture whose comparison gates `verify → record`. Task 0769 moved recording after
verification (precheck → draft → docs-review → verify → record → done): a pre-verification
record could write UNKNOWN/old Testing evidence. `verify → record` opens only on measured PASS
with an intact bracket; `record → done` re-asserts the captured record result and the persisted
verdict/digest, and `record → failed` always — a denied record is never converted to success by
an exit 0. The former synthetic PASS writer in `done` is gone — no state manufactures a verdict,
and non-PASS/malformed/mismatched evidence routes to `failed`. Temporary captures are
run-scoped (`.spur/run/<runId>-docs-*`); the verdict artifact keeps its wbs-named compatibility
path with `runId` stamped inside.

| Program | Disposition | Reason |
| --- | --- | --- |
| `precheck:onEnter:2` | GLUE | combines two status files into one PASS/FAIL |
| `draft:onEnter:1` | SIMPLE | single `task update wip --no-lifecycle` |
| `record:onEnter:0` | GLUE | captured `task record --solution-from-diff --transition testing` → status file; `record → failed` consumes the capture (0769) |
| `verify:onEnter:0` | GLUE | `rm -f` stale answer before the fresh-session verifier (0769) |
| `verify:onEnter:1` | GLUE | task path extraction (feeds the proof capture; `docs/tasks*` excluded from the digest's git-tree half) |
| `verify:onEnter:5` | SIMPLE | single `task verdict --from-answer` |
| `verify:onEnter:6` | GLUE | proof-digest + runId injection into verdict json (jq mutation; workflow-local proof wiring) |
| `done:onEnter:0` | SIMPLE | single `task update done --no-lifecycle` |

### task-pipeline.yaml

0823 rebuilt the over-budget programs under the ADR-115 caps: the three lifecycle transitions are
now `command.gate` built-ins (option c), the quality gate is the `quality-gate.ts` extension
(option d), and the remaining compounds are condensed in place (option e). Dispositions marked
`warn` sit in the advisory band; each keeps its one-line reason as a YAML comment directly above
the action (R1) — as does the warn-band `verify → test-fix` guard, whose sibling `verify → record`
collapsed to the single `jq -e` verdict predicate.

| Program | Disposition | Reason |
| --- | --- | --- |
| `precheck:onEnter:0` | GLUE (warn) | git-status hygiene WARNING/NOTE; advisory |
| `precheck:onEnter:2` | GLUE (warn) | auto-profile feature reopen; a failed reactivation exits 1 (0723 R3) |
| `precheck:onEnter:3` | EXT (warn) | wrapper for `task-size-precheck.ts` (option d); a missing checker writes FAIL |
| `precheck:onEnter:4` | EXT (warn) | wrapper for `task-evidence-precheck.ts` (option d); a missing checker writes FAIL |
| `precheck:onEnter:5` | GLUE (warn) | route-reason lookup + routes log |
| `implement:onEnter:1` | BUILTIN | `command.gate` `task update wip --no-lifecycle` with transient retry |
| `implement:onEnter:2` | POLICY | `$formatCmd ; exit 0`; project-only formatter, best-effort |
| `test:onEnter:6` | EXT (warn) | wrapper for `quality-gate.ts run` (option d); runs the per-project `qualityGateCmd` |
| `test-fix:onEnter:0` | GLUE | mutation-policy gate |
| `test-fix:onEnter:1` | GLUE (warn) | fixall attempt counter + verdict hand-off |
| `test-recheck:onEnter:1` | EXT (warn) | wrapper for `quality-gate.ts recheck`; `gateProbeCmd` fast path, then `qualityGateCmd` |
| `verify:onEnter:2` | EXT | wrapper for `verify-answer-lint.ts` (option d) |
| `verify:onEnter:3` | SIMPLE | single `task verdict --from-answer` |
| `verify:onEnter:4` | GLUE (warn) | proof-digest injection into the verdict json (one jq mutation) |
| `record:onEnter:1` | BUILTIN | `command.gate` `task record --solution-from-diff --transition testing` with transient retry |
| `record:onEnter:2` | EXT (warn) | `feature-sync-bounded.ts` (option d) + `feature sync` fallback + orphan note |
| `done:onEnter:0` | BUILTIN | `command.gate` `task update done --no-lifecycle` with transient retry |
| `done:onEnter:2` | GLUE (warn) | terminal checkpoint write |

### basic.yaml (3 compound)

| Program | Disposition | Reason |
| --- | --- | --- |
| `implement:onEnter:1` | GLUE | reset fix-attempt counter |
| `check:onEnter:0` | POLICY | `qualityGateCmd` soft probe (same exception as task-pipeline `test`) |
| `fix:onEnter:0` | GLUE | fix-attempt counter increment |

### wrapup-pipeline.yaml (6 compound)

0824 moved the run-local JSON handling, the status probes and the bounded feature sync out of the
workflow: the `wrapup-steps.ts resolve|metrics|feature-transition` extension (option d) owns them,
and the workflow keeps the locator wrappers (which fail closed writing FAIL for their defense
effect) plus the route writer. Dispositions marked `warn` sit in the advisory band with a one-line
YAML-comment reason directly above the action.

| Program | Disposition | Reason |
| --- | --- | --- |
| `task-resolve:onEnter:1` | EXT | wrapper for `wrapup-steps.ts resolve` (option d): task capture validation, status resolution and the run-scoped artifacts; a missing script writes FAIL |
| `task-resolve:onEnter:2` | GLUE | route-reason writer: one jq table lookup over the mode var over the validated capture (0758/0783) |
| `doc-sync:onEnter:1` | GLUE | append learnings if present (7 lines; re-keyed from `learning-capture:onEnter:1` after task 0607 renamed the state) |
| `metrics-record:onEnter:0` | EXT | wrapper for `wrapup-steps.ts metrics` (option d): per-task metrics loop (`task show` + verdict) → wrapup-metrics.jsonl |
| `feature-transition:onEnter:0` | EXT + POLICY | wrapper for `wrapup-steps.ts feature-transition`: bounded sync (`feature-sync-bounded.ts` → `feature sync` fallback); after an applied sync, trusted `featureGateCmd` runs through `sh -c` (option e) and reports PASS/FAIL softly |
| `done:onEnter:1` | GLUE | checkpoint write |

### feature-dev.yaml (2 compound)

| Program | Disposition | Reason |
| --- | --- | --- |
| `precheck:onEnter:0` | GLUE | `test -n "$featureId"` + `agent doctor` exit-code soft probe; simpler than `doctor.probe`; consolidation candidate |
| `done:onEnter:0` | GLUE | checkpoint write |

## Portability rule (feature R5, task 0608 R5)

`spur init` never scaffolds `packages/` or `plugins/sp/`, so any capability a shipped workflow
invokes must resolve in a seeded project or degrade deliberately:

- **Built-in action kinds** (`doctor.probe`, `command.gate`, `run.artifact`) run in-process in the
  `spur` CLI, which seeded projects install — portable by construction.
- **External extensions** under `plugins/sp/scripts/` resolve via
  `bun "$(superskill script path sp <name>.ts)"`; the workflows that use them carry a `spur`-verb
  fallback for projects without the plugin.
- **Application services** in `packages/app` are monorepo-only by source, but a plugin script can
  reach one through a generated bundle: `scripts/commands/bundle-plugin-lib.ts` emits a committed,
  standalone `plugins/sp/lib/*.generated.mjs` ESM module (the 0669 `artifact-digest` precedent),
  and the registered ADR-065 twin imports it by relative URL, so bare `node` in a seeded project
  runs the same tested application function the monorepo branch executes. The idea handoff has
  used this bridge since 0824 (`idea-handoff.ts` over `lib/idea-handoff.generated.mjs`, with the
  bundle's `import.meta.main` pinned off and the workflow failing closed when the script is
  absent). A shell copy of the application logic stays rejected — one implementation, two
  transports.

## Precedent this record sets

Any future shell program in a shipped pipeline is judged against this classification: reusable
product semantics → built-in or application service; project-only policy → shell exception with a
recorded reason (or an external extension when one is available); trivial glue → stays shell.
