---
schema_version: 1
name: "Feature check: exempt home-node AC scenarios and honour ac_altitude in the feature-side orphan sweep"
status: todo
template: issue
created_at: 2026-10-10T05:04:30.044Z
updated_at: "2026-10-10T05:41:37.992Z"
feature_id: F91

ac_altitude: task-local
priority: P2
estimate_hours: 4
---

## 1153. Feature check: exempt home-node AC scenarios and honour ac_altitude in the feature-side orphan sweep

### Background

The feature-side DD-09 orphan sweep compares a feature's AC scenarios against the ACs of tasks linked **directly** by `feature_id`, via `checkAcCoverage` (`packages/app/src/services/feature-check.ts:739-750`, `packages/domain/src/bdd/coverage.ts:106`). Coverage is title-based: a feature scenario is covered when a linked task's gherkin scenario title, checklist item text, or `covers:` alias normalizes to the same title (`packages/domain/src/bdd/coverage.ts:128-142`).

A **home-node feature** deliberately carries a structural scenario instead of a capability one — e.g. knowledge-kit's G7:

```gherkin
Scenario: R1 — Work on kk workflow run ledger has a home node
  Given a change that targets the kk workflow run ledger workflow
  When the change is planned as a feature
  Then it is feature G7 or a child feature of G7
```

No task can cover that statement: it describes *planning placement*, not behaviour, so the sweep reports `L4.uncovered-feature-scenario` and the finding is blocking at the `--as done` target.

Observed 2026-10-10 while closing knowledge-kit task 0247: `spur feature sync G7` (verifying → done) was denied by `GuardDeniedError` with `[ERR] L4 Acceptance Criteria: Feature scenario "R1 — Work on kk workflow run ledger has a home node" is not covered by any linked task (DD-09)`, even though G7's feature-verification receipt was `PASS` (`sha256:49c5b6d8…`, 5m05s pass) and its only directly-linked task (0247) is `done` with a MET AC1. The operator chose to leave G7 in `verifying` and file this task rather than reword the feature's AC.

The same AC shape is used by the sibling home nodes F, G1, G3–G6 in that corpus (all still `backlog`); G2 reached `done` only before the sweep existed (today it fails on a stale receipt), so there is no grandfathering convention to copy.

Second, sharper defect in the same path: the documented `ac_altitude: task-local` carve-out — F91's own deliverable (task 0584) — does not apply on the feature side. `packages/app/src/services/feature-check.ts:742` calls `checkAcCoverage(acBody, taskAc, parseChecklist(taskAc))` with no altitude argument, while `packages/domain/src/bdd/coverage.ts:122` documents a task-local early return whose `orphans` field the code itself warns is "NOT a computed result" (`packages/domain/src/bdd/coverage.ts:115`).

**Refine corrections (2026-10-09)**

- "the finding is blocking at the `--as done` target" → confirmed. The sweep emits `L4.uncovered-feature-scenario` as a warning (`feature-check.ts:747-753`), and `planning-check-base.ts:42` lists it in `COMPLETION_FINDING_CODES`, which become errors at the done boundary. Re-run read-only on 2026-10-09 from `../knowledge-kit` with the source-local CLI: `feature check G7 --as done --json` → `pass:false`, errors `L4.feature-receipt-stale` and `L4.uncovered-feature-scenario`. The `sha256:49c5b6d8…` receipt is now stale, so R4 needs a fresh feature-verification pass whatever this task changes.
- "Second, sharper defect: the `task-local` carve-out does not apply on the feature side" → not a live defect. The feature sweep (`feature-check.ts:742`) omits the altitude, so `checkAcCoverage` computes that task's orphans honestly. That is correct: `task-local` relaxes the *task-side* subset rule (ADR-062 / 0584), not feature coverage. The only callers that pass an altitude read `uncovered` alone (`task-service.ts:1561`); `task-check.ts:1821` returns before calling it. → R2 is restated as hardening a latent trap: the early return at `coverage.ts:122-124` reports `orphans: []` without computing them, and `packages/domain/tests/bdd/coverage.test.ts:173-174` pins that uncomputed empty set. Fix it so a future caller cannot read a false "no orphans". The feature-side call is not changed.
- "expose scenario tags through `parseForCoverage`" → unnecessary. `packages/domain/src/bdd/parser.ts:101-150` already attaches `tags` to each `ParsedScenario`, and `feature-check.ts` already imports `parseFeature` (used at :864). → R1 reads tags in the sweep; `coverage.ts` needs no change for R1.
- R1 "the 0340 classification is unchanged" → verified safe. `checkScenarioSatisfaction` skips a scenario with no covering task (`feature-check.ts:1005` `if (linked.length === 0) continue; // orphan`), so an exempt, uncovered scenario produces no `L4.scenario-unverified`. Exempting at the sweep alone is enough.
- Tag collision check → the only scenario tags in this corpus are `@core` (885), `@edge` (109), `@transition-shim`, and `@deprecated`, and no source reads scenario `tags` today. `@home-node` collides with nothing. Tag conventions are documented in `plugins/sp/skills/spur-dev/references/ac-style-guide.md:70-90`, so the new tag is documented there.
- R4 "G7 reaches `done` once the marker is declared" vs Design "no corpus change in knowledge-kit" → contradictory. `../knowledge-kit` also has uncommitted work from another session. → R4 runs on a scratch copy; tagging the real G7 and syncing it is the knowledge-kit operator's follow-up and is out of scope here.
- AC3 named no test → the two-sided ratchet cases are `packages/app/tests/services/task-check.test.ts:3385-3434` (task 0582, done).

### Requirements

- [ ] R1. A feature scenario tagged `@home-node` (scenario-level gherkin tag in the feature's Acceptance Criteria) is excluded from the feature-side DD-09 orphan sweep (`packages/app/src/services/feature-check.ts:739-754`). The exemption is by tag only, never by matching wording, and only scenario-level tags count (a `Feature:`-level tag does not exempt every scenario). It removes the scenario from the sweep's initial orphan set only. `checkScenarioSatisfaction` (0340), verdict-row matching, and the warning ratchet (0582) are not changed. A tagged scenario that a task does cover is still classified by 0340 as before.
- [ ] R2. `checkAcCoverage(..., 'task-local')` (`packages/domain/src/bdd/coverage.ts:106-124`) computes `orphans` instead of returning an empty set it never computed. With `task-local` it still returns `covered: true`, `uncovered: []`, and no error-severity subset issues, so `task-service.ts:1561` and every existing subset caller behave as today. The `orphans` field and its warning issues are computed exactly as for the default altitude, and a `covers:` alias removes the scenario it names. Replace the CAUTION comment (`coverage.ts:115-121`) with one line stating that `orphans` is always computed and altitude affects only the subset rule. Do not change the feature-side call at `feature-check.ts:742`.
- [ ] R3. Falsification cases:
  (a) a `@home-node` scenario with no covering task produces no `L4.uncovered-feature-scenario`, including at `asStatus: 'done'`;
  (b) the same scenario without the tag still produces it, and it is error severity at the done boundary;
  (c) `checkAcCoverage` with `task-local` and no `covers:` alias lists the feature scenario in `orphans` while `uncovered` stays empty; adding `(covers: <title>)` removes it;
  (d) a feature with one tagged and one untagged uncovered scenario reports only the untagged one.
- [ ] R4. Re-run the knowledge-kit G7 reproduction on a scratch copy with this branch's source-local CLI, and record command and output in `## Testing`: tag G7's R1 `@home-node`, run G7's feature-verification pass for a fresh receipt, then `feature check G7 --as done --json`. Expected: no `L4.uncovered-feature-scenario`. Record any residual finding verbatim. Do not modify `../knowledge-kit` itself.
- [ ] R5. Document `@home-node` in `plugins/sp/skills/spur-dev/references/ac-style-guide.md` next to `@core` / `@edge`: when to use it (a structural or placement scenario no task can cover), that it exempts the scenario from the DD-09 orphan sweep only, and that it must not be used to hide an uncovered capability scenario.

Out of scope: wording heuristics, reusing bracket tags, changing the ratchet baseline, editing knowledge-kit's corpus, grandfathering G2 or the other home nodes, and any CLI surface change.

### Acceptance Criteria

- [ ] AC1 — With the declaration in place, the feature-side sweep stops reporting the structural scenario while an untagged structural scenario still fails (req: R1, R3)
  Evidence: new `FeatureCheckService` cases in `packages/app/tests/services/feature-check.test.ts` (next to the DD-09 orphan cases near :2532): a feature with a `@home-node` scenario and one linked done task yields no `L4.uncovered-feature-scenario` with `asStatus: 'done'`; the untagged control yields it at error severity; a mixed feature reports only the untagged scenario.
- [ ] AC2 — The task-local path computes instead of short-circuiting (req: R2, R3)
  Evidence: `packages/domain/tests/bdd/coverage.test.ts`: the 0584 R3 case at :161 now expects the drifted feature scenarios in `orphans`, with `uncovered` still empty and `covered` still true; a new case shows a `covers:` alias removes the named scenario from `orphans` under `task-local`.
- [ ] AC3 — No ratchet loosening (req: R1, R2)
  Evidence: the 0582 baseline cases `packages/app/tests/services/task-check.test.ts:3385-3434` and the 0584 altitude cases in `coverage.test.ts` / `task-check.test.ts` stay green unedited, except the one `orphans` assertion AC2 intentionally changes.
- [ ] AC4 — The repository gate is green on the change (req: R1, R2, R5)
  Evidence: `bun run spur-check` exits 0; the knowledge-kit G7 scratch reproduction (R4) is recorded in `## Testing`.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-10T05:40:43.017Z

Refine (depth ready), closed decisions:

- R2 is a latent-trap fix, not a live feature-side defect: no caller passes `task-local` and reads `orphans` today. Compute-then-relax was chosen over deleting the altitude parameter, so `task-service.ts:1561` keeps its subset carve-out.
- The marker is frozen as the scenario-level `@home-node` tag, read in the sweep via `parseFeature`; no domain parse change.
- R4 runs on a scratch copy of knowledge-kit. Tagging the real G7 and syncing it to `done` is the knowledge-kit operator's follow-up.
- Added R5 (document the tag in `ac-style-guide.md`), because that file owns gherkin tag conventions.

### Design

**Seam.** R1 lives entirely in `packages/app/src/services/feature-check.ts` at the DD-09 sweep (:739-754). R2 lives entirely in `packages/domain/src/bdd/coverage.ts` `checkAcCoverage` (:106-124). Neither changes a public API, a CLI flag, or a finding code.

**R1 — marker, frozen.** Scenario-level gherkin tag `@home-node`. Add a module constant in `feature-check.ts`, `const HOME_NODE_TAG = '@home-node';`. In the sweep, before the loop:

```ts
const exempt = new Set(
    (parseFeature(acBody)?.scenarios ?? []).filter((s) => s.tags?.includes(HOME_NODE_TAG)).map((s) => s.name),
);
let stillOrphan = new Set(checkAcCoverage(acBody, '').orphans.filter((o) => !exempt.has(o)));
```

Orphan titles and `ParsedScenario.name` come from the same parser (`parseForCoverage` returns `s.name`), so raw-string equality is exact. Keep the existing `hasScenarios && linkedTasks === 0` branch (`L4.orphan-scenarios`) unchanged: a feature with no linked task is still flagged, tag or not. Home nodes always have their child or linked work.

**R2 — compute, then relax.** Delete the early return. Run the existing comparison for every altitude. At the end:

```ts
if (acAltitude === 'task-local') {
    // task-local relaxes only the subset rule (0584 R3); orphans are always computed.
    return { covered: true, orphans, uncovered: [], issues: issues.filter((i) => i.severity !== 'error') };
}
```

Subset-violation issues are exactly the `error` entries; orphan issues are `warning`. The broken-`covers:` alias path pushes to `uncovered` without an issue, and is cleared with `uncovered`. Behavior for `graduating` and absent altitude is byte-identical.

**R5 — doc.** One short `@home-node` subsection in `ac-style-guide.md` after the `@edge` block (:78-89), with a one-scenario example (the G7 shape).

**Rejected.**
- Wording heuristics ("has a home node"): brittle, and they silently exempt a capability scenario phrased that way.
- Reusing `[doc-only]` / `[non-behavior]`: those carry evidence-rule semantics and are stripped before matching (0398 R7).
- Exempting any feature with a single linked task: masks real gaps.
- Hand-adding `covers:` aliases in knowledge-kit: claims coverage the task does not provide, and repeats per home node.
- Threading `acAltitude` into the feature sweep: not needed, and with the old early return it would have produced false "no orphans".
- Changing `parseForCoverage` to return tags: the sweep already has `parseFeature`.

**Anti-patterns.** Do not exempt by feature-level tag. Do not suppress `L4.scenario-unverified` or `L4.orphan-scenarios`. Do not touch `COMPLETION_FINDING_CODES` or the ratchet baseline. Do not edit `../knowledge-kit`.

**Blast radius.** Two source files, their two test suites, one plugin reference doc. The domain change can only add `orphans` entries for `task-local` callers, and no such caller reads `orphans` today.

**Dependencies / concurrency.** No `dependencies[]`. F91 is `active`; its file has an uncommitted 6-line edit in this tree from another session, so leave it alone. The `main` tree also has uncommitted edits to `packages/app/src/services/inline-run-setup.ts`, a disjoint file; start from a tree clean of other tasks' changes (AGENTS.md commit-per-task).

### Plan

1. R2 first (domain, smallest): in `coverage.test.ts` change the :173 expectation to the computed orphans, add the `covers:` alias case under `task-local`, and watch both fail. Then edit `checkAcCoverage` per Design and replace the CAUTION comment. Run `(cd packages/domain && bun test tests/bdd/coverage.test.ts)`.
2. R1: add the AC1 cases to `packages/app/tests/services/feature-check.test.ts` (tagged + done boundary, untagged control at error severity, mixed), and watch the tagged case fail. Add `HOME_NODE_TAG` and the exempt filter at the sweep. Run `(cd packages/app && bun test tests/services/feature-check.test.ts tests/services/task-check.test.ts)`.
3. R5: add the `@home-node` subsection to `ac-style-guide.md`.
4. R4: copy `../knowledge-kit` (including `.spur/`) to `$TMPDIR/kk-1153`; tag G7 R1 `@home-node`; run G7's feature-verification pass with `bun <spur-new>/apps/cli/src/index.ts`; then `feature check G7 --as done --json`. Record commands and output in `## Testing`.
5. `bun run spur-check`; record the tail in `## Testing`.

### Root Cause

The sweep has no first-class way to say "no task is expected to cover this scenario", and the one carved-out mechanism that exists is not wired on this path.

- **No structural-scenario marker.** `parseForCoverage` returns only `parsed.scenarios.map((s) => s.name)` (`packages/domain/src/bdd/coverage.ts:216-222`), so gherkin tags never reach the comparison. The existing bracket tags (`[doc-only]`, `[non-behavior]`, `[advisory]`, `[non-core]`) are *evidence-rule metadata* that `requiresExecutableEvidence` reads — they are stripped from scenario identity precisely so they do not take part in title matching (`packages/domain/src/bdd/coverage.ts:27-40`) — so they cannot serve as a sweep exemption without overloading one marker with two meanings.
- **The altitude carve-out is inert here.** The feature-side call omits the `acAltitude` argument (`packages/app/src/services/feature-check.ts:742`); had it been passed, the intersection would collapse to "no orphans" for reasons unrelated to coverage, which the in-code CAUTION at `packages/domain/src/bdd/coverage.ts:115-121` explicitly warns against. The two rules have therefore diverged: a task may declare its ACs task-local (the subset rule is skipped for it) while the feature still demands coverage for scenarios that no linked task can own.
- **Consequence.** A home-node feature cannot complete: the receipt gate passes, the coverage gate blocks, and the only in-corpus escapes today are a hand-written `covers:` alias claiming coverage the task does not provide, or rewording the feature's AC (a scope decision).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature F91 (active). Task 0584 / ADR-062 — `ac_altitude` carve-out. Task 0582 (done) — two-sided ratchet. Task 0340 — scenario satisfaction. Task 0398 R7 — bracket tags stripped from identity. Task 0700 R3 — `covers:` aliases.
- `packages/domain/src/bdd/coverage.ts:106-124` (`checkAcCoverage`, early return, CAUTION), `:216` `parseForCoverage`.
- `packages/domain/src/bdd/parser.ts:101-150` — scenario `tags`.
- `packages/app/src/services/feature-check.ts:739-754` sweep, `:1005` satisfaction skips uncovered scenarios.
- `packages/app/src/services/planning-check-base.ts:40-63` `COMPLETION_FINDING_CODES`.
- `packages/app/src/services/task-service.ts:1561`, `packages/app/src/services/task-check.ts:1821` — altitude callers (read `uncovered` only).
- Tests: `packages/domain/tests/bdd/coverage.test.ts:161-190`, `packages/app/tests/services/feature-check.test.ts:2532-2610`, `packages/app/tests/services/task-check.test.ts:3385-3434`.
- `plugins/sp/skills/spur-dev/references/ac-style-guide.md:70-90` — tag conventions.
- Reproduction: `../knowledge-kit/docs/features/G7_kk-workflow-run-ledger.md` (status `verifying`, `@core` R1 home-node scenario); 2026-10-09 read-only `feature check G7 --as done` → `L4.feature-receipt-stale`, `L4.uncovered-feature-scenario`.

### History
