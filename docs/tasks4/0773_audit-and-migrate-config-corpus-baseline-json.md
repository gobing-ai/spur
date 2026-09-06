---
schema_version: 1
name: "Audit and migrate config/corpus-baseline.json"
status: testing
template: feature-impl
created_at: 2026-09-05T15:33:37.889Z
updated_at: "2026-09-06T00:51:36.768Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P2"]
ac_altitude: task-local
dependencies: ["0765"]
---

## 0773. Audit and migrate config/corpus-baseline.json

### Background

D61 implementation sub-task split from 0766 (R2 first phase), approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

The original 0766 R2 attempt that removed `accepted` at the gate broke 11/172 CLI task-check tests, confirming that the migration requires per-fixture remediation that exceeds one-session scope. 0766 is decomposed into 0773/0774/0775; this task owns the classification phase only — no deletions, no caller migration, no regenerator removal. Delete phases belong to 0774 (caller migration) and 0775 (snapshot + script removal).

The corpus baseline snapshot contains 299 unique keys behind 828 observations. These are different counts (the same key can be hit multiple times across the corpus), not 828 independent waived defects. Each key must be classified into one of three destinations: (a) real affected defects to repair via Spur CLI, (b) stylistic warnings the design contract retires (silently dropped), (c) acceptance-debt entries that should never have been baselined (silently dropped with an audit-trail note).

Dependencies: 0765 (frozen `REQUIRED_FINDING_CODES` set + advisory-only `accepted` suppression). Detailed inputs and handoffs are frozen below.

### Requirements

- [x] **R1.** Audit and classify every key in `config/corpus-baseline.json`. For each of the 299 keys, assign one of three classes: **(a)** real defect — a finding that exposes an affected integrity issue that must be repaired via Spur CLI before this task closes; **(b)** retired warning — a stylistic/document-quality finding the design contract retires (no repair, no migration, no regenerated acceptance); **(c)** acceptance-debt — a baseline entry that should never have been baselined under the 0765 unsuppressible-code policy (no repair, no migration, with an audit-trail note).

- [x] **R2.** Migrate each classified key to its proper destination. Class (a) defects are fixed via Spur CLI mutations; the resulting corpus must be clean against the affected-input checks after the repair commits. Class (b) warnings are recorded in the classification report and dropped from any future baseline; they never reappear in any post-0775 acceptance ledger. Class (c) entries are recorded in the classification report and dropped, with one-line rationale naming which unsuppressible-code policy they violated.

- [x] **R3.** Preserve existing scope and JSON shape inherited from 0766 R2. The classification report must include, per key: key string, classification (a/b/c), rationale, and migration action. The classification report is the audit trail for 0775's deletion step. Do NOT delete `config/corpus-baseline.json`, the loader, or the regenerator scripts in this task — those are 0775's scope.

Out of scope: removing `accepted`-map callers from CLI/fallback paths (0774); deleting baseline files, regenerator scripts, or the loader export (0775); new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Audit and migrate config/corpus-baseline.json

  @core
  Scenario: R1 — Every baseline key receives a classification with rationale
    Given config/corpus-baseline.json with 299 unique keys behind 828 observations
    When the classification audit runs
    Then every key has one of {a: real defect, b: retired warning, c: acceptance-debt}
    And every key has a one-line rationale and a migration action
    And the audit report is saved to .spur/run/d61-0773-classification.json

  @core
  Scenario: R2 — Class (a) defects are repaired via Spur CLI before close
    Given one or more baseline keys classified as real defects
    When Spur CLI mutations repair the underlying affected defects
    Then the affected task/feature corpus is clean against the affected-input checks after repair
    And the repair commit precedes the classification report closure

  @core
  Scenario: R3 — Class (b) and (c) entries are dropped with audit trail
    Given baseline keys classified as retired warnings or acceptance-debt
    When the audit report is finalized
    Then those entries are recorded with a one-line rationale naming the unsuppressible-code policy for (c)
    And they never reappear in any post-0775 acceptance ledger
    And no corpus-baseline file suppresses a finding at task close

  @core
  Scenario: R4 — Baseline file and loader remain intact through this task
    Given the classification report and the repaired corpus
    When this task transitions to done
    Then config/corpus-baseline.json, loadAcceptedFindings and regen-corpus-baseline.ts are still present
    And the loader still returns the un-repaired keys for 0774's caller migration and 0775's deletion step
```

### Q&A

Closed: classify all 299 keys into {a, b, c} before any caller migration. Class (a) defects are repaired via Spur CLI; classes (b) and (c) are recorded in the audit report and dropped. No transitional pruning/expiry/waiver metadata; no regeneration step that fabricates a new baseline. The audit report is the single source of truth for 0775's deletion step.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

### Design

No new API, classification daemon, or waiver ledger. Use the existing loader in `packages/app/src/services/corpus-check.ts` (`loadAcceptedFindings`, line ~656) to read all 299 keys; do not duplicate the read path. Reuse `collectObservedFindings` to enumerate the live corpus findings for each key, and apply the existing `REQUIRED_FINDING_CODES` set from `packages/app/src/services/planning-check-base.ts` as the unsuppressible filter when distinguishing class (c) entries from class (b).

Classification rules:

- **Class (a) — real defect.** A key whose code is not in `REQUIRED_FINDING_CODES` AND whose unsuppressed observation exposes an affected identity/reference integrity defect (e.g. duplicate task IDs, broken cross-references, malformed frontmatter that spur-task-check would fail on after baseline retirement). Repair with the matching Spur CLI verb (`spur task update`, `spur feature update`, or the canonical fix). Never erase the finding or fabricate a PASS; the repair must produce a green affected-input check.
- **Class (b) — retired warning.** A key whose code is in `REQUIRED_FINDING_CODES` OR a document-style warning the design contract retires (R2 explicit-corpus-audit scope: warnings alone do not fail the audit). No repair needed; record + drop.
- **Class (c) — acceptance-debt.** A key whose code is in `REQUIRED_FINDING_CODES` AND was previously baselined under a policy that the 0765 frozen contract now overrides. Drop with an explicit rationale naming which 0765 invariant the entry violated.

Audit report schema (saved to `.spur/run/d61-0773-classification.json`):

```jsonc
{
  "generatedAt": "<ISO-8601>",
  "totalKeys": 299,
  "totalObservations": 828,
  "byClass": { "a": <int>, "b": <int>, "c": <int> },
  "keys": [
    {
      "key": "<exact-baseline-key>",
      "observations": <int>,
      "code": "<L*-finding-code>",
      "classification": "a" | "b" | "c",
      "rationale": "<one-line>",
      "migrationAction": "spur task update <wbs> --section ..." | "drop" | "drop-with-policy-violation",
      "repairedVia": "spur task update <wbs>" | null
    }
  ]
}
```

Preserve existing scope and JSON shape inherited from 0766 R2 — do not invent new fields the live DTO does not already carry. Repair commits precede the audit report commit so the report's `repairedVia` field points to commits that are reachable from the branch HEAD at task close.

Verification targets: read the audit report shape from `.spur/run/d61-0773-classification.json`; assert `totalKeys === 299` and `byClass.a + byClass.b + byClass.c === 299`; assert every class (a) entry has a non-null `repairedVia`; assert `spur feature check D61 --strict --json` L4.scenario-unverified count for R3 is unchanged from the pre-0773 baseline (this task only adds task IDs to the D61 scenario coverers, not new acceptance evidence).

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under `.spur/run/d61-0773-before.json`; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.

**Reusable partial artifacts from prior timed-out run (46734bfc).** The first implement attempt hit the 30-minute ceiling mid-classification; its scratch outputs are preserved under `.spur/run/` and must be completed/normalized rather than recomputed from scratch:

- `.spur/run/d61-0773-classify-out.json` — first-pass classification output: `totalKeys=299`, `totalObservations=837`, `inRequiredCodes=174`, `notInRequiredCodes=125`, `baselineErrorSev=6`, `baselineWarningSev=293`, plus all 299 per-key rows.
- `.spur/run/d61-0773-classify.ts` — classifier helper; the second pass (severity grouping) is incomplete and the file ends mid-comment.
- `.spur/run/d61-0773-before-corpus.json` — pre-state snapshot; normalize its filename to the spec's `.spur/run/d61-0773-before.json` when finalizing (a normalized copy may already exist — validate it against the evidence field set rather than recapturing blindly).
- `.spur/run/d61-0773-dump-messages.ts` + `.spur/run/d61-0773-messages.txt` — class-(a) human-review dump (observed findings grouped by code).
- `.spur/run/d61-0773-RESUME.md` — handoff notes enumerating the above.

Resume semantic: finish the second classification pass on top of `d61-0773-classify-out.json`, then write `.spur/run/d61-0773-classification.json`, validate/normalize `-before.json`, and produce `-after.json` per this section's evidence requirements. Plan steps and scope are unchanged by this note.

**Update (implement run 2d33f201):** that run completed the classification phase — `d61-0773-classification.json`, `-before.json`, `-after.json`, `-d61-check-after.json` are on disk and a full Solution section is drafted in this file (uncommitted). Its result: **class (a) = 0** — no real defects, no corpus or source mutation required. Remaining implement work is therefore: (1) validate the six `d61-0773-*` artifacts against this Design's field requirements; (2) tick the Plan checkboxes; (3) commit this task file's addendum + Solution update.

**requireDiff guidance (authoritative for this task):** the implementation diff IS this task file's addendum + Solution update — commit it. This is a classification-only task: no code, config, or corpus mutation is expected, and none may be invented to satisfy the diff gate. `.spur/run/` is gitignored and must not be committed.

### Plan

1. [x] Capture pre-state: save the live `loadAcceptedFindings()` output and a `spur task check --corpus --json` snapshot to `.spur/run/d61-0773-before.json` so 0775 and 0772 can diff the after-state. *(Done — captured 2026-09-05T20:05Z; normalized from the first-pass `d61-0773-before-corpus.json` snapshot.)*

2. [x] Read every key from `config/corpus-baseline.json` via the existing loader (do not duplicate the read path). Emit one row per key into the audit report, then classify each row by applying the three rules from Design: code-in-`REQUIRED_FINDING_CODES` distinguishes (c) from (b); live `collectObservedFindings` distinguishes (a) from the rest. *(Done — `.spur/run/d61-0773-classification.json`, 299 rows, key set matches baseline key-for-key.)*

3. [x] Repair class (a) entries via the matching Spur CLI verb. Each repair is its own commit; the audit report's `repairedVia` field points to the committing CLI invocation. Do not erase findings or fabricate PASSes; the affected-input check after each repair must be green before moving on. *(Vacuous — `byClass.a = 0`; no baseline key exposes an affected defect, so no repairs and no repair commits exist.)*

4. [x] Finalize the audit report at `.spur/run/d61-0773-classification.json`. Validate `totalKeys === 299` and `byClass.a + byClass.b + byClass.c === 299`. Cross-check the report against the post-repair corpus to confirm no class (a) entry remains unrepaired. *(Done — 299 = 0+293+6; zero class (a) rows to repair; error-severity tier unchanged.)*

5. [x] Run `spur task check 0773 --as testing`, `spur task check 0774` (sanity — not yet implemented), and `spur feature check D61 --strict --json`; capture results. Do NOT delete `config/corpus-baseline.json` or the loader in this task; those are 0775's scope. *(Results: `--as testing` fails only on the unfilled `## Testing` placeholder — filled at the pipeline's verify hop — plus two non-gating `L4.anchor-subject-mismatch` warnings on this Solution's own baseline citations; `0774` pass=true with the expected prerequisite warning; `D61 --strict` 13 findings, identical set to the stored pre-task snapshot.)*

6. [x] Hand off the audit report and the repaired corpus to 0774 (caller migration) and 0775 (snapshot + script removal). *(Done — report + before/after envelopes on disk under `.spur/run/`; Solution names the preserved consumers `config/corpus-baseline.json`, `loadAcceptedFindings`, and the regenerator for 0774/0775.)*

### Solution

**Status (implementation, 2026-09-05):** classification phase complete — all 299 baseline keys classified; no class (a) repairs needed; baseline/loader/regenerator preserved for 0774/0775. Artifacts validated against the Design field set, Plan ticked, and evidence envelopes finalized by implement run 3 (2026-09-05).

## What changed

- **Classification audit report** — new file `.spur/run/d61-0773-classification.json` (gitignored; created this task). All 299 unique keys in `config/corpus-baseline.json:1` classified per the frozen 0765 contract:
  - **class (a) = 0** — real defects. No baseline key exposes an affected identity/reference integrity defect: every not-in-`REQUIRED_FINDING_CODES` code in the baseline (`packages/app/src/services/planning-check-base.ts:40`) is emitted at warning severity as a document-style/advisory finding (`packages/app/src/services/task-check.ts:649`, `packages/app/src/services/structural-repair.ts:129`, `packages/app/src/services/feature-check.ts:318`), so no Spur CLI repair is required and the corpus needs no mutation.
  - **class (b) = 293** — retired warnings. Warning-severity baseline entries (both in-required codes at pre-completion advisory status and not-in-required advisory codes per the 0765 disposition table `docs/design/essential-workflow-checks.md:20`); recorded in the report and dropped from any future baseline.
  - **class (c) = 6** — acceptance-debt. The six error-severity baseline entries (`feature:F821:L3.ac-bdd-error`, `feature:F821:L3.ac-bdd-invalid`, `task:0662:L3.ac-empty`, `task:0690:L3.ac-empty`, `task:0761:L3.ac-empty`, `task:0762:L3.ac-empty`) carry codes in `REQUIRED_FINDING_CODES` and were baselined under the pre-0765 suppression policy that the unsuppressible-code contract now overrides; `summarizeWithStatus` refuses accepted-map absorption for these codes (`packages/app/src/services/planning-check-base.ts:274`). Recorded with a one-line policy-violation rationale and dropped.
- **Evidence envelopes** — `.spur/run/d61-0773-before.json` and `.spur/run/d61-0773-after.json` (gitignored; execution-evidence handoff per task Design). Before = pre-classification corpus state via `runCorpusCheck` (`packages/app/src/services/corpus-check.ts:637`): `observed=911`, `baselined=299`, `newErrors=0`, `newWarnings=74`, `ok=false` (74 unexpected warnings from D61-era tasks not in the baseline; the 4 live REQUIRED-code errors surface unsuppressibly). Since class (a) = 0, no repairs occurred. The after envelope was re-captured at the final task-file state because its original capture left `elapsedMs` null (a required field): the re-capture measured `elapsedMs` and refreshed digests to the closing HEAD. Its state differs from before only by two `L4.anchor-subject-mismatch` warnings (`observed=913`, `newWarnings=76`) introduced by this task file's own post-capture growth — the run-2d33f201 Update note and this Solution cite the baseline file's first line, which does not name the citation's subject. They are document-style, class-b-like, non-gating findings on the task's own citations; the error tier is unchanged (`observed 4 / baselined 6 / newCount 0`).

## Preserved surfaces (0775 scope — untouched)

- `config/corpus-baseline.json:1` — 299 entries retained.
- `loadAcceptedFindings` (`packages/app/src/services/corpus-check.ts:656`) — read-only consumer retained; still returns the un-repaired keys for 0774's caller migration.
- `scripts/commands/regen-corpus-baseline.ts` — regenerator retained.

## Verification

- Report shape: `totalKeys === 299`, `byClass.a + byClass.b + byClass.c === 299` (0+293+6).
- Every class (c) entry carries `migrationAction: "drop-with-policy-violation"`; every class (b) entry `"drop"`; no class (a) entry exists so no `repairedVia` is populated.
- `spur feature check D61 --strict --json` unchanged from pre-0773 baseline: 13 findings (12 `L4.scenario-unverified` + 1 `L4.evidence-not-recoverable`), confirmed byte-identical against `.spur/run/d61-0773-d61-check-before.json`. No new acceptance evidence was added — this task only classifies and records.
- `spur task check 0774 --json`: pass=true (only `L4.prerequisite-not-done` warning, expected — 0773 not yet done).
- Re-verified fresh at run 3 close: report key set matches `config/corpus-baseline.json` key-for-key (299/299); `0774` check pass=true; `D61 --strict` finding set identical to the stored snapshot; envelopes carry definition digests, exit/outcome, invocation counts, `elapsedMs` (after) and output bytes, with token/cost null per Design.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | .spur/run/d61-0773-classification.json: totalKeys=299, byClass a:0/b:293/c:6; every row carries rationale+migrationAction; key set matches baseline key-for-key (review-verified) |
| R2 | N/A | Vacuous: byClass.a=0 — no baseline key exposes an affected defect; no repair commits required (plan item 3 annotated) |
| R3 | MET | Preserved scope: config/corpus-baseline.json = 299 entries, loadAcceptedFindings (corpus-check.ts:656) and regen-corpus-baseline.ts untouched; classification-only task |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 | MET | artifact | Every key classified with one-line rationale + migration action; report at .spur/run/d61-0773-classification.json |
| R2 | N/A | artifact | No class (a) keys exist; affected-input checks trivially clean (nothing repaired) |
| R3 | MET | artifact | All 293 (b) + 6 (c) recorded with rationales; (c) rows name the 0765 unsuppressible-code policy; migrationAction drop-with-policy-violation |
| R4 | MET | diff | Baseline file, loader, and regenerator present and un-repaired for 0774 caller migration and 0775 deletion |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | qualityGate | — | bun run spur-check: 7387 tests / 0 fail, biome, typecheck, rules 44/44 + 2/2 after fixall commit f30e6e66e |
| P4 | review | — | fresh-context reviewer: pass; 1 minor + 2 info, none gating (commit identity + artifact arithmetic verified) |
| P4 | verification | — | spur task check 0773 PASS; requirement checkboxes ticked from verified evidence |
| P4 | fix | — | bounded remediation: 1 fixall hop (f30e6e66e) repairing pre-existing rule violations confirmed on main be6e5304d |
### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Parent task 0766 (superseded by this task, 0774, 0775)](./0766_retire-routine-corpus-sweeps-and-suppression-based-acceptanc.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0765 --json; spur task show 0766 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
- 2026-09-06T00:25:25.080Z todo → wip (system)
- 2026-09-06T00:51:36.768Z wip → testing (system)
