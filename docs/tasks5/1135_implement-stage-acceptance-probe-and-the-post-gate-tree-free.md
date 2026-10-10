---
schema_version: 1
name: Implement-stage acceptance probe and the post-gate tree-freeze boundary
status: done
template: feature-impl
created_at: 2026-10-09T05:28:31.520Z
updated_at: "2026-10-10T01:26:55.646Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 10
dependencies: ["1136"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1135-verdict.json
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

**Refine corrections (2026-10-09)**

- **Drift detection is not entirely unenforced.**
  - Claim: "Nothing today detects 'the tree changed after the gate PASSed'".
  - Verified: `config/workflows/task-pipeline.yaml:135-146,832-839` already re-captures `proofDigestNow` with `expect: ${vars.proofDigest}` at verify entry and again at record entry. A mismatch fires `workflow.tripwire.fired` and fails the run (`packages/app/src/workflow/actions/proof-fingerprint.ts:25,57`). `test-recheck` already re-captures `proofDigest` after bounded remediation, which is the existing re-certify path.
  - Actual gaps: (a) review entry has no compare, so a review is spent on a drifted tree and only marked `skipped` later in the proof block (`:747,886`); (b) a mismatch reports a digest pair, not the drifted paths.
  - Resolution: R4/R5 are rewritten to those two gaps. No second re-certify mechanism is added; mid-run edits route to the existing `test-fix → test-recheck` hop.
- **R3 "refuse".** The driver cannot intercept arbitrary file writes; it can only detect them. R3 is now a stage-ordering rule enforced by R4's detection, and AC3 is reworded from "refused" to "detected before review is spent".
- **Duplicate numbering.** R6 and AC6 appeared twice. The static-invariant self-check is renumbered R8 / AC8, and AC8 binds R8.
- **R8 sources verified.** `config/rules/*/env-var-hygiene.yaml` exists. `script-contract-check` is a `package.json` script (`spur-check-feature`, `:90`). `spur-check` and `spur-check-new` are identical chains (`package.json:88-89`).
- **Existing probe language.** `plugins/sp/skills/code-implementation/SKILL.md:105-124` already says "run only targeted probes", meaning unit/targeted tests, not a surface probe. R1 extends that section; it does not add a new one. Payload field 6 is at `inline-pipeline-driver.md:584`.

### Requirements

- [x] R1. **Implement-stage surface probe.**
  - Before an `implement` stage reports done, it runs at least one end-to-end probe of each new or changed **public surface**: CLI verb/flag, HTTP route, or plugin script entry.
  - The probe runs against a throwaway project root, never the repo corpus.
  - The stage records the exact command and its observed output as acceptance evidence.
  - A stage that changed no public surface records `probe: not-applicable (no public surface changed)` instead.
  - A service-only test suite does not satisfy R1.
- [x] R2. **Probe evidence travels in the dispatch payload and the stage result.**
  - Payload field 6 (`inline-pipeline-driver.md:584`) names the probe requirement.
  - The stage report carries probe command and output, or the not-applicable line.
  - A stage that returns neither is recorded `done` with a `probe-missing` marker in the run log and the batch report. It is never silently treated as complete.
- [x] R3. **Hygiene and authoring precede the gate.**
  - All tree edits belong to `implement`, or to the bounded `test-fix` remediation hop that already re-captures the digest at `test-recheck`. This covers stray-file cleanup, anchor qualification, contract pins, doc edits, and task-section writes other than the pipeline-owned `## Testing`/`## Review`/`## Solution`.
  - No other state edits the tree after the quality gate captures `proofDigest`.
  - The rule is stated in the driver reference and the code-implementation skill. R4 enforces it by detection.
- [x] R4. **Review-entry digest compare.**
  - `review` gets the same `proof.fingerprint` compare that verify and record already have: `var: proofDigestNow`, `expect: ${vars.proofDigest}`.
  - A mismatch stops before the review dispatch is spent. It never reaches a review whose proof stage is later marked `skipped`.
  - The existing tripwire/failed routing is reused. No new re-certify path is added; legitimate mid-run edits go through `test-fix → test-recheck`.
- [x] R5. **A digest mismatch names the drifted paths.**
  - At quality-gate entry, the driver snapshots the non-corpus tree state: `git status --porcelain=v1 -uall` plus `git diff --name-only HEAD`, excluding `DEFAULT_EXCLUDE_GLOBS`, written to `.spur/run/<run-id>-gate-paths.txt`.
  - A `proof.fingerprint` mismatch at review, verify or record diffs the current state against that snapshot. The tripwire event and run log name the changed paths, not only the D1/D2 pair.
  - The fingerprint's untracked-file behavior is documented beside `DEFAULT_EXCLUDE_GLOBS` (`proof-input-fingerprint.ts:241`): an untracked file outside `docs/tasks*`/`docs/features*` is part of the certified set.
- [x] R6. **The probe is cheap and safe.**
  - It runs under a temp project root and leaves no tracked change.
  - It needs no network beyond the CLI under test.
  - It is bounded: a 120 s timeout per invocation and output capped at 8 KiB.
  - A probe failure is probe evidence, never a corpus mutation.
- [x] R7. **Docs and bundle ship in the same change.** Update:
  - the driver reference: payload field 6, the R3 ordering rule, the R5 path-naming line;
  - `plugins/sp/skills/code-implementation/SKILL.md` § implement scope: where the probe sits in the stage;
  - the YAML header comment at `task-pipeline.yaml:135-146`: review joins the bracket.

  Then run `bun run --filter @gobing-ai/spur build:bundle`.
- [x] R8. **The probe also covers the repo's static gate invariants, scoped to changed paths.**
  - The H1 batch (2026-10-08) spent full-gate runs on three defects a stage-time self-check would have caught:
    - direct environment reads (`env-var-hygiene` rule);
    - a plugin script whose generated `.mjs` twin was stale (`script-contract-check`);
    - one of the paired `spur-check`/`spur-check-new` chains changed alone.
  - The stage therefore runs, over its changed paths only:
    - `spur rule run` with the configured pre-check preset;
    - `bun run script-contract-check` when a plugin script was touched;
    - the paired-script parity test when `package.json` changed.
  - The single full project check remains the pipeline `test` hop's job.

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
  Given an implement stage that returns neither probe evidence nor the not-applicable line
  When the driver records the stage boundary
  Then the stage result carries a probe-missing marker
  And the run log and batch report state the marker explicitly
  And a stage that returned probe evidence or the not-applicable line carries none
```

```gherkin
Scenario: AC3 — A post-gate edit is detected before review is spent (req: R3, R4)
  Given the quality gate captured proofDigest D1
  And a later non-remediation state edits a non-corpus file
  When the driver enters review
  Then the review-entry proof.fingerprint compare fails before any review dispatch
  And the run routes through the existing tripwire to failed
  And a tree edit made inside test-fix is re-captured at test-recheck and does not trip the compare
```

```gherkin
Scenario: AC4 — Pipeline-owned section writes never trip the compare (req: R4)
  Given the record step writes the Testing, Review and Solution sections after verify
  When the record-entry compare runs
  Then it passes, because those sections are outside the fingerprinted task sections
```

```gherkin
Scenario: AC5 — Drift reporting names the path, not just the digest (req: R5)
  Given an untracked file apps/server/docs/stray.md is added after the gate snapshot
  When any proof.fingerprint compare fails
  Then the tripwire event and run log name apps/server/docs/stray.md
  And the untracked-file behavior is documented beside DEFAULT_EXCLUDE_GLOBS
```

```gherkin
Scenario: AC6 — The probe is bounded and non-polluting (req: R6)
  Given an implement-stage probe runs a command that never exits
  When 120 seconds elapse
  Then the probe is killed and recorded as failed probe evidence with at most 8 KiB of captured output
  And the tracked worktree is unchanged apart from the task's own deliverable
```

```gherkin
Scenario: AC7 — Owning docs and bundle reflect the probe and freeze rules (req: R7)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass
  And the driver reference documents the probe evidence requirement, the ordering rule and path-naming
  And the code-implementation skill states where in the stage the probe belongs
```

```gherkin
Scenario: AC8 — A static-invariant defect is caught at stage time (req: R8)
  Given an implement stage whose change reads process.env directly, leaves a stale generated twin, or edits only one of spur-check and spur-check-new
  When the stage runs its changed-path self-check
  Then the stage reports the failing invariant and file before it reports done
  And the pipeline test hop is not the first place that defect is seen
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:03:52.042Z

- **Q: Build a new "re-certify" branch for post-gate drift?** A: No. `test-fix → test-recheck` already re-captures `proofDigest` after a bounded remediation, and verify/record already compare and fail. The only gaps are the missing review-entry compare and digest-only reporting (R4/R5).
- **Q: Can the driver refuse a post-gate write?** A: No. A host session cannot intercept file writes. The contract is ordering (R3) plus early detection (R4).
- **Q: Extend the exclusion globs so stray files stop mattering?** A: No. A stray file is real proof input. The fix is ordering and naming the path (R5).

### Design

- **Probe = the surface contract, not more unit tests.** The failure mode behind cost 1 is a *missing verification seam*, not a missing assertion: 19 service tests were green while `task create --feature <verifying>` failed. The cheap, decisive seam is the CLI boundary against a temp project — the same shape the review lane used to find the defects in minutes. So the requirement is one **surface probe per changed public entry point**, executed by the stage that owns the change, with its output travelling as acceptance evidence (driver payload field 6) rather than as another unit test.

- **Where the probe belongs.** Inside the implement stage, after the code and its tests are green, and before the stage reports done — i.e. in the stage's own scope rules (`plugins/sp/skills/code-implementation/SKILL.md`), with the *enforcement* in the driver contract (payload field 6 + the stage-boundary record). The stage already must produce non-corpus changes (`requireDiff`); the probe adds "and one real invocation per changed surface" without adding a new state or a new gate.

- **Freeze + drift (R3/R4/R5) closes two gaps; it adds no new mechanism (corrected 2026-10-09).** The pipeline already re-captures `proofDigestNow` against `proofDigest` at verify and record entry and fails on mismatch. `test-fix → test-recheck` is already the declared re-certify path. Two things are missing: a compare at **review** entry, so a review is never spent on a drifted tree, and **path naming** on mismatch, via a gate-entry `git status`/`git diff` snapshot diffed by `proof.fingerprint`.

- **Why ordering beats re-certification.** A gate costs 6–10 min plus a review dispatch. Moving hygiene into implement places those edits *before* the gate, where they cost nothing. A genuine later fix goes through the bounded `test-fix` hop, which re-captures the digest.

- **Boundaries.** Do not move the pipeline-owned `## Testing`/`## Review`/`## Solution` writes into implement (they follow the verdict and are digest-free by design — `proof-input-fingerprint.ts:335` reads only the planning sections). Do not weaken `requireDiff`. Do not turn the probe into a test suite (one invocation per changed surface, bounded timeout, temp root). Do not extend the exclusion globs to make strays invisible — the stray-file class is real evidence and the fix is ordering, not blindness; document the behaviour instead (R5).

- **Failure inventory to write before code** (the reason this task is worth a driver-contract change rather than a tutorial): probe that pollutes the corpus; probe that hangs; probe evidence claimed but not run; probe requirement blocking a stage that changed no public surface; freeze rule blocking the pipeline's own Testing/Review write; drift detection firing on a task-corpus write that is legally digest-free; drift stop that names a digest but not the path.

### Plan

1. **Write the failure inventory first.**
   - The probe pollutes the corpus.
   - The probe hangs.
   - Probe evidence is claimed but not run.
   - The probe requirement blocks a stage that changed no public surface.
   - The review-entry compare trips on a legal task-section write.
   - The compare trips on a `test-fix` edit that `test-recheck` re-captured.
   - A drift report names no path.
   - The gate-path snapshot includes corpus globs.
   - The R8 self-check runs repo-wide instead of over changed paths.
2. **Write the tests before the implementation.**
   - `plugins/sp/tests/inline-pipeline-driver.test.ts` (it executes the real graph): the review-entry compare, `test-fix` re-capture not tripping, and the `probe-missing` marker.
   - `packages/app/tests/workflow/` for `proof.fingerprint` path naming against a snapshot fixture.
3. **R4.** Add the `proof.fingerprint` compare to `review` `onEnter` in `config/workflows/task-pipeline.yaml`, mirroring `:832-839`, then regenerate the bundled copy.
4. **R5.**
   - Write the gate-entry snapshot in the quality-gate `onEnter` next to the `proofDigest` capture (`:494`).
   - Teach `packages/app/src/workflow/actions/proof-fingerprint.ts` to read an optional `pathsFile` option and include the diffed paths in the tripwire payload. Extend `ACCEPTED_OPTION_KEYS`.
   - Add the doc comment at `proof-input-fingerprint.ts:241`.
5. **R1/R2/R6/R8.** Edit the code-implementation skill's implement-scope section (`:105-124`), payload field 6, and the stage-boundary `probe-missing` recording in the driver reference.
6. **R7 docs and bundle.** Run `bun run --filter @gobing-ai/spur build:bundle`.
7. **Acceptance drill.**
   - A change adding one CLI flag produces probe evidence.
   - A deliberate post-gate stray file stops at review entry naming that path.
   - Record both in Testing.
8. Run `bun run spur-check` once on the final tree.

### Solution

Change map (worktree `spur-new-runall-1135-1142-42b58deb`):

| File | Change |
| --- | --- |
| `config/workflows/task-pipeline.yaml:494` | `test` entry snapshots the non-corpus tree state (`git status --porcelain=v1 -uall` + `git diff --name-only HEAD`, both excluding `docs/tasks*`/`docs/features*`) into `.spur/run/<run-id>-gate-paths.txt` immediately before the `proofDigest` capture (R5). |
| `config/workflows/task-pipeline.yaml:594` | `test-recheck` entry re-snapshots after the bounded remediation, so a legitimate `test-fix` edit is not read as drift (R5). |
| `config/workflows/task-pipeline.yaml:717` | `review` entry gains the `proof.fingerprint` compare (`var: proofDigestNow`, `expect: ${vars.proofDigest}`) ahead of its `agent.run`, joining the bracket verify/record already had (R4). |
| `config/workflows/task-pipeline.yaml:135` | Header comment records that review joins the bracket and that a mismatch names the drifted paths (R7). |
| `packages/app/src/workflow/actions/proof-fingerprint.ts:63` | `computeDriftedPaths` diffs the current tree state against the gate snapshot, then a mismatch reports the paths in the error, the `data.driftedPaths` payload, the tripwire event and the run log (`proof-compare-failed … drifted paths: …`) (R5). |
| `packages/app/src/workflow/proof-input-fingerprint.ts:241` | `DEFAULT_EXCLUDE_GLOBS` is exported and documents the untracked-file behaviour: an untracked file outside the corpus exclusions is part of the certified set (R5). |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:584` | Payload field 6 gains the public-surface probe contract (temp root, one invocation per changed surface, exact command + observed output, bounded 120 s / 8 KiB, `probe: not-applicable …`, `probe-missing` marker in run log and batch report) plus the R8 changed-path static self-check (R1/R2/R6/R8). |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:757` | New § Post-gate tree freeze: the ordering rule (every tree edit in `implement` or `test-fix`), the review compare, and the path-naming guarantee (R3/R4/R5). |
| `plugins/sp/skills/code-implementation/SKILL.md:127` | § Public-surface probe: where the probe sits in the stage, its bounds, the not-applicable line, and the changed-path static self-check (R1/R6/R8). |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts` | Static pins over the driver reference, the skill and the YAML (review compare position, snapshot-before-capture order in `test`/`test-recheck`, exclusion globs, untracked-file doc) (R1–R8). |
| `packages/app/tests/workflow/actions/proof-fingerprint.test.ts` | Drift case: a snapshot plus an untracked file added afterwards makes the compare fail and name `apps/server/docs/stray.md` (AC5). |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`, `packages/app/tests/workflow/pipeline-action-budget.test.ts`, `plugins/sp/tests/task-pipeline-resilience.test.ts` | Updated to the new review action order, the raised action ratchet (52 → 55, the change record) and a locate-by-content gate-shell lookup instead of a positional index. |

Rationale: the review lane paid three times for defects a surface probe would have caught in minutes (task 1135 Background), and a post-gate edit invalidated the certified digest without naming the file that moved. The probe is a contract on the stage that owns the change — not a new state or gate — and the freeze is ordering plus early detection, since a host session cannot intercept a file write.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` payload field 6 states the public-surface probe: one end-to-end invocation per changed CLI verb/flag, HTTP route or plugin entry, against a throwaway project root, with the exact command and observed output; `plugins/sp/skills/code-implementation/SKILL.md` § Public-surface probe places it in the stage; both pinned in `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts`. |
| R2 | MET | Field 6 carries the `probe: not-applicable (no public surface changed)` line and the `probe-missing` marker rule ("recorded `done` with a marker in the run log and the batch-report row"); pinned in the same contract test. |
| R3 | MET | The driver reference § Post-gate tree freeze states that every tree edit belongs to `implement` or `test-fix`, that no other state edits the tree after `test` captures `proofDigest`, and that the skill carries the same rule. |
| R4 | MET | `config/workflows/task-pipeline.yaml` `review` entry has one `proof.fingerprint` (`proofDigestNow`, `expect: ${vars.proofDigest}`) as its first action, before `agent.run`; asserted by `tree-freeze-contract.test.ts` and by `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`. |
| R5 | MET | `test` and `test-recheck` snapshot `.spur/run/<run-id>-gate-paths.txt` before the digest capture (asserted in the contract test); `computeDriftedPaths` in `packages/app/src/workflow/actions/proof-fingerprint.ts` names the drifted paths in the error, the `data.driftedPaths` payload, the tripwire event and the run log; `DEFAULT_EXCLUDE_GLOBS` documents the untracked-file behaviour. |
| R6 | MET | Field 6 and the skill state the bounds (120 s per invocation, 8 KiB output cap, no network beyond the CLI under test, temp root only, failure is evidence not mutation). |
| R7 | MET | The owning docs shipped in this change (`plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, `plugins/sp/skills/code-implementation/SKILL.md`, `config/workflows/task-pipeline.yaml`); `bun run --filter @gobing-ai/spur build:bundle` (`apps/cli/package.json:52`) ran; the driver reference, the skill and the YAML header comment were updated in the same change; `bun run spur-check` (pre-check, full suite 10744 pass / 0 fail, post-check) is green. |
| R8 | MET | The skill's "Changed-path static self-check" names the pre-check preset run, the `script-contract-check` trigger and the paired-script parity trigger over changed paths; pinned by the contract test. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A changed CLI surface is probed before the stage reports done (req: R1) | MET | test | contract pins in `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts` (payload field 6 + skill § Public-surface probe) |
| AC2 — A missing probe is visible before the review lane pays for it (req: R2) | MET | test | contract pin "R2: a missing probe is a probe-missing marker in the run log and the batch-report row" |
| AC3 — A post-gate edit is detected before review is spent (req: R3, R4) | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` asserts the review compare precedes the dispatch; the drift mechanism is exercised by `packages/app/tests/workflow/actions/proof-fingerprint.test.ts` |
| AC4 — Pipeline-owned section writes never trip the compare (req: R4) | MET | test | the fingerprint scopes task content to the planning sections only (`packages/app/src/workflow/proof-input-fingerprint.ts`), unchanged by this task and covered by its existing suites |
| AC5 — Drift reporting names the path, not just the digest (req: R5) | MET | test | `packages/app/tests/workflow/actions/proof-fingerprint.test.ts` "AC5/R5: a digest mismatch names drifted paths when snapshot file exists" |
| AC6 — The probe is bounded and non-polluting (req: R6) | MET | test | the bounds are pinned in `tree-freeze-contract.test.ts`; the probe is a stage contract, so no probe process runs in this repo's tests |
| AC7 — Owning docs and bundle reflect the probe and freeze rules (req: R7) | MET | command | `bun run spur-check` green (10744 pass / 0 fail) and `build:bundle` executed in this change |
| AC8 — A static-invariant defect is caught at stage time (req: R8) | MET | test | contract pin for the changed-path static self-check in the skill |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Self-review over the full diff. No P1/P2 findings; disposition PASS.

| Sev | Finding | Disposition |
| --- | --- | --- |
| P1 | — | none found |
| P2 | — | none found |
| P3 | The probe and the `probe-missing` marker are enforced by the driver contract (a model-followed reference) rather than by interposing code, so a driver that ignores the contract degrades to the old behaviour. | Accepted and explicit in the task's Design: "the driver cannot refuse a post-gate write", and the same is true of a stage that omits its probe — the reference plus pins are the enforcement the harness actually has. The alternative (gating every stage on a machine-checked probe artifact) is a new gate, which the Q&A closed against. |
| P3 | The gate-entry snapshot adds two git invocations to `test` and `test-recheck`. | Accepted: sub-second, and paid once per gate entry. It is the only way a mismatch can name the path rather than the digest pair. |
| P3 | The task-pipeline action ratchet rises 52 → 55. | Recorded in `pipeline-action-budget.test.ts` as the change record, per that test's own convention; the three actions are the review compare and the two snapshots. |
| P4 | `computeDriftedPaths` reports both new and vanished lines from the snapshot, and extracts a path from a porcelain line heuristically. | Accepted: the snapshot stores raw `git status`/`git diff` lines, so the comparison is text-exact and conservative — a path that cannot be extracted is reported verbatim rather than dropped. Verified by the AC5 test on an untracked file. |
| P4 | The snapshot is a shell action inside the YAML, so its exclusion globs must stay in lockstep with `DEFAULT_EXCLUDE_GLOBS`. | Accepted with a pin: `tree-freeze-contract.test.ts` asserts the exclusions on the snapshot command, and the fingerprint comment documents the same set. |

Residual risk: the review-entry compare is a new failure mode on a path that previously always
reached review — a tree edited between the gate and review now fails the run. That is the intended
behaviour (task 1135 R4) and the declared recovery is `test-fix → test-recheck`; the snapshot refresh
at `test-recheck` is what keeps a legitimate remediation from tripping it.

### References

- Incident: run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132), 2026-10-08 — six review passes, five repair cycles; defects 1–3 in task 1134's sibling analysis were CLI-visible only; two post-certification mutations (stray `apps/server/docs/tasks/0001_server-reopen-probe.md`; three R5 contract pins) cost two extra gate+review+verify cycles.
- Digest mechanics: `packages/app/src/workflow/proof-input-fingerprint.ts:241` (`DEFAULT_EXCLUDE_GLOBS = ['docs/tasks*', 'docs/features*']`), `:335` (task half reads Background/Requirements/Acceptance Criteria/Design/Plan only), `computeProofInputFingerprint` (`:393`).
- Driver surfaces: `inline-pipeline-driver.md` § Dispatch payload (field 6, acceptance evidence), § Native-subagent dispatch, § Chunked implement dispatch contract, § YAML interpreter (`agent.run` honouring `expectFile`/`requireDiff`), and the run-log/status-file conventions.
- Stage scope: `plugins/sp/skills/code-implementation/SKILL.md` (§ Implement scope; § Changed-path targeted checks) — the pipeline YAML cites task 1110 R3 as the owner of the implement brief.
- Probe pattern precedent: `plugins/sp/scripts/wrapup-steps.ts` (probe + run-scoped status file), `.spur/run/<wbs>-test-gate.status` / `-check-receipt.json` (digest-bound gate receipts).
- Related: ADR-119 (validation runs at the scope of the invariant it protects), ADR-117 (every surface owes the structured action trace), feature D62 (workflow execution economy), H1 (spur-dev umbrella skill).

### History

- 2026-10-09T05:30:22.368Z backlog → todo (system)
- 2026-10-10T01:26:49.282Z todo → wip (system)
- 2026-10-10T01:26:52.469Z wip → testing (system)
- 2026-10-10T01:26:55.634Z testing → done (system)

