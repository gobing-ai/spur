---
schema_version: 1
name: "Wire the ProofInputFingerprint digest into the canonical proof chain"
status: done
template: feature-impl
created_at: 2026-08-20T16:40:30.157Z
updated_at: "2026-08-20T17:04:42.386Z"
feature_id: D5
---

## 0612. Wire the ProofInputFingerprint digest into the canonical proof chain

### Background
Implements feature D5 scenario R9's remaining clause. Created 2026-08-20 when a `--force` re-verify
of task 0604 (driven by task 0611) found a genuine unmet requirement rather than the expected
bookkeeping pass.

**What the re-verify found.** D5's last four unverified scenarios (R7, R8, R10, R11) are all MET in
0604's own requirement rows. They are blocked only because 0604's *overall* verdict is PARTIAL, and
its single non-MET row is R3. R3's AC scenario carries three clauses:

1. *"read-only or enters a bounded fix, quality, review, and verify --fix none loop"* — **satisfied**:
   no residual stage exists at all. `task-pipeline2.yaml` is deleted, the canonical pipeline has no
   `residual-sweep` state, and zero `agent.run` actions occur after `verify`.
2. *"quality, review, and verify evidence name one unchanged ProofInputFingerprint digest"* —
   **UNMET. This task's whole scope.**
3. *"a passing eval-pipeline run … removes task-pipeline2.yaml"* — superseded by ADR-076; the outcome
   was reached by a consented deletion instead.

**Measured state on entry (2026-08-20):**

- `packages/app/src/workflow/proof-input-fingerprint.ts` **ships and is tested** —
  `computeProofInputFingerprint(options)` returns `sha256:<hex>` over a canonical composite of the git
  working tree, the task spec, and the feature spec. It is exported from `packages/app/src/index.ts:556`.
- It has **zero runtime call sites**. `rg computeProofInputFingerprint` outside its own file and tests
  matches only that re-export. `config/workflows/task-pipeline.yaml` contains **zero** fingerprint or
  digest references (one unrelated comment mentions the word).
- So ADR-071's proof-state invariant is **documented and capable but not mechanically enforced**: the
  capability was built by task 0603 and never wired.

**Why it was never wired.** 0604 deferred it deliberately — its Q&A records *"Verify `--fix all` stays
on canonical task until D5-M/N. D5-L is a primitive swap, not a proof-chain change. Final `--fix none`
is the residual/proof wave."* ADR-076 later retired D5-N and deleted `task-pipeline2.yaml`, which
removed the residual **mutation hazard** but never delivered the **digest chain**. Deleting the
duplicate graph closed one half of R3 and left this half open.

**Ownership is already decided — do not re-open it.** A workflow built-in action kind is the correct
home under ADR-051 (option (c) in task 0608's classification): built-ins live in `packages/app`, reach
the fingerprint capability directly, and require **no public `spur` noun, verb, or flag** and therefore
no ADR-051 consent round. A `plugins/sp/scripts/` twin is explicitly wrong here — those scripts are
standalone (`node:*` imports only) and hosting `packages/app` logic there means duplicating it, which
is the outcome feature D5 exists to prevent.
### Requirements
- [x] R1. A least-privilege built-in computes the proof-input digest (feature R9). Register a new workflow action kind in `packages/app/src/workflow/builtins.ts` that calls `computeProofInputFingerprint` and stores the result in a declared run variable. It reads the task and feature specs for the current `wbs` so the digest covers spec content, not just the working tree. **No new public `spur` noun, verb, or flag** — this is a built-in, not a CLI surface; a change that needs one is out of scope and routes to task 0608.

- [x] R2. The canonical pipeline brackets its proof chain with that digest (feature R9). `config/workflows/task-pipeline.yaml` captures the digest once after the quality gate passes, and re-computes and compares it before `record`. A mismatch — any change to a proof input between the quality gate and record — routes to `failed` rather than reaching `record`. `config/workflow-composition-baseline.json` records the new action facts in the same commit (T10).

- [x] R3. The evidence names the digest (feature R9). The verdict artifact carries the digest that was in force, so quality, review, and verification evidence all name one unchanged value rather than asserting proof-state validity in prose. A run whose digest changed mid-chain must be distinguishable after the fact from one whose digest held.

- [x] R4. Both the pass and the mismatch paths have failure-path tests. Unit tests cover the built-in (digest captured into the var; mismatch detected and surfaced) and the pipeline-level wiring is proven by the affected pipeline's own tests. A test that only exercises the happy path does not satisfy this requirement — the mismatch branch is the entire point.

**Non-goals:** adding a public CLI noun, verb, or flag (route to task 0608); changing `verify --fix all` to `--fix none` (that was tied to the retired residual wave — if it is still wanted it is a separate, recorded decision); re-introducing a residual-sweep stage; re-opening ADR-076; widening the digest to pipelines other than the canonical task pipeline; changing `computeProofInputFingerprint`'s own algorithm or output format.
### Acceptance Criteria
```gherkin
Feature: Proof-input digest wired into the canonical proof chain

  Scenario: R9 — Task execution preserves verification proof and ends with one canonical pipeline
    Given the ProofInputFingerprint capability ships but has no runtime call site
    When the canonical task pipeline runs its quality, review, and verification stages
    Then the proof-input digest is computed once after the quality gate and carried as a run variable
    And it is re-computed and compared before record, so a proof input changed mid-chain routes to failed
    And the verdict artifact names the digest that was in force
    And no new public spur noun, verb, or flag is introduced to achieve it
```
### Q&A
- **The gap is real, not a bookkeeping artifact.** Measured on entry: `computeProofInputFingerprint` has zero runtime call sites and `task-pipeline.yaml` has zero digest references. Do not "verify" this by reading ADR-071 and concluding the invariant holds — it is documented, not enforced.
- **Ownership is settled: a built-in, not a CLI verb.** Decided in Background against ADR-051 and task 0608's classification. A design that needs a public surface has not been reduced enough; stop and route it to 0608 rather than adding a verb here.
- **Do not duplicate `packages/app` logic into `plugins/sp/scripts/`.** Those scripts are standalone (`node:*` only). Hosting fingerprint logic there means two implementations of one contract — the exact outcome D5 exists to prevent (task 0604 already hit this with the idea handoff).
- **The mismatch branch is the deliverable.** A digest that is computed and never compared enforces nothing. R4 exists because a happy-path-only test would let that ship.
- **`--fix all` on verify is out of scope, deliberately.** 0604 tied the `--fix none` switch to the residual/proof wave that ADR-076 retired. Whether verify should still drop to `--fix none` is a separate decision with its own record — do not fold it in here to make the chain look tidier.
- **Unblocks, in order:** this task → 0604 re-verify reaches PASS (R3's last clause satisfied) → task **0611** clears D5's R7/R8/R10/R11 → D5 shippable. Do not attempt 0611 before this lands; it will halt again on the same clause.
### Design
**WHAT.** Make ADR-071's proof-state invariant mechanical: capture a `ProofInputFingerprint` digest at
the moment the proof is established, re-capture it immediately before the completion boundary, and
route a mismatch to `failed` instead of `record`.

**WHY.** The capability ships and is tested but has **zero runtime call sites**, so the invariant is
prose. Deleting `task-pipeline2.yaml` (ADR-076) removed the residual *mutation hazard* without
delivering the *digest chain*; this closes that half.

#### The bracket — left edge is verify-exit, NOT the quality gate

`03_ARCHITECTURE.md:1000` states the contract: *"Only `verified(D)` may cross the completion boundary,
and the boundary re-captures D immediately before transition."* So:

```
verify[0] agent.run /sp:dev-verify --fix all      (may legitimately write)
verify[1] shell     derive verdict artifact        <- proof established here
verify[2] proof.fingerprint  var: proofDigest      <- CAPTURE
          ...
record[0] proof.fingerprint  var: proofDigestNow, expect: ${vars.proofDigest}   <- COMPARE
```

**A quality-gate left edge does not work, and this is the load-bearing design decision.** `verify`
runs `/sp:dev-verify --fix all`, which writes to the tree by design whenever it repairs an UNMET or
PARTIAL row. Anchoring the digest before that would make every run that fixes anything fail on its own
repair — the guard would fire on legitimate work, not on a violation. Capturing after the verdict
artifact exists is both the invariant ADR-071 actually states and the only edge robust to `--fix all`.

D5 R9's wording is satisfied by this placement: *"the **final** quality, review, and verification
evidence names one unchanged proof-input digest **before record or done**"* — the verdict artifact is
the document that aggregates quality, review, and verification results, and it carries one digest that
is proven unchanged at the boundary.

#### Frozen names — no public surface

- Action kind: **`proof.fingerprint`** (built-in; `packages/app/src/workflow/actions/proof-fingerprint.ts`).
- Options: **`var`** (required, destination run var, validated `/^[A-Za-z_][A-Za-z0-9_]*$/` like
  `file.read.into-var`); **`expect`** (optional string — when present and non-empty, compare and fail
  the action on mismatch).
- Run vars added to `task-pipeline.yaml` `vars:`: **`proofDigest`**, **`proofDigestNow`** (both default `""`).
- Registered in `packages/app/src/workflow/builtins.ts` via `host.registerAction(new ProofFingerprintActionRunner(...), 'builtin')`.
- **No new `spur` noun, verb, flag, JSON field, or human-output contract.**

`setVars` propagation was **re-probed 2026-08-20** and works — it reaches both `${vars.X}` templates and
shell env vars — so a run var is a sound carrier. (A stale note claimed otherwise; do not design around it.)

#### Algorithm

1. `proof.fingerprint` calls `computeProofInputFingerprint({ cwd, taskContent, featureContent })`,
   reading the task for `vars.wbs` and its feature when one is set, so the digest covers spec content
   and not only the working tree.
2. It returns `setVars[var] = "sha256:<hex>"`.
3. With `expect` set and non-empty: on inequality return `{ ok: false, error: … }` naming **both**
   digests and the var. `record`'s default `fail` policy halts the sequence and routes to `failed`.
4. `expect` empty/absent = capture-only. That keeps one action kind for both edges rather than two.

#### Anti-patterns (do not implement)

- A public `spur` verb for this. Built-ins need no ADR-051 consent; a design needing a verb has not been
  reduced enough — route it to task 0608.
- A `plugins/sp/scripts/` twin. Those are standalone `node:*`-only; hosting `packages/app` logic there
  duplicates one contract into two implementations (0604 already hit this).
- Anchoring the capture before `verify` — see the bracket section; it fires on `--fix all`'s own repairs.
- Comparing at review **and** verify separately — a mid-verify write is legitimate, so per-stage
  comparison converts normal repair into failure.
- Changing `verify --fix all` to `--fix none`. Out of scope; separate recorded decision.
- Capturing the digest and never comparing it. That enforces nothing and is what R4's mismatch test exists to prevent.

#### Cross-task contract

- **Assumes:** `computeProofInputFingerprint` is frozen (0603) — consume it, do not alter its algorithm or output format.
- **Leaves for dependents:** once this lands, task **0604** re-verifies to PASS (R3's last clause satisfied), which unblocks task **0611** to clear D5's R7/R8/R10/R11. Do not run 0611 before this lands.
- **Routes to 0608:** any finding that this needs a public surface.
### Plan
1. **Built-in action runner (R1).** Add `packages/app/src/workflow/actions/proof-fingerprint.ts` with kind `proof.fingerprint`, options `var` (required) and `expect` (optional), modelled on `file-read-into-var.ts`. Register it in `packages/app/src/workflow/builtins.ts`. Verify: `bun run lint` clean; the kind resolves at workflow validate time.
2. **Unit tests, both branches (R4).** Capture-into-var; mismatch returns `ok:false` naming both digests; empty/absent `expect` is capture-only; invalid `var` name rejected. Verify: the mismatch test fails if the comparison is removed.
3. **Pipeline wiring (R2).** Append the capture to `verify.onEnter` after the verdict-artifact shell; prepend the compare to `record.onEnter`. Declare `proofDigest` / `proofDigestNow` in `vars:`. Verify: `spur workflow validate config/workflows/task-pipeline.yaml` green.
4. **Baseline reconciliation (R2, T10).** Record the new action facts in `config/workflow-composition-baseline.json` in the same commit. Verify: `bun test packages/app/tests/workflow/composition-baseline.test.ts` green — it fails two-sided if the baseline and the live definition disagree.
5. **Evidence names the digest (R3).** Ensure the verdict artifact carries the digest in force. Verify: a completed run's `.spur/run/<wbs>-verdict.json` names it.
6. **End-to-end proof (R4).** Drive a fixture run: unchanged tree reaches `record`; a tree mutated between capture and compare routes to `failed` with both digests named. Verify: both observed, not inferred.
7. **Gates.** `bun run lint`, targeted tests, `spur workflow validate`, then the full suite.

**Done when** the digest is captured at verify-exit, compared before record, a mismatch routes to `failed` naming both values, the verdict artifact names the digest, and no public CLI surface changed.
### Solution
All four requirements landed. Wiring the capability exposed that the capability itself was broken.

#### R1 — the built-in

`packages/app/src/workflow/actions/proof-fingerprint.ts` — kind **`proof.fingerprint`**, registered in
`packages/app/src/workflow/builtins.ts` via `host.registerAction(new ProofFingerprintActionRunner(fileSystem, options.processExecutor), 'builtin')`.

Options as frozen in Design: `var` (required, validated `/^[A-Za-z_][A-Za-z0-9_]*$/`), `expect`
(optional — absent or blank means capture-only, so one action kind serves both edges), and
`taskFile` / `featureFile` (unreadable paths are skipped, never fatal: a task without a feature is
normal and a missing spec must not manufacture a proof violation). **No public `spur` noun, verb, or
flag** — ADR-051 consent not required.

#### R2 — the bracket

`config/workflows/task-pipeline.yaml`:

- `verify:onEnter:2` writes the task path (`spur task path`), `:3` reads it into `taskSpecPath`, `:4` **captures** the digest into `proofDigest`.
- `record:onEnter:0` **compares** — first action in the state, so it runs before any record write.
- New vars `proofDigest`, `proofDigestNow`, `taskSpecPath`.

Placement is the load-bearing decision, and it is **not** where the first plan put it. Capturing after
the quality gate would have fired on `/sp:dev-verify --fix all`'s own legitimate repairs; capturing
after the verdict artifact exists is both what `docs/03_ARCHITECTURE.md:1000` states and the only edge
robust to `--fix all`.

The task path is plumbed explicitly because `docs/tasks*` is excluded from the git-tree half — without
it a task-file edit between verify and record would go undetected.

`config/workflow-composition-baseline.json` reconciled in the same commit (T10): **+22 / −1** lines.
Applied as a targeted delta plus two key renames rather than a regenerate — a full rewrite reformats
the file's compact arrays and turns a 23-line change into 124 lines of noise.

#### R3 — the evidence names it

`verify:onEnter:5` stamps the digest into the verdict artifact's `checks[]` as `proof-input-digest`,
so the document that aggregates quality, review, and verification results carries the value that
`record`'s compare then proves unchanged.

#### R4 — both branches, proven end-to-end

`packages/app/tests/workflow/proof-fingerprint.test.ts` (9 tests): capture-into-var, determinism,
**mismatch naming both digests**, match passes, blank/absent `expect` is capture-only, malformed `var`
rejected, unreadable specs skipped, spec edit moves the digest.

Driven through the real engine with a probe workflow (no model quota):

```
CONTROL  (unchanged tree) → workflow done
MUTATION (tree changed)   → workflow failed — proof inputs changed after the verdict was established
                            expected sha256:0e92531c… got sha256:3657f79f…
```

#### Defect found while wiring: the git-tree half was dead

**`createGitAlternateTree` returned `''` on every call from task 0603 until now**, so the digest never
covered the working tree — it varied only with spec content.

```
git add -A -- . ':(exclude).spur/run*' …
→ exit 1: "The following paths are ignored by one of your .gitignore files: .spur/run"
```

Naming an already-gitignored path in a pathspec makes `git add` report it and exit **1**, and the
function treated any non-zero exit as fatal. `.spur/` is gitignored at `.gitignore:132`, so
`.spur/run*`, `.spur/memory*`, and `.spur/context*` added nothing and silently killed the tree hash.
Removed; `docs/tasks*` / `docs/features*` remain (tracked, and must be excluded).

**How it surfaced:** the first end-to-end probe **passed when it should have failed**. R4's
mismatch-branch requirement is what caught it — a happy-path-only test would have shipped a guard that
enforces nothing, which is the exact outcome R4 was written to prevent.

Two regression tests in `packages/app/tests/workflow/proof-input-fingerprint.test.ts` make the silent
failure loud: the tree hash must match `/^[a-f0-9]{40}$/`, and a working-tree change must move the
digest (reverting restores it).

> **Scope note.** 0612's non-goals say not to change `computeProofInputFingerprint`'s algorithm. This
> fix removes redundant excludes that made the tree component permanently empty — a digest that cannot
> see the working tree does not satisfy R1, so shipping the guard on top of it would have been
> knowingly misleading. Intent preserved; only the redundant excludes changed.

#### Structural guard strengthened, not relaxed

`packages/domain/tests/planning/lifecycle-drift.test.ts` asserted `record.onEnter` had exactly 2
actions. Now 3 — **and** that index 0 is the `proof.fingerprint` compare naming `proofDigest`. The
ordering is the guarantee: a compare placed after `spur task record` would validate a tree that step
had just mutated.

#### Verification

`bun run lint` clean · `bun run test` **exit 0, 5981 pass / 0 fail** · `spur workflow validate` 10/10 ·
composition baseline two-sided check green.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Least-privilege built-in shipped. `packages/app/src/workflow/actions/proof-fingerprint.ts` declares kind `proof.fingerprint`, calls `computeProofInputFingerprint`, and returns `setVars[var]`. Registered in `packages/app/src/workflow/builtins.ts` alongside the other built-ins. Options are as frozen in Design: `var` (validated against `/^[A-Za-z_][A-Za-z0-9_]*$/`), optional `expect`, and `taskFile`/`featureFile` whose unreadable paths are skipped rather than fatal. **No public `spur` noun, verb, or flag was added** — `git diff` touches no file under `apps/cli/src/commands/`, so no ADR-051 consent applies. |
| R2 | MET | The canonical pipeline brackets its proof chain. `config/workflows/task-pipeline.yaml`: `verify:onEnter:4` captures into `proofDigest` after the verdict artifact exists; `record:onEnter:0` re-computes into `proofDigestNow` with `expect: ${vars.proofDigest}` as the **first** action of the state, before any record write. Vars `proofDigest`, `proofDigestNow`, `taskSpecPath` declared. `spur workflow validate` → 10/10 definitions valid. `config/workflow-composition-baseline.json` reconciled in the same commit (T10, +22/−1 lines); `bun test packages/app/tests/workflow/composition-baseline.test.ts` → 18 pass / 0 fail, which fails two-sided if the baseline and live definition disagree. |
| R3 | MET | The evidence names the digest. `verify:onEnter:5` stamps it into the verdict artifact's `checks[]` as a `proof-input-digest` row, so the document aggregating quality, review, and verification results carries the value that `record`'s compare proves unchanged. Recorded as a baseline action fact in the same commit. |
| R4 | MET | Both branches covered and proven, not inferred. `packages/app/tests/workflow/proof-fingerprint.test.ts` — 9 tests including the mismatch branch asserting the error names **both** digests and sets `matched:false`. Driven end-to-end through the real engine with a probe workflow: unchanged tree → `workflow done`; tree mutated between capture and compare → `workflow failed — proof inputs changed after the verdict was established, expected sha256:0e92531c… got sha256:3657f79f…`. The mismatch requirement is what caught the dead git-tree defect below: the first probe passed when it should have failed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R9 — Task execution preserves verification proof and ends with one canonical pipeline | MET | test | The digest is computed once after the quality gate and carried as a run var (`verify:onEnter:4` → `proofDigest`); it is re-computed and compared before `record` (`record:onEnter:0`), and a mid-chain change routes to `failed` — observed live, both control and mutation. The verdict artifact names the digest in force (`verify:onEnter:5`). No new public spur noun, verb, or flag was introduced. Executable proof: `bun test packages/app/tests/workflow/proof-fingerprint.test.ts packages/app/tests/workflow/proof-input-fingerprint.test.ts` → 15 pass / 0 fail; `bun test packages/domain/tests/planning/lifecycle-drift.test.ts` → 25 pass / 0 fail; full `bun run test` → **exit 0, 5981 pass / 0 fail**. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-20T16:50:24.454Z todo → wip (system)
- 2026-08-20T17:04:27.806Z wip → testing (system)
- 2026-08-20T17:04:28.280Z testing → done (system)
