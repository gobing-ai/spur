# Workflow composition contract

**Area:** workflow definition composition, deterministic action ownership, pipeline promotion, and run artifacts.
**Status:** composition/projection infrastructure built; proof-finality completion pending (ADR-071; tasks 0703/0704).
**Authority:** derived; decisions live in `00_ADR`, module boundaries in `03_ARCHITECTURE`.

## Target workflow inventory

| Workflow | Lifecycle boundary | Disposition |
| --- | --- | --- |
| `task-pipeline.yaml` | one task from precheck through recorded completion | canonical; absorb only a proof-preserving pipeline2 delta |
| ~~`task-pipeline2.yaml`~~ | *(deleted 2026-08-20)* | **removed under ADR-076** — unreferenced duplicate declaring a 5th model query against the canonical pipeline's 4; deleted rather than promoted |
| `planning-pipeline.yaml` | feature planning front half | absorb into the canonical idea/dev-plan path, then delete after caller parity |
| `idea-pipeline.yaml` | idea discovery, design review, and decomposition | keep separate; migrate last |
| `docs-pipeline.yaml` | numbered-document evolution | keep separate |
| `wrapup-pipeline.yaml` | completed-task wrap-up | keep separate |
| `pr-review.yaml` | integration-HEAD review | keep separate; invoke once per stable HEAD after local gates |

`feature-dev.yaml` remains a caller/orchestrator, not a second owner of any lifecycle above. Other
workflow definitions remain regression fixtures or examples unless a later ADR changes their status.

### Migration status (task 0604)

| Wave | Scope | Status |
| --- | --- | --- |
| D5-I | wrap-up metrics off the model hop | landed |
| D5-J | docs precheck onto soft `command.gate` | landed |
| D5-K | planning callers absorbed into idea/dev-plan | landed; `planning-pipeline.yaml` retained until ADR-072 is accepted |
| D5-L | `task-pipeline.yaml` onto the shared primitives | partial — `run.artifact` owns the verdict; `qualityGateCmd` stays a documented per-project **shell** string. The precheck doctor probe **landed** on the `doctor.probe` built-in action kind (task 0608, feature D6 — the D6 ownership-surface decision); the D5-L wave itself shipped under the constraint that `command.gate` cannot express either program's semantics without a new public CLI surface (ADR-051) |
| D5-M | pipeline2 residual made read-only | landed — the sweep is bracketed by a tree snapshot and any post-PASS mutation routes to `failed`, never `record` (ADR-071) |
| D5-N | ~~eval-pipeline promotion bar~~ | **retired (ADR-076, 2026-08-20)** — the bar is no longer a gate; `task-pipeline2.yaml` was deleted rather than promoted. `eval-pipeline` remains a measurement tool only |
| D5-O | idea handoff onto `finalizeIdeaHandoff` | landed as monorepo writer + portable shell fallback |
| D5-P | advisory integration review at the feature boundary | landed in `feature-dev.yaml` |

**Known baseline gap (carried forward by design).** The composition advisory is heuristic — it
measures shell length and slash-invocation shape only, so a semantic rewrite of a shell body can
still go undetected. Task 0775 retired the manifest that was proposed to close this; the residual
risk is accepted and documented here.

## Composition facts (post-0775)

Task 0775 retired `config/workflow-composition-baseline.json` and the two-sided snapshot check.
Resolved composition facts (`terminalStates`, `modelQueries`, per-action `kind`/`invocation`) are
extracted from the live definitions by `extractResolvedWorkflowFacts`
(`packages/app/src/workflow/composition-baseline.ts`) and guarded by unit tests
(`composition-baseline.test.ts`, `task-pipeline-proof-chain.test.ts`). The checker-era guarantee —
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
  so the transition guards decide the route. This is required, not a convenience: the shipped
  action schema pins `additionalProperties: false` at the action level and exposes no `onError`,
  so a hard-failing gate aborts the run before any guard can read the result file. Every soft
  probe whose FAIL must reach a `failed` state through the graph — the docs precheck, the
  advisory integration review — sets it. Hard gates leave it unset.
- Formatting and auto-fix are separate `write` remediation actions. The named gate script is
  observe-only and cannot establish PASS if it changes the proof-input digest.
- `retry.maxAttempts` is a positive bounded integer. Only declared failure classes retry; each
  attempt is persisted separately.
- `resultFile` must resolve beneath `.spur/run/`; absolute paths and parent traversal fail before execution.
- The result token is exactly `PASS` or `FAIL`; raw stdout/stderr is bounded and remains diagnostic.
- A failed final attempt fails the action. Empty, missing, or malformed result data never becomes PASS.

The live `qualityGateCmd` and `gateProbeCmd` shell strings remain baseline facts until the target
action has parity; they are not part of the final contract.

### `run.artifact`

```yaml
- kind: run.artifact
  options:
    id: verify-verdict
    path: .spur/run/${vars.__runId}-verdict.json
    artifactKind: verify-verdict
    proofBinding: current
    requireExisting: true
```

Contract:

- `path` must resolve beneath the project `.spur/run/` directory.
- `requireExisting: true` fails when the file is absent or not a regular file.
- `proofBinding: current` resolves from the run's internal proof state; workflow vars cannot supply it.
- The structured evidence file must carry the same `proofInputDigest`; the action compares it before recording.
- `ArtifactDao` remains path-only (run id, kind, path). The bounded action result carries the compared digest.
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
or mismatched proof evidence. The docs pipeline still runs `--fix all` with a synthetic PASS and
cannot claim the proof state until task 0704 lands; the composition baseline pins the task
pipeline's `--fix none` invocation so a regression fails deterministically (R7).

## Run-definition binding

The canonical resolved-definition digest is merged into `runs.metadata_json` before the first
action. The merge contract is atomic and preserves all keys not named by the patch, including
`dryRun`, `failureReason`, `staleReason`, and unknown future keys. A replace-style metadata stamp is
invalid. Continue/replay retains the launch digest; a different current digest reports
`definition-drift` and never overwrites history.

Detailed metadata and projection shapes are in
[`workflow-observability.md`](workflow-observability.md#d5-detailed-progress-projection).

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
requires a separate ADR-051 surface decision with operator consent.
