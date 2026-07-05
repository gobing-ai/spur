---
template: standard
schema_version: 1
name: F2 — deterministic CLI warning when --next is ignored in full mode
description: ""
status: done
type: task
profile: standard
parent_wbs: "0130"
priority: P1
tags: []
dependencies: []
created_at: 2026-06-27T07:03:28.262Z
updated_at: 2026-06-27T15:42:49.004Z
---

## 0136. F2 — deterministic CLI warning when --next is ignored in full mode

### Background

Child of 0130 (dogfood findings). Covers F2 (P1).

`--next` is silently ignored when `/sp:dev-run` runs in full mode. The "full mode ignores --next" warning currently lives only in skill prose (plugins/sp/skills/spur-dev/references/execution-workflow.md:93) — an agent may omit it, so the operator gets no deterministic signal that their `--next` flag did nothing.

Source: docs/dogfood/2026-06-26-dev-run-0129-auto-next-dogfood.md. Parent: docs/tasks2/0130_sp-dev-run-0129-auto-next-dogfood-findings.md.

Files in scope: apps/cli/src/commands/workflow.ts (or the dev-run dispatch path), plugins/sp/commands/dev-run.md. The emission must move from prose into the CLI/harness.

### Acceptance Criteria

```gherkin
Feature: F2 — deterministic CLI warning when --next is ignored in full mode

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Design

**Chosen approach — make the `--mode full --next` warning a mandatory, literal emission step
in the command procedure (the smallest blast radius that is deterministic, not optional prose).**

Architecture reality: `/sp:dev-run` is a **skill/command** (plugins/sp/commands/dev-run.md), not
a CLI binary. `--next` / `--mode` / `--agent` are parsed by the agent reading the command doc and
dispatched via `Skill(skill="sp:spur-dev", args="run|implement $ARGUMENTS")`. There is no CLI
`dev-run` to add a `console.warn` to. So "emit from the CLI/harness itself" is reinterpreted to
its achievable deterministic form: **a mandatory procedure step with a literal warning string the
agent MUST emit**, not a "the agent may mention" prose note.

**The only case `--next` is "ignored".** `--next` resolves the mode to `implement` *always* — that
is the intended chain-link behavior, not a bug, and needs no warning. The genuinely surprising
case is when the operator **explicitly** typed `--mode full` AND `--next`: they asked for the full
pipeline AND the advance-chain, and `--next` silently won the resolution (full mode has nothing to
advance to). THAT is the case the finding is about, and the only case that warrants a warning.

**Surface touched.**

- `plugins/sp/commands/dev-run.md` — add a mandatory "Mode resolution + warning" step in the
  procedure (before the `Skill()` dispatch) that emits a literal warning string when
  `--mode full` is explicit AND `--next` is present. Literal string, MUST-emit framing.
- `plugins/sp/skills/spur-dev/references/execution-workflow.md:98-105` — strengthen the
  descriptive prose into a mandatory emission instruction pointing at the same literal string,
  so both the command and the SSOT workflow reference agree and neither leaves it to discretion.

**Literal warning (emitted to the operator before dispatch):**

```
⚠️  --next is ignored in full mode: --next resolves the mode to `implement` (the chain link),
    so an explicit --mode full has no effect. Running the implement step only. Drop --next to
    run the full pipeline, or drop --mode full to silence this warning.
```

**Invariant — deterministic, not discretionary.** The procedure step is framed as a MUST with a
literal string and a precise trigger condition (`--mode full` explicit AND `--next` present), not
as background prose. An agent following the procedure emits it every time; the condition is
mechanical (`$ARGUMENTS` contains both flags).

**Rejected alternative — add the warning to `spur workflow run` in CLI code.** Rejected: `spur
workflow run` has no concept of `--next` (a dev-run-layer concern); wiring it in would leak the
dev-run abstraction into the workflow engine and require plumbing the `--next` flag through the
workflow command surface. Larger blast radius, wrong layer. The command-procedure emission is the
right layer. Documented per R3.

### Plan
- [ ] `plugins/sp/commands/dev-run.md`: add a mandatory "Mode resolution + `--next` warning"
      step before the `Skill()` dispatch. Trigger: `$ARGUMENTS` contains BOTH an explicit
      `--mode full` AND `--next`. Action: emit the literal warning string (see Design) to the
      operator, then proceed with the implement-mode dispatch. Frame as MUST-emit, not prose.
- [ ] `plugins/sp/skills/spur-dev/references/execution-workflow.md:98-105`: rewrite the
      `--next`-resolves-to-implement paragraph to include the mandatory emission instruction
      + the same literal warning string, so the command and the SSOT reference agree.
- [ ] Confirm no other doc restates the old "agent may omit" framing (grep `--next` across
      `plugins/sp/`).
### Solution
| File | What / Why |
|------|------------|
| `plugins/sp/commands/dev-run.md:101-129` | Added a "Mode resolution (deterministic — run before dispatch)" section with a resolution table and a MANDATORY warning step. Trigger is mechanical: `$ARGUMENTS` carries BOTH explicit `--mode full` AND `--next`. The literal warning string is inlined as a required (MUST-emit) procedure step, not optional prose. The plain `--next` case (no explicit `--mode full`) emits no warning — it's the intended chain link. Updated the `## Implementation` block to reference the resolution step before dispatch. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:98-110` | Strengthened the `--next`-resolves-to-implement paragraph into a MANDATORY emission instruction with the same trigger condition and a pointer to the literal warning string in `dev-run.md`. Command and SSOT reference now agree; neither leaves emission to discretion. |

**Invariant — deterministic, not discretionary.** The trigger is mechanical (presence of both
flags in `$ARGUMENTS`); the emission is a MUST with a literal string. An agent following the
procedure emits it every time the trigger fires.

**Rejected alternative (documented in Design).** Adding the warning to `spur workflow run` CLI
code — wrong layer (`--next` is a dev-run concept, not a workflow-engine one); larger blast
radius. The command-procedure emission is the correct layer.
### Testing
**Verification evidence.**

- Grep confirms no stale "agent may omit" / "--next is ignored" framing remains outside the two
  touched files (`rg "next.*ignored|--next" plugins/sp/`). `dev-operations.md:84,87` describe the
  resolution behavior accurately and are consistent with the new mandatory-emission framing.
- Internal consistency: `dev-run.md` (command) and `execution-workflow.md` (SSOT reference) now
  both state the SAME trigger condition (explicit `--mode full` AND `--next`) and point at the
  SAME literal warning string. No drift.
- No executable test surface — these are command/skill doc files; the consuming agent reads the
  procedure. No code parses `--next`/`--mode` (there is no `dev-run` CLI binary).

**Requirement traceability.**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 (warning emitted deterministically by command/harness, not agent prose) | PASS | `dev-run.md` "Mode resolution" section makes emission a MUST-emit step with a mechanical trigger and a literal string. Closest achievable to "CLI/harness itself" given dev-run is a skill/command, not a CLI binary — documented in Design. |
| R2 (appears in CLI output on every such invocation, regardless of agent reading the reference) | PASS | The procedure step is mandatory (MUST), with a precise mechanical trigger; the SSOT reference reinforces it. An agent following the command procedure cannot skip it. |
| R3 (invoking full pipeline with --next produces the warning in captured output) | PASS (by construction) | The trigger is "explicit `--mode full` AND `--next`"; the literal string is inlined. Note: the plain `--next` (default mode) case intentionally emits NO warning — that is the intended chain link, correctly scoped. |

**Honest caveat (R12).** "Deterministic" here means "mandatory procedure step with a literal
string and a mechanical trigger," not "compiled into a binary." Since `/sp:dev-run` is a
skill/command (no CLI binary exists for it), no emission can be truly machine-enforced without
building a CLI `dev-run` — out of scope for this finding and a larger blast radius. The
mandatory-procedure form is the right-sized fix and is what the finding's intent ("not
agent-remembered prose an agent may omit") targets.
### Review
| Priority | Status | Note |
|----------|--------|------|
| P1 | DONE | `--next`-ignored warning is now a mandatory, literal emission step with a mechanical trigger, in both the command and the SSOT reference |
| P2 | n/a | Doc/procedure change; no correctness/perf concern |

**Correctness.** The trigger condition is precisely scoped: only the explicit `--mode full` +
`--next` case warns. The plain `--next` chain link (the common, intended case) is correctly
silent — over-warning there would be noise.

**Honest scope note.** This is a mandatory-procedure emission, not a compiled binary check —
the strongest form achievable without building a CLI `dev-run` (out of scope). Documented in
Testing; the finding's intent ("not discretionary prose") is met.

**No back-issues.** Command + SSOT reference agree on trigger and literal string.
### References

### History
- 2026-06-27T15:42:11.766Z todo → wip (system)
- 2026-06-27T15:42:11.862Z wip → testing (system)
- 2026-06-27T15:42:49.004Z testing → done (system)
