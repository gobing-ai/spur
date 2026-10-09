---
schema_version: 1
name: Implement-stage acceptance probe and the post-gate tree-freeze boundary
status: todo
template: feature-impl
created_at: 2026-10-09T05:28:31.520Z
updated_at: "2026-10-09T05:30:22.368Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
---

## 1135. Implement-stage acceptance probe and the post-gate tree-freeze boundary

### Background

**Origin.** Pipeline run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132, 2026-10-08) needed **six** review passes (~39 min of dispatches) and **five** repair cycles (~3 h 47 m including five full gates) to certify a change whose final defect budget was six. Two distinct, avoidable costs produced that churn.

**Cost 1 — the implement stage handed over an un-probed public surface (~2 h of churn).** Three of the six defects were *only* observable through the CLI, not through the service seams the implementation's own tests covered:
1. the R2 parent-status guard was inert in this repo's real layout because `deriveFeaturesDir()` keyed on a `/tasks$` basename while the active folder is `docs/tasks5` (found by review pass 3, after two passes missed it);
2. `task create --feature <verifying>` failed end-to-end with `FSMError: … undeclared state "verifying"` because the reopen borrowed the **task** lifecycle profile (found by pass 3, fixed in cycle 3);
3. `task batch-create` reported the implied `ac_altitude`/`ac_numbering` frontmatter without writing it (found by pass 2).
Passes 1–2 (read-only) missed all three; passes 3–4 found them within minutes of building a **temp-project CLI probe**. The implementation had 19 service-level tests green while the primary verb was broken: the stage verified its units, not its surface. The review lane then paid for that gap, three times, at ~7 min of dispatch plus a gate per cycle.

**Cost 2 — the tree was mutated after it had been certified (~1 h of churn).** Two changes landed after the quality gate had recorded PASS for digest `sha256:fc21cf12…` and a reviewer had certified it:
- deletion of a stray untracked artifact (`apps/server/docs/tasks/0001_server-reopen-probe.md`, created by an earlier failed test attempt) — a *hygiene* action that belongs to implement;
- addition of three R5 contract pins demanded by the verify pass.
Each mutation invalidated the certified input set and forced gate + review + verify again (two extra cycles, two extra ~7–12 min gates, plus a reviewer re-dispatch each time).

**Current code facts (verified 2026-10-08).**
- **What the digest actually covers.** `packages/app/src/workflow/proof-input-fingerprint.ts:241` — `DEFAULT_EXCLUDE_GLOBS = ['docs/tasks*', 'docs/features*']` for the git-tree half; `:335` — the task-file half reads **only** `Background, Requirements, Acceptance Criteria, Design, Plan` (so `## Testing`/`## Review` writes are free, which is why the pipeline may write them). Consequence: an **untracked file outside those globs** (e.g. `apps/server/docs/…`) is part of the certified input set, while task-corpus and planning-section writes are not. That asymmetry is exactly what turned a stray test artifact into two extra certification cycles.
- **Where the implement brief lives.** `inline-pipeline-driver.md` § Dispatch payload field 6 is *"the implement-stage acceptance-evidence requirement … the task's AC identities verbatim"*; the stage's own scope rules are owned by `plugins/sp/skills/code-implementation/SKILL.md` (§ Implement scope, dependency-aware § Changed-path targeted checks) per the pipeline YAML's comment (task 1110 R3).
- **What already exists to build on.** The inline driver requires a `requireDiff` stage to produce non-corpus changes; it records run-scoped status files under `.spur/run/`; the wrapup protocol already demonstrates the "probe + status file" pattern (`plugins/sp/scripts/wrapup-steps.ts`); `spur task check <wbs> --as todo` is the deterministic form check the stage already runs.
- **The freeze boundary is implied but unenforced.** Nothing today detects "the tree changed after the gate PASSed": the driver re-uses the digest value it wrote to `.spur/run/<wbs>-proof-digest.txt`, so a post-gate edit is discovered only when the verify/record marker comparison fails — after the whole cycle has been spent.

### Requirements

- [ ] R1. **Implement-stage acceptance probe.** Before an `implement` stage reports done, the stage must run at least one end-to-end probe of each new/changed **public surface** against a throwaway project (never the repo corpus) and record the exact command plus its observed output as acceptance evidence. For a CLI surface that means at least one real invocation of every new or changed verb/flag combination; a service-only test suite does not satisfy this.
- [ ] R2. **The probe is carried in the dispatch payload and in the stage result.** The inline driver's dispatch payload field 6 (acceptance evidence) names the probe requirement, and the stage's returned report carries the probe command + output. A stage that returns without a probe is recorded `done` with a `probe-missing` marker in the run log and the batch report (never silently treated as complete), so the gap is visible before the review lane spends a cycle.
- [ ] R3. **Tree freeze at gate PASS.** From the moment the quality gate records PASS for a digest, the run must not mutate the tree. All hygiene and authoring — untracked stray-file cleanup, anchor qualification, contract pins, doc edits, task-section writes other than the pipeline-owned `## Testing`/`## Review`/`## Solution` — belongs to the implement stage or earlier.
- [ ] R4. **Drift detection with an explicit choice.** Before each state that consumes the digest (review, verify, record) the driver recomputes it. On mismatch it must either (a) finish the pending write and then **explicitly re-run the quality gate on the new digest** (a declared `re-certify` path that records the old→new digest pair in the run log and the gate log), or (b) stop with `failed` naming the drifted paths. Silently reusing the stale digest, and silently re-certifying, are both forbidden.
- [ ] R5. **Digest hygiene is documented and reported.** The fingerprint's untracked-file behaviour is stated next to the exclusion globs (an untracked file outside `docs/tasks*`/`docs/features*` is part of the certified set), and a drift stop names the offending path(s) rather than a bare digest pair.
- [ ] R6. **The probe must be cheap and safe.** It runs against a temp project root (never the repo corpus), leaves no tracked change, must not require network access beyond the CLI under test, and is bounded (a timeout plus a bounded output capture), so a probe can never become a new source of run failures or corpus pollution.
- [ ] R7. **Same-change docs and bundle.** Update the driver reference (dispatch payload field 6, the freeze/drift rule, the probe evidence line), the `sp:code-implementation` skill's implement-scope section (the probe requirement and where it belongs in the stage), and any run-record/observability doc that lists the run's status artifacts; rebuild the bundle.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A changed CLI surface is probed before the stage reports done (req: R1)
  Given an implement stage that added or changed a CLI verb or flag
  When the stage finishes
  Then its returned report contains at least one temp-project invocation per new or changed verb/flag combination
  And each probe entry carries the exact command and the observed output
  And no probe wrote inside the repository corpus
```

```gherkin
Scenario: AC2 — A missing probe is visible before the review lane pays for it (req: R2)
  Given an implement stage that returns without any probe evidence
  When the driver records the stage boundary
  Then the stage result carries a probe-missing marker
  And the run log and batch report state the marker explicitly
  And a stage that did return probe evidence carries none
```

```gherkin
Scenario: AC3 — No tree mutation after the gate certifies a digest (req: R3)
  Given the quality gate has recorded PASS for a digest
  When any later state attempts a tree or corpus mutation other than the pipeline-owned Testing, Review or Solution sections
  Then the mutation is refused by the driver contract
  And the refusal names the path and the state that attempted it
```

```gherkin
Scenario: AC4 — Post-gate drift is detected and resolved one of two declared ways (req: R4)
  Given the tree changed after the gate recorded PASS for digest D1
  When the driver recomputes the digest before review, verify or record
  Then it either completes the pending write and re-runs the quality gate on the new digest D2, recording the D1 to D2 pair
  Or it stops with failed naming the drifted paths
  And it never reuses D1 as if the tree were unchanged
```

```gherkin
Scenario: AC5 — Drift reporting names the path, not just the digest (req: R5)
  Given an untracked file outside the docs corpus globs is added after certification
  When the drift check runs
  Then the report names that path
  And the fingerprint's untracked-file behaviour is documented where the exclusion globs are declared
```

```gherkin
Scenario: AC6 — The probe is bounded and non-polluting (req: R6)
  Given an implement-stage probe runs
  When it completes or times out
  Then the run's tracked worktree is unchanged apart from the task's own deliverable
  And the probe ran under a temp project root with a bounded timeout and bounded captured output
  And a probe failure is reported as probe evidence rather than as a corpus mutation
```

```gherkin
Scenario: AC7 — Owning docs and bundle reflect the probe and freeze rules (req: R7)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass
  And the driver reference documents the probe evidence requirement and the freeze/drift rule
  And the code-implementation skill states where in the stage the probe belongs
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Probe = the surface contract, not more unit tests.** The failure mode behind cost 1 is a *missing verification seam*, not a missing assertion: 19 service tests were green while `task create --feature <verifying>` failed. The cheap, decisive seam is the CLI boundary against a temp project — the same shape the review lane used to find the defects in minutes. So the requirement is one **surface probe per changed public entry point**, executed by the stage that owns the change, with its output travelling as acceptance evidence (driver payload field 6) rather than as another unit test.

- **Where the probe belongs.** Inside the implement stage, after the code and its tests are green, and before the stage reports done — i.e. in the stage's own scope rules (`plugins/sp/skills/code-implementation/SKILL.md`), with the *enforcement* in the driver contract (payload field 6 + the stage-boundary record). The stage already must produce non-corpus changes (`requireDiff`); the probe adds "and one real invocation per changed surface" without adding a new state or a new gate.

- **Freeze + drift (R3/R4) is a contract change, not a new mechanism.** The digest already exists (`.spur/run/<wbs>-proof-digest.txt`), the gate already records per-digest PASS, and the review/verify markers already compare digests. What is missing is (a) the *rule* that nothing may mutate after gate PASS, and (b) a **declared resolution** when something did: either re-certify explicitly (finish the write, re-run the gate on the new digest, record the D1→D2 pair) or stop. Today the only trace of drift is a downstream marker mismatch, which surfaces after an entire cycle has been spent — the opposite of cheap.

- **Why "freeze" is the right default rather than "always re-certify".** Re-certification is legitimate but expensive by construction (a gate is 6–10 min plus a review dispatch). Making hygiene part of implement moves those edits *before* the gate, where they are free. The re-certify path exists for the genuine case where a later state discovers a required change; it must be explicit so the cost is attributable.

- **Boundaries.** Do not move the pipeline-owned `## Testing`/`## Review`/`## Solution` writes into implement (they follow the verdict and are digest-free by design — `proof-input-fingerprint.ts:335` reads only the planning sections). Do not weaken `requireDiff`. Do not turn the probe into a test suite (one invocation per changed surface, bounded timeout, temp root). Do not extend the exclusion globs to make strays invisible — the stray-file class is real evidence and the fix is ordering, not blindness; document the behaviour instead (R5).

- **Failure inventory to write before code** (the reason this task is worth a driver-contract change rather than a tutorial): probe that pollutes the corpus; probe that hangs; probe evidence claimed but not run; probe requirement blocking a stage that changed no public surface; freeze rule blocking the pipeline's own Testing/Review write; drift detection firing on a task-corpus write that is legally digest-free; re-certify looping (D2→D3→D4) without bound; drift stop that names a digest but not the path.

### Plan

1. **Failure inventory first** (see Design's list) — one row per way this change can be wrong, each with the surface that can fail.
2. **Tests before implementation**, at the cheapest failing surface: the inline driver smoke harness (`plugins/sp/tests/inline-pipeline-driver.test.ts`, which executes the real task-pipeline graph) for the stage-boundary marker and the freeze/drift branch; a service test for the digest recompute/compare helper; and a fixture test for the probe-evidence recorder.
3. **Implement R1/R2 (probe evidence)** — the stage-scope requirement in `sp:code-implementation`, the payload wording in the driver reference, the run-log/batch-report `probe-missing` marker, and the recorded command+output shape.
4. **Implement R3/R4 (freeze + drift)** — the post-gate immutability rule, the digest recompute before review/verify/record, the two declared resolutions (re-certify with a recorded D1→D2 pair, or stop naming the drifted paths), and the run-log lines for both.
5. **Implement R5/R6** — document the fingerprint's untracked-file behaviour beside the exclusion globs; bound the probe (temp root, timeout, capped capture) and assert it leaves no tracked change.
6. **Docs and bundle (R7)**, then `bun run --filter @gobing-ai/spur build:bundle`.
7. **Re-run the 1132 shape as the acceptance drill**: a change that adds one CLI flag must now produce the probe evidence and a single review pass; and a deliberate post-gate stray file must produce a drift stop naming that path (both recorded in Testing).
8. `bun run spur-check` once on the final tree; record the evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Incident: run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132), 2026-10-08 — six review passes, five repair cycles; defects 1–3 in task 1134's sibling analysis were CLI-visible only; two post-certification mutations (stray `apps/server/docs/tasks/0001_server-reopen-probe.md`; three R5 contract pins) cost two extra gate+review+verify cycles.
- Digest mechanics: `packages/app/src/workflow/proof-input-fingerprint.ts:241` (`DEFAULT_EXCLUDE_GLOBS = ['docs/tasks*', 'docs/features*']`), `:335` (task half reads Background/Requirements/Acceptance Criteria/Design/Plan only), `computeProofInputFingerprint` (`:393`).
- Driver surfaces: `inline-pipeline-driver.md` § Dispatch payload (field 6, acceptance evidence), § Native-subagent dispatch, § Chunked implement dispatch contract, § YAML interpreter (`agent.run` honouring `expectFile`/`requireDiff`), and the run-log/status-file conventions.
- Stage scope: `plugins/sp/skills/code-implementation/SKILL.md` (§ Implement scope; § Changed-path targeted checks) — the pipeline YAML cites task 1110 R3 as the owner of the implement brief.
- Probe pattern precedent: `plugins/sp/scripts/wrapup-steps.ts` (probe + run-scoped status file), `.spur/run/<wbs>-test-gate.status` / `-check-receipt.json` (digest-bound gate receipts).
- Related: ADR-119 (validation runs at the scope of the invariant it protects), ADR-117 (every surface owes the structured action trace), feature D62 (workflow execution economy), H1 (spur-dev umbrella skill).

### History

- 2026-10-09T05:30:22.368Z backlog → todo (system)

