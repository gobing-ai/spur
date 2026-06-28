---
template: standard
schema_version: 1
name: "Harden sp:super-coder done-time contract — 5 findings from first 0131 run"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-28T18:38:41.444Z"
updated_at: 2026-06-28T18:48:49.339Z
---

## 0143. Harden sp:super-coder done-time contract — 5 findings from first 0131 run

### Background
First production use of the `sp:super-coder` subagent (executing task 0131,
`docs/tasks2/0131_*.md`) succeeded on the **deliverable** — correct code fix, passing tests, gate
green, hard boundary (don't touch 0142) respected. A process postmortem of the run surfaced
hardening findings. None broke the 0131 result; all are gaps that compound at scale.

**Scope note (2026-06-28):** F3 (OpenWolf protocol obligations) is **cancelled** — OpenWolf is
external dev tooling used to assist development, **not** in the Spur project scope. The
`sp:super-coder` contract must not carry `.wolf/` (buglog/anatomy/cerebrum) obligations. The row is
retained below for audit history, marked CANCELLED. Active scope: **F1, F2, F4, F5.**

**Root cause (ties F1/F5 together):** a subagent spawns cold — it gets only the launch prompt, not
the session's absorbed CLAUDE.md protocol obligations. The launch prompt specified the *what*
(R1/R2) and the boundary (well honored), but did **not** restate the done-time housekeeping the main
session performs automatically. The agent had no way to know it must check completed boxes or clean
its staging files — so it didn't. The fix is to bake these obligations into the **agent definition**
(and/or the `sp:spur-dev` skill it loads) so every future launch inherits them, rather than relying
on each launch prompt to re-specify them.

#### Findings

| ID | Severity | Finding | Evidence | Recommended fix |
|----|----------|---------|----------|-----------------|
| F1 | High | `done` task shipped with 9 unchecked `- [ ]` boxes — every Requirement (R1/R2/R3) and Plan item (P1.1–P3.2) left `[ ]` though all were completed. Narrative sections filled; checklist never flipped. A reader can't tell `done` from `abandoned` by the boxes. | `grep -c "^- \[ \]" docs/tasks2/0131_*.md` → 9 in a `done` task | When a Plan/Requirements/AC item is completed, flip `[ ]`→`[x]` in the same `--section` update. Make it a done-time invariant in the agent contract. |
| F2 | Medium | Cannot prove the real pipeline ran — `wip→testing→done` happened in ~2s (18:27:41→43) with **no verdict file** (`.spur/run/0131*` absent), suggesting the FSM was hand-walked rather than driving `task-pipeline.yaml`. Outcome is gate-legal (`--strict-core` passes — the L3/L4 findings stay warnings under core mode), so nothing was wrongly promoted; the issue is opacity, not an illegal transition. | History timing + missing `.spur/run/0131*`; `spur task check 0131 --strict-core` → PASS | Agent must either drive the real pipeline OR explicitly state "transitioned manually; gate verified via `--strict-core`". Silent hand-walking is the anti-pattern to forbid. |
| F3 | ❌ CANCELLED | ~~OpenWolf protocol partially skipped — `.wolf/buglog.json`/`.wolf/anatomy.md`/cerebrum not updated.~~ **Out of scope:** OpenWolf is external dev tooling, not in the Spur project scope. The agent contract must not carry `.wolf/` obligations. No fix. | — | None — cancelled. |
| F4 | Low | Self-reported gate — `bun run test-cf` and `bun run build` claimed green, witnessed only by the agent's summary (lint + test were independently re-verified; the slow two were not). | Agent final message vs. independent re-run | For high-stakes tasks, have the agent paste the raw gate tail output, not a one-line "green" summary. |
| F5 | Low | Stray `/tmp` staging clutter — 11 `0131-*.md` `--from-file` staging files left behind after the sections landed (already cleaned during the postmortem). | `ls /tmp/0131-*.md` → 11 files | Agent should `rm` its `--from-file` staging files after landing each section. |

Source: postmortem of the first `sp:super-coder` run, conversation 2026-06-28.
### Acceptance Criteria
```gherkin
Feature: sp:super-coder enforces a done-time housekeeping contract

  Scenario: Completed checklist items are checked off (F1)
    Given sp:super-coder finishes a task it was asked to drive to done
    When it transitions the task to done
    Then every Plan/Requirements/AC item it completed is flipped from "[ ]" to "[x]"
    And no completed work is left as an unchecked box

  Scenario: Pipeline execution is honest (F2)
    Given sp:super-coder advances a task through lifecycle statuses
    When it does NOT drive the real task-pipeline FSM
    Then it states explicitly that transitions were manual
    And it names the gate it verified (e.g. "spur task check --strict-core PASS")

  Scenario: Gate evidence is verifiable (F4)
    Given sp:super-coder reports the verification gate as green
    When the task is high-stakes
    Then it includes the raw gate tail output, not just a summary verdict

  Scenario: Scratch files are cleaned (F5)
    Given sp:super-coder used --from-file staging files to land task sections
    When the sections have landed
    Then the staging files are removed
```

- [ ] AC1 (F1) — Completed checklist items are checked off at done time; zero stray `[ ]` on completed work.
- [ ] AC2 (F2) — Manual transitions are declared with the verified gate named; the real pipeline is driven where applicable.
- [ ] AC3 (F4) — High-stakes gate claims carry raw evidence.
- [ ] AC4 (F5) — `--from-file` staging files are cleaned after use.

> F3 (OpenWolf protocol) is cancelled — out of project scope. No AC.
### Plan
The fix is to the **`sp:super-coder` agent definition** (and/or the `sp:spur-dev` skill it loads),
not to any Spur app/package code. Route the actual edit through the agent-refine path
(`sp:expert-*` / `cc:expert-agent` / `rd3:expert-agent`) since editing a subagent definition is what
those experts exist for.

> **F3 cancelled** — OpenWolf is external dev tooling, out of project scope. The agent contract
> carries no `.wolf/` (buglog/anatomy/cerebrum) obligations.

- [ ] P1 (F1, F5 — the cold-start contract gap) — Add a **"Definition of Done housekeeping"** block
      to the `sp:super-coder` agent definition: (a) flip completed `[ ]`→`[x]` in
      Plan/Requirements/AC; (b) `rm` `--from-file` staging files after landing sections. Prefer
      putting the SSOT in the loaded skill if more than one agent needs it.
- [ ] P2 (F2 — honest transitions) — Add to the agent contract: drive the real `task-pipeline.yaml`
      FSM where applicable; if hand-walking statuses, state so explicitly and name the verified gate
      (`spur task check --strict-core`). Forbid silent manual transitions.
- [ ] P3 (F4 — gate evidence) — Add to the agent contract: for high-stakes tasks, paste the raw
      gate tail output (lint/test/test-cf/build), not a one-line summary.
- [ ] P4 — Decide placement SSOT: agent-definition vs. `sp:spur-dev` skill. If the obligations apply
      to every dev subagent (likely), put them in the skill and have the agents reference it.
- [ ] P5 — Re-run the agent on a small task to confirm the done-time contract now holds (boxes
      checked, no `/tmp` clutter, honest transition note). This is the acceptance dogfood.
- [ ] P6 — Verify no regression: the agent still respects hard boundaries and produces correct
      deliverables (the things the first run got right must stay right).
### Solution

### Testing

### Review

### References

### History
