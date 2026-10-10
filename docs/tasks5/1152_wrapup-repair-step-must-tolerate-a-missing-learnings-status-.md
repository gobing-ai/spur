---
schema_version: 1
name: Wrapup repair step must tolerate a missing learnings status file
status: todo
template: issue
created_at: 2026-10-10T02:50:01.484Z
updated_at: "2026-10-10T02:51:07.319Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
---

## 1152. Wrapup repair step must tolerate a missing learnings status file

### Background

Filed from the active-session review of the 2026-10-09/10 batch session.

`wrapup-pipeline`'s `repair` state is the ADR-118 pilot's contract-violation lane: when `doc-sync`'s
`agent.run` exits cleanly but misses its declared post-condition, the wrap records the miss and
**proceeds** to `doc-tripwire` and `metrics-record` instead of paying for a second dispatch. That is
its documented intent (`config/workflows/wrapup-pipeline.yaml`, `repair` description: "wrap-up
proceeds through the doc-tripwire hop (1037) to metrics-record").

Observed **once** in that session (task 1136's wrap, run `3ec77cc1-da7f-45ec-8e57-79080c433927`): the
`doc-sync` `agent.run` exited 0 with an empty `-wrapup-learnings.md`, the contract-violation edge
routed to `repair`, and `repair`'s shell exited 1 — ending the whole wrap as
`workflow failed: wrapup-pipeline -> repair`. The wrap then had to be completed a second time on the
documented fast route (`mode=fast`), costing an extra dispatch cycle.

Evidence, quoted from the recorded tool output of that session rather than from memory:

```
✗ doc-sync/agent.run (1m 49s) · agent.run (coder) exited 0 but produced an empty answer for
  answerFile: .spur/run/3ec77cc1-…-wrapup-learnings.md
↪ doc-sync → repair [contract-violation]
workflow failed: wrapup-pipeline -> repair — Command "mkdir -p .spur/run && R=".spur/run/$__runId-wrapup-repair.status"
  && V="$(cat .spur/run/$__runId-wrapup-learnings.status 2>/dev/null)" && if [ "$V" = invalid-learnings-shape ]; then
  … fi && exit 0" exited with 1
```

**Not evidence for this defect:** the session's other failed wrap (task 1140/1141's batch) died before
reaching `repair` — its `doc-sync` agent failed with `402 … requires more credits` and the run
terminated `failed-check`. Only the `repair`-entered case above exercises the missing-status-file path.

### Requirements

- [ ] R1. **A missing learnings status file is not a step failure.** With
  `.spur/run/<run>-wrapup-learnings.status` absent, the `repair` shell still writes
  `.spur/run/<run>-wrapup-repair.status` (the `contract-violation:` line) and exits 0, so the wrap
  proceeds to `doc-tripwire` and `metrics-record` as its description declares.
- [ ] R2. **The three observed inputs keep their distinct outcomes.** An absent status file, an
  explicit `invalid-learnings-shape` value, and any other value each write their own repair-status
  line (narration-only vs contract-violation), and each exits 0.
- [ ] R3. **A pin covers the absent-file case**, shown to fail against the current chain (the
  `&&`-joined `cat`), and green after the change.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An absent learnings status file does not fail the repair lane (req: R1, R3)
  Given a wrapup run whose doc-sync wrote no learnings status file
  When the repair state's shell runs
  Then it writes a repair status naming the contract violation
  And it exits 0
  And the wrap continues to doc-tripwire
```

```gherkin
Scenario: AC2 — The narration-only shape is still distinguished (req: R2)
  Given the status file contains "invalid-learnings-shape"
  When the repair shell runs
  Then the repair status names invalid-learnings-shape
  And it exits 0
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- **Smallest correct change.** Make the read non-fatal —
  `V="$(cat .spur/run/$__runId-wrapup-learnings.status 2>/dev/null || true)"` — which keeps the
  three-way `if` and the existing status vocabulary intact. One line inside
  `config/workflows/wrapup-pipeline.yaml`'s `repair` `onEnter` shell.
- **Boundary.** This is the repair lane's own robustness, not the doc-sync write-scope guard or the
  delinked-row check owned by 1147, and not the `onEnter` shell error-detail work in 1147 R3 (which
  improves a message, not this exit code). The wrapup action is not otherwise restructured.
- **Authority note.** A workflow edit needs explicit operator authorization; the task carries the
  one-line diff and the pin so the change is reviewable as written.
- **Failure inventory (write before code):** a status file containing only whitespace; a shell that
  cannot write the repair status (must still not wedge the wrap silently — the existing `&&` on the
  `printf` keeps that loud); a Claude/Codex-side difference in how the step is entered.

### Plan

1. Add the pin first: a test that runs the `repair` shell with no status file present and asserts the
   repair-status line plus exit 0; confirm it fails against the current chain.
2. Apply the one-line `|| true` to the `repair` `onEnter` shell in `config/workflows/wrapup-pipeline.yaml`.
3. Re-run the pin, then `bun run spur-check` once (this touches a shipped workflow, so the repo-wide
   contract checks matter).
4. Record the verification in `## Testing`.

### Root Cause

The step's shell is a single `&&` chain whose second command is

```sh
V="$(cat .spur/run/$__runId-wrapup-learnings.status 2>/dev/null)" &&
```

`2>/dev/null` silences the message but not the exit status. On the empty-capture path that file was
never written, so `cat` exits 1, the chain aborts before the `if`, and the step exits 1 — before it
can write its own `-wrapup-repair.status` or reach `doc-tripwire`. The step's declared behaviour
("the miss is recorded … and wrap-up proceeds") therefore only holds when the status file happens to
exist.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
