---
schema_version: 1
name: Wrapup write-scope guard and nested feature-transition verification
status: todo
template: feature-impl
created_at: 2026-10-09T18:05:11.090Z
updated_at: "2026-10-09T18:08:17.886Z"
feature_id: H1

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 6
---

## 1147. Wrapup write-scope guard and nested feature-transition verification

### Background

Captured from the creation title: "Wrapup write-scope guard and nested feature-transition verification".

**Origin (split from 1136 on 2026-10-09).** Two wrapup integrity defects from the 1132 run (2026-10-08) and the H1 batch (2026-10-08).

**Defect A: doc-sync wrote outside its declared scope.**
- On the full route, the wrapup `doc-sync` `agent.run` (`config/workflows/wrapup-pipeline.yaml:224`, one model query over 04_DESIGN, 03_ARCHITECTURE, 00_ADR and `docs/design/*`) re-added the deliberately delinked row for `design/spur-team-mode-design.md` to `docs/04_DESIGN.md`. It also edited an unrelated test, `apps/app/tests/decision/decision-log-query.test.ts` (+36 lines).
- `doc-tripwire` (`:330`, repo-wide tripwires over the uncommitted wrap diff) then failed on `repo-wide-tests/adr-supersession.test.ts` (g2). That routes straight to `failed` (`:600-611`), so both edits had to be reverted by hand and the wrap finished on `mode=fast`.
- Verified 2026-10-09: the `repair` state (`:308-328`) is a shell step that only writes a status file. The unrelated edit therefore came from doc-sync's agent run, not from "repair". The delinked row is currently absent from `docs/04_DESIGN.md`, which is correct.

**Defect B: the nested feature-transition failed while its own check passed.**
- In the H1 batch, the wrapup `feature-transition` (`wrapup-steps.ts feature-transition` → `spur feature sync`) failed with `GuardDeniedError: Lifecycle transition denied for feature H1: State "verifying" onEnter shell failed (exit 1)`, while its gate printed `H1 (active): PASS`.
- Running `feature-verification.yaml` directly succeeded (`H1 verification PASS`, run `abf585eb-3e26-4b66-9835-3d3332e139dc`).
- The failing shell is `config/workflows/feature-lifecycle.yaml:53`, which runs `$spurBin workflow run feature-verification.yaml` nested inside the running wrapup workflow. The error carries no stderr, so the root cause is unknown. Candidates: inherited run env such as `__runId`, a cwd difference, or a DB lock held by the outer run.

### Requirements

- [ ] R1. **doc-sync writes only inside its declared scope.**
  - After the `doc-sync` `agent.run`, a deterministic shell action compares the working diff against the entry snapshot.
  - Allowed paths: `docs/**` except `docs/tasks*`/`docs/features*`, and the learnings capture path the step declares.
  - Any other changed path fails the step: write `scope-violation: <paths>` to `.spur/run/<run>-wrapup-doc-sync-scope.status` and route to `failed` with the paths named.
  - The violating edits are reported, not auto-reverted.
- [ ] R2. **doc-sync never re-adds a delinked index row.**
  - The doc-sync prompt states that a row absent from `docs/04_DESIGN.md` for a superseded satellite is intentional.
  - A deterministic check after doc-sync runs the supersession pins (`repo-wide-tests/adr-supersession.test.ts`) before `doc-tripwire`, so the failure names doc-sync, not the tripwire stage.
  - The tripwire is never weakened.
- [ ] R3. **A nested onEnter shell failure carries its own error.** A lifecycle `onEnter` shell failure includes the last 2 KiB of the command's stderr in the `GuardDeniedError` message, instead of a bare `exit 1`.
- [ ] R4. **The nested feature-verification agrees with the standalone run.**
  - Reproduce the H1 failure: run a wrapup whose feature-transition moves a feature to `verifying`, with a feature whose standalone `feature-verification.yaml` passes.
  - Fix the root cause R3 exposes, so the nested and standalone runs return the same verdict.
  - The fix is the one shared invocation path (`feature-lifecycle.yaml:53` or the env it inherits), not a wrapup-only special case.
- [ ] R5. **Docs and bundle ship in the same change.** Update the wrapup workflow comments (doc-sync scope, the new check), `docs/design/` for the lifecycle onEnter error contract if one owns it, then run `bun run --filter @gobing-ai/spur build:bundle`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A doc-sync edit outside docs fails the step naming the path (req: R1)
  Given a doc-sync run that modifies apps/app/tests/decision/decision-log-query.test.ts
  When the post-doc-sync scope check runs
  Then the step fails with scope-violation naming that path
  And an edit confined to docs/design/*.md passes the check
```

```gherkin
Scenario: AC2 — A resurrected delinked row fails at doc-sync, not at doc-tripwire (req: R2)
  Given doc-sync re-adds the design/spur-team-mode-design.md row to docs/04_DESIGN.md
  When the post-doc-sync supersession check runs
  Then the failure names doc-sync and the adr-supersession (g2) pin
  And repo-wide-tests/adr-supersession.test.ts is unchanged
```

```gherkin
Scenario: AC3 — A lifecycle onEnter failure shows the nested stderr (req: R3)
  Given a lifecycle onEnter shell that writes "boom" to stderr and exits 1
  When the transition is attempted
  Then the GuardDeniedError message contains "boom"
```

```gherkin
Scenario: AC4 — Nested and standalone feature verification agree (req: R4)
  Given a feature whose standalone feature-verification.yaml run passes
  When a wrapup feature-transition moves it to verifying
  Then the transition succeeds with the verification receipt recorded
  And a regression test reproducing the nested invocation fails without the fix
```

```gherkin
Scenario: AC5 — Workflow comments and bundle reflect the scope check (req: R5)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass and the wrapup workflow documents the doc-sync scope check
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:07:18.152Z

- **Q: Auto-revert out-of-scope doc-sync edits?** A: No. Report and fail. A revert destroys evidence of what the model did; the operator decides.
- **Q: Fix the H1 nested failure by bypassing verification in wrapup?** A: No. Root-cause it through R3's stderr and fix the shared invocation path.

### Design

- **Scope is enforced by a deterministic check, not by prompt wording alone.** doc-sync is a free-form model step (ADR-043 residual), and its prompt cannot be the only guard. A shell action right after it diffs `git status --porcelain -uall` against the snapshot taken at doc-sync entry, filters to the allowed globs, and fails on the rest. Report, don't revert: reverting a model's edit hides evidence, and the operator decides.
- **Run the supersession pin where the defect is introduced.** Running `bun test repo-wide-tests/adr-supersession.test.ts` (seconds) right after doc-sync turns a late doc-tripwire failure into an attributable doc-sync failure. `doc-tripwire` stays as the full backstop.
- **Root-cause before fixing R4.** R3 is the instrument. The fix goes where R3's stderr points. Hypotheses to test, cheapest first:
  - (a) the inherited `__runId`/workflow env makes the nested `workflow run` resolve the outer run;
  - (b) the nested run hits the outer run's DB lock;
  - (c) a cwd/`spurBin` difference.
- **Boundaries.** Do not weaken `adr-supersession.test.ts`, do not make doc-sync skip index files wholesale, do not turn `mode=fast` into the default, and do not special-case wrapup in the lifecycle engine.
- **Failure inventory:**
  - the scope check flags the learnings capture file;
  - the scope check misses an untracked file;
  - the snapshot is taken after doc-sync has already written;
  - the stderr tail leaks a secret, which is why the tail goes through the existing redaction;
  - the R4 fix masks a genuine verification failure.

### Plan

1. Write the failure inventory (Design) as test names.
2. Tests first:
   - `plugins/sp/tests/wrapup-steps.test.ts` fixtures for R1/R2: an out-of-scope edit, an in-scope edit, a resurrected row;
   - an engine test for R3's stderr tail;
   - a nested-invocation reproduction for R4 that runs the lifecycle onEnter from inside a running workflow context.
3. R1/R2: add the entry snapshot and the post-doc-sync check actions in `config/workflows/wrapup-pipeline.yaml`, implemented in `plugins/sp/scripts/wrapup-steps.ts`, and route the failure edge.
4. R3: include the redacted stderr tail in the lifecycle onEnter failure message.
5. R4: reproduce, read the stderr, fix the root cause, and confirm that nested and standalone runs agree.
6. R5: docs, then `build:bundle`.
7. Acceptance drill: one full-route wrapup on a scratch branch that completes with `doc-tripwire` PASS, plus one deliberately out-of-scope doc-sync edit that fails naming the path. Record both in Testing.
8. Run `bun run spur-check` once.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-09T18:08:17.886Z backlog → todo (system)

