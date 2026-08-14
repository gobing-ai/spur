---
template: feature-impl
schema_version: 1
name: "Inventory and repair plugins/sp and workflow YAML drift against the live spur CLI"
description: ""
status: todo
type: task
profile: standard
feature_id: I3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0538"]
ac_numbering: task-local
created_at: "2026-08-13T23:28:17.604Z"
updated_at: "2026-08-14T00:07:32.132Z"
---

## 0539. Inventory and repair plugins/sp and workflow YAML drift against the live spur CLI

### Background
Feature I3's sweep half. `plugins/sp` and `config/workflows/*.yaml` are tightly coupled to a `spur`
CLI surface that has moved underneath them, and nothing mechanically checks that a flag, verb, or
`--json` shape a command asserts still exists.

Two live examples found while charting feature B2 on 2026-08-13, offered as calibration rather than as
the full inventory:

- `plugins/sp/scripts/task-size-precheck.ts` exits `FAIL — could not fetch task <wbs> via spur` when
  no global `spur` resolves. Task 0501 addressed one `execFileSync` multi-token `spurBin` case; the
  resolution path is still fragile in a monorepo checkout.
- Tier facts restated in plugin prose that duplicate `packages/domain/src/stage-registry/schema.ts`
  — being removed by task 0538, and the reason this task is sequenced after it.

Run after B2's role migration lands. An inventory taken before it would catalogue drift that 0538 is
about to delete, and would miss the drift the role model exposes — notably every place a command or
workflow still assumes `--agent` takes an executor name.

`I2` (spur-dev/spur-cli parity-first drift audit and harness refinement, done) is the previous pass of
this sweep. Read its findings and method before re-deriving one.
### Requirements
- [ ] **R1.** Produce a reproducible inventory of every `spur` flag, verb, and `--json` shape that
      `plugins/sp` asserts (commands, skills, references, scripts, hooks), checked against the live
      CLI surface. Record each mismatch with file, line, asserted form, and actual form; record an
      assertion that cannot be checked mechanically as **unverified**, never as passing. Run after
      task 0538 so the inventory reflects the post-migration tree. Measurable: the inventory names
      its check method per entry and is re-runnable.
- [ ] **R2.** Extend the same inventory to `config/workflows/*.yaml` — step kinds, action inputs,
      and vars contracts against the live engine — and confirm `.spur/workflows` resolves to the
      tracked `config/workflows` tree. Measurable: all ten workflow definitions are covered, each
      divergence names the workflow and step, and the symlink target is stated.
- [ ] **R3.** Every confirmed mismatch ends the task either fixed or carrying the WBS of the task
      that owns it. Repairs correct the plugin or the workflow; changing a CLI noun or verb is out
      of scope under ADR-051 and is filed for operator consent instead. Measurable: no confirmed
      inventory entry is left in neither state.
### Acceptance Criteria
Covers feature I3 scenarios:

- **R1 — Plugin assertions are inventoried against the live CLI**
- **R2 — Workflow YAML is inventoried against the live engine**
- **R3 — Confirmed drift is repaired or filed, never left recorded-and-ignored**

```gherkin
Scenario: R1 — Plugin assertions are inventoried against the live CLI
  Given plugins/sp asserts spur flags, verbs, and --json shapes across commands, skills, and scripts
  When each assertion is checked against the installed CLI surface
  Then every mismatch is recorded with the file, the line, the asserted form, and the actual form
  And an assertion that cannot be checked mechanically is recorded as unverified rather than as passing

Scenario: R2 — Workflow YAML is inventoried against the live engine
  Given config/workflows carries ten workflow definitions
  When each step kind, action input, and vars contract is checked against the engine
  Then every mismatch is recorded with the workflow, the step, and the divergence
  And the .spur/workflows symlink is confirmed to resolve to the tracked config/workflows tree

Scenario: R3 — Confirmed drift is repaired or filed, never left recorded-and-ignored
  Given the inventory lists confirmed mismatches
  When the sweep completes
  Then each entry is either fixed in this feature or carries the WBS of the task that owns it
  And no confirmed entry ends the feature in neither state
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Run after 0538.** An inventory taken before the intention migration would catalogue drift that 0538
is about to delete, and would miss the drift 0538 exposes.

**Mechanical first, prose second.** Check what can be checked by execution — `spur <noun> --help`
output, `--json` envelope shapes, workflow schema validation — before reading prose for claims. An
assertion no mechanical check can reach is recorded **unverified**, never as passing (R1). A sweep
that silently upgrades "I could not check this" to "this is fine" is worse than no sweep.

**Surfaces to cover:**

| Tree | What is asserted | How to check |
| --- | --- | --- |
| `plugins/sp/commands/` | flags, verbs, invocation shapes | against `spur <noun> --help` |
| `plugins/sp/skills/*/references/` | `--json` shapes, exit codes, conventions | against live `--json` output |
| `plugins/sp/scripts/` | CLI resolution, argument construction | execute them |
| `plugins/sp/hooks/` | event names, matcher shapes | against the hook contract |
| `config/workflows/*.yaml` | step kinds, action inputs, vars | `spur workflow validate` + dry-run |

**Repair boundary (R3).** Fix the plugin or the workflow. A mismatch whose correct fix is a CLI change
is filed for operator consent under ADR-051, never landed here — this task reconciles the consumers
against the surface, it does not move the surface.

**The inventory is an artifact, not a message.** Write it to a file the follow-up can cite, the way
0347 produced `docs/tasks2/0347-inventory.md`.
### Plan
- [ ] Confirm task 0538 is done before starting; re-read I2's findings and method (R1)
- [ ] Enumerate every `spur` flag/verb/`--json` assertion across commands, skills, references, scripts, hooks (R1)
- [ ] Check each mechanically where possible; mark the rest unverified with the reason (R1)
- [ ] Validate and dry-run all ten `config/workflows/*.yaml`; confirm the `.spur/workflows` symlink target (R2)
- [ ] Write the inventory to a citeable artifact file with the check method per entry (R1, R2)
- [ ] Fix confirmed plugin/workflow drift; file CLI-surface changes for operator consent instead (R3)
- [ ] File a task for any confirmed entry too large to fix here and record its WBS in the inventory (R3)
- [ ] Run `bun run autofix && bun run spur-check`
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- **Prior pass to read first:** feature `I2` and its tasks — method and findings
- **Inventory artifact precedent:** `docs/tasks2/0347-inventory.md` (task 0347's citeable inventory)
- **Trees to sweep:** `plugins/sp/commands/`, `plugins/sp/skills/*/references/`, `plugins/sp/scripts/`,
  `plugins/sp/hooks/`, `config/workflows/` (10 definitions)
- **Known-drift seed:** `plugins/sp/scripts/task-size-precheck.ts` (spurBin resolution; task 0501
  fixed one case), `.spur/workflows` → `config/workflows` symlink model (`docs/04_DESIGN.md` §2.3)
- **Surface of record:** `docs/04_DESIGN.md`, `plugins/sp/skills/spur-cli/references/*.md`
- **Consent boundary:** ADR-051 — a mismatch whose correct fix is a CLI change is filed, not landed
- **Upstream dependency:** task 0538 (role migration) must be `done` first
### History
