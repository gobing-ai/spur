---
schema_version: 1
name: "S4: Optional behavior-neutral workflow version contract in both dialects"
status: todo
template: feature-impl
created_at: 2026-09-03T20:27:38.911Z
updated_at: "2026-09-03T21:13:35.212Z"
feature_id: D9
dependencies: ["0752"]
ac_altitude: task-local
---

## 0756. S4: Optional behavior-neutral workflow version contract in both dialects

### Background
Both workflow dialects already accept an optional root `version?: string`, including the useless empty string. All 11 repository definitions omit it, and no list/show/run evidence propagates it (`docs/inventory/d8-0729-workflow-contract-inventory.md` §H).

D8's decision was to reuse the field as a behavior-neutral identity tag rather than build version infrastructure: absent means `unversioned`, a present non-empty literal is `explicit(<literal>)`, and nothing dispatches on it. The exact definition digest already exists (`packages/app/src/workflow/composition-baseline.ts:110`) and folds `version` in, so a version-only edit changes the digest with zero behavior change — proven in the prototype with two digests (`docs/analysis/d8-0732-proportional-gate-prototype.md` §7).

The one real defect is that `version: ""` validates silently today. Everything else here is a small schema and reporting contract. D8 decision **D4** (accepted default) records this as an amendment to the workflow-schema documentation rather than a new ADR; decision **D5** keeps the digest as the rendered identity, with version not surfaced in `show`/`trace` by default.

No registry, no semantic-version parser, and no mandate: a future-major requirement needs objective evidence — a consumer that branches on version, or a real drift incident the digest diagnostic could not disambiguate. Neither exists.
### Requirements
- [ ] R1. Both dialect schemas accept an optional root `version` as a non-empty string; `version: ""` fails validation with a diagnostic naming the empty value.
- [ ] R2. A definition with no `version` is reported as `unversioned`; one with a literal is reported as `explicit(<literal>)`. The literal is treated as opaque — not parsed, ordered, or compared for compatibility.
- [ ] R3. No behavior dispatches on `version`. An unversioned and a versioned copy of the same definition execute identically; only their digests differ.
- [ ] R4. The workflow-schema documentation is amended to describe the optional-first contract, including the absent/explicit/empty semantics and the no-registry boundary (D8 decision D4).
- [ ] R5. The digest remains the rendered run identity; `version` is not surfaced in `show`/`trace` output by default (D8 decision D5).
- [ ] R6. Pause and resume need no version-specific handling: the digest comparison introduced by task 0752 already catches a version edit between run and resume, and this task adds no second mechanism.
- [ ] R7. No supported-version registry, semantic-version parser, or compatibility engine is added.
### Acceptance Criteria
```gherkin
Feature: Optional behavior-neutral workflow version

  @core
  Scenario: R1 — An empty version value is rejected with a diagnostic
    Given a workflow definition declaring an empty-string version
    When it is validated in either dialect
    Then validation fails with a diagnostic naming the empty value.

  @core
  Scenario: An unversioned workflow keeps working and an explicit version is observable
    Given one workflow definition with no version field and a copy declaring a non-empty version literal
    When each is validated and run
    Then both execute the same steps with the same outcome
    And the first is reported as unversioned and the second as its explicit literal
    And their definition digests differ.

  @core
  Scenario: R2 — The version literal is opaque
    Given a workflow declaring a version literal that is not a semantic version
    When it is validated and run
    Then it is accepted and reported verbatim
    And nothing parses, orders, or compatibility-checks the literal.

  @edge
  Scenario: R5 — The digest stays the rendered identity
    Given a versioned workflow run
    When show and trace render it
    Then the definition digest is the identity shown
    And the version literal is not surfaced by default.

  @edge
  Scenario: R7 — No version infrastructure is introduced
    Given the change set for this task
    When it is inspected
    Then it contains no supported-version registry, semantic-version parser, or compatibility engine.
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**This is a `minLength: 1` and a reporting label.** The schemas already accept the field; the work is rejecting the empty string in both dialects' JSON/Zod schemas and adding the `unversioned` / `explicit(<literal>)` classification wherever a definition's identity is reported. Everything else in the contract is a statement about what we deliberately do *not* build.

**Opaque means opaque.** Do not add a parser, a comparator, or an ordering. The moment something parses the literal, `version` stops being behavior-neutral and this task's whole justification (no registry until behavior dispatches on it) collapses. If a future consumer needs to branch on version, that is the objective evidence the mandate requires — and a different task.

**R6 is a deliberate non-implementation.** Version drift across a pause is already caught by 0752's digest comparison, because `version` is folded into the digest. Adding version-specific resume handling would be a second mechanism for a case the first already covers. Depend on 0752; write a test that proves the coverage rather than new code.

**R5 keeps the surface still.** The digest is the identity operators already read. Surfacing a second identity by default invites confusion about which one is authoritative for no gain, since nothing dispatches on version.

**Tradeoff:** rejecting `version: ""` is technically a validation tightening. No repository definition declares it, so real-world breakage is limited to a definition that was already declaring something meaningless.

**Depends on 0752** for the digest comparison R6 relies on. No dependency on 0751 or 0753.
### Plan
- [ ] R1: add `minLength: 1` (and the Zod equivalent) to the root `version` in both dialect schemas; assert the diagnostic names the empty value.
- [ ] R2: add the `unversioned` / `explicit(<literal>)` classification at the definition-identity reporting point; keep the literal opaque.
- [ ] R3: add the both-forms test — same definition with and without a version executes identically, digests differ (mirror the 0732 §7 proof).
- [ ] R6: add the test proving 0752's digest comparison catches a version-only edit across pause/resume; add no new resume code.
- [ ] R4: amend the workflow-schema documentation with the optional-first contract and the no-registry boundary.
- [ ] R5/R7: confirm `show`/`trace` default output is unchanged and the diff contains no registry or parser.
- [ ] `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §8, §7 (S4), §9.3 decisions D4 and D5
- Evidence: `docs/inventory/d8-0729-workflow-contract-inventory.md` §H; `docs/analysis/d8-0732-proportional-gate-prototype.md` §7 (both-forms digest proof)
- Code: `packages/domain/src/planning/schema.ts` and the dialect schemas; `packages/app/src/workflow/composition-baseline.ts:110`
- Depends on: 0752 (digest comparison at resume)
### History
