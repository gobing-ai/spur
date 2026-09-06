---
schema_version: 1
name: "Make wrapup consume validated inputs and fail on incomplete synchronization"
status: done
template: issue
created_at: 2026-09-06T18:27:45.332Z
updated_at: "2026-09-06T20:33:18.289Z"
feature_id: D6
priority: P1
---

## 0783. Make wrapup consume validated inputs and fail on incomplete synchronization

### Background
Audit 0781 F-04 remains present in wrapup-pipeline.yaml. The first reason action and later guards parse raw tasks separately; the validation regex accepts whitespace-only strings, and shell word splitting then executes zero lookups. Metrics ignores jq/lookup exit status and builds JSON by printf interpolation. feature-sync-bounded.ts explicitly exits 0 for blocked and suppressed-blocked proposals; applied alone cannot prove completion. Existing classifySyncResult checks gateBlocked before applied. Preserve that producer contract and correct the workflow consumer.
### Requirements
- [x] R1. Parse raw tasks once into a first-seen-order, deduplicated JSON array of canonical four-digit WBS strings. Reject malformed JSON, non-arrays, non-strings, whitespace, invalid WBS, missing __runId, failed/malformed task lookups, and nonterminal task status. Only a successfully validated [] may skip.
- [x] R2. Every route, model prompt, metrics consumer and operator note after resolution uses the normalized run-scoped capture, never raw tasks. A missing/corrupted capture or status refuses progression; preserve one doc-sync/learnings model hop on the safety route and keep fast activation dormant.
- [x] R3. Metrics revalidate the capture, require successful well-shaped task lookups, serialize each row with jq rather than interpolated printf JSON, and write PASS only after all required appends succeed. Missing verdict remains UNKNOWN telemetry, never proof of completion; existing valid prior rows survive failure.
- [x] R4. Required feature sync succeeds only with a valid matching proposal, no gateBlocked/requiresConfirm condition, and a freshly observed feature status equal to proposal.to. applied:false is a successful no-op only when from == to and that status is observed. Nonzero, malformed, partial, blocked or unreadable outcomes fail explicitly; an affected-feature check cannot convert failed sync into success.
- [x] R5. Remove dead duplicate raw-input parsing, fixed run-ID fallback and contradictory soft-success comments. Preserve prior artifacts, exact failure routing, explicit featureGateCmd overrides, and consent-only branch cleanup without Git operations.
### Acceptance Criteria
```gherkin
Feature: Truthful wrapup outcomes
  Scenario: R1 — Invalid wrap input never succeeds
    Given whitespace-only task IDs or missing or malformed normalized input
    When wrapup resolves or records metrics
    Then it fails rather than skipping work or writing PASS
    And only a validated empty list skips
    And duplicate valid IDs retain first-seen order
    And nonzero lookups or failed appends preserve earlier evidence and fail
  Scenario: R2 — Blocked synchronization is not no-change success
    Given a required feature sync with applied false and an unreached target
    When wrapup handles the result
    Then it reports failure and preserves prior artifacts
    And an actual from-equals-to no-op remains successful
    And partial applied true or confirmation-required results cannot claim success
```

Verify in packages/app with bun test tests/workflow/wrapup-pipeline.test.ts. Execute the extracted shipped shells and declaration-ordered guards in temporary directories using stub CLI/sync/model actions. Include malformed successful stdout, escaped JSON fields, write failure, two run IDs and normal safety-route completion.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-06T19:03:57.509Z

- Whitespace handling: reject, do not trim into a different WBS; the corpus schema uses four digits (packages/domain/src/planning/schema.ts).
- Zero tasks: only parsed validated [] is skipped; lookup/parser failures are not emptiness.
- Sync rc=0: means handled, not reached target. The consumer checks proposal flags and a fresh observed status; no producer exit-contract change.
- Metrics without a verdict artifact: emit UNKNOWN telemetry after a valid terminal task lookup; do not synthesize PASS proof.
- Learning capture/append failure: retain prior evidence and fail the action; do not describe an empty required capture as a successful no-op.
- No open design decision; branch cleanup remains consent-only and performs no Git mutation.
### Design
#### Frozen design
Keep the existing YAML/jq/CLI ownership rather than introducing a wrapup service or plugin executable: the underlying services already exist; the defect is validation and control flow at their caller.

In task-resolve, combine validation and reason generation in one shell action. Validate all elements against ^[0-9]{4}$ before iteration, deduplicate in first-seen order, resolve every task with exit 0 and matching wbs plus done/cancelled status, and publish .spur/run/<runId>-wrapup-tasks.json only after the entire input is accepted. Use temporary files plus rename for publication; initialize or remove old status before work, then write PASS last. Failure writes the existing resolve status FAIL and bounded failed reason when possible, otherwise exits nonzero. No fallback run ID.

Keep existing artifact paths: <runId>-wrapup-resolve.status, <runId>-route-reason.txt and .spur/memory/wrapup-routes.log. Generate the route reason only after validation; preserve existing reason vocabulary and run-attributed append. A separate normalized load state uses the existing file.read.into-var action into the already-declared tasks var, so downstream interpolation shows normalized values without a new public var. Place it only on a resolve-PASS edge. Empty/nonempty guards inspect the validated file and PASS status; never echo raw input or use jq-failure-as-zero. Any missing status/capture has an explicit failed fallback.

At metrics-record, validate the capture again because it crosses the doc-sync phase, and use one fresh task show per member to observe current status/feature metadata. Do not duplicate lookups in sibling guards. Capture exit separately from stdout, validate the JSON object and matching identity, and use jq -cn --arg for rows with existing wbs/feature_id/status/verdict/timestamp keys. Check every append exit. UNKNOWN verdict telemetry does not certify a task; the normal task done guard remains the authority. No new metrics schema or transaction log.

Sync: retain the current source-local → installed wrapper → plain CLI fallback. Capture one sync JSON/exit result, validate proposal.featureId/from/to plus boolean applied and flags. gateBlocked or requiresConfirm true always fails. Read feature show once afterward and require current status == proposal.to; applied false additionally requires from == to. An applied/possibly partial attempt still runs the existing affected-feature gate once for diagnostics, but PASS requires successful sync AND gate. No repeated sync attempt, new suppression record or policy change to feature-sync-bounded.ts. Missing artifacts and I/O failures route failed; prior learnings/metrics are not rolled back.

Own config/workflows/wrapup-pipeline.yaml and packages/app/tests/workflow/wrapup-pipeline.test.ts; sync docs/04_DESIGN.md and relevant workflow surface notes. Increment the definition version. Replace the current test pin requiring validation to be the second shell action with behavioral assertions (exact action order was the defect, not a compatibility contract). 0784 depends on this result to remove the noncanonical terminal checkpoint writer; leave that cleanup to its owner. No new public noun/verb, dependency, engine, registry, cache, baseline, blanket strictness, fast-route activation, live-run mutation, external review request, host installation, or release. Workflow/source changes below are the implementation handoff, not actions performed by refine.

Execution budget: one owned task at a time; checkpoint after 45 minutes or two unsuccessful fix iterations in .spur/run/0783-execution-notes.md, preserving focused logs. Reproduce with targeted workspace tests before the single final project gate. requireDiff: source/tests for runtime tasks, canonical docs/tests for 0786; no fabricated source edit for refinement. Refinement itself changes planning sections only.
### Plan
- [ ] R1/R2: reproduce whitespace, missing/corrupt capture, failed lookup and stale-PASS cases with the shipped shell/guard fixtures.
- [ ] R1/R2: consolidate parse/normalize/resolve/reason generation and load normalized tasks through file.read.into-var; retain empty-list and dormant route semantics.
- [ ] R3: implement checked metrics lookup/serialization/append; test quoted values and a deliberate append failure without removing prior rows.
- [ ] R4/R5: validate sync proposal plus actual reached status, preserve affected-gate diagnostics and require explicit PASS on every success edge.
- [ ] Run focused wrapup and feature-sync-bounded contract tests; increment version, sync docs, rebuild packaged definitions, then one final implementation gate.
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:186` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:191` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:194` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:214` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:234` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:238` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:3` |
| `packages/app/tests/workflow/proportional-routing-pilots.test.ts:46` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:151` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:176` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:182` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:196` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:199` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:2` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:212` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:219` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:231` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:238` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:260` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:282` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:286` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:300` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:439` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:444` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:468` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:558` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:606` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:609` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:614` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:784` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:9` |
| `packages/app/tests/workflow/wrapup-pipeline.test.ts:98` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/wrapup-pipeline.yaml:154` — validation accepts only `type == "array" and all(.[]; type == "string" and test("^[0-9]{4}$"))` (whitespace/leading/trailing rejected, not trimmed); `:159` first-seen dedup via `reduce .[] as $w`; `:146-148` empty `__runId` refuses the legacy fixed-path fallback; `:160-175` per-member `task show` lookup requires exit-0 well-formed status in {done,cancelled}, else RESOLVE_RC=1 → `failed:` reason + FAIL status; only the validated capture publishes to `.spur/run/<runId>-wrapup-tasks.json`, so only a validated `[]` can skip. Tests: `packages/app/tests/workflow/wrapup-pipeline.test.ts:301` (malformed/non-array/non-string/whitespace-only/leading/trailing/non-canonical all FAIL), `:330` (duplicate valid ids keep first-seen order, not sorted). |
| R2 | MET | `config/workflows/wrapup-pipeline.yaml:188-219` — route writer runs AFTER validation, refuses empty `__runId` (`:190-192`), short-circuits on FAIL resolve (`:195-197`), computes N from the validated capture only (`:199`, corrupt/missing → -1, no skip claim); route edges `:472-496` read `jq length .spur/run/$__runId-wrapup-tasks.json` (never raw `$tasks`), -1 satisfies no numeric edge → always-defense `failed`; doc-sync model prompt reads the capture `:235-241`; cleanup prompt `:424` and done operator note `:434` reference the validated list. Test: route reason writers run-attributed, second run does not overwrite first (`wrapup-pipeline.test.ts` 0758 R4/R5 group, passed this run). Residual (P4, by design): done-state checkpoint writer `:439` still echoes raw `$tasks` — the noncanonical terminal checkpoint writer 0784 owns per the frozen design; not one of R2's consumer classes. |
| R3 | MET | `config/workflows/wrapup-pipeline.yaml:283-286` — metrics revalidates the capture with the same canonical-shape jq gate; `:287-296` requires well-shaped lookup (`(.frontmatter.status // .status) != null`), else METRICS_RC=1; `:295` rows serialized via `jq -cn --arg` (wbs/feature_id/status/verdict/timestamp), no interpolated printf; `:297-301` every append exit checked, PASS written only when METRICS_RC=0; missing verdict stays UNKNOWN telemetry. Tests: `wrapup-pipeline.test.ts:444-445` (asserts `jq -cn`, no interpolated printf JSON), `:517-535` (deliberate append failure records FAIL and prior valid rows survive), `:558` (missing verdict → UNKNOWN, never proof of completion). |
| R4 | MET | `config/workflows/wrapup-pipeline.yaml:356-357` — fresh `feature show` OBSERVED status (unreadable sentinel otherwise); `:363-381` classification: nonzero rc fails, sync output must be an object with string proposal.featureId/from/to + boolean applied, featureId must match `$feature`, `gateBlocked=true` fails (`:371`), `requiresConfirm=true` fails (`:373`), applied=true requires OBSERVED == proposal.to (`:375-376`), applied=false requires from==to AND observed==to (`:377-379`); `:383-390` affected-feature gate runs diagnostically after applied/partial attempts but `:395-397` PASS requires SYNC_OK=1 AND gate != FAIL — a gate PASS can never convert a failed sync. Tests: `wrapup-pipeline.test.ts:610` (asserts `.proposal.gateBlocked` consumed), `:634` (gate-blocked rc=0 sync is failure, not no-change success — audit F-04), plus from==to observed no-op success path (`:401` output). |
| R5 | MET | `config/workflows/wrapup-pipeline.yaml:75` — definition version "1" → "2"; pre-validation route-writer block with raw `echo "$tasks |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Invalid wrap input never succeeds | MET | test | `packages/app/tests/workflow/wrapup-pipeline.test.ts:301-330` — whitespace-only `["  "]`, leading/trailing whitespace, non-canonical entries all FAIL (never skip/PASS); first-seen order retained for duplicates; failed lookups record FAIL and preserve reason/status artifacts; only validated [] skips. Re-run this turn: 46 pass / 0 fail. |
| Scenario: R2 — Blocked synchronization is not no-change success | MET | test | `packages/app/tests/workflow/wrapup-pipeline.test.ts:634` — gateBlocked rc=0 sync records FAIL with prior artifacts intact; `:373` requiresConfirm fails; partial applied=true with off-target observed fails (`wrapup-pipeline.yaml:375-376`); from==to observed no-op remains successful (`:401`). Re-run this turn: 46 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- docs/plans/2026-09-06-workflow-conflict-audit.md — F-04; task 0770.
- docs/00_ADR.md — ADR-022, ADR-107 Option B, ADR-108; docs/99_PROJECT_CONSTITUTION.md T10/T11.
- plugins/sp/scripts/feature-sync-bounded.ts — FeatureSyncResult, classifySyncResult and rc=0 blocked behavior.
- packages/app/src/workflow/actions/file-read-into-var.ts; packages/domain/src/planning/schema.ts.
- Task 0784 owns later terminal-checkpoint cleanup.
### History
- 2026-09-06T20:19:28.324Z todo → wip (system)
- 2026-09-06T20:33:17.492Z wip → testing (system)
- 2026-09-06T20:33:18.289Z testing → done (system)
