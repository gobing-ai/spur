# Workflow composition contract

**Area:** workflow definition composition, deterministic action ownership, pipeline promotion, and run artifacts.
**Status:** proposed; operator taste gate pending (D5, ADR-069/071/072).
**Authority:** derived; decisions live in `00_ADR`, module boundaries in `03_ARCHITECTURE`.

## Target workflow inventory

| Workflow | Lifecycle boundary | Proposed disposition |
|---|---|---|
| `task-pipeline.yaml` | one task from precheck through recorded completion | canonical; absorb only a proof-preserving pipeline2 delta |
| `task-pipeline2.yaml` | experimental task execution | temporary candidate; freeze current promotion, redesign, merge after parity, then delete |
| `planning-pipeline.yaml` | feature planning front half | absorb into the canonical idea/dev-plan path, then delete after caller parity |
| `idea-pipeline.yaml` | idea discovery, design review, and decomposition | keep separate; migrate last |
| `docs-pipeline.yaml` | numbered-document evolution | keep separate |
| `wrapup-pipeline.yaml` | completed-task wrap-up | keep separate |
| `pr-review.yaml` | integration-HEAD review | keep separate; invoke once per stable HEAD after local gates |

`feature-dev.yaml` remains a caller/orchestrator, not a second owner of any lifecycle above. Other
workflow definitions remain regression fixtures or examples unless a later ADR changes their status.

## Composition baseline

The proposed checked manifest is `config/workflow-composition-baseline.json`. It records resolved
facts, not executable behavior. The first baseline must describe the live definitions truthfully:

```json
{
    "schemaVersion": 1,
    "proofInputs": {
        "repository": {
            "excludeConfiguredCorpusFolders": true
        },
        "taskFields": ["wbs", "name", "feature_id", "depends_on"],
        "taskSections": ["Background", "Requirements", "Acceptance Criteria", "Design", "Plan"],
        "featureFields": ["id", "name"],
        "featureSections": ["Goal", "Scope", "Acceptance Criteria"]
    },
    "workflows": {
        "task-pipeline": {
            "definition": "config/workflows/task-pipeline.yaml",
            "boundary": "task-execution",
            "callers": ["sp:spur-dev", "sp:super-planner"],
            "terminalStates": ["done", "failed", "cancelled"],
            "artifacts": ["verify-answer", "verify-verdict", "testing-section", "review-section"],
            "failurePolicy": "fail-closed",
            "modelQueries": ["implement", "test-fix", "review", "verify"],
            "actions": {
                "test:onEnter:0": {
                    "kind": "shell",
                    "stateEffect": "write",
                    "evidenceEffect": "write"
                },
                "verify:onEnter:0": {
                    "kind": "agent.run",
                    "invocation": "/sp:dev-verify ${vars.wbs} --auto --fix all --focus all",
                    "stateEffect": "may-write",
                    "evidenceEffect": "write"
                },
                "verify:onEnter:1": {
                    "kind": "shell",
                    "invocation": "spur task verdict --from-answer",
                    "stateEffect": "read",
                    "evidenceEffect": "write"
                }
            }
        },
        "task-pipeline2": {
            "definition": "config/workflows/task-pipeline2.yaml",
            "actions": {
                "residual-sweep:onEnter:0": {
                    "kind": "agent.run",
                    "stateEffect": "may-write",
                    "evidenceEffect": "none"
                }
            }
        }
    }
}
```

The checker compares the resolved definition, not YAML text. A changed graph, caller, terminal,
artifact owner, failure policy, model-query location, action kind, or effect classification fails
with a field-level diff until the baseline and design are deliberately updated together.

## Stable action identity and effects

A definition action has the stable key:

```text
<state>:<onEnter|onExit>:<zero-based ordinal>
```

The key is derived after extensions resolve and is independent of a persisted attempt UUID. Each
action declares two independent effects:

| Field | Value | Contract |
|---|---|---|
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
  per-run vars cannot provide executable content.
- The runner maps directly to `ProcessExecutor.run({ command: executable, args })`; it never calls
  `/bin/sh -c` and does not accept a `command` option.
- Shell interpreters and `-c`-style execution are rejected. Compound behavior belongs in the named,
  version-controlled project script (`spur-check` above).
- Formatting and auto-fix are separate `write` remediation actions. The named gate script is
  observe-only and cannot establish PASS if it changes the proof-input digest.
- `retry.maxAttempts` is a positive bounded integer. Only declared failure classes retry; each
  attempt is persisted separately.
- `resultFile` must resolve beneath `.spur/run/`; absolute paths and parent traversal fail before execution.
- The result token is exactly `PASS` or `FAIL`; raw stdout/stderr is bounded and remains diagnostic.
- A failed final attempt fails the action. Empty, missing, or malformed result data never becomes PASS.

The live `qualityGateCmd` and `gateProbeCmd` shell strings remain baseline facts until the target
action has parity; they are not part of the proposed target contract.

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

The current task pipeline cannot claim this proof state because its verification action uses
`--fix all`. Pipeline2 additionally runs an editing-capable residual sweep after the verdict. Both
are `may-write`; neither existing graph is eligible for promotion under this proposed contract.

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
|---|---|
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

This proposal adds no public `spur` noun, verb, flag, JSON field, or human-output contract. Internal
projection use may extend existing application interfaces. Exposing it through `spur workflow`
requires a separate ADR-051 surface decision with operator consent.
