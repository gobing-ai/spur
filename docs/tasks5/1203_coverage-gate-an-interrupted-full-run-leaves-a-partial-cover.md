---
schema_version: 1
name: "coverage-gate: an interrupted full run leaves a partial .coverage artifact that fails unrelated files"
status: backlog
template: standard
created_at: 2026-10-14T03:25:27.063Z
updated_at: "2026-10-14T03:26:08.629Z"
feature_id: C

---

## 1203. coverage-gate: an interrupted full run leaves a partial .coverage artifact that fails unrelated files

### Background

Observed twice in one session while running task 1200 and its follow-up review, on 2026-10-13.

`config/rules/quality/coverage-gate.yaml:1-11` reads per-file line coverage from
`.coverage/lcov.info` and fails any measured file below the 90% threshold. Its header already
documents one way that artifact goes wrong: a **targeted** `bun test <file>` run overwrites the whole
artifact with a partial one, so unrelated files then read as under-covered. That hazard is known and
accepted (a full suite run repairs it).

The session exposed a second, undocumented way — an **interrupted full run**:

- 20:18:31 — a canonical `bun run spur-check` that had hung (see 1204) was killed mid-suite; it had
  already flushed `.coverage/lcov.info`.
- 20:20 — `bun run test-post-check` reported three `coverage-gate` errors on files that **no commit in
  the session touched**: `packages/app/src/services/run-storage.ts` 57%,
  `packages/app/src/services/run-store-service.ts` 14%,
  `packages/app/src/services/scheduler-custom-job-service.ts` 87%. `git log --name-only` over the
  session's commits and the concurrently merged `a0fad8c09` shows none of them.
- 20:24 — a completed `bun run spur-check` (11385 pass / 1 fail, 658 files) refreshed the artifact and
  `bun run test-post-check` returned `All 2 rules passed` with no change to those files.

The same class appeared earlier in the session in the other direction: a stale `.coverage` left over
from a previous tree state made a fresh `main` report `scheduler-custom-job-service.ts 87%` until the
landing gate refreshed it.

**Why it matters beyond noise.** It compounds with the hang (task 1204): the gate hangs → the operator
kills it → the kill poisons the coverage artifact → the *next* post-check fails on innocent files,
which reads as a content regression and can burn a whole diagnosis cycle. During this session it did
exactly that, and the only reason it was not mistaken for a real defect is that the three files were
cross-checked against the commit list. Note the observed artifact had the **normal** count of `SF:`
entries (444) — so file *count* is not a usable partial-detection signal.

### Requirements

- [ ] R1. A `coverage-gate` verdict is never derived from a coverage artifact that an interrupted or
      targeted run produced; decide and state the mechanism (completion marker in the artifact's
      producer, atomic publish, or a producer-stamped run identity the rule validates).
- [ ] R2. `bun run test-post-check` on a tree whose last coverage-producing run did not complete
      reports the situation explicitly — either a skip with a named reason or a distinct finding — and
      does **not** report per-file under-coverage for files the interrupted run never reached.
- [ ] R3. A completed full run still fails the gate for a genuinely under-covered file (no weakening
      of the threshold); the 90% per-file rule and `bunfig.toml`'s `coverageThreshold` stay authoritative.
- [ ] R4. The mechanism is cheap: the producing path must not add a second full-suite pass, and the
      rule must not walk the source tree to count files.

### Acceptance Criteria

- [ ] AC1 — With a coverage artifact produced by an interrupted run, post-check does not emit
      per-file under-coverage errors for files that run never reached (req: R1, R2)
- [ ] AC2 — With a coverage artifact from a completed full run, a deliberately under-covered file
      still fails with the same message shape and threshold (req: R3)
- [ ] AC3 — `bun run test-post-check` on the unmodified tree is green after any completed full run,
      and the new behaviour costs no extra suite execution (req: R3, R4)
- [ ] AC4 — The chosen mechanism is recorded where the rule's other partial-artifact note lives
      (`config/rules/quality/coverage-gate.yaml` header), so the next reader sees both variants (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Evidence pinned in the Background, deliberately narrow.** Interrupted-run poisoning is
*reproduced* (red at 20:20 on three untouched files, green at 20:24 after a completed run, with the
only change being a completed full run). The mechanism is **not** established beyond that: the
observed artifact carried the normal `SF:` count (444), so "fewer files" is not the discriminator —
per-file counters for unreached files are the likely cause, and that has not been measured. The
implementer should reproduce first and record what actually differs in the artifact (counters vs
entries) before choosing the fix.

**Candidate mechanisms, cheapest first.**
- (a) *Producer-stamped completion*: whatever writes `.coverage/lcov.info` also writes a small
  completion/sidecar marker naming the full run; the rule refuses an artifact without a marker for the
  current tree state and reports R2's explicit skip. Cheapest, no second pass, no tree walk.
- (b) *Atomic publish*: write the artifact to a temp dir and move it into place only on completion, so
  an interrupted run cannot leave a half artifact. Removes the failure at the source but does not help
  the leftover-stale case (the earlier 87% observation), which (a) also covers.
- (c) *Rule-side sanity gate*: compare the artifact's coverage of files the tree declares. Rejected
  unless (a)/(b) prove impossible — it walks the source tree, which R4 forbids.

Prefer (a), optionally (a)+(b). Note the rule's existing header note covers the targeted-run variant;
this task owns the interrupted-run variant and should extend that note rather than duplicate it.

**Out of scope.** The hang itself is task 1204; this task assumes an interrupted run is a normal
operator response to one and must not poison the next verdict.

### Plan

1. Reproduce deterministically: start a full `bun run test` and interrupt it mid-suite; capture the
   resulting `.coverage/lcov.info` and `git diff --stat` it against an artifact from a completed run.
   Record which counters/entries differ (the Background leaves this open on purpose).
2. Implement the chosen mechanism — prefer (a) producer-stamped completion with an explicit skip
   finding, since it also covers a stale artifact from an earlier tree state.
3. Add both regression fixtures: an interrupted artifact must not produce per-file errors for
   unreached files; a completed artifact with a deliberately under-covered file must still fail at the
   90% threshold with the existing message shape.
4. Extend the `coverage-gate.yaml` header note to cover the interrupted-run variant beside the
   existing targeted-run note.
5. Run the owning gate plus `bun run spur-check`; confirm `test-post-check` reports the same 2-rule
   count with the new behaviour.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
