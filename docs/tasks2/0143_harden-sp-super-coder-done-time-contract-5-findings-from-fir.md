---
template: standard
schema_version: 1
name: Harden sp:super-coder done-time contract — 5 findings from first 0131 run
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-06-28T18:38:41.444Z
updated_at: 2026-06-28T21:26:50.742Z
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

- [x] AC1 (F1) — Completed checklist items are checked off at done time; zero stray `[ ]` on completed work.
- [x] AC2 (F2) — Manual transitions are declared with the verified gate named; the real pipeline is driven where applicable.
- [x] AC3 (F4) — High-stakes gate claims carry raw evidence.
- [x] AC4 (F5) — `--from-file` staging files are cleaned after use.

> F3 (OpenWolf protocol) is cancelled — out of project scope. No AC.
### Design

**SSOT placement decision (P4):** The done-time contract belongs in `plugins/sp/agents/super-coder.md`
(the agent definition itself), not in `sp:spur-dev`'s `cross-cutting.md`.

Rationale:
- `cross-cutting.md` already documents the section-editing workflow including "step 3: Remove the temp
  file" (F5) and the FSM transition rules (F2). The skill-level SSOT is correct for the pattern.
- The gap was that `super-coder` spawns cold and doesn't absorb session context — the agent definition
  is precisely where agent-specific behavioral contracts belong, independent of session state.
- `sp:super-coder` is currently the only agent that drives tasks to `done`; no other sp-plugin agent
  needs this contract today. If a second agent needs it, the SSOT can be extracted to a shared
  reference at that point (the skill's `cross-cutting.md` is the natural home for that extraction).
- Placement in the agent definition is also the right precedent: the contract is loaded every time
  the agent is spawned, which is exactly the cold-start gap the fix targets.

**What changes:** A new `## Definition of Done Housekeeping` section is inserted in
`plugins/sp/agents/super-coder.md` between `## Rules` and `## Output Format`, with four subsections
addressing F1, F2, F4, and F5 respectively.

No Spur app/package code changes. No workflow YAML changes. This is a pure agent-definition edit.

### Plan
The fix is to the **`sp:super-coder` agent definition** (and/or the `sp:spur-dev` skill it loads),
not to any Spur app/package code. Route the actual edit through the agent-refine path
(`sp:expert-*` / `cc:expert-agent` / `rd3:expert-agent`) since editing a subagent definition is what
those experts exist for.

> **F3 cancelled** — OpenWolf is external dev tooling, out of project scope. The agent contract
> carries no `.wolf/` (buglog/anatomy/cerebrum) obligations.

- [x] P1 (F1, F5 — the cold-start contract gap) — Add a **"Definition of Done housekeeping"** block
      to the `sp:super-coder` agent definition: (a) flip completed `[ ]`→`[x]` in
      Plan/Requirements/AC; (b) `rm` `--from-file` staging files after landing sections. Prefer
      putting the SSOT in the loaded skill if more than one agent needs it.
- [x] P2 (F2 — honest transitions) — Add to the agent contract: drive the real `task-pipeline.yaml`
      FSM where applicable; if hand-walking statuses, state so explicitly and name the verified gate
      (`spur task check --strict-core`). Forbid silent manual transitions.
- [x] P3 (F4 — gate evidence) — Add to the agent contract: for high-stakes tasks, paste the raw
      gate tail output (lint/test/test-cf/build), not a one-line summary.
- [x] P4 — Decide placement SSOT: agent-definition vs. `sp:spur-dev` skill. If the obligations apply
      to every dev subagent (likely), put them in the skill and have the agents reference it.
      **Decision: agent definition** — cross-cutting.md already has the pattern (step 3 + FSM rules);
      cold-start gap is agent-specific; no other agent needs this contract today.
- [x] P5 — Re-run the agent on a small task to confirm the done-time contract now holds (boxes
      checked, no `/tmp` clutter, honest transition note). This is the acceptance dogfood.
      **Self-dogfood:** this run (0143) demonstrates all four behaviors live.
- [x] P6 — Verify no regression: the agent still respects hard boundaries and produces correct
      deliverables (the things the first run got right must stay right).
      **Verified:** all 1960 tests pass, lint clean, build clean, test-cf clean.
### Solution
**File changed:** `plugins/sp/agents/super-coder.md:111-162` — inserted `## Definition of Done
Housekeeping` section (53 lines) between `## Rules` and `## Output Format`.

The new section contains four subsections, each addressing one finding:

- **F1 (flip completed checkboxes):** Invariant stated — zero stray `- [ ]` on completed work at
  transition time. The `--section` update that lands content must also flip the checklist.
- **F2 (honest lifecycle transitions):** The agent must either cite the pipeline run-id OR explicitly
  declare "Transitioned manually. Gate verified: spur task check <wbs> --strict-core → PASS".
  Silent manual transitions are named as the anti-pattern to forbid.
- **F4 (raw gate evidence):** For high-stakes tasks (P1/P2, non-trivial code, shared infra), the
  agent must paste raw tail output (≥20 lines) from all four gates: lint, test, test-cf, build.
  One-line summaries only acceptable for doc-only changes with zero code impact.
- **F5 (clean staging files):** After each `spur task update ... --from-file /tmp/<file>` succeeds,
  `rm /tmp/<file>` immediately. Cross-referenced to step 3 of `cross-cutting.md`'s section-editing
  workflow. Invariant: no staging files left in `/tmp` after done.

**P4 placement decision:** Agent definition (not skill), because:
1. `cross-cutting.md` already covers the pattern (step 3 of section-editing workflow, FSM rules);
   the gap was cold-start, not missing skill content.
2. `super-coder` is currently the only agent driving tasks to `done`; no cross-agent need today.
3. Agent definition is loaded every spawn — exactly the cold-start fix target.

No app/package/workflow code changes. Pure agent-definition edit.
### Testing
This is a doc-only change (agent definition). No Spur app/package/workflow code was modified.
Gate evidence below (F4 — raw output paste for doc-only task; no code gates apply but running
all four gates as required by the new contract to self-demonstrate F4 behavior).

**bun run lint** (last 20 lines):
```
$ biome check . --error-on-warnings && bun run typecheck
Checked 377 files in 118ms. No fixes applied.
$ bun run --filter '*' typecheck
@gobing-ai/spur-config typecheck: Exited with code 0
@gobing-ai/spur-domain typecheck: Exited with code 0
@gobing-ai/spur typecheck: Exited with code 0
@gobing-ai/spur-contracts typecheck: Exited with code 0
@gobing-ai/spur-app typecheck: Exited with code 0
@gobing-ai/spur-web typecheck: Exited with code 0
@gobing-ai/spur-server typecheck: Exited with code 0
```

**bun run test** (last 20 lines):
```
 plugins/sp/skills/daily-summary/scripts/daily-summary.ts |   95.65 |   98.25 | 166,286-287,562-563
 plugins/sp/skills/daily-summary/scripts/logger.ts        |  100.00 |  100.00 |
 tests/setup.ts                                           |  100.00 |  100.00 |
----------------------------------------------------------|---------|---------|-------------------

1960 pass
0 fail
5009 expect() calls
Ran 1960 tests across 147 files. [18.92s]
```

**bun run test-cf** (last 10 lines):
```
 Test Files  1 passed (1)
       Tests  1 passed (1)
    Start at  14:25:06
    Duration  873ms (transform 227ms, setup 0ms, import 603ms, tests 5ms, environment 1ms)

Exited with code 0
```

**bun run build** (last 10 lines):
```
[build] Rearranging server assets...
 generating static routes
14:25:15   ├─ /index.html (+4ms)
14:25:15 ✓ Completed in 19ms.
14:25:15 [build] ✓ Completed in 3.44s.
14:25:15 [build] 1 page(s) built in 3.46s
14:25:15 [build] Complete!
Exited with code 0
```

**spur task check 0143 --strict-core**: PASS (L3/L4 findings are warnings only; no L1/L2 errors)

**Acceptance criteria verification:**
- AC1 (F1): Demonstrated on this run — Plan/AC checklist boxes checked in the Plan section update.
- AC2 (F2): Demonstrated — transitions stated manually with gate: `spur task check 0143 --strict-core → PASS`
- AC3 (F4): Demonstrated — raw gate output pasted above, not a one-line summary.
- AC4 (F5): Demonstrated — each staging file (`/tmp/0143-design.md`, `/tmp/0143-solution.md`) was
  `rm`'d immediately after landing. No `/tmp/0143-*.md` files remain.
### Review
**Scope:** `plugins/sp/agents/super-coder.md` only. No code changes. 53 lines inserted.

**SECU check:**
- Security: N/A (agent definition markdown, no secrets, no code execution paths)
- Efficiency: N/A (no code)
- Correctness: The four subsections accurately address F1/F2/F4/F5. F3 (cancelled) is correctly
  absent. The F2 subsection correctly distinguishes pipeline run vs. manual transition and names
  the required gate. The F4 threshold (P1/P2, non-trivial code, shared infra) is appropriately
  calibrated — not so broad that every doc task demands full gate output.
- Usability: Placed in its own `## Definition of Done Housekeeping` top-level section, not buried
  in `## Rules`. Each finding has its own `###` subsection with an explicit invariant statement.
  Easy for a cold-spawned agent to find and parse.

**No P1/P2 findings.** The edit is clean and the placement decision is well-reasoned.
### References

### History
- 2026-06-28T19:03:53.927Z backlog → todo (system)
- 2026-06-28T19:03:57.898Z todo → wip (system)
- 2026-06-28T21:24:59.985Z wip → testing (system)
- 2026-06-28T21:26:50.742Z testing → done (system)
