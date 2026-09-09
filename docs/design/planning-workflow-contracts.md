# Planning workflow and operation contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="75-lifecycle-workflow-definitions"></a>

### 7.5 Lifecycle workflow definitions

Source: `config/workflows/task-lifecycle.yaml`, `config/workflows/feature-lifecycle.yaml`.
Authority: ADR-022 (lifecycles are engine configuration — no local FSM); design §2.3 (graphs +
guard placements), §5.1 (skeleton). Both are `kind: state-machine` definitions validated against
the engine schema shipped by the CLI, referenced as
`@gobing-ai/spur/schemas/state-machine-workflow.schema.json` (the schema file lives at
`apps/cli/schemas/state-machine-workflow.schema.json` and is exported via the package's
`./schemas/*` map).

| File                     | States (§2.3)                                                       | Initial   | Terminal      | Guards                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------- | --------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-lifecycle.yaml`    | `backlog · todo · wip · testing · blocked · done · cancelled`       | `backlog` | `[cancelled]` | `wip→testing`: `spur task check <wbs> --as testing`; `testing→done`: `spur task check <wbs> --as done` (F92 R3: guard evaluates the transition target)                                                                                                                                    |
| `feature-lifecycle.yaml` | `backlog · active · verifying · blocked · done · cancelled` (DD-13) | `backlog` | `[cancelled]` | `active→verifying`: `spur feature check <id> --as verifying`; `verifying→done`: `spur feature check <id> --strict --as done` (0418: guards pass the edge target so the one-active-goal rule evaluates the post-transition state) |

Guard commands reference the check verbs (tasks: 0051/0057). The engine integration is **live**:
`spur task update <wbs> <status>` (0055) and `spur feature update <id> <status>` (0059) drive these
graphs through the dual-workflow engine via `LifecycleAdapter` / `FeatureLifecycleAdapter`
(create-or-attach a durable run keyed `task:<wbs>` / `feature:<id>`, file-wins re-seed per DD-04,
then `requestTransition` — a denied guard aborts the write with its report). The feature
`active→verifying` guard is non-blocking (warns when linked tasks aren't all done/cancelled, DD-13);
`verifying→done` is blocking (`feature check --strict`); `verifying→active` is rework (mandatory
History entry). Unconditional transitions use the engine's `always` guard (externally-driven via
`requestTransition`, not auto-advance). `done` is re-enterable (reopen, warned); `cancelled` is
truly terminal (no outgoing transitions).

**Status normalization invariant (0152):** the raw frontmatter `status` is case-normalized
(`normalizeTaskStatus` / `normalizeFeatureStatus`) at the `PlanningWriteService` boundary before
`requestTransition`, so the file-wins re-seed always receives a canonical lowercase state even when
the stored value is capitalized (`Backlog`), aliased (`completed`), or otherwise non-canonical. This
service-boundary normalization is the sole production entry into the engine transition path; removing
it re-introduces the `FSMError: Cannot reseed run … to undeclared state` crash for any case-drifted
task. See `packages/app/src/services/planning-write-service.ts:326,367`.

**Drift prevention:** `packages/domain/tests/planning/lifecycle-drift.test.ts` parses both YAMLs
and asserts state sets == the `TASK_STATUSES` / `FEATURE_STATUSES` unions from `schema.ts`. The
YAML files and the 0041 enums can never drift silently.

Validate: `spur workflow validate config/workflows/task-lifecycle.yaml` — full JSON-Schema
validation resolves the `@gobing-ai/spur` workspace package and passes (no `--no-schema`
needed). `feature-dev.yaml` uses the same resolvable ref.

**Task execution pipeline** — `config/workflows/task-pipeline.yaml` (design §6, ADR-022
"orchestration is configuration": YAML over the existing engine, zero engine code). `kind:
state-machine`, shape `precheck → implement → test [→ test-fix ↔ test-recheck] → review →
approve(HITL) → verify → record → done` (precheck failure short-circuits to `failed`; `approve`
routes to `failed` on rejection or `cancelled` on cancel). Invariants: it never touches files
directly — status moves use the normal `spur task update <wbs> <status>` verb and section writes go
through `spur task record` (0108) / `spur task update --section`, so the lifecycle guards apply
identically; `approve` is a `hitl.confirm` gate skippable with `--vars '{"profile":"auto"}'`.

**Rival pipeline — retired.** `config/workflows/task-pipeline2.yaml` (feature I6, task 0596) was a
parallel file beside the live pipeline, adding a `residual-sweep` FSM stage reached only via the PASS
verdict guard. It was **deleted rather than promoted** on 2026-08-20 (ADR-076): it had zero live
callers, and a resolved-fact comparison showed it declared **5** model queries against the canonical
pipeline's **4**, so promotion would have raised cost against a goal of lowering it. `task-pipeline.yaml`
is the single canonical task pipeline. Two-layer plan rendering is the inline driver's job
(`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:33-42`).

**D5 transition (ADR-071/072/076).** The proof-state invariant (ADR-071) requires remediation to be
separated from a digest-bound quality → review → `--fix none` proof chain. The task pipeline half
landed (task 0703, 2026-08-29): observe-only verify, entry-point capture, bounded remediation hop,
proof-block evidence, and fail-closed completion guards. The docs pipeline remains open under task
0704. The `task-pipeline2.yaml`
candidate was retired without promotion (ADR-076, 2026-08-20) — the invariant it was meant to
demonstrate stands on its own and governs any future candidate. Composition, action, gate, and artifact shapes are in
[`workflow-composition-contract.md`](workflow-composition-contract.md).

**Vars.** `wbs`, `profile`, `spurBin`, `agent`, `implementAgent`, `stepTimeoutMs`, `implementTimeoutMs`,
`maxImplementReqs`, `maxImplementPlanItems`, `qualityGateCmd`, `qualityGateMaxFixAttempts`, `gateProbeCmd`,
`formatCmd`, `implementScopeGuard`, `mutationPolicy`, `__hitlAnswer`, plus the proof-chain inputs (task 0703,
completed by 0785 R2): `taskSpecPath` (task file resolved at `test` entry — `docs/tasks*` is excluded from the digest's
git-tree half), `featureSpecPath` (linked feature spec resolved at `test` entry from the task frontmatter; empty
for orphan tasks = legitimately omitted — a declared feature whose path fails to resolve fails closed),
`proofDigest` (canonical capture at quality-gate entry, re-captured at
`test-recheck`), and `proofDigestNow` (live re-capture compared at verify entry; re-set by the bound artifact
registration before `record`). Three are command-shaped (the per-project override
surface): `qualityGateCmd` (default `bun run spur-check`) is single-sourced across the soft
probe, the `/sp:dev-fixall` input and the recheck; `formatCmd` (default `bun run format`) is the
post-implement auto-format; `gateProbeCmd` (default `bun run lint`) is the cheap red-detector run before
the full gate on `test-recheck` only — a red probe records `FAIL` and skips the full gate (empty ⇒ pre-0587
behavior, full gate every recheck). `review` is only ever entered through a **full green** `qualityGateCmd` —
only the full gate writes `PASS` (task 0587 R3). `formatCmd` is invoked best-effort (`${vars.formatCmd} ; exit 0`) — a
missing or failing formatter must not abort a run, because `qualityGateCmd` at `test` is the gate
that actually decides. **Implement-only pin (task 0454):** `implementAgent` is used only by the
implement `agent.run` hop; override with `--vars '{"implementAgent":"pi-zai"}'` without retargeting
review/verify. **Agent var precedence (task 0487 R4):** caller `vars.implementAgent` > caller
`vars.agent` > `agent.default` > YAML literal, resolved per var — `--vars '{"agent":"claude"}'`
therefore reaches the implement hop too, where it previously lost to `agent.default`. Precheck logs
the configured resolution, not the interactive session model: `auto` resolves through the configured
role/tier and usable-executor selection; capability attestation gates the chosen executor before spawn.
No session-model inheritance is implied. **Remediation policy (0777):** `mutationPolicy` defaults to
`code`; test-fix reads the task's explicit standalone `mutationPolicy: <value>` declaration in its
body (or frontmatter). Automatic fixall requires both run and task policies to be `code`. `none`,
`tests`, invalid or ambiguous declarations halt before agent dispatch, preserving the failed gate
for scoped manual remediation. A permissive run override cannot weaken a restrictive task policy.
**Precheck (deterministic and doctor-free since 0723):** precheck runs no
`doctor.probe` and spawns no `spur agent doctor` subprocess on any execution surface — the inline
driver executes host-side actions too, so `--agent inline` never implied a bypass. Executor
liveness, routing, and native capability attestation stay fail-closed at the `agent.run` dispatch
boundary (0706): precheck does not predict what dispatch proves. The `doctor.probe` built-in
remains registered for idea-pipeline, which intentionally elects an executor at `start`.
**Size precheck (0454; count-only since 0723):** `maxImplementReqs` (default `10`) and
`maxImplementPlanItems` (default `16` — the operator-approved doubling of the original 5/8
defaults) feed `plugins/sp/scripts/task-size-precheck.ts`, a deterministic count-only check of
R-items and Plan checklist items with no `--executor` flag and no doctor call. A missing or
failing size checker writes FAIL (never PASS), so readiness fails closed; a raised limit is an
explicit size override, not a capability grant. precheck→implement requires
`.spur/run/<wbs>-precheck-size.status=PASS` plus `spur task check <wbs>` (run exactly once, in
the guard). Auto-profile feature reactivation is single-shot (`feature sync`, one
`feature update` fallback); a real reactivation failure surfaces and blocks implementation,
while dirty-tree diagnostics stay advisory.
**Evidence-channel precheck (0726 R2):** alongside the size check,
`plugins/sp/scripts/task-evidence-precheck.ts` makes a task's declared live-data evidence
calls deterministic. It parses the task content for `evidence-channel:` declarations; only the
exact channel `history_tool_call.args_raw[pi]` is allowlisted — any other token is an unknown
declaration and writes FAIL. With the exact declaration present, one fixed query
(`SELECT COUNT(*) AS n FROM history_tool_call WHERE args_raw IS NOT NULL AND source = 'pi'`)
runs on `.spur/spur.db` via bun:sqlite; a missing database, a missing table, or a zero count
also writes FAIL (fail closed). A task without any `evidence-channel:` declaration passes
without opening SQLite. The script always exits 0; the precheck→implement guard requires
`.spur/run/<wbs>-precheck-evidence.status=PASS` in addition to the size status, so a task that
declares live pi bash-command evidence must import real history (safe importer, non-dry-run)
before implementation begins.
**Diff-scope guard (task 0487 R1):** the implement step's `requireDiff` also rejects changes outside
the exact files and explicit directory/glob prefixes backticked in the target task's body, naming
the rogue files; new files beside an exact declared file are allowed, and a task body naming no
paths fails open. The guard snapshots the non-corpus tree before dispatch, so pre-existing dirt is
not attributed to the implementer. Set `--vars '{"implementScopeGuard":"off"}'` to bypass. **Edit surface:** change this YAML under
`config/workflows/task-pipeline.yaml` only (see §2.3 monorepo path model) — no hand-sync to
`.spur/workflows` or `apps/cli/config`.

**Step→command mapping (ADR-026, amended by ADR-043):** `implement` → `/sp:dev-run --mode implement`
(NOT `--mode full` — that drives this pipeline, so calling it here recurses); `test` → **the project
quality gate**, a soft shell probe of `${vars.qualityGateCmd}` plus a bounded pure-slash
`/sp:dev-fixall` loop — *not* `/sp:dev-unit`, which is the coverage gap-fill competency (router
C3/C5). The gate run is tee'd to `.spur/run/${wbs}-test-gate.log`, and the `test-fix` hop passes
`--gate-log .spur/run/${wbs}-test-gate.log` to `/sp:dev-fixall` so the fix agent starts at the
captured finding's `file:line` anchor rather than re-deriving the failure (task 0482 R3);
`review` → `/sp:dev-review` (→ `sp:super-reviewer` → `sp:code-verification` +
`sp:functional-review` + `sp:code-improvement`; three dimensions — SECUA / functional /
architecture, task 0227); `verify` → `/sp:dev-verify --fix none` (→ `sp:code-verification` verify
mode) — observe-only per task 0703/ADR-071: a repairable non-PASS routes once through the bounded
`verify → test-fix` edge (budget shared with the quality gate via
`.spur/run/<wbs>-test-fix-attempt`), and `test-recheck` re-captures `proofDigest` so the re-entered
quality → review → verify chain certifies a fresh state. Gate run output is a bounded summary
(task 0772 R1): a green gate prints status, attempt count, log path, and byte size; a red gate
prints at most the last 40 lines plus the log path — the durable full log on disk is never
truncated, and the log path is also what `test-fix` consumes.

**Completion gate (ADR-026; proof block per task 0703/ADR-071; binding + review evidence per task 0785):** the `verify`
step emits `.spur/run/<wbs>-verdict.json` whose `checks[]` carries a `proof-input-digest` row and whose
`proof` block names the digest (`capturePoint: quality-gate-entry`) with per-stage results for
`qualityGate`, `review`, and `verification` — each carrying the same digest value. Since 0785 R4 the
`review` stage's status is stamped `completed` only when the run-scoped marker
`.spur/run/<runId>-review-proof.digest` (written by the review state right after its agent) names the current
digest — otherwise `skipped`, and an unexecuted review is never reported completed. The
`verify → record` transition is a shell guard asserting `.verdict = PASS`, `.proof.digest` + all
three stage digests equal `$proofDigest`, `.proof.runId`/`.proof.definitionDigest` match the certifying run, and
`stages.review.status = completed`, with a bounded `verify → test-fix` edge (repairable
non-PASS, budget unexhausted) and an `always` sibling `verify → failed` — so a PARTIAL/FAIL,
missing file, malformed JSON, or missing/mismatched proof evidence blocks `done` and always
terminates. Record entry is gated by the bound `run.artifact` registration (0785 R3): the FIRST record
action re-captures the proof inputs fresh over `taskSpecPath` + `featureSpecPath`, requires agreement with the
run's declared digest, validates the raw proof block against the authoritative RunDao run row
(`resumeDefinitionDigest`/`definitionDigest`) plus PASS/COMPLETED stage evidence and the review marker, and only
then writes the artifact ledger row — before any `task record` or status mutation, so an unbound or forged
completion can never cross the lifecycle boundary. This is the spur-native replacement for rd3's default-on
`--postflight-verify`.
**Proof-input fingerprint scope (task 0817 R4):** `computeProofInputFingerprint` binds exactly three
components and deliberately nothing more, so an operator can tell a safe task-file edit from a
digest-breaking one. The git-tree half hashes the working tree minus
`DEFAULT_EXCLUDE_GLOBS = ['docs/tasks*', 'docs/features*']`
(`packages/app/src/workflow/proof-input-fingerprint.ts:172`) — the corpus and ephemeral trees the proof
documents never contribute, which is why record-time evidence writes (ledger rows under `Solution` /
`Testing` / `Review`, new run artifacts) leave the digest unchanged. The task-spec half folds the task
sections `['Background', 'Requirements', 'Acceptance Criteria', 'Design', 'Plan']`
(`proof-input-fingerprint.ts:249`) via `taskSpecPath`, and the linked-feature half folds
`['Goal', 'Scope', 'Acceptance Criteria']` (`proof-input-fingerprint.ts:282`) via `featureSpecPath`.
`Solution` / `Testing` / `Review` are out of the input set by design, so post-verification prose does not
re-open the gate; editing a `Requirements`, `Design`, or `Plan` section after capture does.
**Canonical verdict contract (task 0592, F92):** the verify artifact is validated and aggregated
by one runtime contract — `packages/app/src/services/verify-verdict.ts` owns the Zod schema
(`verifyVerdictSchema`), the parser (`parseVerifyVerdict` / `readVerifyVerdict`, distinguishing
missing / malformed JSON / structurally invalid / valid non-PASS / valid PASS, with the compatibility
aliases normalized in that one place — `scenario`→`id` on coverage rows, and `check`/`id`→`name` on
`checks[]` rows, the latter resolved for raw rows too via `checkRowName` because aggregation and the
done guard's `task-check` lookup run over unparsed artifacts; a check row carrying no label at all is
structurally invalid, since an unnamed check would silently exempt a failed task-check from the
completion rule), and the single aggregation policy
(`aggregateVerifyVerdict`) that answer derivation, persisted-artifact consistency, task/feature
validation, record rendering, and the done gate all share. The done-transition choke point
(`done-transition-guard.ts` `evaluateDoneTransition`) is the final authority: it re-parses and
re-evaluates the artifact, applying check severity (`blocker` → FAIL, `major` → PARTIAL,
`minor`/`advisory` non-blocking; legacy no-severity `fail` → FAIL / `warn` → PARTIAL) and denying any
PASS that is not internally consistent (a stored PASS whose coverage rows do not recompute to PASS,
including a row-less PASS, is treated as non-PASS). `--force-done --reason` remains the sole auditable
override; workflow routing (`verify → record/failed`) may route states but cannot weaken the final
transition.
**`task_run_links` pipeline linkage (kind=pipeline, R4):** resolved by task 0436 — `spur task record`
now auto-creates the `pipeline` run-link when recording a PASS verdict to `done`, so no link-writing
CLI verb is needed from a shell step.
**Step timeout (ADR-026 amendment, 2026-06-23, task 0107; raised task 0398 R4):** each `agent.run`
step carries a `timeoutMs` option — `${vars.stepTimeoutMs}` for review/verify/test-fix and
`${vars.implementTimeoutMs}` for the heavier implement hop, both defaulting to `"1800000"` (30 min).
On elapse the ts-libs `ProcessExecutor` kills the subprocess (never abandons it); the agent step
exits non-zero → `ok:false` → pipeline routes to `failed`, and a partial-work handoff artifact is
written to `.spur/run/<runId>-<state>-partial.md`. The artifact carries a `## resume context` block
naming the agent session dir (`.spur/run/<runId>/agent-sessions/<executor>/`) and the latched
session sidecar (`.spur/run/<runId>-agent-session.json`), so an operator resumes from the dead
agent's transcript instead of re-deriving it (task 0482 R4). Overridable per run via
`--vars '{"stepTimeoutMs":"120000"}'`. The `agent.run` action surface accepts `timeoutMs`
(number parsed from the workflow option or CLI string flag `--timeout`), forwarded through
`AgentService.executeRun` → `AiRunner.runPromptCommand` → `ProcessExecutor.run({ timeout })`.

**Declared step role (0538 R2).** Every `agent.run` step declares `role: <scribe|coder|reviewer|planner>`
beside its `agent:` pin — the Layer-1 role vocabulary (`DEFAULT_AGENT_ROLES`, `packages/config`).
`spur workflow validate` fails a step with no or an unknown role via the post-schema walk
(`collectAgentRunRoleViolations` — `packages/app/src/services/workflow-service.ts`; the JSON schema
validator is a keyword subset, so the walk is the enforcement surface). `spur workflow run` rejects
the same step at dispatch time via `AgentRunActionRunner`'s runtime guard — which is also the
fallback for any dispatch path that bypassed validate — so neither verb ever spawns a role-less
step. The runner threads
the role onto the underlying `spur agent run` — the `--json` envelope and the run trace record it —
and the step-reporter renders it on the action line (`role=<id>`). An `agent:` pin still beats role
routing permanently (0536 R2): the role declares the *reason*, so removing the pin later routes
correctly instead of falling to the default role.

<a id="agent-capability-attestation"></a>

#### Agent capability attestation

**Capability attestation (ADR-094 principle / ADR-102 contract, task 0706).** A `agent.run` step may declare
`requiresCapabilities` — a partial map over the closed axis vocabulary
`fsRead|fsWrite|networkEgress|processSpawn|externalMutationApproval` to a minimum level
`available|enforced` (`EXECUTION_CAPABILITY_*`, `packages/config/src/index.ts`). Executors attest
`executionCapabilities` (`version: 1`, partial `axes` map, per-axis `state` + `provenance`
`native-known|operator-configured|unattested`) in their agent-config entry. `AgentService`
dispatch resolves the target executor and compares requirements against the attestation BEFORE
spawning, re-checking on each escalation hop; a missing attestation, unknown axis state, or
level below the requirement fails closed (exit 2) with an axis-by-axis diagnostic naming required
vs. actual state and provenance. Missing data resolves to `unknown`, never permissive; tier is
never a capability signal. Satisfied gates record a bounded, redacted per-axis evidence payload
(axis/state/provenance only — no config blobs) on `routing.capabilities` in the run trace.
`AgentRunActionRunner` re-validates the option shape at the action boundary. Shipped reference
workflows attest the two unattended tree-mutating stages (`implement`, `test-fix` in
`task-pipeline.yaml`); observe-only stages stay undeclared.

**Usage propagation and hard budgets (ADR-095, task 0707, R1–R7).** Agent usage is a normalized optional
contract (`NormalizedAgentUsage`, `packages/app/src/services/agent-usage.ts`): `availability:
'measured'|'unavailable'` with typed token/cost fields only when actually reported — unavailable
stays unavailable with a reason and is **never** coerced to zero. The contract reads ONLY typed
structured fields off a runner result (R2); parsing stdout/stderr for accounting is rejected. The
installed `@gobing-ai/ts-ai-runner` facade exposes no structured usage today, so dispatch results
carry the honest `unavailable` shape (`AgentRunTracedResult.usage?`, `agent.execution.finished`, and
the trace-safe `WorkflowActionUsageSummary` projection) until the owning runner package publishes
typed fields — the seam normalizes them the day they appear. `agent.run` accepts optional
`maxTokens` / `maxCostUsd` hard budgets (R4): validated at the action trust boundary (positive
finite; string numbers accepted), evaluated once when the dispatch returns — wall-clock
(`timeoutMs`) remains the only mid-run control. Over-budget steps fail with per-cap violations and
emit a bounded `workflow.agent.budget` event (identifiers + scalars only; run-log records one line);
a cap that cannot be evaluated because usage is unavailable fails closed as `budget-unverifiable`
(R5) — never silently passed, never estimated from public price tables (R8). Actions that declare no
budget dispatch unchanged; failed dispatches keep their existing diagnostics (R7).

**Fail-closed operational trip wires (ADR-096, task 0708, R1–R8).** High-risk operational signals at
workflow/action safe boundaries are evaluated against a **closed, deterministic catalog**
(`packages/app/src/workflow/tripwire.ts`): `retry-exhausted`, `hard-budget`, `capability-denied`,
`proof-invalidated`, `output-drop` — each versioned, with a fixed `response` (`fail` for all but
`output-drop`, which records and continues) and an `nextDecision` recovery instruction (R1/R6). No
model call, no DSL, no new thresholds (Q&A). The agent-run action evaluates the wires once per
dispatch at the existing post-dispatch boundary, reading only already-normalized outcomes — the
budget verdict, the steering settle reason, the capability-attestation denial marker
(`CAPABILITY_BLOCK_PREFIX`), the bounded relay's drop counter — never duplicated state (R2/R5). A
fired wire emits the canonical bounded `workflow.tripwire.fired` event on the workflow observability
bus (policy id/version, run/action/task correlation, observed value, threshold, evidence refs,
next decision; run-log records one line) (R4). Fail policies return through the existing
action-failure semantics with the exact next decision in the error and the partial-work artifact
preserved, so the engine stops subsequent actions and the state machine follows its declared route
(R3/R7); `capability-denied` keeps the richer pre-dispatch failure path (no dispatch ever ran). The
steering boundary's timeout default is fail-closed: once the retry policy is exhausted and the
attempt failed, a steering timeout resolves `abort` with a `retry-exhausted` reason instead of
continue (R3). `proof.fingerprint` participates when composed with the observability bus: an
`expect` mismatch emits the `proof-invalidated` wire before failing through its existing mismatch
semantics. Deterministic fail-closed evaluation means an unknown signal id fails the evaluation
rather than silently passing, and drift between emitters and the catalog is caught by unit tests
pinning the closed catalog and the event map (R8).

**Fresh-context review independence (ADR-097, task 0710, R1–R8).** `agent.run` accepts `freshSession: true`
(R1): the action bypasses every inherited session knob (`__agentSessionDir`, `__agentSessionId`, the
`__agentSession` latch), dispatches into a per-node `fresh-<node>` session directory with no session
id, and publishes **only** routing evidence on success — never its own session identity — so a
review/verify hop cannot contaminate a later implement/test-fix resume. Every successful dispatch
persists bounded routing evidence under the workflow var `__agentRouting_<node>` (R3):
`{"agent": <resolved executor>, "model?"}` — identifiers only. The task pipeline's `review` and
`verify` steps declare `freshSession: true` and route by `role: reviewer` alone (R2/R7): the
implementation executor pin is gone, so review/verify resolve through the executor registry and the
reviewer's context comes only from the persisted task spec, the recorded diff, and run artifacts.
Risk policy (R4): a task's frontmatter priority (extracted to `taskPriority` at the quality-gate
stage) decides whether the P0/P1 distinct-executor rule applies — review/verify must then resolve a
DIFFERENT executor spec than `__agentRouting_implement` records; lower priorities (and unknown
priority) require fresh context only, with executor reuse allowed. Distinctness is evaluated AFTER
routing and BEFORE dispatch via the pure `review-independence` module (R5): missing implementation
evidence, unresolvable reviewer routing, and equal executor names all fail closed with the exact
configuration remedy (`roles.reviewer` tier override or an explicit pin) — never a silent dispatch.
Composition (R8): the live pipeline itself is checked — a proof-chain test fails if review/verify
re-pin an executor, lose `freshSession: true`, or drift from `compareExecutorWith: implement`, and
the composition baseline digest regenerates with every pipeline change.

**Escalation packets (ADR-098, task 0709, R1–R3).** A blocked or failed run emits exactly ONE
versioned escalation packet — a pure, deterministic projection over evidence that already exists
(`packages/app/src/workflow/escalation-packet.ts`). The packet carries `schemaVersion` (1), a stable
`fingerprint` (sha256 over run id + trigger + gate + evidence refs, so the same failure re-projects
to the same id), the trigger (`tripwire` | `terminal-failure`), and one unresolved operator decision
drawn from a closed vocabulary: `retry`, `revise_requirements`, `grant_capability`, `raise_budget`,
`inspect_failure`. The trip-wire policy → decision mapping is a closed catalog keyed on the ADR-096
gate ids; an unknown gate falls to `inspect_failure`. Evidence enters as **references only** — task,
run, proof, artifact, budget, capability, and event ids — never copied logs or payloads, and every
string field is bounded and redacted. JSON is the source of truth; Markdown is an optional render.
The sink (`packages/app/src/observability/escalation-packet-sink.ts`) writes the artifact under
`.spur/run/` plus one artifacts-table row, and gates emission on `isDryRunProbe(runId)` so a dry
probe never writes a packet (0753 R4) — an escalation channel that fires on probes is one nobody
reads. No new persistence plane is introduced.

**Checkpoint and indexed-context freshness (ADR-099, task 0711, R1–R5).** A session checkpoint is an
**advisory** resume projection under `.spur/memory/sessions/`; task/feature files and persisted
workflow state stay authoritative. `packages/app/src/workflow/checkpoint-contract.ts` fixes the
metadata contract at `CHECKPOINT_SCHEMA_VERSION = 1`: `sessionId`, `workflow`, `runId`, `taskWbs`,
`featureId`, `phase`, `status`, `lastGate`, `sourceCommit`, `digest`, `generatedAt`, `updatedAt`,
`nextAction`, and `artifacts[]` — the freshness fields the Session Checkpoint Convention documented
but writers never emitted. `parseCheckpointMetadata` returns `null` for any structurally invalid
file (missing or short frontmatter, missing required field, wrong schema version); callers must
report-and-ignore, never silently trust (R3). `TERMINAL_CHECKPOINT_STATUSES`
(`done`/`failed`/`cancelled`/`skipped`) bound cleanup: `WorkflowService.cleanCheckpoints` deletes
only expired, unreferenced, regenerable state inside its own confined owner path, and never a file
it cannot prove is a terminal checkpoint (R5). The plugin's
`plugins/sp/scripts/stage-registry-adapter.ts` keeps a self-contained lean copy of this semantics —
it installs into foreign repos and cannot import workspace packages — and a parity test pins the two
together.

**Resume-side checkpoint mapping (0784 R3).** On `workflow continue`, a checkpoint associated with
the paused run is validated in the run's recorded launch workdir: `pending`/`running`/`approved`
statuses are accepted as the nonterminal advisory projections of a paused engine (the engine
persists no `paused` checkpoint status); terminal, missing, or unknown statuses refuse the resume
with a named reason. Artifacts resolve relative to the launch workdir and git HEAD is probed there
through the ProcessExecutor (a probe failure refuses — never an empty-string fallback); an engine
run with no associated checkpoint remains a valid resume.

**Verifier-owned verify answer file (task 0726, R3).** The verify step's `agent.run` declares
`expectFile` instead of `answerFile`: the verifier writes `.spur/run/<wbs>-verify-answer.txt` itself
(append-progress authoring — `Verdict: PARTIAL` first, one complete requirement/AC row at a time,
first verdict line replaced only after all rows are certified), and the host checks post-exit
existence without capturing or overwriting, so an interrupted verify leaves lintable partial rows
instead of losing the capture. A hard `verify-answer-lint.ts` gate runs after the agent exits and
before `spur task verdict --from-answer`, rejecting with row-level diagnostics: missing, duplicate,
or unknown requirement IDs (vs the task's bold `R#` items), AC IDs that do not exactly match a task
AC checklist label (or its leading token) or a linked feature scenario title, status/evidence-type
values the verdict parser would drop, and empty evidence. The lint's normalization mirrors
`packages/app/src/services/task-verdict.ts` exactly (compound evidence types included), so the lint
is a strict pre-filter of the verdict parser, never an independent dialect. On retry the verifier
keeps rows that pass the lint and verifies only the missing IDs.

**Task evidence precheck + verify answer lint (tasks 0726, R2/R3):** `precheck` gains a
fail-closed `task-evidence-precheck` step (same contract as the size precheck: PASS/FAIL to
`.spur/run/<wbs>-precheck-evidence.status`, always exit 0; a missing checker fails closed) and the
precheck→implement guard requires BOTH status files PASS. On the verify stage, the verifier OWNS
the answer file — `agent.run expectFile` (engine checks existence; the verifier authors it and
appends progress) — and a deterministic hard-gate lint step
(`plugins/sp/scripts/verify-answer-lint.ts`) runs between capture and
`spur task verdict --from-answer`: bounded row findings (max 10), non-zero exit writes nothing,
enforcing verdict-line shape, requirement row completeness/uniqueness/identity, status/evidence
validity, and AC-label identity against the task checklist (AC completeness stays a verifier
judgement, not a lint class). A lint failure halts the stage before the verdict step can misread a
malformed answer.

**Run status (ADR-044):** terminal states partition into success and failure via an optional
`failureStates` subset of `terminalStates` (declared per workflow; absent ⇒ today's behavior). Landing
in a failure terminal finalizes the run as `status: "failed"` through `lifecycle.fail` — the persisted
run row, the `workflow.run.failed` event, and the CLI exit code all agree, so **`status` alone is
authoritative for pass/fail**. Judge a run by `status === 'done'`, never by string-matching a
`finalState` name the caller does not own. Workflows declaring no `failureStates` still finalize every
terminal as `done` (backward compatible).

**Pipeline section-ownership model (ADR-026 amendment, 2026-06-23, task 0106):** every
`done`-required section ([Solution, Testing, Review]) is owned by exactly one pipeline step:

| Required section          | Owning step                    | When                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Solution` (change-map)   | `/sp:dev-run --mode implement` | After writing code — the implement agent authors a markdown table of changed files with `file:line` + `what/why`. Idempotent (upsert via `replaceSection`); writes only when the section is bare (absent, empty, or a placeholder). |
| `Testing` (verdict table) | `record`                       | Post-verify — transcribes the per-requirement verdict + evidence from `.spur/run/<wbs>-verify-answer.txt` and `.spur/run/<wbs>-verdict.json`.                                                                                       |
| `Review` (P1–P4 findings) | `record`                       | Post-verify — transcribes SECU findings from the verify output.                                                                                                                                                                     |

The `record` step provides a **Solution safety-net**: if the implement step didn't write
`## Solution`, `record` backfills a minimal change-map from `git diff --name-only`. A
`sectionIsBare` predicate (in `packages/app/src/services/task-service.ts`) detects absent,
empty/whitespace, or placeholder sections — the single reusable mechanism behind all three
writes.

**Done gate:** the `record → done` transition runs a shell guard `spur task check <wbs>` plus the
proof-block re-assertion (`.verdict = PASS` and `.proof.digest = $proofDigest`, task 0703 R5) with
an `always` `record → failed` sibling — mirroring the `verify → record` gate exactly. The guard
passes because every required section was guaranteed upstream and the evidence still names the
captured digest; a genuinely non-compliant task routes to `failed` instead of a silent bad `done`.

**Planning pipeline** — `config/workflows/planning-pipeline.yaml` (task 0088; design §6). Front-half
of the dev workflow: `phasing(HITL) → feature-id → design-gen → design-approval(HITL) → handoff`.
`kind: state-machine`, `vars: { slug, profile, feature }`, same engine as `task-pipeline.yaml`
(ADR-022 — zero new engine code). Companions the `sp:spur-plan` skill (how-to-think for the
non-deterministic steps: phasing judgment, feature-ID derivation, design-doc authoring). HITL gates
use `hitl.confirm`, skippable with `--vars '{"profile":"auto"}'` (Q4). Doc-write discipline (Q3):
auto-writes derived docs (`docs/design/*`, `docs/features/*`); **stages** `02_ROADMAP`/`04_DESIGN`
index edits to `docs/plans/` for human commit. Every authoritative-doc touch invokes `sp:doc-evolve`
(§5 sync triggers). Terminal at `handoff` (drafted feature list → `sp:spur-dev` steps 7–12) or
`cancelled`. Validates against the workspace state-machine schema.

**D5-K caller migration landed (task 0604; ADR-072 still Proposed).** Planning is absorbed into
the canonical idea/dev-plan path: `/sp:dev-plan` routes through `idea-pipeline.yaml`, the scaffold
manifest no longer carries a planning row, `listBundledProjectSeedFiles` excludes
`workflows/planning-pipeline.yaml` (`packages/config/src/bundled-config.ts` —
`RETIRED_PROJECT_SEEDS`), and no skill, README, or help table points at it. A fresh `spur init`
therefore never receives a second planning graph.

The **source file is deliberately retained** at `config/workflows/planning-pipeline.yaml`: deleting
it is gated on operator acceptance of ADR-072, which is also what resolves ADR-029's deferred
consolidation question. Until then it stays schema-valid and schema-valid (composition baseline retired, task 0767),
but nothing ships or invokes it.

<a id="76-task-dtos-orpc-contract"></a>

### 7.6 Task DTOs (oRPC contract)

Transport DTOs live in `packages/contracts/src/task.ts` and are the single source of truth for the
wire shape. Domain types stay in `@gobing-ai/spur-domain`; transport DTOs belong in `packages/contracts`.

| DTO                     | Key fields                                                                          | Notes                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskSummarySchema`     | `wbs, name, status, priority?, featureId?, parentWbs?, type?, filePath, updatedAt?` | List response. `type` and `priority` are extracted from frontmatter by the server handler. `priority` is a free-form `z.string()` (not the `PRIORITIES` enum) because the corpus mixes `P0–P3` with `high/medium/low`; the raw value is passed through. |
| `taskCreateInputSchema` | `title, featureId?, parentWbs?, folder?, template?`                                 | `template` selects a `TASK_VARIANTS` scaffold (R8); defaults to `standard` or `feature-impl` (when `featureId` set).                                                                                                                                    |
| `taskActionInputSchema` | `wbs, action, channel?, skipDeps?`                                                  | `action` ∈ `refine\|plan\|run\|verify\|decompose\|evaluate`. `channel` ∈ `claude\|codex\|gemini\|pi\|opencode\|antigravity\|openclaw`; `skipDeps` is persisted in the queued job metadata for dependency-bypass-aware runners (R9).                     |
| `taskFolderSchema`      | `path, label?`                                                                      | Folder entry from `docs/.tasks/config.jsonc` (R6).                                                                                                                                                                                                      |

<a id="77-workflow-action-primitives-for-anti-hallucination-adr-024"></a>

### 7.7 Workflow action primitives for anti-hallucination (ADR-024)

Two primitives back the anti-hallucination migration (superskill task 0041):

| Primitive                  | Surface                                                  | Description                                                                                                                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentService.runCapture`  | `packages/app/src/services/agent-service.ts`             | Opt-in capture path: returns `{ exitCode, answer }` without streaming or diagnostics. Uses buffered output mode.                                                                                                                                                                                          |
| Workflow `agent.run`       | `packages/app/src/workflow/actions/agent-run.ts`         | Always dispatches through `AgentService.runTraced`: buffered output, non-interactive stdin, and a sanitized resolved invocation persisted in `ActionResult.data`. `capture: true` only surfaces buffered stdout as `data.answer`. Direct `spur agent run` keeps its TTY-aware `run` / `runCapture` paths. |
| `response.validate` action | `packages/app/src/workflow/actions/response-validate.ts` | Reads `text` from options, calls injected `ResponseValidateEngine.validate()`, maps `{ ok, reason, issues }` to `ActionResult`. Engine injected via `SpurWorkflowBuiltinsOptions.responseValidateEngine` in `builtins.ts`.                                                                                |

**Engine seam:** `ResponseValidateEngine` interface (`{ validate(text: string): { ok, reason, issues? } }`) is the contract. The concrete engine is owned by superskill 0041 and provided by the externally-installed `cc:anti-hallucination` skill; the caller wires a thin adapter over its surface. The in-repo copy (`plugins/sp/skills/anti-hallucination/`) was removed once the migration completed (ADR-024 amendment, 2026-06-20); the seam itself is DI-only and unchanged.

**Retry/deny pattern:** transition-flow spike (`packages/app/tests/fixtures/anti-hallucination-spike.yaml`) confirms `validate → ok:done | fail:generate(bounded) | exhausted:denied` is expressible. `iterationBound` caps retries; a proper retry-count guard (checking `vars.__retryCount`) is future work (R3.1).

<a id="78-spdev--command-operations"></a>

### 7.8 `sp:dev-*` command operations

The `sp:dev-*` commands back onto the orchestration spine plus competency skills
(`sp:spur-dev`, `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`,
`sp:functional-review`, `sp:code-improvement`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`) or define their procedure inline. The
authoritative reference for all 13 operations — purpose, inputs, backing, behavior contract — is
[`plugins/sp/skills/spur-dev/references/dev-operations.md`](../../plugins/sp/skills/spur-dev/references/dev-operations.md).
The `runall` operation (#13) is the batch entry — interactive sequential omit/inline keeps the
driver loop in the host session; explicit/parallel execution delegates it to `sp:super-planner` per
[`execution-batch.md`](../../plugins/sp/skills/spur-dev/references/execution-batch.md).
Model-bearing operations share the single execution-surface selector `--agent <inline|auto|name>`
(`inline` is the default when omitted; the former `--inline`/`--subprocess` flags are collapsed into
it, ADR-041/047). `--agent auto` / `--agent <name>`, or another named dispatch-surface trigger,
selects `spur agent run`; headless workflow operations retain their `agent.run` subprocess actions.
**Explicit `--agent inline` and an omitted `--agent` resolve identically (ADR-087, task 0687):**
`inline` is the default selector; host-session surfaces execute model-bearing work in the invoking
session, with eligible model stages allowed a native platform subagent per task-0508 eligibility
(now generalized to all inline resolutions). Headless surfaces (`spur agent run`, workflow
`agent.run`, serve-side dispatch) cannot host a session; `AgentService.resolveAgent` substitutes
tier resolution there and emits one warning naming the resolved executor — no rejection, no
frozen message, no `exit 2`. Genuine resolution failures keep the existing
`agent-resolution` envelope.
Interactive full task execution uses the YAML-backed host driver defined in
[`inline-pipeline-driver.md`](../../plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md).
Interactive omit is host-controlled and **non-subprocess** (no `spur agent run`, no
`spur workflow run`), but eligible sequential model-bearing `agent.run` stages dispatch once to a
native platform subagent when the host exposes one with shared-worktree read/write/shell
capability; host fallback covers every ineligible stage, and post-dispatch failures follow the
stage error policy without host replay (ADR-047 amendment, task 0508). Operator confirmation
actions and approve/taste/ask decisions stay host-owned.
The inline driver's run identity is frozen at invocation (task 0809 R4): setup persists the
authoritative run row with the complete launch identity — canonical `definitionDigest`,
`workflowVersion` including explicit null, and `definitionSource` path/layer/workdir — in the
initial insert, and the driver keeps one invocation-time parsed definition for the entire run.
`proof.digest` is the fresh current-input fingerprint while `proof.definitionDigest` identifies
the workflow actually interpreted; a tracked YAML source edit before capture lands in current
input proof, post-capture input edits invalidate it, and switching the executed definition stops
the run in favor of a fresh inline run — never a history repair or resume stamp at record (0784
owns paused-engine consent). The inline record is 0808's registration-equivalent run-log line
with run/definition identity agreement checked from authoritative setup/run evidence; there is
no inline artifact-ledger write. Owner:
[`inline-pipeline-driver.md`](../../plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md).
The SSOT is
[`cross-cutting.md`](../../plugins/sp/skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
The `review` operation resolves to deterministic modes: WBS mode runs functional traceability (`sp:functional-review`), SECUA framework (`sp:code-verification`), and architectural depth (`sp:code-improvement`), writing findings to the task's `## Review` section; Path mode runs advisory SECUA and architecture with no task mutation. `--fix` is deprecated (no-op + warning; route remediation → `/sp:dev-verify --fix`). `--next` was **removed** from `dev-review` (feature H8, task 0401 R3): it had been a deprecated no-op, and once `--next` was redefined as chain-to-completion with propagation (ADR-039) keeping a no-op spelling of a now-meaningful flag would have been the fourth contradictory meaning. Route progression through `/sp:dev-next`.
The `handover` operation writes the durable handover SSOT to `docs/handover/<YYYY-MM-DD>-<slug>.md` and appends a pointer link into the task's `References` / `Notes` without clobbering existing content.
See [`dev-operations.md`](../../plugins/sp/skills/spur-dev/references/dev-operations.md).

| Pattern              | Operations                                                                                          | Backing                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Skill()` delegation | implement, unit, review, verify, run, refine, plan, docs, brainstorm, dogfood, runall, debug, daily | `sp:code-implementation`, `sp:code-testing`, `sp:code-verification`, `sp:functional-review`, `sp:code-improvement`, `sp:spur-dev`, `sp:doc-evolve`, `sp:brainstorm`, `sp:dogfood-testing`, `sp:sys-debugging`, `sp:daily-summary` |
| Inline procedure     | changelog, gitmsg, fixall, handover                                                                 | git CLI + `spur` CLI + agent reasoning                                                                                                                                                                                            |

**Brainstorm artifact exits.** `dev-brainstorm` runs the grilling interview → ideation, then lands an
artifact via one of two **mutually exclusive** exits:

- `--task [<feature-id>]` — one `todo` task via `spur task create` (the fast path for a single unit
  of work; skips feature/AC ceremony on purpose).
- `--feature [<parent-id>]` — the **front-half entry**: `spur feature create`, then author Goal/Scope
  and BDD acceptance criteria from the decision trace through
  `spur feature update --section <name> --from-file <path>`, then loop
  the `spur feature check` gate to exit 0. Lands a validated feature and hands off to
  `/sp:dev-plan --feature <ID>` for schema-gated decomposition. Passing both exits is an error.

> **`dev-new-task` retired (2026-06-25).** The standalone single-task command was a thin wrapper over
> `spur task create` + intake; its use cases are absorbed by `dev-brainstorm --skip-discovery --task`
> (same result, seeds Background/Requirements/Plan). Operation count dropped 12 → 11.

**Pipeline step→command mapping (ADR-026):** `implement` → `/sp:dev-run --mode implement`, `test` → `/sp:dev-unit`,
`review` → `/sp:dev-review`, `verify` → `/sp:dev-verify` (§7.5). The remaining commands are
operator-invoked, not pipeline-driven.
