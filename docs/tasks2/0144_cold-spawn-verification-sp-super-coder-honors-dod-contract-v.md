---
template: standard
schema_version: 1
name: "Cold-spawn verification: sp:super-coder honors DoD contract via dev-runall without prompt coaching"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-28T21:47:01.215Z"
updated_at: 2026-06-28T21:51:23.860Z
---

## 0144. Cold-spawn verification: sp:super-coder honors DoD contract via dev-runall without prompt coaching

### Background
Follow-up to 0143 (P2-b finding in `docs/dogfood/2026-06-28-super-coder-0143-dogfood.md`). 0143
added the **Definition of Done Housekeeping** contract (F1/F2/F4/F5) + **Dogfood mode** persistence
to the `sp:super-coder` agent definition. But 0143's own execution was a **self-dogfood in the main
session** — the contract was also handed to the agent in the launch prompt, so a successful run did
not isolate whether the **agent definition alone** drives the behavior.

**The gap:** a genuinely cold-spawned `sp:super-coder` (launched via `/sp:dev-runall`, or via the
`Agent` tool with a launch prompt that gives only the task and **withholds** the DoD/dogfood
obligations) must demonstrate it honors the contract from its definition alone. If it does not, the
definition wording is insufficient and needs hardening (it is markdown prose, not a CLI gate — the
only enforcement is the agent reading and obeying its own definition).

This is a **verification task**, not a feature. The deliverable is evidence (a dogfood report), and
— only if the cold run fails the contract — a hardening edit to `super-coder.md`.
### Acceptance Criteria
```gherkin
Feature: sp:super-coder honors the DoD contract from its definition alone (cold-spawn)

  Scenario: Cold-spawn run with no contract coaching in the prompt
    Given sp:super-coder is spawned with a launch prompt that names ONLY a trivial task to execute
    And the launch prompt does NOT restate F1/F2/F4/F5 or the dogfood-persist obligation
    When the agent drives that task to done
    Then completed checklist boxes are flipped to "[x]" (F1)
    And the lifecycle transition is honest — pipeline run-id OR manual + named gate (F2)
    And gate evidence matches the change type (F4)
    And no --from-file staging files remain in /tmp (F5)

  Scenario: Dogfood persistence from definition alone
    Given the cold-spawn run is requested as a dogfood
    And the launch prompt does NOT mention docs/dogfood/ or --save
    When the run completes
    Then a report exists at docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md
```

- [ ] AC1 — A cold-spawn run (no DoD/dogfood coaching in the prompt) is executed on a trivial task and its behavior recorded.
- [ ] AC2 — Each of F1/F2/F4/F5 is verified operator-side as honored-or-not from the definition alone.
- [ ] AC3 — Dogfood persistence to `docs/dogfood/` is verified to occur without prompt coaching.
- [ ] AC4 — If any obligation is NOT honored cold, `super-coder.md` is hardened (stronger wording / explicit invariant) and re-tested; if all honored, the contract is confirmed sufficient and no edit is made.
### Plan
- [ ] P1 — Pick/seed a **trivial** throwaway task as the cold-spawn target (a tiny doc or
      no-op-ish change with a 2–3 item Plan so F1 box-flipping is observable). It must be cheap and
      low-risk — the point is to observe the agent's housekeeping, not the work.
- [ ] P2 — Cold-spawn `sp:super-coder` with a launch prompt that contains ONLY: the task to execute,
      the project gate rules, and the dogfood request. **Deliberately withhold** F1/F2/F4/F5 wording
      and any mention of `docs/dogfood/`/`--save`. This isolates the agent definition as the sole
      source of the contract.
- [ ] P3 — Operator-side verification (do NOT trust the agent's self-report): for the target task,
      check `grep -c '^- \[ \]'` (F1), the transition honesty + `--strict-core` (F2), gate evidence
      vs. change type (F4), `ls /tmp/<target>-*` (F5), and `ls docs/dogfood/` for a persisted report.
- [ ] P4 — Record the outcome in a dogfood report under `docs/dogfood/`. If every obligation held
      cold → mark the contract confirmed-sufficient, no edit. If any failed → harden `super-coder.md`
      (promote the failed obligation to a stronger invariant) and re-run P2–P3 once to confirm.
- [ ] P5 — Clean up the throwaway target task (cancel/delete) so it does not pollute the board.
### Solution

### Testing

### Review

### References

### History
