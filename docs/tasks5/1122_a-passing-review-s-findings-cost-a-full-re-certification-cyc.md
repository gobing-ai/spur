---
schema_version: 1
name: A passing review's findings cost a full re-certification cycle (no review fix edge)
status: todo
template: feature-impl
created_at: 2026-10-07T20:52:34.353Z
updated_at: "2026-10-07T21:31:47.239Z"

feature_id: H15
priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 3
---

## 1122. A passing review's findings cost a full re-certification cycle (no review fix edge)

### Background

Observed 2026-10-07 on knowledge-kit tasks 0210 and 0213, twice each.

`task-pipeline.yaml` has **no edge out of `review` for a fix**: `review → verify` (PASS, `profile=auto`), `review → approve` (PASS, interactive), `review → review-fail-triage` (no PASS). So a **PASS review that reports a P2** has nowhere to send it. Acting on that finding mid-flow risks leaving the run with a driver-side tree change the state machine does not know about.

Consequences paid this session:
- 0213 review pass 1 → P2 (column declared `integer`, enum stored). Fixing it changed the tree, so the digest-bound certification was invalidated: gate (3.5 min) + review + verify all had to re-run. Then pass 2 found a **second** P2 (the code half was fixed but the docs still described the old type) → another full cycle. Three review passes and two gates for a two-line correction.
- 0210 had the same shape (210 s + 172 s gates for doc-level corrections).

The contract's position is defensible — a PASS review's findings are residuals for the wrap, not mid-flow work — but that is not stated where an operator or driver will see it at the moment they are tempted to fix it, and the cost is a full re-certification per attempt.

This is a design question, not a clear defect; filed so the trade-off gets decided rather than rediscovered.

**Refine corrections (2026-10-07)**

- **The premise "a PASS review's findings are residuals for the wrap" is wrong for P1–P3.** The record-stage residual sweep parses the `## Review` findings table (`parseReviewFindings`, `packages/app/src/services/residual-scan.ts:106`). It classifies every P1–P3 row without a `RESOLVED`/`FIXED`/`DONE` disposition as **blocking**; only a P3 may become deferrable with a `DEFER(<reason>)` (`classify`, `:195-215`). `foldVerdict` (`:297-323`) then downgrades PASS→PARTIAL, and `record → failed` fires (`config/workflows/task-pipeline.yaml:1359-1362`, "a post-record residual downgrade"). So a `Verdict: PASS` review with an open P2 already cannot reach `done`. The run spends a full verify plus record before failing terminally, and the operator restarts the whole cycle. That is the observed 0210/0213 cost. Only P4 rows are true wrap residuals.
- **"No edge out of `review` for a fix" is accurate for PASS only.** `review → verify` (auto) and `review → approve` require `Verdict: PASS`, and everything else goes to `review-fail-triage` → the bounded `test-fix` hop (`:1183-1222`, `:1225-1247`). The repair lane exists; the PASS edges just do not consult the findings table that record will enforce later.
- **R4 is already satisfied.** The review report carries machine-readable severity: native `P1 (blocker)`…`P4 (advisory)` cells plus a `Disposition` cell (`plugins/sp/agents/super-reviewer.md:150-176`), parsed deterministically by `parseReviewFindings`. Dropped.
- **Decision (R1):** move the record-time check forward. The PASS edges also require "no blocking review finding", using the *same* classifier, so a PASS-with-open-P2 review routes into the existing bounded repair lane before verify runs. No new state and no new budget. R2/R3 become concrete requirements on that edge.
- **Coordination:** task 1116 swaps the inline `decide` in `review-fail-triage` for a catalog reference; this task changes the PASS edge guards and the state descriptions. Different lines, no ordering dependency.

### Requirements

- [ ] R1. Add a pure function to `packages/app/src/services/residual-scan.ts` that returns the blocking review findings for a task's content plus deferrals, using `parseReviewFindings` + `classify` restricted to the `review-finding` category. Regenerate `plugins/sp/lib/residual-scan.generated.mjs` and `plugins/sp/scripts/residual-scan.mjs`.
- [ ] R2. Add a `review-gate <wbs>` mode to `plugins/sp/scripts/residual-scan.ts`. It loads the task like `scan`, applies the same deferrals, writes the review-only residual artifact to `.spur/run/<wbs>-residuals.json` (so the `test-fix` hop's existing hand-off feeds the findings to `/sp:dev-fixall`), prints the blocking anchors, and exits 1 when any blocking review finding exists, 0 otherwise.
- [ ] R3. In `config/workflows/task-pipeline.yaml`, both PASS edges (`review → verify`, `review → approve`) require `Verdict: PASS` **and** a passing `review-gate`. The scanner is resolved exactly like the record step's residual-scan call, and a missing scanner fails closed. A PASS review with an open P1–P3 finding then falls through to `review-fail-triage` → `test-fix`, bounded by the shared `qualityGateMaxFixAttempts` budget, and re-enters quality → review → verify on a fresh digest.
- [ ] R4. The cost is discoverable at the decision point. The `review` and `review-fail-triage` state descriptions state that open P1–P3 findings block `done`, that a fix invalidates the certified digest and re-runs quality → review → verify, and that only P4 rows and `DEFER`-ed P3 rows are wrap residuals. The reviewer Output Format note in `super-reviewer.md` says the same.
- [ ] R5. Regenerate the CLI bundle (`bun run --filter @gobing-ai/spur build:bundle`); `config/workflows/` stays the source of truth.

### Acceptance Criteria

```gherkin
Scenario: AC1 — review-gate classifies review findings exactly like the record sweep (req: R1, R2)
  Given task contents whose Review table holds (a) only P4 rows, (b) a P3 row with a recorded DEFER reason, (c) an OPEN P2 row, (d) a P2 row marked RESOLVED, and (e) unchecked Requirement boxes with only P4 rows
  When `residual-scan review-gate <wbs>` runs on each
  Then it exits 0 for (a), (b), (d) and (e), exits 1 for (c) naming the P2 anchor, and writes `.spur/run/<wbs>-residuals.json` containing only review-finding items

Scenario: AC2 — A PASS review with an open P2 routes to the repair lane before verify (req: R3, R5)
  Given a task-pipeline run at `review` whose answer says `Verdict: PASS` and whose Review table has an OPEN P2 row, with profile=auto
  When the review transitions are evaluated
  Then the run moves to `review-fail-triage` (not `verify`), and with a `fix` decision under the attempt cap it enters `test-fix` with the review finding in the remediation input

Scenario: AC3 — A clean PASS review still advances unchanged (req: R3)
  Given a `Verdict: PASS` answer whose Review table has only P4 or RESOLVED rows
  When the review transitions are evaluated with profile=auto and with an interactive profile
  Then the run moves to `verify` and `approve` respectively, as today

Scenario: AC4 — The cost of fixing a review finding is stated where the driver decides (req: R4)
  Given the `review` and `review-fail-triage` state descriptions and the super-reviewer Output Format
  When a driver reads them
  Then they state that open P1–P3 findings block done, that a fix re-runs quality → review → verify on a fresh digest, and that only P4 and DEFER-ed P3 rows are wrap residuals
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:30:53.489Z

- **R1 direction: no new post-review fix hop; reuse the existing bounded repair lane.** Record already enforces "no open P1–P3", so PASS-with-P2 is not a wrap residual. The waste is *when* that is discovered (after verify and record, terminally). Consulting the same classifier on the PASS edges moves the failure before verify and into `review-fail-triage` → `test-fix`, which already has an attempt budget and re-certifies on a fresh digest. A dedicated hop would duplicate that budget and lane.
- **The re-certification cost is inherent and stays.** Any fix changes the tree, and the proof digest binds quality, review and verify to it. Scoping the post-fix review to the changed surface would let an uncertified tree reach `done`. Rejected. The saving is the skipped verify + record + manual restart per finding.
- **Same classifier, not a second rule.** `review-gate` calls `classify` with the same deferrals, so the early check and the record sweep cannot disagree. It ignores unchecked boxes and diff markers, which are not decidable at review time.
- **Missing scanner fails closed** (the run goes to triage), matching the record step, which already fails closed without the scanner.
- **Machine-readable severity (old R4) already exists** (P1–P4 cells + Disposition). No report-format change.

### Design

**Pure logic** (`packages/app/src/services/residual-scan.ts`, reused through the generated lib):

```ts
/** 1122: the review-finding slice of the record sweep — same parse, same classify, same deferrals. */
export function blockingReviewFindings(taskContent: string, deferrals: Deferral[]): ResidualItem[] {
    const items = parseReviewFindings(taskContent).map((r) => ({ ...r, category: 'review-finding' as const }));
    return classify(items, deferrals);
}
```

(Shape the mapping to whatever `scanResiduals` already passes for review rows; do not re-derive fields.)

**Glue** (`plugins/sp/scripts/residual-scan.ts`): add `review-gate` to the mode table and usage string. It `loadTask`s, loads deferrals the same way `scanMode` does, builds the artifact with the same writer restricted to these items, writes `.spur/run/<wbs>-residuals.json`, prints `residual-review-gate: <wbs> blocking=<n> [ids]`, and returns `n > 0 ? 1 : 0`.

**Workflow** (`config/workflows/task-pipeline.yaml`, review edges `:1225-1240`): each PASS guard becomes

```sh
<existing Verdict: PASS grep> &&
eval "$(jq -r '<same source-repo/installed resolver as the record step :918>' ".spur/run/$__runId-script-root.json" 2>/dev/null)" &&
[ -f "$S" ] && "$RUNNER" "$S" review-gate "$wbs" --spur-bin "$spurBin" >&2
```

The catch-all `review → review-fail-triage` edge is unchanged and still last. Update the `review` and `review-fail-triage` descriptions (R4), and the comment block above the review routing edges.

**Invariants.**
- Edge declaration order stays fail-closed.
- `review-fail-triage` guards, budget file and decision file are unchanged.
- The record sweep is unchanged and remains the final authority.
- `review-gate` writes nothing except the residual artifact, which record's `scan` overwrites later anyway.

**Parity.** `packages/app/tests/workflow/fixtures/guard-parity-baseline.json` pins guard text; update it in the same change and say why.

### Plan

1. Write AC1 tests in `plugins/sp/tests/residual-scan.test.ts` (fixtures (a)–(e)); confirm they fail (mode missing).
2. Add `blockingReviewFindings` to `packages/app/src/services/residual-scan.ts`; regenerate the plugin lib bundle and `residual-scan.mjs` with the repo's existing generation script.
3. Add the `review-gate` mode to `plugins/sp/scripts/residual-scan.ts`.
4. Edit the two PASS guards and the state descriptions in `config/workflows/task-pipeline.yaml`; update `super-reviewer.md` Output Format; update the guard-parity baseline; `bun run --filter @gobing-ai/spur build:bundle`.
5. AC2/AC3: extend `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` (it already drives review answers) with PASS+open-P2 → `review-fail-triage` and PASS+clean → `verify`/`approve`.
6. E2E: drive one real task through `spur workflow run task-pipeline` to `review` with a seeded PASS+OPEN P2 Review, show the transition into `review-fail-triage` → `test-fix`, and save the run log to `.spur/run/1122-e2e.log`.
7. `bun run spur-check`; `bun run plugin-smoke`.

### Solution

Moves the record sweep's review-finding enforcement forward to the review PASS edges (R1 decision):
a `Verdict: PASS` review now also needs a passing `residual-scan review-gate` check, so an open
P1–P3 finding routes into the existing `review-fail-triage` → `test-fix` bounded repair lane
BEFORE verify spends the cycle, instead of failing terminally after verify + record. No new state,
no new budget; the record sweep is unchanged and remains the final authority.

Per requirement:

- **R1** — `packages/app/src/services/residual-scan.ts:282` adds the pure
  `blockingReviewFindings(taskContent, deferrals)`: `parseReviewFindings` + `classify` restricted
  to the `review-finding` category, same deferrals as the sweep. Regenerated through the repo
  generator: `plugins/sp/lib/residual-scan.generated.mjs` (+ `.generated.d.mts` declaration,
  maintained in `scripts/commands/bundle-plugin-lib.ts:345`) and the installed twin
  `plugins/sp/scripts/residual-scan.mjs`.
- **R2** — `plugins/sp/scripts/residual-scan.ts:13` (usage), `:138` (`reviewGateMode`), `:282`
  (mode table): loads the task like `scan`, applies the same deferral file, writes the
  review-finding-only `.spur/run/<wbs>-residuals.json` (the `test-fix` hop's existing remediation
  input; record's `scan` overwrites it later), prints
  `residual-review-gate: <wbs> blocking=<n> ids=… anchors=…`, exits 1 iff blocking > 0.
- **R3** — `config/workflows/task-pipeline.yaml:1264-1301`: both PASS edges
  (`review → verify` under `profile=auto`, `review → approve` interactive) now require the
  reviewer's own `Verdict: PASS` line AND the `review-gate` check; the scanner resolves through
  the same `${__runId}-script-root.json` source-repo/installed resolver as the record sweep and a
  missing scanner fails the edge closed into the `review → review-fail-triage` catch-all
  (`guard: always`, still declared last). Guard parity pinned in
  `packages/app/tests/workflow/fixtures/guard-parity-baseline.json`.
- **R4** — the cost is stated where the driver decides: `review` description
  (`config/workflows/task-pipeline.yaml:703-706`), `review-fail-triage` description
  (`:763-767`), and the reviewer Output Format note (`plugins/sp/agents/super-reviewer.md:177-182`):
  open P1–P3 block `done`; a fix invalidates the certified digest and re-runs quality → review →
  verify on a fresh digest; only P4 and `DEFER`-ed P3 rows are wrap residuals.
- **R5** — `config/workflows/` stays the SSOT; the gitignored generated copy
  `apps/cli/config/workflows/task-pipeline.yaml` was regenerated (`build:bundle`) and verified in
  sync. Design satellite updated in the same change (`docs/design/task-residual-sweep.md:61,77,148`).

Finishing-tail fixes (test harness only, `plugins/sp/tests/inline-pipeline-driver.test.ts`) —
the 0503 smoke previously failed because the 1122 PASS-edge guards read
`.spur/run/$__runId-script-root.json` while the smoke left `__runId` empty and seeded the record
at a path no guard read:

1. `runInlineSmoke` now sets `__runId: 'inline-smoke-run'` in its vars — mirroring the real
   driver, which injects the run id on the `__runId` seam (workflow-service) — so every
   run-scoped artifact (review answer, proof digest, script-root record) resolves at the paths
   the guards read.
2. The precheck script-root probe is stubbed to `exit 0` (same pattern as the other
   script-backed steps): from the scratch task tree the cwd-first probe can only record
   installed/unresolved and would clobber the seeded record before review reads it. The seeded
   source-repo record pointing at the repo's live `plugins/sp/scripts` makes the REAL scanner
   execute inside the review PASS guards (its own suite owns the unit contract; the record-stage
   `scan`+`fold` shell stays stubbed per the existing F96 pattern).
3. Right-reason proof (manual, scratch repo): with an OPEN P2 row under `### Review` the real
   scanner exits 1 (`blocking=1 ids=review-finding:* anchors=src/a.ts:12` — guard falls to
   triage); the clean fixture task exits 0 and writes the review-only artifact.

Test evidence: `plugins/sp` — residual-scan + inline-pipeline-driver +
super-reviewer-output-contract: 41 pass / 0 fail (242 expects; was 38/3). AC1 in
`residual-scan.test.ts:577,632` (parity with the sweep slice; review-gate fixtures a–e), AC2/AC3
in `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:688` (PASS+open P2 → triage,
clean PASS → verify/approve, missing scanner fails closed): 33 pass / 0 fail; guard-parity
fixture test: 2 pass / 0 fail. AC4 in `super-reviewer-output-contract.test.ts` + the YAML
descriptions. Biome clean on the changed file.

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `config/workflows/task-pipeline.yaml:666` — `review` state; `:719` `review-fail-triage`; `:1183-1247` review/triage edges; `:908-918` record residual sweep; `:1359-1362` `record → failed` on residual downgrade; `:474` `test-fix` hand-off.
- `packages/app/src/services/residual-scan.ts:106` `parseReviewFindings`; `:195` `classify`; `:297` `foldVerdict`.
- `plugins/sp/scripts/residual-scan.ts` — mode glue (`scan|fold|settle|report`).
- `plugins/sp/agents/super-reviewer.md:150-213` — priority vocabulary, Disposition column, machine-read Verdict line.
- Task 1116 — catalog decide for `review-fail-triage` (same state, different lines).
- Feature H15 (batch execution productization: integrated gates).

### History

- 2026-10-07T21:31:47.239Z backlog → todo (system)

