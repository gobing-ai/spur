---
description: Verify a task against its requirements and Acceptance Criteria — traceability check producing a PASS/PARTIAL/FAIL verdict with evidence
argument-hint: "<wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Verify

Wraps the **sp:code-verification** skill (verify mode).

Verify that a task's implementation satisfies its requirements and acceptance criteria. Maps each
requirement and each Acceptance Criteria item to evidence, runs a SECUA code review, and produces a
**PASS / PARTIAL / FAIL** verdict. Findings are written back to the task's `## Testing` and
`## Review` sections, and the verdict artifact (`.spur/run/<wbs>-verdict.json`) is emitted for the
pipeline completion gate.

## When to use

- The pipeline's verify phase needs to certify a task before `done`.
- Re-auditing a completed task (`--force` bypasses the terminal-status guard).
- The operator says "verify this" or "check the requirements."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--agent <name\|auto>` | Spawn the verification under a specific agent. *Pipeline surface* (invoked from `task-pipeline.yaml`'s `verify` step, already an `agent.run` subprocess): omit (the default) → the spawned step uses the configured default executor (`omp`); current-agent execution is not expressible there. *Standalone inline surface* (`/sp:dev-verify <wbs>` run directly): the Implementation below delegates via inline `Skill()`, which runs in the **current session** — omitting `--agent` here spawns nothing. | (pipeline: `omp`; standalone: current session) |
| `--fix <strategy>` | Post-verdict repair: `none`, `blockers-first` (UNMET only), `all` (UNMET + PARTIAL + major findings) | `none` |
| `--focus <lens>` | SECUA dimensions: `all`, `security`, `efficiency`, `correctness`, `usability`, `architecture`, or comma-separated | `all` |
| `--bdd` | Strict BDD lens: require Gherkin scenarios in `## Acceptance Criteria` to map to executable or explicitly missing test evidence. AC checking itself is automatic when AC exists. | off |
| `--auto` | Skip confirmations (CI / pipeline use) | off |
| `--force` | Bypass the terminal-status guard — verify even a `done`/`cancelled` task | off |
| `--next` | Terminal chain link. On the (post-`--fix`) PASS verdict, transition `testing → done` through the FSM (`--strict-core` guard honored). On PARTIAL/FAIL or guard failure, stop as review-pending. | off |

## Behavior

Thin wrapper: status guard, change-scope detection, requirements traceability, automatic Acceptance
Criteria guard, SECUA/quality review, verdict aggregation, findings write-back, verdict-artifact
emission, and the optional `--fix` pass are all owned by the skill.

### Acceptance Criteria guard

If the task contains a non-empty `## Acceptance Criteria` or `### Acceptance Criteria` section, the
verify pass must evaluate it even when `--bdd` is omitted. The guard accepts checklist and Gherkin
forms:

- checklist items become AC rows with `MET` / `PARTIAL` / `UNMET` / `N/A` status and evidence;
- Gherkin scenarios become AC rows keyed by scenario title;
- `--bdd` tightens Gherkin handling by requiring each scenario to map to executable test evidence
  or an explicitly reported missing-test condition.

LLM-as-judge review can surface qualitative findings, but it cannot alone certify objective AC.
Objective AC needs deterministic evidence (`test`, `command`), static evidence (`static-ref`), or an
explicit justified `N/A`.

### Agent override

`--agent` behaves differently depending on which surface invokes `/sp:dev-verify` — the two-surface
contract in [cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"
classifies `dev-verify` as pipeline-surface, but that classification describes the *pipeline* path
only; the standalone invocation is inline. Both are documented here so neither is misread as the
other's default:

- **Pipeline path** (`task-pipeline.yaml`'s `verify` state runs `agent.run` with
  `input: /sp:dev-verify ${vars.wbs} --auto --fix all`): the whole step is already a spawned
  subprocess. The calling agent cannot block on itself, so "current agent" is **not expressible**
  here. Omit `--agent` → the configured default executor (`omp`) runs the step. An explicit
  `--agent <name>` (via `vars.agent`) spawns that agent instead.
- **Standalone path** (`/sp:dev-verify <wbs>` invoked directly, not via the pipeline): the
  Implementation below delegates with an inline `Skill(skill="sp:code-verification", ...)` call,
  which runs in the **current session** — omitting `--agent` spawns nothing. An explicit
  `--agent <name>` or `--agent auto` on this path spawns that agent via `spur agent run` instead of
  running inline (mirroring the inline-surface contract `dev-refine`/`dev-plan` already use).

## `--next` chain — the terminal link

`--next` makes verify the last step in the `refine → run → verify → done` chain.

> **Precondition — `/sp:dev-review` must have run first** on a standalone
> `--next` invocation. Verify mode is forbidden from writing `## Review` (code-
> verification SKILL.md Step 10), yet the done-gate's Review L3 layer (see
> below) requires a populated P1–P4 `### Review` table. So a standalone
> `/sp:dev-verify --next` on a task that skipped `/sp:dev-review` cannot reach
> `done` unaided — the stop message will name the missing Review. The Step 10
> write prohibition stays intact; the contract tension is real and intentional.
> Pipeline-driven runs satisfy this automatically (the pipeline's `review`
> state runs `/sp:dev-review` before `verify`).

When `--fix` is set, `--next` acts on the **post-fix** verdict: the fix pass repairs findings, the
skill re-verifies (Step 10's bounded loop), and the **re-verified** verdict drives the transition.
A `--fix all` that turns a FAIL into a PASS therefore reaches `done`; a residual UNMET after the
bounded retry does not.

When the (post-fix) verdict is **PASS**:

1. Transition: `spur task update <wbs> done`. The `testing → done` transition runs **three** gate
   layers in the order below; a failure at any layer stops the transition with that layer's
   remediation. **No `--no-lifecycle`:** these guards are the final defense-in-depth check before
   `done`.
2. Stop — end of the chain (no further command to invoke).

### The three `testing → done` gate layers

The CLI verdict-artifact check runs first. The lifecycle adapter then checks provenance, Review L3,
and finally the workflow's strict-core shell guard. The table groups the two complementary
strict-core/verdict checks as one defense-in-depth layer even though they bracket the adapter checks.
The first denial wins; each denial names its own remediation. In verify-0293, the artifact check
passed, so provenance denied first and Review L3 denied on the retry.

| # | Gate layer | Triggers denial when | Remediation |
|---|------------|----------------------|-------------|
| 1 | **Strict-core + verdict artifact** (`spur task check <wbs> --strict-core` + `done-transition-guard.ts`) | The strict-core check fails, or `.spur/run/<wbs>-verdict.json` is missing or has a non-PASS aggregate. The aggregate is recomputed from requirement/AC rows; the harsher of stored and computed wins. | Re-run `/sp:dev-verify <wbs>` until PASS, or explicitly override with `spur task update <wbs> done --force-done --reason "<why>"`. |
| 2 | **Provenance guard** (`lifecycle-adapter.ts`) | No pipeline-kind run link exists for `<wbs>`. | Run `/sp:dev-run <wbs>` through the pipeline, use `/sp:dev-run <wbs> --auto --next`, or record the audited bypass with `SPUR_PROVENANCE_OVERRIDE=1`. |
| 3 | **Review L3** (`task-check.ts`) | `### Review` is empty, placeholder-only, or lacks a populated P1–P4 findings table. | Run `/sp:dev-review <wbs>`; verify cannot write Review because of the Step 10 prohibition above. |

When the verdict is **PARTIAL/FAIL**, or any gate layer fails: stop as review-pending — surface
the verdict (or the gate's blocking finding), leave the task at its current status, do NOT
transition to `done`.

> **Already-terminal task (`--force` re-audit):** when the task is already `done`/`cancelled`, a
> PASS verdict has no transition to make — `--next` is a no-op. The CLI prints the honest message
> `<wbs>: already <status> — no transition` (task 0292 R9) and exits 0. Do not expect a
> `testing → done` transition line.

> **Deferred `feature_id` and strict rigor:** the `--strict-core` done-gate treats a missing
> `feature_id` as a warning (deferral is valid). If the operator opts into `--strict` rigor and
> the `feature_id` error surfaces, use the sp:spur-dev feature-link helper to resolve it — single-task
> mode or batch-sweep. The helper is opt-in only; it NEVER runs automatically from `--next` or any gate.
> See [references/feature-link-helper.md](../skills/spur-dev/references/feature-link-helper.md).

> **Answer-file shape (R3).** The verify step's structured output (`.spur/run/<wbs>-verify-answer.txt`)
> is parsed by `spur task verdict` to derive the artifact. Free-form prose with no markdown
> requirement/AC tables parses to `verdict: "UNKNOWN"` and will deny the done-gate. The expected
> table format (`| Req | Status | Evidence |` and `| AC | Status | Evidence Type | Evidence |`)
> is documented in [sp:spur-cli `tasks/verbs.md` §Answer-file shape](../skills/spur-cli/references/tasks/verbs.md#answer-file-shape-what---from-answer-parses).
> The verify skill writes this shape automatically — operators only need it when hand-authoring
> an answer file or debugging an UNKNOWN verdict.

## Implementation

Delegates to **sp:code-verification** skill (verify mode). `$ARGUMENTS` passes all flags including `--agent` through verbatim:

```
Skill(skill="sp:code-verification", args="verify $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:code-verification` skill's verify mode directly.
