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

When `--fix` is set, `--next` acts on the **post-fix** verdict: the fix pass repairs findings, the
skill re-verifies (Step 10's bounded loop), and the **re-verified** verdict drives the transition.
A `--fix all` that turns a FAIL into a PASS therefore reaches `done`; a residual UNMET after the
bounded retry does not.

When the (post-fix) verdict is **PASS**:

1. Transition: `spur task update <wbs> done` — the `testing → done` guard runs
   `spur task check <wbs> --strict-core`. **No `--no-lifecycle`:** the guard is the final
   defense-in-depth check before `done`.
2. Stop — end of the chain (no further command to invoke).

When the verdict is **PARTIAL/FAIL**, or the `testing → done` guard fails: stop as review-pending —
surface the verdict (or the guard's blocking finding), leave the task at its current status, do NOT
transition to `done`.

> **Deferred `feature_id` and strict rigor:** the `--strict-core` done-gate treats a missing
> `feature_id` as a warning (deferral is valid). If the operator opts into `--strict` rigor and
> the `feature_id` error surfaces, use the sp:spur-dev feature-link helper to resolve it — single-task
> mode or batch-sweep. The helper is opt-in only; it NEVER runs automatically from `--next` or any gate.
> See [references/feature-link-helper.md](../skills/spur-dev/references/feature-link-helper.md).

## Implementation

Delegates to **sp:code-verification** skill (verify mode). `$ARGUMENTS` passes all flags including `--agent` through verbatim:

```
Skill(skill="sp:code-verification", args="verify $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:code-verification` skill's verify mode directly.
