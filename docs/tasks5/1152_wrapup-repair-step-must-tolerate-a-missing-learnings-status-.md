---
schema_version: 1
name: Wrapup repair step must tolerate a missing learnings status file
status: todo
template: issue
created_at: 2026-10-10T02:50:01.484Z
updated_at: "2026-10-10T03:30:44.619Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 1
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

**Refinement 2026-10-09 — the defect is deterministic, not intermittent.** The only writer of
`.spur/run/<run>-wrapup-learnings.status` is `learnings-validate`'s shell
(`config/workflows/wrapup-pipeline.yaml:278`). The `doc-sync → repair` contract-violation edge
(`:529`) bypasses `learnings-validate`, so on that edge the status file **never** exists and the
`repair` shell exits 1 on **every** entry — the ADR-118/0871 repair lane has never completed for its
primary input. Only the `learnings-validate → repair` (invalid-shape) entry, which always has the file,
works today. Reproduced in isolation:

```sh
sh -c 'V="$(cat /nonexistent 2>/dev/null)" && echo ok'           # prints nothing, exit 1
sh -c 'V="$(cat /nonexistent 2>/dev/null || true)" && echo ok'   # ok
```

The existing pin `packages/app/tests/workflow/wrapup-pipeline.test.ts` › "0871 contract-first routing"
› "repair is cheap (shell only)…" only asserts the command *text* (`toContain('wrapup-repair.status')`)
and never executes it, which is why the regression shipped green.

### Requirements

- [ ] R1. **A missing learnings status file is not a step failure.** With
  `.spur/run/<run>-wrapup-learnings.status` absent (the `doc-sync → repair` contract-violation entry),
  the `repair` shell writes `.spur/run/<run>-wrapup-repair.status` with the `contract-violation:` line
  and exits 0, so the wrap proceeds to `doc-tripwire` as the state description declares.
- [ ] R2. **Both reachable entries keep their distinct outcomes.** Absent file → `contract-violation:`
  line; `invalid-learnings-shape` (the `learnings-validate → repair` entry) → `invalid-learnings-shape:`
  line. Any other value (not reachable today: `PASS` routes to `learnings-append`) falls to the
  `contract-violation:` line. All exit 0.
- [ ] R3. **The pin executes the shell, not its text.** A test runs the `repair` `onEnter` command via
  `sh -c` in a temp cwd with `__runId` in env (the existing 0783 R2 `runGuard` pattern in the same file)
  for the absent and `invalid-learnings-shape` cases, asserting exit 0 and the status line. Shown red
  against the current chain before the fix.
- [ ] R4. **Write failure stays loud.** If the repair status cannot be written (unwritable `.spur/run`),
  the shell still exits non-zero — the `|| true` applies to the read only.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An absent learnings status file does not fail the repair lane (req: R1, R3)
  Given a temp cwd with no ".spur/run/r1-wrapup-learnings.status"
  When the repair state's onEnter shell runs with __runId=r1
  Then it exits 0
  And ".spur/run/r1-wrapup-repair.status" starts with "contract-violation:"
```

```gherkin
Scenario: AC2 — The narration-only shape is still distinguished (req: R2, R3)
  Given ".spur/run/r2-wrapup-learnings.status" contains "invalid-learnings-shape"
  When the repair shell runs with __runId=r2
  Then it exits 0
  And ".spur/run/r2-wrapup-repair.status" starts with "invalid-learnings-shape:"
```

```gherkin
Scenario: AC3 — The pin was red before the fix (req: R3)
  Given the pre-fix wrapup-pipeline.yaml
  When the AC1 test runs
  Then it fails on exit status 1
```

```gherkin
Scenario: AC4 — A failed status write is still loud (req: R4)
  Given ".spur/run" exists but is not writable
  When the repair shell runs
  Then it exits non-zero
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-10T03:30:43.623Z

- **Q: `|| true` on the read, or `[ -f ] && V=…`?** A: `|| true` — one token, keeps the existing
  three-way `if` and vocabulary; an absent file and an empty file both mean "not classified as
  invalid-shape", which is exactly the `contract-violation` branch.
- **Q: Whitespace-only status file?** A: `$(…)` strips trailing newlines only; a whitespace value is
  not `invalid-learnings-shape`, so it takes the `contract-violation` branch. Correct; no trim needed.
- **Q: Authorization.** A: `config/workflows/wrapup-pipeline.yaml` is a shipped Spur workflow (not
  `.github/workflows/`); the edit is one token, authorized by the operator approving this task for
  implementation. `apps/cli/config/` is gitignored and regenerated by `bun run bundle:config`.
- **Q: Why not restructure repair?** A: Out of scope; 1147 owns doc-sync write-scope and onEnter error
  detail.

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

1. In `packages/app/tests/workflow/wrapup-pipeline.test.ts`, describe "0871 contract-first routing",
   add AC1/AC2/AC4 executing `shellsOf(def, 'repair')[0].options.command` via
   `spawnSync('sh', ['-c', cmd], { cwd, env: { ...getEnvVars(), __runId } })`. Run
   `(cd packages/app && bun test tests/workflow/wrapup-pipeline.test.ts)` → AC1 red (AC3 evidence).
2. Edit `config/workflows/wrapup-pipeline.yaml:324`:
   `V="$(cat .spur/run/$__runId-wrapup-learnings.status 2>/dev/null || true)" &&`.
3. Re-run the file → green. Run `bun run spur-check` once (shipped workflow; contract checks).
4. Record red/green output in `## Testing`; commit `fix(workflows): …(1152)`.

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
