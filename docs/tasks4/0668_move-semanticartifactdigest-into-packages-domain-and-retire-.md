---
schema_version: 1
name: "Move semanticArtifactDigest into packages/domain and retire the ranked-key mirror"
status: cancelled
template: feature-impl
created_at: 2026-08-25T16:54:43.001Z
updated_at: "2026-08-25T17:06:41.608Z"
feature_id: I8
ac_altitude: task-local
---

## 0668. Move semanticArtifactDigest into packages/domain and retire the ranked-key mirror

### Background
Follow-up from the I8 verifyall re-audit (2026-08-25). `semanticArtifactDigest` — the function
ADR-079 makes cache validity depend on — lives in `plugins/sp/scripts/history-anatomy-cache.ts`,
outside `packages/domain`, while the type it canonicalizes (`HistoryArtifact`) lives in
`packages/domain/src/analytics/artifact.ts`.

The script therefore hand-maintains a mirror of the artifact's shape: `RANKED_ARTIFACT_KEYS` names
the arrays whose ORDER is evidence (bounded leaderboards) so canonicalization does not sort them.
Nothing keeps that mirror in sync with the type.

**The drift is proven, not hypothetical.** Two ranked arrays were missing from the list for months:

| Array | Ranked since | Missing until |
| --- | --- | --- |
| `CacheWasteStat.topSteps` — "largest offenders, bounded by the same `top`" (`artifact.ts:161`) | 0581 | 2026-08-25 |
| `DerivedVariables.bottlenecks` — "rank bottlenecks by ms descending" (`derived.ts:345`) | 0554 | 2026-08-25 |

**Neither was exploitable**, and the record should say so plainly: every entry in both lists carries
its own sort key, so `analyze` cannot emit the same entries in a different order — a reordering
implies a value change, which changes the digest anyway. The 2026-08-25 fix added both keys for
correctness-of-intent and consistency, not to close a live false-hit.

**The risk is the next one.** A ranked array whose order is NOT determined by its entries — ties
broken by insertion order, or a list ordered by an external key — would be silently sorted away, and
the digest would report `hit` on changed evidence. That is the one failure ADR-079 exists to prevent.

Secondary instances of the same seam: `ELEVEN_SECTIONS` and `FINDING_FIELDS` are re-declared in the
script as local constants duplicating `plugins/sp/skills/history-anatomy/references/report-contract.md`,
held together only by a string-matching test in `plugins/sp/tests/skill-structure.test.ts`.

**Constraint that shaped the original placement (do not regress it).** The script is ADR-065
"standard contract": no `packages/` import, no `Bun.*` global, a committed `.mjs` twin that runs
under bare `node` on an agent machine that has only the plugin. Any fix must preserve that — the
twin cannot gain a runtime dependency on the monorepo.
### Requirements
- [ ] R1. `semanticArtifactDigest` and its canonicalization rules have a single owner in
      `packages/domain/src/analytics/`, beside the `HistoryArtifact` type they canonicalize. The
      ranked-versus-set classification is derived from, or co-located with, the artifact definition —
      not retyped as a second list.
- [ ] R2. The plugin script consumes that owner without gaining a runtime dependency on the
      monorepo: ADR-065 standard contract is preserved (no `packages/` import surviving into the
      committed `.mjs` twin, no `Bun.*` global, `bun run script-contract-check` green, the twin still
      runs under bare `node` on a plugin-only machine).
- [ ] R3. Adding a new array field to `HistoryArtifact` without classifying it as ranked or set
      fails a test — the drift class is closed, not merely the two known instances.
- [ ] R4. Digest values are unchanged for every currently ranked and set array, so no published
      report's recorded `artifactDigest` is invalidated by the move. A migration that silently
      invalidates every existing cache is a regression, not a refactor.
- [ ] R5. `ELEVEN_SECTIONS` and `FINDING_FIELDS` are assessed against the same seam: either given a
      single owner or explicitly recorded as a deliberate duplication with the reason, so the choice
      is documented rather than incidental.
- [ ] R6. `docs/04_DESIGN.md` records the resulting ownership boundary in the same commit (T3), and
      ADR-079 gains an amendment noting where digest authority now lives.
### Acceptance Criteria
```gherkin
Feature: Single-owner artifact digest with no hand-maintained shape mirror

  @core
  Scenario: R1 — The digest and its ranking rules have one owner beside the artifact type
    Given the analyze artifact type in "packages/domain/src/analytics/"
    When the semantic digest implementation is located
    Then it lives in the same package as the type it canonicalizes
    And the ranked-versus-set classification is defined once
    And no second enumeration of artifact array keys exists in "plugins/sp/scripts/"

  @core
  Scenario: R2 — The plugin script still runs on a plugin-only agent machine
    Given the committed ".mjs" twin of the history-anatomy cache helper
    When "bun run script-contract-check" runs
    Then it reports zero violations
    And the twin contains no import resolving into "packages/"
    And invoking the twin under bare "node" produces a digest for a fixture artifact

  @core
  Scenario: R3 — An unclassified new artifact array fails the suite
    Given a new array field added to "HistoryArtifact"
    When the test suite runs without classifying it as ranked or set
    Then a test fails naming the unclassified field
    And the failure message states that order-as-evidence must be declared

  @core
  Scenario: R4 — The move does not invalidate any published report's recorded digest
    Given a fixture artifact and the digest produced by the pre-move implementation
    When the post-move implementation digests the same artifact
    Then the two digests are identical
    And every currently ranked array still preserves order
    And every currently set-valued array still sorts

  @edge
  Scenario: R5 — The report-contract vocabulary duplication is resolved or recorded
    Given "ELEVEN_SECTIONS" and "FINDING_FIELDS" in the cache helper
    When the ownership seam is reviewed
    Then either they are sourced from a single owner
    And or the duplication is recorded with its reason in the script and in "docs/04_DESIGN.md"

  @core
  Scenario: R6 — The ownership boundary is documented in the same change
    Given the digest has moved
    When the documentation gates run
    Then "docs/04_DESIGN.md" names the owning module in the same commit
    And ADR-079 carries an amendment stating where digest authority lives
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-25T17:06:12.212Z todo → cancelled (system)
