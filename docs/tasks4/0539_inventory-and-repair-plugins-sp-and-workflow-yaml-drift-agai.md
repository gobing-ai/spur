---
template: feature-impl
schema_version: 1
name: "Inventory and repair plugins/sp and workflow YAML drift against the live spur CLI"
description: ""
status: done
type: task
profile: standard
feature_id: I3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0538"]
ac_numbering: task-local
created_at: "2026-08-13T23:28:17.604Z"
updated_at: "2026-08-15T07:13:55.294Z"
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
- [x] Confirm task 0538 is done before starting; re-read I2's findings and method (R1)
- [x] Enumerate every `spur` flag/verb/`--json` assertion across commands, skills, references, scripts, hooks (R1)
- [x] Check each mechanically where possible; mark the rest unverified with the reason (R1)
- [x] Validate and dry-run all ten workflow YAMLs via `.spur/workflows`; confirm the symlink target (R2)
- [x] Write the inventory to a citeable artifact file with the check method per entry (R1, R2)
- [x] Fix confirmed plugin/workflow drift; file CLI-surface changes for operator consent instead (R3)
- [x] File a task for any confirmed entry too large to fix here and record its WBS in the inventory (R3)
- [x] Run `bun run autofix && bun run spur-check`
### Solution
Implemented by sp-super-coder subagent (inline pipeline, run 22CB59EB-3226-4E60-8CCB-261509EE7876); Solution section appended by host after subagent timeout at final bookkeeping step.

- **R1 inventory script (re-runnable):** `plugins/sp/scripts/surface-drift-inventory.ts`. Methods: help-capture (live Commander help diff), json-exec (read-only `--json` envelope recording; mutating commands stay unverified), script-exec (fake-bin execution), file-resolution/json-parse, host-contract (recorded unverified, never passed). CLI provenance pinned to source-local entry @ 0.3.47.
- **R1 inventory report:** `docs/tasks2/0539-inventory.md` — totals **278 ok · 0 mismatch · 8 unverified**, every entry names its check method. R1 scope: `plugins/sp/{commands,skills,scripts,hooks}`; R2 scope: all `config/workflows/*.yaml` + `.spur/workflows` symlink.
- **R2 repairs from confirmed drift:**
  - `plugins/sp/skills/parallel-execution/references/dispatch-surface.md:116` — prose asserted a direct-CLI `--stage` flag on `agent run`; commander rejects it (`stage` is engine-internal only). Corrected.
  - `plugins/sp/scripts/feature-sync-bounded.ts` + `task-size-precheck.ts` — CLI resolution repaired: source-local repo-root resolution (three `..` from `plugins/sp/scripts`), no PATH-`spur` dependence. (`--output` checked and confirmed real — `workflow trace`.)
- **Tests:** targeted additions to `plugins/sp/tests/feature-sync-bounded.test.ts` (+22) and `task-size-precheck.test.ts` (+28) covering the resolution chain; 67/67 pass (137 expect() calls).

Unverified items (8) are host-owned or mutating-command assertions with no mechanical check — recorded in the inventory, never marked passing.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-runnable inventory script `plugins/sp/scripts/surface-drift-inventory.ts` + artifact `docs/tasks2/0539-inventory.md`: 278 ok / 0 mismatch / 8 unverified, exit 0, reproduced at implement and again independently at review. Every entry carries file:line + check method; non-mechanically-checkable assertions recorded unverified with reason, never passing. Post-review fix removed the 16 `undefined:undefined` occurrence cells (arg-order defect). |
| R2 | MET | All ten workflow definitions validated + dry-run walked by the live engine (`workflow-validate` / `workflow-dry-run` rows in artifact); `.spur/workflows` symlink realpath resolves to the tracked SSOT tree (`symlink-realpath` row ok; independently re-confirmed by review). |
| R3 | MET | Final inventory: 0 confirmed mismatches remain — none recorded-and-ignored. Two confirmed drifts fixed in-task: dispatch-surface.md:116 `--stage` prose corrected (engine-internal only); plugin scripts' spur CLI resolution repaired to source-local repo-root with regression tests. No CLI-surface change made (ADR-051 consent gate respected); no entry was too large to fix here, so no WBS filing was needed. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
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
- 2026-08-15T07:13:48.028Z todo → wip (system)
- 2026-08-15T07:13:48.615Z wip → testing (system)
- 2026-08-15T07:13:55.294Z testing → done (system)
