---
schema_version: 1
name: Follow-up ledger completeness check enforced in idea handoff
status: todo
template: feature-impl
created_at: 2026-11-22T03:48:21.137Z
updated_at: "2026-11-22T04:35:17.054Z"
feature_id: I15

tags: ["I15"]
priority: P1
estimate_hours: 5
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

- [ ] R1. `parseInventory` also returns `dispositions: Map<id, {kind: 'excluded'|'follow-up', text}>` for deferred ids:
  - `[deferred: excluded — <reason>]` → excluded, with the reason;
  - `[deferred: follow-up — <title>]` or a bare `[deferred: <x>]` → follow-up.

  The marker may sit on a continuation line. `checkInventoryCoverage` output is byte-identical for existing inputs.
- [ ] R2. The exported pure `checkFollowupLedger(reportText, ledger, resolvable: ReadonlySet<string>): FollowupLedgerResult` returns `{findings, filed: [{item, featureId, title, disposition}], excluded: [{item, reason}]}`. Findings carry `severity: 'error'`, a new `FINDING_CODES` entry, and a message naming the item:
  - follow-up item with no row (`unfiled`);
  - item with more than one row (`duplicate`);
  - row for an excluded item (`filed-excluded`);
  - row whose featureId is not in `resolvable` (`dangling`);
  - row for an id that is not in the inventory (`unknown-item`).
- [ ] R3. `finalizeIdeaHandoff`:
  - reads the run-scoped eval report and `<runId>-idea-followups.json`;
  - resolves each distinct featureId via `spur feature show <id> --json` through the existing executor;
  - runs the check **before** any task deps or report write.

  Any finding → `ok: false` with an `error` that lists each finding, and no report file is written. A malformed ledger (not the documented array shape) → `ok: false`.
- [ ] R4. Legacy runs:
  - no ledger file and no follow-up items → pass, treated as an empty ledger;
  - no ledger file and follow-up items present → `unfiled` for each;
  - no eval report → skip the check, recorded as a line in the report. Pre-I15 runs have no report contract to enforce.
- [ ] R5. The handoff report adds `## Follow-ups filed` (one line per row: `<item> → <featureId> (<title>) — next: /sp:dev-plan --feature <featureId>`, or "none") and `## Excluded` (`<item> — <reason>`, or "none"). Both go **before** `## Next command`. The single main-feature next command is unchanged.
- [ ] R6. Docs:
  - `planning-workflow.md` Step 5.6 names the two sections and the fail-closed check;
  - `idea-evaluation.md` uses the run-scoped report path in all three places.

### Acceptance Criteria

- [ ] AC1 — Every follow-up inventory item has exactly one resolvable ledger row
- [ ] AC2 — Excluded inventory items are never filed and are reported with their reason
- [ ] AC3 — Handoff finalization fails closed on an incomplete follow-up ledger
- [ ] AC4 — The handoff report lists filed follow-ups and excluded items

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T03:48:23.240Z backlog → todo (system)

