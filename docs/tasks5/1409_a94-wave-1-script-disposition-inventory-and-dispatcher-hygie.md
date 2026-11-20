---
schema_version: 1
name: "A94 wave 1: script disposition inventory and dispatcher hygiene"
status: done
template: feature-impl
created_at: 2026-11-20T07:58:05.081Z
updated_at: "2026-11-20T08:54:14.455Z"
feature_id: A94
priority: P1
tags:
  - A94
  - tooling

estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1409. A94 wave 1: script disposition inventory and dispatcher hygiene

### Background

Implements: R1 — Every script has a downstream-use disposition; R2 — Public surfaces are consented before implementation; R14 — Dispatcher shrinks to retained entries.

Extend the A93 ownership inventory to the downstream-use criterion and record the granted consent before any public surface lands.

Design authority: docs/design/downstream-tooling-absorption.md (consent C1–C10 granted 2026-11-19).

**Refine corrections (2026-11-20)**

- "Extend the A93 test" → the A93 test pins `docs/reports/A93-script-ownership.json` to the live tree: exact candidate set (`repo-wide-tests/a93-script-ownership.test.ts:110`) and real `{path,line}` caller anchors (`:151`). Every later A94 deletion or `package.json` edit would break it. → The test is retargeted at the A94 inventory. The A93 JSON becomes a frozen historical record and is not edited.
- Design said "add a `downstreamReason` field rather than a new report"; R1 said a new `A94-script-ownership.json` → Resolved: new A94 file, using the A93 entry shape plus downstream fields. The A93 audit closed at 1356 and stays as written.
- usage() omissions → confirmed. `scripts/spur-dev.ts:97-102` lists neither `a2a-two-install-e2e` nor `delegate-workflow-e2e`, though both are dispatched (`:185`, `:188`) and named in the header (`:44-45`).
- Boilerplate design line (packages/app verb, source/packed/binary proof) → not applicable. This wave adds no public surface. Removed.

### Requirements

- [x] R1. `docs/reports/A94-script-ownership.json` (schemaVersion 2) has one entry per tracked candidate. The candidate set uses the A93 rule: `scripts/install.sh`, `scripts/spur-dev.ts`, every `scripts/commands/**/*.ts`. Each entry keeps the A93 fields (`path`, `responsibility`, `tests`, `callers`) and adds:
  - `downstream`: `move | generalize | forwarder | retain`.
  - `surface`: the `spur <noun> <verb>` or config key, required for move/generalize.
  - `waveWbs`: one of 1410–1415, required unless retain.
  - `downstreamReason`: required for retain/forwarder.
  - `disposition`: `pending | done | retained`.

  Values copy satellite §2 verbatim.
- [x] R2. `repo-wide-tests/a93-script-ownership.test.ts` reads the A94 report and fails on:
  - a missing, stray or duplicate entry against `git ls-files`;
  - retain/forwarder without `downstreamReason`;
  - move/generalize without `surface` or `waveWbs`;
  - `disposition: "done"` while the file is still tracked;
  - a caller anchor that is not a real line.

  The boundary-edge block now reads the A94 `boundaryEdges` (expected empty).
- [x] R3. Running `bun scripts/spur-dev.ts` with no arguments prints every `case '<name>'` in the dispatcher switch plus every `DELEGATED` key. The test asserts this by parsing the source, so a later addition cannot drift.
- [x] R4. `scripts/spur-dev.ts` exports `RETIRED: Record<string, string>` (old name → replacement command). A retired name prints `spur-dev: '<name>' moved to '<replacement>'` to stderr and exits 2. RETIRED keys never collide with a live case. 1409 ships it empty; waves 1410–1414 add entries as they delete routes.
- [x] R5. The inventory's `consentStatus` reads `{state: "granted", at: "2026-11-19", by: "Robin", record: "docs/design/downstream-tooling-absorption.md §5", amendment: "2026-11-20 surface-shape"}`. The test asserts it before any `surface` value is accepted.

**Out of scope:** moving or deleting any script (waves 1410–1415), editing `A93-script-ownership.json`, any new CLI verb.

### Acceptance Criteria

- [x] AC1 — Every script has a downstream-use disposition (req: R1, R2)
- [x] AC2 — Public surfaces are consented before implementation (req: R5)
- [x] AC3 — Dispatcher shrinks to retained entries (req: R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-20T08:31:42.060Z

- **Q:** New A94 report or extend the A93 JSON? **A (closed):** new A94 report. The A93 audit closed at 1356, and the tree-coupled assertions must follow the live inventory.
- **Q:** Rename the test file? **A (closed):** no. Records cite `a93-script-ownership.test.ts`, and renaming adds churn with no behavior change.
- **Q:** How is R4 tested while RETIRED is empty? **A (closed):** the per-key spawn assertion stays vacuous in 1409. 1410 adds the first entry, and 1415 re-audits.

### Design

**WHAT/WHY.** One live inventory (A94) replaces A93 as the tree-coupled contract, because A94 deletes and rewires files the A93 test pins. The dispatcher gains a complete usage list and a retired-name exit, so callers of removed routes get a pointer instead of "unknown command".

**WHERE (frozen).**
- `docs/reports/A94-script-ownership.json`: new. The top level reuses A93 keys (`schemaVersion: 2`, `generatedAt`, `sourceCommit`, `consentStatus`, `entries`, `boundaryEdges`, `waves: ["1410".."1415"]`).
- `repo-wide-tests/a93-script-ownership.test.ts`: keep the filename, since other records cite it. Set `REPORT_REL = 'docs/reports/A94-script-ownership.json'`. Replace `WAVES` and the destination/action enums with the A94 `downstream` vocabulary. Keep `trackedCandidates()` and the anchor check unchanged.
- `scripts/spur-dev.ts`:
  - `usage()` lists the full set.
  - `export const RETIRED: Record<string, string> = {}`, checked before the switch.
  - Exit codes: retired → 2, unknown → 1 (unchanged), no args → 0.

**Algorithm.** The test derives live names with the regex `/case '([a-z0-9-]+)':/g` over the dispatcher source, plus `Object.keys(DELEGATED)`. Retired-name behavior is checked by spawning `bun scripts/spur-dev.ts <name>` for each RETIRED key. The set is empty in 1409, so that assertion is vacuous here and becomes live when 1410 adds the first entry.

**Handoff to 1410–1415.** Every wave that deletes or rewires a script updates its A94 entries in the same commit: `disposition: "done"` and refreshed `callers` anchors. It also adds RETIRED entries for removed dispatcher names. Otherwise this test fails, which is the intended tripwire. 1415 asserts the final state: no `pending` entries.

**Anti-patterns.**
- No inventory CLI verb or generator tool.
- No hardcoded entry counts.
- Do not edit or delete the A93 JSON.
- Do not weaken the existing anchor and boundary assertions.

### Plan

- [x] 1. Retarget the test to A94 and add the downstream, usage-coverage and RETIRED assertions. Confirm it fails because the A94 JSON is absent. (R2, R3, R4, R5)
- [x] 2. Build `A94-script-ownership.json`: candidates from `git ls-files`, fields carried from the A93 entries, downstream/surface/wave from satellite §2, current `sourceCommit`. (R1, R5)
- [x] 3. Fix `usage()` and add `RETIRED` with the exit-2 branch. (R3, R4)
- [x] 4. Verify:
  - `bun scripts/spur-dev.ts run-tests test --reporter=dots ./repo-wide-tests/a93-script-ownership.test.ts`
  - `bun scripts/spur-dev.ts; echo $?` → 0, full list
  - `bun scripts/spur-dev.ts nope; echo $?` → 1

  Write the receipt to `.spur/run/1409-receipt.md`. (all)

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/features/A94_downstream-usable-tooling-absorb-remaining-repository-scripts-into-spur-surfaces.md:173` |
| `docs/features/A94_downstream-usable-tooling-absorb-remaining-repository-scripts-into-spur-surfaces.md:185` |
| `docs/features/A94_downstream-usable-tooling-absorb-remaining-repository-scripts-into-spur-surfaces.md:5` |
| `docs/features/A94_downstream-usable-tooling-absorb-remaining-repository-scripts-into-spur-surfaces.md:9` |
| `docs/features/INDEX.md:27` |
| `repo-wide-tests/a93-script-ownership.test.ts:11` |
| `repo-wide-tests/a93-script-ownership.test.ts:112` |
| `repo-wide-tests/a93-script-ownership.test.ts:119` |
| `repo-wide-tests/a93-script-ownership.test.ts:121` |
| `repo-wide-tests/a93-script-ownership.test.ts:124` |
| `repo-wide-tests/a93-script-ownership.test.ts:136` |
| `repo-wide-tests/a93-script-ownership.test.ts:14` |
| `repo-wide-tests/a93-script-ownership.test.ts:143` |
| `repo-wide-tests/a93-script-ownership.test.ts:146` |
| `repo-wide-tests/a93-script-ownership.test.ts:149` |
| `repo-wide-tests/a93-script-ownership.test.ts:155` |
| `repo-wide-tests/a93-script-ownership.test.ts:157` |
| `repo-wide-tests/a93-script-ownership.test.ts:165` |
| `repo-wide-tests/a93-script-ownership.test.ts:2` |
| `repo-wide-tests/a93-script-ownership.test.ts:20` |
| `repo-wide-tests/a93-script-ownership.test.ts:253` |
| `repo-wide-tests/a93-script-ownership.test.ts:26` |
| `repo-wide-tests/a93-script-ownership.test.ts:267` |
| `repo-wide-tests/a93-script-ownership.test.ts:272` |
| `repo-wide-tests/a93-script-ownership.test.ts:295` |
| `repo-wide-tests/a93-script-ownership.test.ts:32` |
| `repo-wide-tests/a93-script-ownership.test.ts:329` |
| `repo-wide-tests/a93-script-ownership.test.ts:338` |
| `repo-wide-tests/a93-script-ownership.test.ts:351` |
| `repo-wide-tests/a93-script-ownership.test.ts:365` |
| `repo-wide-tests/a93-script-ownership.test.ts:4` |
| `repo-wide-tests/a93-script-ownership.test.ts:47` |
| `repo-wide-tests/a93-script-ownership.test.ts:50` |
| `repo-wide-tests/a93-script-ownership.test.ts:56` |
| `repo-wide-tests/a93-script-ownership.test.ts:6` |
| `repo-wide-tests/a93-script-ownership.test.ts:71` |
| `scripts/spur-dev.ts:132` |
| `scripts/spur-dev.ts:149` |
| `scripts/spur-dev.ts:97` |
| `docs/reports/A94-script-ownership.json:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/reports/A94-script-ownership.json:1 — 63 entries, one per tracked candidate, each with downstream/surface/waveWbs/disposition; candidate set regenerated by repo-wide-tests/a93-script-ownership.test.ts:118 |
| R2 | MET | repo-wide-tests/a93-script-ownership.test.ts:136 (downstream/destination/wave), :175 (done-while-tracked), :197 (real anchors); 18 tests pass |
| R3 | MET | scripts/spur-dev.ts:102 COMMANDS printed by usage(); repo-wide-tests/a93-script-ownership.test.ts:317 spawns the dispatcher and compares to its parsed case labels |
| R4 | MET | scripts/spur-dev.ts:129 exported RETIRED map, :150 exit-2 pointer branch; repo-wide-tests/a93-script-ownership.test.ts:331 asserts exit 2 + message and no live collision |
| R5 | MET | docs/reports/A94-script-ownership.json:5 consentStatus granted 2026-11-19 with the surface-shape amendment; asserted at repo-wide-tests/a93-script-ownership.test.ts:279 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Every script has a downstream-use disposition (req: R1, R2) | MET | test | bun test ./repo-wide-tests/a93-script-ownership.test.ts — 18 pass, 0 fail; docs/reports/A94-script-ownership.json:1 |
| AC2 — Public surfaces are consented before implementation (req: R5) | MET | test | repo-wide-tests/a93-script-ownership.test.ts:279 asserts the exact consentStatus block; no surface is accepted while state != granted |
| AC3 — Dispatcher shrinks to retained entries (req: R3, R4) | MET | command | bun scripts/spur-dev.ts -> exit 0 listing all 29 live names; bun scripts/spur-dev.ts nope -> exit 1; RETIRED spawn assertion passes |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature A94; satellite `docs/design/downstream-tooling-absorption.md` §2 (dispositions), §5 (consent).
- A93 record: `docs/reports/A93-script-ownership.json`, `docs/design/concrete-spur-self.md`.
- Dependents: 1410–1415 update A94 entries per wave.
- Concurrency: no other worktrees or wip tasks (`git worktree list`, `spur task list --status wip`, checked 2026-11-20).

### History

- 2026-11-20T08:47:25.855Z todo → wip (system)
- 2026-11-20T08:53:48.661Z wip → testing (system)
- 2026-11-20T08:53:57.663Z testing → done (system)

