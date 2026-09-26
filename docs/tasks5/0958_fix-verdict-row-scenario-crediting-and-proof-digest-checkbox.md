---
schema_version: 1
name: Fix verdict-row scenario crediting and proof-digest checkbox invalidation in the completion gate
status: backlog
template: feature-impl
created_at: 2026-09-26T00:29:55.505Z
updated_at: "2026-09-26T17:03:44.532Z"
feature_id: F91

ac_altitude: task-local
---

## 0958. Fix verdict-row scenario crediting and proof-digest checkbox invalidation in the completion gate

### Background

Two defects in the completion/evidence path, both found by a real batch run (`/sp:dev-runall --feature D6`,
knowledge-kit, 2026-09-25) where three tasks (0164/0165/0166) each reached `done` with gate/review/verify
PASS, and the feature still could not close. They are mirror images of each other: one **under-credits**
valid evidence, the other **over-invalidates** it. Both were worked around by hand during that run; the
workarounds are the reproduction.

#### Defect A — a verdict row that explicitly names a feature scenario is not credited by it

The verifier wrote its traceability rows keyed by prose:

| row id (verbatim from the artifact) | status |
| --- | --- |
| `Req1 — \`fallback?: true \| string[]\` on the envelope; …` | MET |
| `Req2 (feature R3) — \`resolveFallbackOrder\` contract` | MET |
| `Req3 (feature R6) — selection unchanged` | MET |
| `AC1 — explicit fallback list honored in order (R3)` | MET |
| `AC2 — explicit unknown/unconfigured provider still throws at selection (R6)` | MET |

`spur feature check D6 --as done` then reported:

```
D6 (done): FAIL
  [ERR] L4 Acceptance Criteria: Task 0165 verdict evidence (.spur/run/0165-verdict.json) carries 5
        row(s) matching no scenario of this feature — key rows by scenario title or AC-N alias
        (repair: /sp:dev-verify 0165)
  [ERR] L4 Acceptance Criteria: Feature scenario "R3 — Explicit fallback list is honored in order" is
        linked but unverified: covering task(s) 0165 have no PASS verdict with MET requirement
  [ERR] L4 Acceptance Criteria: Feature scenario "R6 — Explicit unknown or unconfigured provider still
        throws at selection" is linked but unverified: covering task(s) 0165 have no PASS verdict with
        MET requirement
```

Two rows name their scenario in parentheses — `(feature R3)`, `(feature R6)` — and are still credited to
nothing. Root cause, verified in source:

- `spur task verdict --from-answer` derives each row's `id` from the answer table's first column
  verbatim (`packages/app/src/services/task-verdict.ts` → `deriveVerdict`), so the id is free-form model
  prose.
- The done gate matches a row to a scenario with
  `rowMatchesScenario(id, sc)` (`packages/app/src/services/feature-check.ts:1206`), which accepts only:
  `normalizeTitle(id)` equal to the scenario's normalized title, or `id`/stripped/body-stripped equal to
  `sc.alias` — and `sc.alias` is `AC-<n>` (1-based ordinal, built at `feature-check.ts:796`, and a second builder `indexScenarioAliases` at `:1262` builds the same `AC-<n>` aliases).
  `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:61`) strips a leading `R<n>`/`AC<n>` prefix but
  has no notion of a scenario reference *inside* a longer string. So `(feature R3)` contributes nothing.
- Nothing upstream prevents this: the verify-exit lint
  (`plugins/sp/scripts/verify-answer-lint.ts`; the `apps/cli/plugins/…` path is the generated build:bundle copy) validates AC ids against the task's AC labels
  *or* a linked feature scenario title — the prose ids satisfy the task-label branch, so the lint passes
  and the failure only surfaces later, at the feature's `verifying → done` boundary, as an opaque count.

Observed cost: the feature sat at `verifying`; the repair was manual — re-key the two rows to the
scenario titles, re-run `spur task verdict --from-answer`, re-bind the verdict proof block, re-run the
transition. `spur feature check D6 --as done` then returned `D6 (done): PASS` with zero findings.

#### Defect B — ticking a Requirements/AC checkbox invalidates the proof digest

`proof.fingerprint` folds the task spec's proof-input sections into the digest
(`packages/app/src/workflow/proof-input-fingerprint.ts` → `extractTaskProofData`, `TASK_SPEC_SECTIONS`).
The section bodies are hashed verbatim, so the `- [ ]` / `- [x]` marker is part of the hash. Ticking a
verified checkbox — a *verification-state* write, not a spec change — therefore moves the digest.

Measured in the same run:

| task | digest before the record-stage box tick | digest after | consequence |
| --- | --- | --- | --- |
| 0164 | `sha256:12dcfb9f60f7d53670b45eaac90db629c8438dc03cfe6ddb71c889992bc083ce` | `sha256:4d0342761772b88896297578ccfff62274d2f912c4eae9f75e89b8a456fdb259` | re-capture + verdict proof-block re-bind required |
| 0165 | `sha256:8aec71107ad7a2df4b1c866279e9bdda23cf16295b9285973b3353434a47e693` | `sha256:2da118d353e5efc445fab7e0215bc107b0fe1a046aa50cee8312f71953c2871e` | same |
| 0166 | `sha256:c8597aa0cea650bc2dfd9eb89f7b508ef6d080cc3d14a4435c36efa43395f30d` | unchanged after `### Solution` + `### Testing` backfills | R6 carve-out works for those sections |

So the R6 carve-out (record-time Solution/Testing/Review writes do not invalidate) is correct and
deliberate, but the checkbox tick lands in the Requirements/AC sections it does *not* cover. The tick is
the canonical record-stage action — `spur task record` has no checkbox flag, so an operator must use
`spur task update <wbs> --section Requirements --from-file …` — which means the pipeline's own sanctioned
record step invalidates the proof it just established, and the run must re-capture (R4 pattern) and
re-bind the verdict proof block by hand. A task that is *more* verified looks *less* certified.

#### Blast radius and sibling work (re-checked 2026-09-26)

- **0956** (D64 data-level re-key of tasks 0937–0946) is now **done**. It was the workaround, and this task is the engine fix. 0956 R3 documented the trap from the other side: a covering task whose rows are keyed task-locally fires `L4.verdict-rows-match-no-scenario`. R2 below is scoped to covering tasks for that reason.
- **0957** (feature-receipt verifier identity) is now **done**. It touched a different layer, and there is no overlap.
- **Folded in: 0975 F3** (proof-capture ordering against the completion-box tick). Ticking boxes before the `record` hop moved the fresh digest off the declared one. Defect B's checkbox-canonical digest makes the ordering irrelevant, so 0975 no longer carries it. **0976** also points here for the same observation.
- There is no other pending overlap. `rg` over 0964–0976 for `rowMatchesScenario`, `canonicalizeCheckbox`, the tick-state digest, and `verdict-rows-match-no-scenario` returns only this task and the pointers above.

#### Provenance note (not this task's fix)

The consuming project measured Defect B with a hand-rolled digest runner. Its stale vendored `inline-run-setup.ts` lacked `--fingerprint`, because the inline driver reference resolves `plugins/sp/scripts/` project-first. That resolution defect is owned by **0960**.

### Requirements

- [ ] R1. The feature done gate credits a verdict row to a scenario when the row's `id` carries an explicit reference to that scenario. The accepted embedded forms are a parenthesised `(feature R<n>)`, a parenthesised `(covers: R<n>)`, and a bracketed `[R<n>]` tag. The reference must be one of these delimited tokens; a bare `R<n>` substring anywhere else in the row does not count. Both alias builders (`scenarioAliases` and `indexScenarioAliases`) carry the scenario label, so the gate and the verified-scenario lookup agree.
- [ ] R2. `spur task verdict --from-answer` exits non-zero with an actionable message when three conditions all hold: the task covers at least one scenario of its linked feature (the same `checkAcCoverage` semantics the done gate uses to select covering tasks), that feature's scenarios parse, and no derived row names any of those scenarios. The message lists the offending row ids and the accepted key forms. The check reuses `rowMatchesScenario` in-process, so the check and the done gate cannot disagree.
- [ ] R3. The proof digest is unchanged when the only difference in a proof-input section is checkbox tick-state (`- [ ]` against `- [x]`, including `*`/`+` bullets, indentation and case variants).
- [ ] R4. The proof digest still changes when the text of a proof-input section changes (any edit other than the checkbox marker), and when a proof-input section is added or removed.
- [ ] R5. The `L4.verdict-rows-match-no-scenario` finding names the offending row ids (bounded: the first 5 plus a count) and the accepted key forms, so the repair can be derived from the finding alone.
- [ ] R6. Existing behaviour is preserved. A row keyed by the scenario's exact title or by `AC-<n>` still matches. A task with no linked feature, a task that covers no scenario (task-local rows), and a feature with no parseable scenarios are unaffected and never trip R2.

### Acceptance Criteria

- [ ] AC1 — An embedded `(feature R<n>)` reference is credited by that scenario at the done gate (req: R1)
- [ ] AC2 — An embedded `(covers: R<n>)` or `[R<n>]` reference is credited by that scenario (req: R1)
- [ ] AC3 — A row whose only scenario-like token is an unrelated bare `R<n>` substring is NOT credited, so the new rule cannot over-credit (req: R1)
- [ ] AC4 — `spur task verdict --from-answer` fails with a named message for a covering task whose rows name no linked-feature scenario, and passes once a row is re-keyed (req: R2)
- [ ] AC5 — A checkbox-only edit to Requirements or Acceptance Criteria leaves the proof digest byte-identical; a text edit changes it (req: R3, R4)
- [ ] AC6 — The done-gate finding names the offending row ids (req: R5)
- [ ] AC7 — Title-keyed, `AC-<n>`-keyed, orphan-task, non-covering task-local and scenario-less-feature cases are unchanged (req: R6)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T00:30:39.373Z

- **Credit the explicit embedded reference, not a bare `R<n>` token (closed).** Scanning a row id for any
  `R<n>` substring would credit `Req1 — fallback … ` style rows to unrelated scenarios and would make the
  gate unable to distinguish a scenario reference from incidental prose. Only the three explicit,
  delimiting forms are accepted: `(feature R<n>)`, `(covers: R<n>)`, `[R<n>]`. Rationale: the run's real
  rows used `(feature R3)`, and `(covers: …)` is already the corpus's established binding syntax
  (`COVERS_RE` in `feature-check.ts` for task AC → feature scenario).
- **Prevention belongs in the verify-exit lint, not in the done gate (closed).** The done gate already
  detects the condition, but by then the task is `done`, the proof bracket is bound, and the repair is a
  manual re-key + re-derive + re-bind. The lint runs between the verify agent and
  `spur task verdict --from-answer`, so failing there makes the fix a re-key before any evidence is
  certified. The done gate keeps its finding as the backstop.
- **Checkbox normalization is scoped to the marker, not to whitespace (closed).** Only the checkbox marker
  is canonicalized; all other text is hashed as-is, so a spec edit can never hide behind normalization.
  Deliberately *not* normalized: list bullets, indentation of non-checkbox lines, and checkbox ordering —
  those remain spec content.
- **Digest values change for a given input (accepted, documented).** Normalizing the marker changes the
  digest for any task whose sections contain checkboxes. The digest is per-run state, not a persisted
  contract across versions, so this is acceptable; the change must be noted in the code comment and in
  the task's Solution so a live run spanning an upgrade is diagnosable rather than mysterious.
- **No pipeline YAML change (closed).** `task-pipeline.yaml`'s capture point (test entry) and the R4
  re-capture at `test-recheck` stay as they are; the fix removes a false invalidation rather than moving
  the bracket. Changing the YAML would re-open the digest/definition binding for every project.

#### Q&A entry — 2026-09-26T17:03:43.852Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T00:30:39.373Z

- **Credit the explicit embedded reference, not a bare `R<n>` token (closed).** Scanning a row id for any
  `R<n>` substring would credit `Req1 — fallback … ` style rows to unrelated scenarios and would make the
  gate unable to distinguish a scenario reference from incidental prose. Only the three explicit,
  delimiting forms are accepted: `(feature R<n>)`, `(covers: R<n>)`, `[R<n>]`. Rationale: the run's real
  rows used `(feature R3)`, and `(covers: …)` is already the corpus's established binding syntax
  (`COVERS_RE` in `feature-check.ts` for task AC → feature scenario).
- **Prevention runs in `spur task verdict --from-answer`, not in `verify-answer-lint.ts` (closed; revised 2026-09-26).** The original choice (the lint) is not implementable as written. `plugins/sp/scripts/*` may value-import only `node:*`/`bun:*` builtins and relative paths (`sp-plugin-standalone` rule), so the lint cannot import `rowMatchesScenario`. A second copy of the matcher inside the lint is exactly the divergence Defect A comes from. The lint already carries its own scenario-title normalization (`verify-answer-lint.ts:364-367`, `:473-510`), which is how prose ids passed it. `task verdict --from-answer` runs immediately after the lint in the pipeline (`task-pipeline.yaml:720`) and in every standalone correction loop, so it still fails before any evidence is certified. It is app-side, where the matcher lives. The done gate keeps its finding as the backstop.
- **R2 applies only to covering tasks (closed).** The done gate reads verdict rows only from tasks that cover a scenario (`feature-check.ts:802-828`). Applying R2 to every feature-linked task would punish task-local tasks, which is the trap 0956 R3 recorded.
- **The matcher runs over the original id (closed).** `rowMatchesScenario` derives `bodyStripped` by removing a trailing parenthetical, which is where `(feature R3)` sits. The explicit-reference extractor must therefore read the raw `id`, before any stripping.
- **Checkbox normalization is scoped to the marker, not to whitespace (closed).** Only the checkbox marker
  is canonicalized; all other text is hashed as-is, so a spec edit can never hide behind normalization.
  Deliberately *not* normalized: list bullets, indentation of non-checkbox lines, and checkbox ordering —
  those remain spec content.
- **Digest values change for a given input (accepted, documented).** Normalizing the marker changes the
  digest for any task whose sections contain checkboxes. The digest is per-run state, not a persisted
  contract across versions, so this is acceptable; the change must be noted in the code comment and in
  the task's Solution so a live run spanning an upgrade is diagnosable rather than mysterious.
- **No pipeline YAML change (closed).** `task-pipeline.yaml`'s capture point (test entry) and the R4
  re-capture at `test-recheck` stay as they are; the fix removes a false invalidation rather than moving
  the bracket. Changing the YAML would re-open the digest/definition binding for every project.

### Design

#### R1/R2/R5: crediting and prevention

- **`packages/app/src/services/feature-check.ts`: extend `rowMatchesScenario(id, sc)` (:1206).**
  - Add an explicit-reference extractor. It is evaluated in addition to the existing normalized-title and alias comparisons.
  - It runs over the **original** `id`. `bodyStripped` removes the trailing parenthetical that carries `(feature R3)`, so the extractor cannot run after that step.
  - Bounded patterns, case-insensitive:
    - `\((?:feature|covers:)\s*(R\d+)\b[^)]*\)`. `covers:` may be followed by a title, so capture only the leading `R<n>` token.
    - `\[(R\d+)\]`.
  - A captured token is compared to the scenario's `R<n>` label.
  - Invariant: the extractor never matches a bare `R<n>` outside one of the three delimiters.
- **Both alias builders carry the label.** Add `label` next to `alias: AC-${i+1}` in `scenarioAliases` (:796) and in `indexScenarioAliases` (:1262). Derive it from the scenario name's leading `R<n>`, using the prefix rule `normalizeTitle`/`stripScenarioPrefixes` already applies (`packages/domain/src/bdd/coverage.ts:61`). If `label` is absent (a scenario with no `R<n>` prefix), only the extractor branch is disabled for that scenario.
- **R2 check, app-side.**
  - Add `verdictScenarioKeyGap(wbs, rows)` to `packages/app/src/services/feature-check.ts`. It sits next to `verdictRowsMatchScenarios` (:1236), which is exported but has had no production caller since 0700 R3, and reuses it.
  - It resolves the task's linked feature and decides "covering" with the same `checkAcCoverage` call the done gate uses (:802-818).
  - It returns `null` in three cases: no linked feature, no parseable scenarios, or a non-covering task. Otherwise it returns the offending ids and the accepted forms.
  - `apps/cli/src/commands/task.ts` `verdict` (:1265) calls it after `deriveVerdict` over `[...requirements, ...acceptanceCriteria]`. On a gap it prints the message, does **not** write the artifact, and exits non-zero. The handler stays a thin transport (ADR-021).
  - This answers both reasons 0700 R3 gave for removing the old verdict-time warning (comment at :1291-1298):
    - The old warning could not be cleared. This check is scoped to covering tasks, and re-keying one row clears it.
    - The old warning read only `requirements`. This check reads both tables, as the gate does.
- **`verify-answer-lint.ts` is unchanged.** Its private scenario-title mirror (`plugins/sp/scripts/verify-answer-lint.ts:284`) only admits ids and never credits them. Prose ids already pass it, so the three new forms cannot regress it. It stays standalone-safe.
- **Improve the done-gate message (:915-931).** `L4_VERDICT_ROWS_MATCH_NO_SCENARIO` lists the first 5 offending row ids plus a count, and names the accepted forms: scenario title, `AC-<n>`, `(feature R<n>)`, `(covers: R<n>)`, `[R<n>]`. Keep the `L4.scenario-unverified` text; it already names the scenario and the covering task. The done gate stays the backstop.

#### R3/R4 — proof-digest checkbox normalization

- **`packages/app/src/workflow/proof-input-fingerprint.ts` — canonicalize the checkbox marker inside
  `extractTaskProofData` (:302) and `extractFeatureProofData` (:343)** before the section body is hashed.
  Proposed shape: a small pure helper applied to each section body,
  e.g. `canonicalizeCheckboxMarkers(body)` replacing `^(\s*)(?:[-*+])\s+\[[ xX]\]` with `$1- [x]` — i.e.
  every checkbox marker, ticked or not, indented or not, `-`/`*`/`+`, is canonicalized to one identical
  form, so tick-state cannot influence the digest while the item's text still can.
- **Scope guard:** the helper applies to proof-input section bodies only. `computeProofInputFingerprint`
  (:376) also folds the git tree and the feature file; the git-tree half is untouched, so a real code change
  still moves the digest.
- **Tests:** `packages/app/tests/workflow/proof-input-fingerprint.test.ts` and
  `.../actions/proof-fingerprint.test.ts` already cover the bracket; add cases — (a) tick-only edit →
  identical digest; (b) text edit in a checkbox item → different digest; (c) `* [ ]` / indented / `[X]`
  variants all canonicalize to the same digest as `- [ ]`; (d) section added/removed → different digest.
- **Comment the compatibility note** beside the helper: digest values for inputs containing checkboxes
  change once, so a run spanning the upgrade sees one expected mismatch rather than a silent pass.

#### Verification of the fix (the reproduction must go green)

Replay the recorded failure: build a verdict artifact whose rows are keyed exactly as the run's
(`Req2 (feature R3) — …`, `Req3 (feature R6) — …`, both MET) against a feature whose scenarios are
`R3 — …` / `R6 — …`, and assert `spur feature check <feature> --as done` passes without re-keying; then
assert the pre-fix behaviour by checking the same artifact against the current build still fails. For the
digest: flip a checkbox in a task's Requirements section and assert the digest is unchanged, then edit the
item text and assert it changes.

### Plan

- [ ] 1. `feature-check.ts`: add `label` to both alias builders (:796, :1262). Extend `rowMatchesScenario` (:1206) with the three explicit embedded-reference forms, evaluated over the raw id. Unit tests: credited forms, bare-`R<n>` non-match, unchanged title/alias paths, and a scenario without an `R<n>` label.
- [ ] 2. `feature-check.ts`: add `verdictScenarioKeyGap` (covering-task scoped, reusing `verdictRowsMatchScenarios`). Wire it into `task verdict` (`apps/cli/src/commands/task.ts:1265`): no artifact write and a non-zero exit on a gap. Replace the 0700 R3 comment with the reason this check differs. Tests: covering-task fail, pass-after-rekey, non-covering task-local, orphan task, scenario-less feature.
- [ ] 3. Improve the `L4_VERDICT_ROWS_MATCH_NO_SCENARIO` message to name the offending row ids and accepted forms; update the finding's test expectations.
- [ ] 4. `proof-input-fingerprint.ts`: add `canonicalizeCheckboxMarkers` and apply it in `extractTaskProofData` (:302) and `extractFeatureProofData` (:343); comment the one-time digest-change note.
- [ ] 5. Add the four fingerprint test cases: tick-only identical, text edit differs, marker variants identical, section add/remove differs.
- [ ] 6. Replay the recorded reproduction end-to-end: prose-keyed rows reach done-gate PASS without re-keying, and a checkbox flip leaves the digest unchanged. Record the before/after evidence.
- [ ] 7. Update the `task verdict` entry in the owning design satellite (new failure mode on an existing verb; no new noun/verb). `bun run spur-check` green; no suppressions.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: `docs/features/F91_corpus-gate-integrity-content-verified-evidence-anchors-external-evidence-notation-ac-altitude-carve-out-and-a-two-sided-warning-ratchet.md`
- Related: `docs/features/F93_durable-verification-evidence-the-completion-gate-reads-the-tracked-task-record-not-a-gitignored-artifact.md` (the completion gate reads the tracked record — Defect A is the same gate failing to read valid evidence)
- Source: `packages/app/src/services/feature-check.ts` (`scenarioAliases` :796, covering-task selection :802-828, L4 finding :915-931, `rowMatchesScenario` :1206, `verdictRowsMatchScenarios` :1236, `indexScenarioAliases` :1262)
- Source: `packages/app/src/services/task-verdict.ts` (`deriveVerdict` — row id derivation from the answer tables)
- Source: `packages/domain/src/bdd/coverage.ts:61` (`normalizeTitle` / `stripScenarioPrefixes`)
- Source: `apps/cli/src/commands/task.ts:1265` (`task verdict --from-answer` handler; 0700 R3 comment at :1291)
- Source: `plugins/sp/scripts/verify-answer-lint.ts` (verify-exit lint, 0726 R3; unchanged by this task)
- Source: `packages/app/src/workflow/proof-input-fingerprint.ts` (`extractTaskProofData` :302, `extractFeatureProofData` :343, `computeProofInputFingerprint` :376)
- Source: `packages/app/src/workflow/actions/proof-fingerprint.ts` (the `proof.fingerprint` action)
- Source: `config/workflows/task-pipeline.yaml` (proofDigest capture at `test` entry; R6 carve-out comment; `test-recheck` R4 re-capture)
- Evidence of record: batch run `runall-d6-4440` (knowledge-kit, feature D6, 2026-09-25) — `.spur/run/runall-d6-4440-batch-report.md`, verdict artifacts `.spur/run/0164-verdict.json`, `.spur/run/0165-verdict.json` (rows verbatim in Background), `.spur/run/0166-verdict.json`
- Sibling workaround (done): `docs/tasks5/0956_satisfy-the-d64-feature-done-gate-scenario-key-verdict-evide.md`: data-level re-key of D64 evidence (tasks 0937–0946)
- Related (done, no overlap): `docs/tasks5/0957_feature-receipt-verifier-identity-must-not-bind-the-absolute.md`
- Folded-in pointers: **0975** (F3, capture ordering; removed there), **0976** (Background pointer)
- Provenance owner: **0960**, project-first script resolution (the stale vendored `inline-run-setup.ts`)

### History
