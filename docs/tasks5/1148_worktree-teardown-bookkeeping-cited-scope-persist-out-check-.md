---
schema_version: 1
name: "Worktree teardown bookkeeping: cited-scope persist-out-check, skipped-item report, markerless landing record"
status: todo
template: feature-impl
created_at: 2026-10-09T18:05:11.361Z
updated_at: "2026-10-09T18:08:18.281Z"
feature_id: E71

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 5
dependencies: ["1136", "1139"]
---

## 1148. Worktree teardown bookkeeping: cited-scope persist-out-check, skipped-item report, markerless landing record

### Background

Captured from the creation title: "Worktree teardown bookkeeping: cited-scope persist-out-check, skipped-item report, markerless landing record".

**Origin (split from 1136 on 2026-10-09).** Three worktree-teardown bookkeeping gaps observed in the 1130/1131 and 1133 runs (2026-10-08/09).

1. **The cap turns a safety assertion into a manual step.**
   - `plugins/sp/scripts/persist-out-check.ts` (WT-4 pre-removal assertion, task 1067) checks `<wbs>-*`/`<runId>-*` under `.spur/run/` plus the **whole** `.spur/memory/evidence/` tree, with caps `NAMED_CAP 32`, `PREFIX_CAP 64` and `EVIDENCE_CAP 256` (`:24-29`).
   - On the 1130/1131 teardown, a worktree with 367 evidence files hit the 256 cap and returned `BLOCKED — worktree evidence listing failed or exceeded caps` (`:162`). Removal proceeded on hand-verified citations.
   - The durable evidence directory is flat, with files prefixed by WBS or run id (441 entries in the invoking tree on 2026-10-09), so ownership is decidable by prefix.
2. **A green line can hide an uncarried run directory.**
   - Task 1133's teardown printed `persist-out-check: ok — 13 evidence file(s) persisted, nothing abandoned`, but `.spur/memory/runs/run-1133-c3f1/` was never carried.
   - `carryRunRecordDir` returns silently on `ENOENT` (`packages/app/src/services/inline-run-setup.ts:982-983`), so "nothing to carry" and "carried nothing" look the same.
3. **A markerless worktree run leaves no landing obligation.**
   - `run-1133-c3f1` ran in a hand-made worktree, so it had no WT-3 marker (`.spur/run/worktree-<id>.json`, `execution-worktree-landing.md:28`).
   - It closed `done` at `2026-10-09T06:36:46Z` while its branch sat unlanded for 9 h 20 m until the operator noticed.
   - Under ADR-131, `.spur/run` is disposable, so a durable landing record belongs in `.spur/memory/runs/`.

### Requirements

- [ ] R1. **The evidence assertion is scoped to owned evidence.**
  - `persist-out-check` compares only evidence files whose basename starts with a forwarded `<wbs>-` or `<runId>-` prefix, in both `.spur/run/` and `.spur/memory/evidence/`.
  - The per-prefix cap (64) applies; the whole-tree `EVIDENCE_CAP` walk is removed.
  - Unowned worktree evidence is reported as a count (`unowned: N`) and does not block.
  - When no prefix is forwarded, the check exits 2 (usage error) rather than walking the whole tree.
- [ ] R2. **Skipped run-record items are named.**
  - `carryRunRecordDir` records `{id, reason: 'source-missing'}` in `skips` when the run's source directory or file is absent, instead of returning silently.
  - `persist-out-check` and `--persist-out` print every skip.
  - The ok line reads `nothing abandoned` only when `skips` is empty.
- [ ] R3. **A worktree run without a marker records its landing obligation durably.**
  - At `--close --status done`, when the run's cwd is a linked git worktree (`git rev-parse --git-dir` ≠ `--git-common-dir`) and no WT-3 marker names this run, `inline-run-setup` appends `landing: required branch=<b> path=<p> base=<ref>` to the run record `.spur/memory/runs/<runId>.md` in the owning tree.
  - The worktree landing reference documents the sweep `rg -l '^landing: required' .spur/memory/runs`.
  - A later WT-4 merge or retain rewrites the line to `landing: merged <sha>` or `landing: retained`.
- [ ] R4. **Docs and bundle ship in the same change.** Update the `persist-out-check.ts` header, `execution-worktree-landing.md` (markerless runs and the sweep), and the run-record contract, then run `bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A large worktree evidence tree does not block an owned-evidence check (req: R1)
  Given a worktree with 367 evidence files of which 13 carry forwarded prefixes, all persisted
  When persist-out-check runs with those prefixes
  Then it exits 0 reporting 13 checked and unowned 354
  And a forwarded-prefix file missing from the invoking tree still blocks with its name
  And running with no forwarded prefix exits 2
```

```gherkin
Scenario: AC2 — An absent run directory is reported as skipped (req: R2)
  Given a worktree whose .spur/memory/runs/<runId>/ directory is absent
  When persist-out and persist-out-check run
  Then the output names <runId> with reason source-missing
  And the line "nothing abandoned" is not printed
```

```gherkin
Scenario: AC3 — A markerless worktree run leaves a durable landing record (req: R3)
  Given a run executing in a linked git worktree with no WT-3 marker
  When the run closes done
  Then the owning tree's .spur/memory/runs/<runId>.md contains "landing: required" with branch, path and base
  And the documented rg sweep lists that run
  And a run in the main working tree writes no landing line
```

```gherkin
Scenario: AC4 — Docs and bundle reflect the scoped check (req: R4)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass and execution-worktree-landing.md documents the markerless-run sweep
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:08:12.366Z

- **Q: Raise the cap instead of scoping?** A: No. A higher cap fails again at higher volume. Ownership by prefix is the actual invariant.
- **Q: Store the landing obligation as a WT-3 marker in `.spur/run`?** A: No. `.spur/run` is disposable scratch (ADR-131). The run record is canonical.

### Design

- **Ownership by prefix (R1).** Durable evidence is flat and prefix-named, so the forwarded `<wbs>`/`<runId>` set already defines what this worktree must carry. A whole-tree walk was a proxy for that set and fails at volume. A count of unowned files keeps the information without blocking.
- **Absence is data (R2).** The `skips` array already exists (`inline-run-setup.ts:973`). An `ENOENT` at the top-level run source becomes one skip entry; nested `ENOENT` stays impossible by construction.
- **Landing record in the canonical store (R3).** `.spur/run` is disposable (ADR-131), so the obligation goes into the run record. Detection is two `git rev-parse` calls at close; no new flag. The owning tree comes from 1136 R1's `--project-root`.
- **Boundaries.** Persist-out never overwrites (unchanged). No new public `spur` verb. Do not touch 1139's migrate/persist conflict classification (`persistWorktreeRuns` evidence loop).
- **Failure inventory:**
  - a prefix collision (`113-` vs `1130-`), so match `<prefix>-` exactly;
  - an unowned count that hides an owned-but-misnamed file;
  - a run-record append into the worktree instead of the owning tree;
  - a landing line written for a main-tree run;
  - a duplicate landing line on a re-close.

### Plan

1. Write the failure inventory (Design) as test names.
2. Tests first: `plugins/sp/tests/persist-out-check*.test.ts` for R1 (367-file fixture, prefix collision, no-prefix usage error), and `packages/app/tests/services/inline-run-setup*.test.ts` for R2 and for R3 (temp git repo with `git worktree add`).
3. R1: rewrite the evidence listing in `plugins/sp/scripts/persist-out-check.ts` to filter by prefix.
4. R2: push the `source-missing` skip in `carryRunRecordDir` and print skips in both commands.
5. R3: detect a linked worktree and a missing marker at close, then append to the owning run record. Make WT-4 rewrite the line in `execution-worktree-landing.md`.
6. R4: docs, `build:bundle` and `build:scripts`.
7. Acceptance drill: a real `git worktree add` run closed done without a marker produces the line; persist-out-check on a 300+ file fixture passes. Record both in Testing.
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

- 2026-10-09T18:08:18.092Z backlog → todo (system)

