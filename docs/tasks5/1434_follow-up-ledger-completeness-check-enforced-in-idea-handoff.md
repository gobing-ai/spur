---
schema_version: 1
name: Follow-up ledger completeness check enforced in idea handoff
status: done
template: feature-impl
created_at: 2026-11-22T03:48:21.137Z
updated_at: "2026-11-22T19:46:38.766Z"
feature_id: I15

tags: ["I15"]
priority: P1
estimate_hours: 5
done_forced: "false"
done_reason: unforced close
---

## 1434. Follow-up ledger completeness check enforced in idea handoff

### Background

Implements: R1 — Every follow-up inventory item has exactly one resolvable ledger row; R2 — Excluded inventory items are never filed and are reported with their reason; R3 — Handoff finalization fails closed on an incomplete follow-up ledger; R4 — The handoff report lists filed follow-ups and excluded items.

The prompt/doc contract and the feature-create shape and id gate landed 2026-11-21: `config/workflows/idea-pipeline.yaml` feature-create :177-211; `plugins/sp/skills/spur-dev/references/idea-evaluation.md` "Deferral dispositions". This task adds the deterministic completeness layer.

**Refine corrections (2026-11-21)**
- `finalizeIdeaHandoff` (`packages/app/src/workflow/idea-handoff.ts:102`) **never reads the eval report today**. It reads only the batch, result, order and ready files (:110-117). This task adds the report read from `.spur/run/<runId>-idea-eval-report.md`; that run-scoped path is the one the pipeline writes (`idea-pipeline.yaml:94-103`).
- Doc drift found: `idea-evaluation.md` still names the unscoped `.spur/run/idea-eval-report.md` (frontmatter description, "Authorship" line, and the Pipeline-contract table "Filled instance path"). It is fixed here, because this task makes the handoff depend on the run-scoped path.
- `parseInventory` (`packages/app/src/services/feature-inventory.ts:32-57`) is module-private and returns only `{owing, deferred, hasSection}`. It already absorbs continuation lines (:44-53). Extending it to carry the disposition per deferred id keeps one parser.
- Ledger shape is fixed by the feature-create shell gate (`idea-pipeline.yaml:210`): a JSON array of `{item: "I<n>", disposition: "filed"|"existing", featureId, title}`. That gate also resolves every `featureId` through `spur feature show` at creation time (:211). The handoff re-checks resolution because features can change between the two stages.
- "Injected resolver port" is unnecessary. The handoff already shells `spur task show` through its `ProcessExecutor` (:225). It resolves ledger ids the same way with `spur feature show <id> --json` and passes the resolved set into a pure check.
- Handoff failure already maps to exit 1 (`idea-handoff-cli.ts:24`), and the pipeline's `handoff-finalize` shell fails the run on nonzero (`idea-pipeline.yaml:409-418`). Fail-closed needs no new wiring beyond returning `ok: false` before the report write.

### Requirements

- [x] R1. `parseInventory` also returns `dispositions: Map<id, {kind: 'excluded'|'follow-up', text}>` for deferred ids:
  - `[deferred: excluded — <reason>]` → excluded, with the reason;
  - `[deferred: follow-up — <title>]` or a bare `[deferred: <x>]` → follow-up.

  The marker may sit on a continuation line. `checkInventoryCoverage` output is byte-identical for existing inputs.
- [x] R2. The exported pure `checkFollowupLedger(reportText, ledger, resolvable: ReadonlySet<string>): FollowupLedgerResult` returns `{findings, filed: [{item, featureId, title, disposition}], excluded: [{item, reason}]}`. Findings carry `severity: 'error'`, a new `FINDING_CODES` entry, and a message naming the item:
  - follow-up item with no row (`unfiled`);
  - item with more than one row (`duplicate`);
  - row for an excluded item (`filed-excluded`);
  - row whose featureId is not in `resolvable` (`dangling`);
  - row for an id that is not in the inventory (`unknown-item`).
- [x] R3. `finalizeIdeaHandoff`:
  - reads the run-scoped eval report and `<runId>-idea-followups.json`;
  - resolves each distinct featureId via `spur feature show <id> --json` through the existing executor;
  - runs the check **before** any task deps or report write.

  Any finding → `ok: false` with an `error` that lists each finding, and no report file is written. A malformed ledger (not the documented array shape) → `ok: false`.
- [x] R4. Legacy runs:
  - no ledger file and no follow-up items → pass, treated as an empty ledger;
  - no ledger file and follow-up items present → `unfiled` for each;
  - no eval report → skip the check, recorded as a line in the report. Pre-I15 runs have no report contract to enforce.
- [x] R5. The handoff report adds `## Follow-ups filed` (one line per row: `<item> → <featureId> (<title>) — next: /sp:dev-plan --feature <featureId>`, or "none") and `## Excluded` (`<item> — <reason>`, or "none"). Both go **before** `## Next command`. The single main-feature next command is unchanged.
- [x] R6. Docs:
  - `planning-workflow.md` Step 5.6 names the two sections and the fail-closed check;
  - `idea-evaluation.md` uses the run-scoped report path in all three places.

### Acceptance Criteria

- [x] AC1 — Every follow-up inventory item has exactly one resolvable ledger row
- [x] AC2 — Excluded inventory items are never filed and are reported with their reason
- [x] AC3 — Handoff finalization fails closed on an incomplete follow-up ledger
- [x] AC4 — The handoff report lists filed follow-ups and excluded items

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:35:15.114Z

- **Closed: resolver port vs executor.** Use the existing executor (`spur feature show`). A new port would have one implementation.
- **Closed: re-check resolution at handoff when feature-create already checked it.** Yes. Features can be deleted or renamed between stages, and the check is cheap.
- **Closed: no eval report.** Skip with a recorded line, not a failure. Runs from before the report contract cannot be held to it.

### Design

- **Where:** `checkFollowupLedger` lives in `feature-inventory.ts` next to `checkInventoryCoverage` and shares the extended private `parseInventory`. Handoff wiring goes in `idea-handoff.ts` right after the required-files check (:136-145) and before the batch/deps work, so a bad ledger costs no side effects.
- **Pure core, IO at the edge:** the handoff gathers `reportText`, `ledger` and `resolvable`; the check never touches the fs or processes. Unit tests drive the check directly. Handoff tests use the existing fake `FileSystem`/`ProcessExecutor` seams.
- **Disposition parse:** after a `[deferred:` match, the excluded regex is `/\[\s*deferred\s*:\s*excluded\s*[—–-]\s*([^\]]+)\]/i` (em dash, en dash or hyphen). Everything else is follow-up, matching the template's "bare = follow-up" rule. Store the captured reason trimmed.
- **Frozen:** `checkInventoryCoverage` signature and messages; the ledger JSON shape (owned by the yaml gate); the result interface fields (add none; failures go in `error`); `spur feature handoff` flags (no new flag, consistent with the I15 "no new public surface" scope).
- **Anti-patterns:** no second inventory parser; no reading `.spur/run/idea-eval-report.md` (unscoped); no soft warning mode; no new CLI flag to skip the check.
- **Handoff to 1435:** the E2E asserts the two report sections by heading text and the fail-closed exit, so keep the heading strings exactly `## Follow-ups filed` / `## Excluded`.

### Plan

Premises (verified 2026-11-21):
- `parseInventory` at `feature-inventory.ts:32-57`; `checkInventoryCoverage` at :85.
- `finalizeIdeaHandoff` at `idea-handoff.ts:102`, with the report write at ~:492 and the executor `task show` at :225.
- Ledger gate at `idea-pipeline.yaml:210-211`; handoff state at :409-418; CLI exit mapping at `idea-handoff-cli.ts:24`.

- [ ] 1. Failure-mode tests first in `packages/app/tests/services/feature-inventory.test.ts` (or the existing inventory test file): unfiled follow-up; bare deferral treated as follow-up; duplicate row; filed excluded; dangling id; unknown item; excluded marker on a continuation line; en dash and hyphen variants. Also a regression: existing `checkInventoryCoverage` fixtures give identical findings.
- [ ] 2. Handoff tests in `packages/app/tests/workflow/idea-handoff*.test.ts`:
  - an incomplete ledger → `ok:false`, no report written, no `task deps` call issued;
  - a complete ledger → the report contains both sections before `## Next command`, and there is exactly one next command;
  - no ledger and no follow-ups → pass;
  - no ledger with follow-ups → fail.

  Run; all fail.
- [ ] 3. Implement the parser extension and the check, then the handoff wiring and report sections. Run the focused tests.
- [ ] 4. Make the doc edits (R6).
- [ ] 5. Run `bun run spur-check`.

### Solution

#### Change map

| File:lines | What / why |
| --- | --- |
| `packages/config/src/finding-codes.ts:84` | Register the `followup-ledger` finding code (1434 R2) beside `inventory-coverage`. |
| `packages/config/src/finding-codes.ts:186` | `FINDING_CODES.FOLLOWUP_LEDGER` named constant. |
| `packages/app/src/services/feature-inventory.ts:28-31` | `DEFERRED_EXCLUDED_RE` / `DEFERRED_FOLLOWUP_RE` — disposition markers (em/en dash or hyphen; bare `[deferred:]` = follow-up). |
| `packages/app/src/services/feature-inventory.ts:34-38,52,58-92` | `parseInventory` also returns `dispositions: Map<id, {kind, text}>` for deferred ids, absorbing continuation lines as before; `checkInventoryCoverage` behavior unchanged (byte-identical output for existing inputs). |
| `packages/app/src/services/feature-inventory.ts:145-253` | `FollowupLedgerRow` (documented ledger shape), `FollowupLedgerResult`, and the pure `checkFollowupLedger(reportText, ledger|undefined, resolvable)`: unfiled / duplicate / filed-excluded / dangling / unknown-item error findings naming the item; `filed` and `excluded` lists for the report; `undefined` ledger behaves as empty (1434 R4). |
| `packages/app/src/workflow/idea-handoff.ts:16-22` | Import the check + types. |
| `packages/app/src/workflow/idea-handoff.ts:95-113` | `parseFollowupLedgerRows` — ledger shape validator (documented array shape; null = malformed). |
| `packages/app/src/workflow/idea-handoff.ts:139-142` | Run-scoped eval-report and ledger paths. |
| `packages/app/src/workflow/idea-handoff.ts:226-289` | Fail-closed wiring after the batch shape checks, before any deps/refresh/report: malformed ledger → error; report present → resolve each distinct featureId via `spur feature show --json` through the existing executor, run the check, any finding → `ok: false` listing findings, no report written; no report → skip with a recorded line, ledger rows still listed (1434 R3/R4). |
| `packages/app/src/workflow/idea-handoff.ts:573-588` | Report sections `## Follow-ups filed` (`<item> → <featureId> (<title>) — next: /sp:dev-plan --feature <featureId>`, or "none") and `## Excluded` (`<item> — <reason>`, or "none"), both before `## Next command`; exact headings kept for task 1435's E2E. |
| `packages/app/tests/services/feature-inventory.test.ts:133-322` | Coverage regression (excluded stays exempt) + 10 `checkFollowupLedger` failure-mode tests: unfiled, bare deferral, duplicate, filed-excluded, dangling, unknown-item, wrapped excluded marker, en-dash/hyphen variants, complete-ledger pass, empty-ledger pass. |
| `packages/app/tests/workflow/idea-handoff.test.ts:859-1080` | Handoff wiring tests: incomplete ledger fails closed with no deps write and no report; complete ledger passes with both sections before `## Next command` and one next command; legacy no-ledger/no-follow-ups passes; no-ledger-with-follow-ups fails; no eval report skips with a recorded line; malformed ledger fails; dangling featureId fails. |
| `plugins/sp/skills/spur-dev/references/idea-evaluation.md:5,19,102` | Doc drift fix (R6): run-scoped `.spur/run/<run-id>-idea-eval-report.md` in frontmatter description, Authorship line, and Pipeline-contract table. |
| `plugins/sp/skills/spur-dev/references/planning-workflow.md:254-260` | Step 5.6 names the fail-closed handoff completeness check and the `## Follow-ups filed` / `## Excluded` sections (R6). |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:29` | One-line test-local type fix (`expectFiles?: string[]`) unblocking `typecheck:packages/app` — pre-existing TS2551 from sibling task 1433's commit 042b8a5a3, no assertion changed. |
| `apps/cli/tests/fixtures/script-absorption-pr5-golden.json:823` | Parity golden for `featureHandoff > handoff-success`: the empty-ledger report now renders the ledger skip line plus `## Follow-ups filed` / `## Excluded` ("none") before `## Next command` (1434 report sections). |

#### Forced verification repairs — 2026-11-22

The old verify table omitted R5 and misassigned several requirement ids; this verification re-maps all six requirements from their actual text.

A concrete fail-closed defect was repaired in `packages/app/src/workflow/idea-handoff.ts`: an exit-zero `feature show` did not prove resolution (help text or another feature's JSON could be accepted). The handoff now parses the JSON and requires its id to equal the requested ledger feature id. Failure-first tests cover help output, wrong identity and missing identity, with no dependency mutation or report write. The existing successful executor fixture now returns native-shaped feature JSON. New cases clear their own prior red-run report before asserting absence.

Focused inventory/handoff suites: 54 pass, zero fail. Real CLI parity plus idea E2E: 36 pass, zero fail. The E2E runs the tracked definition whose bytes equal the freshly bundled idea-pipeline definition; its missing-I5 negative leg fails closed. No workflow YAML, public CLI surface or inventory-coverage semantics were changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/feature-inventory.ts:28` and the shared private parser carry excluded/follow-up dispositions, including continuation markers and bare deferrals. Existing coverage semantics remain unchanged; the focused inventory fixtures pass. |
| R2 | MET | `packages/app/src/services/feature-inventory.ts:169` returns the pure filed/excluded/finding result with all required unfiled, duplicate, filed-excluded, dangling and unknown-item cases. `packages/config/src/finding-codes.ts:84` and line 186 register FOLLOWUP_LEDGER; failure-mode tests pass. |
| R3 | MET | `packages/app/src/workflow/idea-handoff.ts:141` reads run-scoped inputs; line 253 re-resolves distinct ids before dependencies/report. The new identity guard at line 268 requires matching feature JSON, not merely exit zero. `packages/app/tests/workflow/idea-handoff.test.ts:1060` rejects help text, wrong identity and missing identity with no deps/report; malformed ledger and real missing-I5 E2E also fail closed. |
| R4 | MET | `packages/app/src/workflow/idea-handoff.ts:291` retains the explicit legacy no-report skip, while undefined ledgers behave as empty. Fresh handoff and inventory tests prove no-ledger/no-followups pass, missing follow-ups fail, and no-report skip is recorded. |
| R5 | MET | `packages/app/src/workflow/idea-handoff.ts:585` renders Follow-ups filed and Excluded before Next command, with plan commands per linked feature and the existing single main next command. `packages/app/tests/workflow/idea-handoff.test.ts:944` and the published `docs/reports/idea-followup-ledger-e2e-receipt.json:1` prove the report behavior. |
| R6 | MET | Full repository gate PASS: @batch `.spur/run/run_5cd020af-b6e3-42d0-883a-aa1d54e908f5-feature-verification.log` lines 1-786. Fix-pass artifacts: @batch `.spur/run/1434-verify-answer.txt` lines 1-37 and `.spur/run/1434-verdict.json` lines 1-90; raw evidence under `.spur/run/verify-1434-1436-` and `.spur/run/verify-1436-`. `plugins/sp/skills/spur-dev/references/planning-workflow.md:254` documents fail-closed handoff and both sections; `plugins/sp/skills/spur-dev/references/idea-evaluation.md:5`, line 19 and line 102 all use the run-scoped path. Fresh source inspection found the required contract in all three locations. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Every follow-up inventory item has exactly one resolvable ledger row | MET | command | `docs/reports/idea-followup-ledger-e2e-receipt.json:1`; native positive and negative E2E plus 54 focused inventory/handoff tests. @batch `.spur/run/verify-1434-1436-e2e-final.log` lines 1-46 records 36 pass; `.spur/run/verify-1434-1436-focused-final.log` lines 1-66 records 54 pass. |
| R2 — Excluded inventory items are never filed and are reported with their reason | MET | command | `docs/reports/idea-followup-ledger-e2e-receipt.json:1`; native positive and negative E2E plus 54 focused inventory/handoff tests. @batch `.spur/run/verify-1434-1436-e2e-final.log` lines 1-46 records 36 pass; `.spur/run/verify-1434-1436-focused-final.log` lines 1-66 records 54 pass. |
| R3 — Handoff finalization fails closed on an incomplete follow-up ledger | MET | command | `docs/reports/idea-followup-ledger-e2e-receipt.json:1`; native positive and negative E2E plus 54 focused inventory/handoff tests. @batch `.spur/run/verify-1434-1436-e2e-final.log` lines 1-46 records 36 pass; `.spur/run/verify-1434-1436-focused-final.log` lines 1-66 records 54 pass. |
| R4 — The handoff report lists filed follow-ups and excluded items | MET | command | `docs/reports/idea-followup-ledger-e2e-receipt.json:1`; native positive and negative E2E plus 54 focused inventory/handoff tests. @batch `.spur/run/verify-1434-1436-e2e-final.log` lines 1-46 records 36 pass; `.spur/run/verify-1434-1436-focused-final.log` lines 1-66 records 54 pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T03:48:23.240Z backlog → todo (system)
- 2026-11-22T05:08:09.869Z todo → wip (system)
- 2026-11-22T05:46:21.272Z wip → testing (system)
- 2026-11-22T05:46:23.013Z testing → done (system)

