# Workflow composition contract

**Area:** workflow definition composition, deterministic action ownership, pipeline promotion, and run artifacts.
**Status:** composition/projection infrastructure built; the digest-bound proof chain shipped for `task-pipeline` (ADR-071; tasks 0703/0769) — the docs half retired with `docs-pipeline.yaml` (task 0866). Physical path confinement, spec-complete proof inputs, honest review-completion evidence, and bound artifact registration at record entry landed (task 0785).
**Authority:** derived; decisions live in `00_ADR`, module boundaries in `03_ARCHITECTURE`.

## Target workflow inventory

| Workflow | Lifecycle boundary | Disposition |
| --- | --- | --- |
| `task-pipeline.yaml` | one task from precheck through recorded completion | canonical; absorb only a proof-preserving pipeline2 delta |
| ~~`task-pipeline2.yaml`~~ | *(deleted 2026-08-20)* | **removed under ADR-076** — unreferenced duplicate declaring a 5th model query against the canonical pipeline's 4; deleted rather than promoted |
| `planning-pipeline.yaml` | feature planning front half | absorb into the canonical idea/dev-plan path, then delete after caller parity |
| `idea-pipeline.yaml` | idea discovery, design review, and decomposition | keep separate; migrate last |
| ~~`docs-pipeline.yaml`~~ | *(deleted 2026-09-16)* | **removed under task 0866 (feature D62)** — zero non-dry runs and zero real completions in the retained run history, and no invoking command, skill, agent, script or config outside tests and documentation (the `/sp:dev-run --mode implement` caller declared in `plugins/sp/README.md` was never wired; that mode is the single implement competency). The docs-only **procedure** is unaffected — it runs through `/sp:dev-run --mode implement` + `spur task record` on `task-pipeline.yaml` |
| ~~`feature-dev.yaml`~~ | *(deleted 2026-09-16)* | **removed under task 0866 (feature D62)** — zero non-dry runs and zero real completions; its declared caller (`/sp:dev-runall --feature`) dispatches `task-pipeline.yaml` per task, not this graph. Its only invoking surfaces — the `bun run features` script and the `feature-dev-precheck` plugin script — were retired with it rather than left dangling. The `integration-review` defect records were **not** retired: `docs/inventory/d8-0729-workflow-contract-inventory.md` §F rows 1–2 still stand, row 2's subject having ceased to exist with this deletion while row 1 (`command-gate.ts:157` spreading `timeoutMs` under the wrong key) remains a live S1 defect independent of it |
| ~~`basic.yaml`~~ | *(deleted 2026-09-16)* | **removed under task 0866 (feature D62)** — zero non-dry runs and zero real completions; it was a generic implement/check/fix example with no caller. The bundled example surface it occupied was not load-bearing: the retained definitions are seeded by `spur init` and exercised by the resolver/composition tests |
| `wrapup-pipeline.yaml` | completed-task wrap-up | keep separate |
| `pr-review.yaml` | integration-HEAD review | keep separate; invoke once per stable HEAD after local gates. **Retained (task 0866)** despite zero real completions: `plugins/sp/scripts/pr-reviewing.ts` + `/sp:dev-pr-review` declare it as the spine SSOT, so the caller half of the retirement test fails |
| `history-anatomy.yaml` | daily/ad-hoc diagnostic report | keep separate; real completions in the window (7 `done`, last 2026-09-13) |
| `wayfinder-resolution.yaml` | research/specification ticket resolution loop | **retained (task 0866)**: records a real completion (1 non-dry `done`, 2026-07-19, 225 s) across 6 non-dry runs, so it does not meet the zero-real-completion half; operator-invocable free-form (`spur workflow run`) |
| `task-lifecycle.yaml` | TaskStatus FSM | **retained (task 0866)**: 545 non-dry runs / 40 real `done` (last 2026-09-16), externally driven by `requestTransition`; zero `action_runs` is correct for a pure status FSM, never evidence of absent traffic |
| `feature-lifecycle.yaml` | FeatureStatus FSM | **retained (task 0866)**: 118 non-dry runs / 29 real `done` (last 2026-09-15); same externally driven shape as `task-lifecycle` |
| `feature-verification.yaml` | feature-scoped verification pass | **added (task 0872, ADR-119)**: owns the repo-wide checks moved out of the per-task pipeline (corpus consistency, contract baselines, dependency/schema drift, frozen History surface, repo-wide test set); invoked by `feature-lifecycle`'s `verifying` entry (task 0880 caller wiring), and its `verifying→done` guard requires its recorded PASS. No model queries — a `shell` action plus `shell`/`always` guards |

Other workflow definitions remain regression fixtures or examples unless a later ADR changes their
status. The retirement discriminator is **zero real completions AND no live caller** — never
`zero action_runs` (task 0866 R1/R2; ADR-117).

### Migration status (task 0604)

| Wave | Scope | Status |
| --- | --- | --- |
| D5-I | wrap-up metrics off the model hop | landed |
| D5-J | docs precheck onto soft `command.gate` | landed |
| D5-K | planning callers absorbed into idea/dev-plan | landed; `planning-pipeline.yaml` retained until ADR-072 is accepted |
| D5-L | `task-pipeline.yaml` onto the shared primitives | partial — `run.artifact` owns the verdict; `qualityGateCmd` stays a documented per-project **shell** string. The precheck doctor probe **landed** on the `doctor.probe` built-in action kind (task 0608, feature D6 — the D6 ownership-surface decision); the D5-L wave itself shipped under the constraint that `command.gate` cannot express either program's semantics without a new public CLI surface (ADR-051) |
| D5-M | pipeline2 residual made read-only | landed — the sweep is bracketed by a tree snapshot and any post-PASS mutation routes to `failed`, never `record` (ADR-071) |
| D5-N | ~~eval-pipeline promotion bar~~ | **retired (ADR-076, 2026-08-20)** — the bar is no longer a gate; `task-pipeline2.yaml` was deleted rather than promoted. `eval-pipeline` remains a measurement tool only |
| D5-O | idea handoff onto `finalizeIdeaHandoff` | landed as monorepo writer + bundled plugin-script fallback (0824) |
| D5-P | advisory integration review at the feature boundary | landed in `feature-dev.yaml` (carrier retired 2026-09-16, task 0866) |

**Known baseline gap (carried forward by design).** The composition measures are heuristic. They
measure shell size, prompt size and slash-invocation shape, so a semantic rewrite of a shell body
within its budget can still go undetected. Task 0775 retired the manifest that was proposed to close
this; the residual risk is accepted and documented here. ADR-115 caps size, not meaning.

## Composition facts (post-0775)

Task 0775 retired `config/workflow-composition-baseline.json` and the two-sided snapshot check.
Resolved composition facts (`terminalStates`, `modelQueries`, per-action `kind`/`invocation`) are
extracted from the live definitions by `extractResolvedWorkflowFacts`
(`packages/app/src/workflow/composition-baseline.ts`) and guarded by unit tests
(`composition-baseline.test.ts`). The checker-era guarantee —
a field-level diff until design and definition are deliberately updated together — is now carried
by those unit gates plus the advisory. The snapshot's `stateEffect`/`evidenceEffect` declarations
and the proof-input baseline retired with the snapshot.

## Stable action identity and effects

A definition action has the stable key:

```text
<state>:<onEnter|onExit>:<zero-based ordinal>
```

The key is derived after extensions resolve and is independent of a persisted attempt UUID. Each
action declares two independent effects:

| Field | Value | Contract |
| --- | --- | --- |
| `stateEffect` | `read` | cannot modify repository files or normative task/feature inputs |
| `stateEffect` | `write` | expected to modify repository files or normative task/feature inputs |
| `stateEffect` | `may-write` | may modify repository files or normative task/feature inputs |
| `evidenceEffect` | `none` | creates no evidence artifact or derived corpus projection |
| `evidenceEffect` | `write` | writes only declared, confined evidence tagged with `proofInputDigest` |

Unknown action kinds and unclassified extension actions use `stateEffect: may-write`. Prompt prose
and shell text cannot narrow an effect. An evidence writer that escapes its declared artifact path
or derived section is reclassified as a state write and invalidates proof.

`ProofInputFingerprint` combines:

1. an alternate-index Git tree for the working repository, excluding configured task and feature folders; and
2. a canonical hash of the baseline-listed task/feature identity fields and normative sections.

Review, Testing, Solution, lifecycle status, timestamps, and `.spur/run` artifacts are evidence or
bookkeeping rather than proof inputs. Their writers remain proof-neutral only while confined to
those declared targets.

## Deterministic capability actions

Workflow YAML selects and orders capabilities. The capability implementation owns validation,
mutation, retry, and diagnostics.

### `command.gate`

```yaml
- kind: command.gate
  options:
    id: quality-gate
    executable: bun
    args:
      - run
      - spur-check
    timeoutMs: 1800000
    retry:
      maxAttempts: 5
      delayMs: 10000
      on:
        - sqlite-busy
    resultFile: .spur/run/${vars.wbs}-test-gate.status
```

Contract:

- `executable` and every `args` entry are literal, non-empty strings in the checked definition;
  per-run vars cannot provide executable *content*.
- **Multi-token `executable` (amended, task 0604 / D5-J).** `executable` may resolve to a
  whitespace-separated launch string and is split into `argv[0]` plus leading arguments. This
  exists because `resolveSpurBin()` legitimately yields `"<bun> <mainModule>"` when the CLI runs
  from source, so a single-token rule made every real gate in the shipped pipelines
  inexpressible. Splitting is safe precisely because no shell is involved: each token becomes one
  literal argv entry. An `executable` containing shell metacharacters
  (`; & | < > $` ( ) { } [ ] ! * ? ~ # " '` or a newline) is rejected before execution — that is
  the ban this action kind actually enforces.
- The runner maps directly to `ProcessExecutor.run({ command: executable, args })`; it never calls
  `/bin/sh -c` and does not accept a `command` option.
- Shell interpreters and `-c`-style execution are rejected. Compound behavior belongs in the named,
  version-controlled project script (`spur-check` above).
- **`softFail` (added, task 0604 / D5-J).** Default `false` — a failed final attempt fails the
  action. With `softFail: true` the gate still writes `FAIL` to `resultFile` but returns success,
  so the transition guards decide the route. Since task 0871 the shipped action schema also
  exposes a per-action `onError: fail | continue`; `continue` records the failure and proceeds,
  so a hard-failing action no longer necessarily aborts the run before a guard can read state —
  but `softFail` remains the gate-specific knob that additionally guarantees the `FAIL` token
  lands in `resultFile` for the guard to read. Every soft probe whose FAIL must reach a `failed`
  state through the graph — the docs precheck, the advisory integration review — routes its
  failure to the guards via one of the two. Hard gates leave both unset.
- Formatting and auto-fix are separate `write` remediation actions. The named gate script is
  observe-only and cannot establish PASS if it changes the proof-input digest.
- `retry.maxAttempts` is a positive bounded integer. Only declared failure classes retry; each
  attempt is persisted separately.
- `resultFile` must resolve beneath `.spur/run/`; absolute paths and parent traversal fail before
  execution. Since task 0785 R2 the confinement is PHYSICAL, not just lexical: the project workdir
  and the run directory are canonicalized with `realPath`, symlink escapes (a link resolving
  outside the canonical `.spur/run` tree) and dangling links are rejected before `ensureDir`,
  dispatch, or any write, and a filesystem without `realPath` support fails closed instead of
  degrading to the lexical check.
- The result token is exactly `PASS` or `FAIL`; raw stdout/stderr is bounded and remains diagnostic.
- A failed final attempt fails the action. Empty, missing, or malformed result data never becomes PASS.

The live `qualityGateCmd` and `gateProbeCmd` shell strings remain baseline facts until the target
action has parity; they are not part of the final contract.

### `run.artifact`

```yaml
- kind: run.artifact
  options:
    path: .spur/run/${vars.wbs}-verdict.json
    artifactKind: verify-verdict
    proofBinding: current
    taskFile: ${vars.taskSpecPath}
    featureFile: ${vars.featureSpecPath}
    requireExisting: true
```

Contract:

- `path` must resolve beneath the project `.spur/run/` directory, with the same physical
  confinement as `command.gate` result files (task 0785 R2): lexical descent first, then
  canonicalization of the workdir and run directory, rejection of symlink escapes and dangling
  links before any read or ledger effect, and fail-closed behavior when `realPath` is unavailable.
- `requireExisting: true` fails when the file is absent or not a regular file.
- `proofBinding: current` (task 0785 R3; previously decorative under 0751 R4) is enforced at the
  write, BEFORE the ledger row exists. The action INDEPENDENTLY re-captures the proof inputs over
  the canonical task spec (`taskFile`, required non-empty for the binding) and the linked feature
  spec (`featureFile`, empty string = legitimately omitted), requires the run's declared digest
  (`proofDigestNow` ?? `proofDigest`) to be well-formed AND equal to that fresh capture, and then
  validates the raw proof block of the verdict artifact — which the canonical parser strips —
  against the freshly captured digest, the certifying run id, and the run row's
  `resumeDefinitionDigest`/`definitionDigest` from `RunDao` (authoritative DB identity, never
  caller vars). `qualityGate` and `verification` stages must be PASS with that digest.
- Review completion is evidenced twice (task 0785 R4): the raw `stages.review.status` must be
  `completed` AND the run-scoped marker `.spur/run/<runId>-review-proof.digest` (written by the
  review stage itself, not caller-stamped) must name the same digest. A skipped or stale review
  never binds; the D9 fast route stays dormant, honestly.
- The task pipeline invokes this registration as the FIRST action of its `record` state — before
  any task record or status mutation — so a refusal aborts before both the ledger write and the
  task lifecycle crossing (task 0785 R3/R5).
- Unbound registration (no `proofBinding`) stays path-only: path + kind + run id, no proof
  evidence demanded and none claimed (ADR-069).
- `ArtifactDao` remains path-only (run id, kind, path). The bounded action result carries the
  compared digest.
- File bodies, stdout, stderr, prompts, and secrets are never copied into the metadata row.
- This action does not define or replace the two-file run-record contract.

Domain mutations such as task status changes and section updates remain owned by existing
application/CLI capabilities. A workflow-local extension is valid only for policy unique to that
workflow; shared deterministic behavior cannot be copied into multiple extension files.

## Verification proof state

The runtime carries a digest-bound proof state:

```text
invalidated
  -- command.gate PASS on D --> quality-passed(D)
  -- review PASS on D -------> reviewed(D)
  -- verify --fix none PASS D -> verified(D)

verified(D) -- confined evidence write tagged D --> verified(D)
any state write|may-write or current digest != D -> invalidated
```

All mutating remediation happens before the final chain. A verification failure may enter one
bounded `--fix all` remediation hop, then returns to the structured quality gate, review, and
`--fix none` verification on a newly captured digest. Completion re-captures the digest before
record/done; a mismatch fails closed.

The task pipeline implements this proof state as of task 0703 (ADR-071 built half): verification
runs `--fix none` with a live digest compare at verify entry, remediation loops once through the
bounded `verify → test-fix` edge (budget shared with the quality gate), `test-recheck` re-captures
the digest, and the verdict artifact's proof block names one digest across quality, review, and
verification. The `verify → record` and `record → done` guards fail closed on missing, malformed,
or mismatched proof evidence. Task 0785 completed the second half: proof inputs are spec-complete
(the linked feature spec folds in beside the task spec, with empty-string compatibility for orphan
tasks), review completion is stamped only from a run-scoped marker written by the review stage
itself and is additionally required by the `verify → record` guard, and the completion boundary
is the bound `run.artifact` registration at `record` entry — a fresh capture agreeing with the
run's declared digest, the raw proof block, the authoritative RunDao identity, and the review
marker, all before any ledger row or task record. Docs-only procedures run the same `--fix none`
measured verification through `task-pipeline` (the retired `docs-pipeline` carried its own digest
bracket, tasks 0704/0769), and the retired composition
baseline's job is done by structural test suites (`composition-baseline.test.ts` and the workflow
action suites) rather than a manifest (task
0775).

## Run-definition binding

The canonical resolved-definition digest is merged into `runs.metadata_json` before the first
action. The merge contract is atomic and preserves all keys not named by the patch, including
`dryRun`, `failureReason`, `staleReason`, and unknown future keys. A replace-style metadata stamp is
invalid. Continue/replay retains the launch digest; a different current digest reports
`definition-drift` and never overwrites history.

Detailed metadata and projection shapes are in
[`workflow-observability.md`](workflow-observability.md#d5-detailed-progress-projection).

## Composition budgets (ADR-115)

[Surface governance](harness-surface-governance.md) §1 owns the measures, tiers and enforcement
posture. This section owns the composition rules those numbers serve.

1. **Deterministic first.** Work that needs no judgment (tests, builds, installs, file and status
   probes, corpus writes) runs as `shell`, `command.gate`, `run.artifact` or another built-in
   action, never inside `agent.run`.
2. **Shell is glue.** A `shell` action calls owned capabilities and routes on their results. A
   program past the warn band moves to an owner from the closed fix vocabulary; above the cap no
   stays-shell exception exists.
3. **Guards are predicates.** A guard reads state and decides; side effects belong in `onEnter`. A
   guard past its cap reads a result file written by a probe action, an `extensions.guards`
   predicate, or one verb's exit status.
4. **`agent.run` invokes a skill or slash command.** The `input` names the operation and its vars;
   the method lives in the skill. Move a long prompt behind a skill or command before it reaches
   the cap.
5. **One model step per judgment.** Merge adjacent `agent.run` steps when they share a role and an
   executor and nothing between them must stay separate: a deterministic gate, a HITL state or an
   independence boundary. Never merge an author step with the review or verify step that
   certifies it; those keep `freshSession: true`. A new model step in a shared workflow raises its
   `pipeline-budgets` `modelQueries`, which needs a recorded decision, and every shared workflow
   with a model query carries a budget entry.
6. **Every step leaves a checked result.** An `agent.run` declares `expectFile` or `requireDiff`,
   and the next deterministic step reads that result fail-closed. Trace keeps each action's
   `durationMs`, invocation and cost, so every step is observable on its own.
7. **Step boundaries follow the cache window, not the clock.** Provider prompt caches expire after
   an idle window and refresh on every hit (Anthropic: 5 minutes by default, 1 hour at extra cost;
   OpenAI: 5–10 minutes in memory, longer with extended retention). A long step that keeps calling
   the model stays warm; an idle gap longer than the window does not. The window W defaults to
   300 s, the shortest common default.
   - A tool call inside `agent.run` that runs longer than W idles the model, so its next request
     re-reads a cold prefix. Run that work in a deterministic step.
   - An `agent.run` that resumes the inherited session after a gap longer than W (a HITL wait or a
     slow deterministic step) rewrites the whole session into the cache. When the prior step's
     artifact carries what the step needs, prefer `freshSession: true` with that artifact as the
     handoff.
   - A deterministic step should finish within W at p50. An `agent.run` with p50 above 2W is a
     split candidate only at a real artifact seam: each split adds a model query and a cold
     prefix, so it must pay for itself in retry granularity or observability.
   - These are runtime budgets, judged by `sp:spur-doctor` from step profiles
     ([spur artifact evolution](spur-artifact-evolution.md) §10), not validate findings.

Evidence (2026-09-10): gaps between consecutive actions are mostly zero, and the long ones follow
HITL states (up to 8.3 hours at idea `design-approval`). Four idea-pipeline `agent.run` steps are
entered from HITL states and resume the inherited session (`feature-create`, `ac-generate`,
`system-design`, `decompose`). Shell steps peak at 63 s; model steps run 53–1418 s.

## Exit and promotion gates

| Boundary | Required exit evidence |
| --- | --- |
| task execution | quality, review, and `--fix none` verify PASS on one current digest; task structural gate PASS |
| docs evolution | doc-evolve contract verification plus repository doc checks |
| wrap-up | required run artifacts recorded and lifecycle checks PASS |
| idea/planning | fixed design-review headings, accepted operator disposition, CLI-gated corpus writes |
| PR review | current integration HEAD captured; pending/unavailable is explicitly advisory unless policy says otherwise |

Pipeline consolidation requires all of: resolved-graph parity, artifact parity, failure-injection
parity, model-query count within the reviewed baseline, proof-state validity, clean exit 0, scaffold
and bundle parity, and explicit operator approval before deleting a live definition.

## Migration sequence

1. Check in the truthful composition baseline and freeze the current pipeline2 promotion path.
2. Add the shared progress, fingerprint, structured gate, artifact, and proof-state capabilities.
3. Migrate wrap-up, then docs, each behind parity and failure-injection gates.
4. Absorb planning into the canonical idea/dev-plan path; remove it only after caller/scaffold/bundle parity.
5. Refactor task-pipeline; redesign residual completeness as read-only or bounded remediation followed by the full proof chain.
6. Merge the safe candidate delta and delete pipeline2 only after the promotion suite and operator approval.
7. Migrate idea last; integrate advisory per-HEAD PR review and run all repository gates.

## Consent boundary

This contract adds no public `spur` noun, verb, flag, JSON field, or human-output contract. Internal
projection use may extend existing application interfaces. Exposing it through `spur workflow`
requires a separate ADR-051 surface decision with operator consent. ADR-115 is that kind of change:
the `level` field, the new `measure.kind` values and the validate exit status on error-level
findings are observable-output changes to `spur workflow validate` and need a consent entry in
[surface governance](harness-surface-governance.md) §4 before they land. An extraction that adds a
public verb or flag needs its own entry.
