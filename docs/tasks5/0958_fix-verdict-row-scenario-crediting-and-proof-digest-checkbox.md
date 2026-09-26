---
schema_version: 1
name: Fix verdict-row scenario crediting and proof-digest checkbox invalidation in the completion gate
status: backlog
template: feature-impl
created_at: 2026-09-26T00:29:55.505Z
updated_at: "2026-09-26T00:31:11.654Z"
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
  `sc.alias` — and `sc.alias` is `AC-<n>` (1-based ordinal, built at `feature-check.ts:793`).
  `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:61`) strips a leading `R<n>`/`AC<n>` prefix but
  has no notion of a scenario reference *inside* a longer string. So `(feature R3)` contributes nothing.
- Nothing upstream prevents this: the verify-exit lint
  (`apps/cli/plugins/sp/scripts/verify-answer-lint.ts`) validates AC ids against the task's AC labels
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

#### Blast radius and sibling work (found while filing this task)

- The same failure independently hit feature **D64**: task **0956** ("Satisfy the D64 feature-done gate:
  scenario-key verdict evidence", `todo`) exists to re-key the recorded verdict evidence of tasks
  0937–0946 to full AC labels — a **data-level workaround** for exactly this symptom. Two independent
  occurrences in the same week: knowledge-kit D6 (manual re-key of 0165) and spur D64 (0956, re-keying
  0937–0946).
- **0956 is the workaround; this task is the engine fix — they must not be merged into one solution.**
  0956 edits *evidence data* for one feature; this task edits *the matcher and the lint* so future
  evidence cannot strand a feature. 0956 R3 already documents the trap from the other side: a task whose
  AC section contains D64 scenario titles becomes a covering task whose task-local rows then fire
  `L4.verdict-rows-match-no-scenario` — the gate punishes the very task written to satisfy it.
- **Defect B has no sibling task.** Nothing in `docs/tasks5/` covers checkbox normalization or
  tick-state digest stability (grep for `canonicalizeCheckbox` / tick-state / checkbox tick returns only
  this task).
- Related in-flight work in the same area (do not duplicate): **0957** (feature-receipt verifier identity
  must not bind the absolute definition path) touches `feature-verification-receipt.ts`, a different
  layer of the same completion boundary.

#### Aggravating factor (not this task's fix)

The inline driver reference documents proof capture as
`bun "$SETUP_SCRIPT" --fingerprint --task-file <task> --feature-file <feature>`, but the copy of
`inline-run-setup.ts` vendored into the consuming project lacked the `--fingerprint` mode entirely (0
occurrences), so the run had to hand-roll a digest runner against the engine's
`computeProofInputFingerprint`. The consumer's stale vendored copy is being re-vendored there; it is
recorded here only as provenance for how Defect B was measured.

### Requirements

- [ ] R1. A verdict row whose `id` carries an explicit feature-scenario reference is credited to that scenario by the feature done gate — accepted embedded forms: a parenthesised `(feature R<n>)`, a parenthesised `(covers: R<n>)`, and a bracketed `[R<n>]` tag. The reference must be an explicit scenario token, not a bare `R<n>` substring anywhere in the row.
- [ ] R2. The verify-exit lint (`verify-answer-lint.ts`) fails, with a non-zero exit and an actionable message, when the task links a feature whose scenarios parse and **no** verdict row names any of those scenarios. The message names the offending row ids and the accepted key forms.
- [ ] R3. The proof digest is unchanged when the only difference in a proof-input section is checkbox tick-state (`- [ ]` vs `- [x]`, including `*`, indentation and case variants).
- [ ] R4. The proof digest still changes when the text of a proof-input section changes (any non-checkbox-marker edit), and when a proof-input section is added or removed.
- [ ] R5. The `L4.verdict-rows-match-no-scenario` finding names the offending row ids (currently only a count) and the accepted key forms, so the repair is derivable from the finding alone.
- [ ] R6. Existing behaviour is preserved: a row already keyed by the scenario's exact title or by `AC-<n>` still matches; a task with no linked feature, or a feature with no parseable scenarios, is unaffected and never fails the new lint check.

### Acceptance Criteria

- [ ] AC1 — An embedded `(feature R<n>)` reference is credited by that scenario at the done gate (req: R1)
- [ ] AC2 — An embedded `(covers: R<n>)` or `[R<n>]` reference is credited by that scenario (req: R1)
- [ ] AC3 — A row whose only scenario-like token is an unrelated bare `R<n>` substring is NOT credited, so the new rule cannot over-credit (req: R1)
- [ ] AC4 — The verify-exit lint fails with a named message when no row names any linked-feature scenario, and passes once a row is re-keyed (req: R2)
- [ ] AC5 — A checkbox-only edit to Requirements or Acceptance Criteria leaves the proof digest byte-identical; a text edit changes it (req: R3, R4)
- [ ] AC6 — The done-gate finding names the offending row ids (req: R5)
- [ ] AC7 — Title-keyed, `AC-<n>`-keyed, orphan-task and scenario-less-feature cases are unchanged (req: R6)

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

### Design

#### R1/R2/R5 — crediting and prevention

- **`packages/app/src/services/feature-check.ts` — extend `rowMatchesScenario(id, sc)` (:1206).** Add an
  explicit-reference extractor evaluated in addition to the existing normalized-title / alias comparisons.
  Proposed shape: after the existing `stripped` / `bodyStripped` derivations, extract candidate references
  with a bounded pattern over the *original* id —
  `\((?:feature|covers:)\s*(R\d+)\)` (case-insensitive, `covers:` may be followed by a title, so capture
  the leading `R<n>` token) and `\[(R\d+)\]` — then match a captured token against the scenario's own
  `R<n>` label. The scenario's label is available from `sc` (add `label` to the `scenarioAliases` entries
  built at :793 alongside `alias: AC-${i+1}`; derive it from the parsed scenario name's leading `R<n>`
  via the same prefix rule `normalizeTitle` uses). Invariant: the extractor must never match a bare
  `R<n>` that is not inside one of the three delimiters.
- **`apps/cli/plugins/sp/scripts/verify-answer-lint.ts` — add the linked-feature scenario check.** When the
  task resolves a linked feature and that feature yields parseable scenarios, require at least one verdict
  row to name a scenario (reusing the same matcher as the gate so the two cannot disagree). On failure:
  non-zero exit, and a message listing the offending row ids verbatim plus the accepted forms
  (scenario title, `AC-<n>`, `(feature R<n>)`, `(covers: R<n>)`, `[R<n>]`). Skip silently when the task has
  no linked feature or the feature has no scenarios (R6). Import the matcher from the app service rather
  than re-implementing it — a divergent second implementation is the defect being fixed.
- **`packages/app/src/services/feature-check.ts` — improve the two finding messages (:916-935).** Include
  the offending row ids (bounded: first N ids plus a count) in `L4_VERDICT_ROWS_MATCH_NO_SCENARIO`, and name
  the accepted key forms. Keep the existing `L4.scenario-unverified` text; it already names the scenario and
  the covering task.

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

- [ ] 1. `feature-check.ts`: add the scenario `label` to `scenarioAliases` (:793) and extend
      `rowMatchesScenario` (:1206) with the three explicit embedded-reference forms; unit tests for
      credited forms, the bare-`R<n>` non-match, and the unchanged title/alias paths.
- [ ] 2. Export the matcher for reuse and wire `verify-answer-lint.ts` to fail on the linked-feature
      no-row-names-a-scenario condition, with the actionable message; tests for fail, pass-after-rekey,
      orphan-task and scenario-less-feature.
- [ ] 3. Improve the `L4_VERDICT_ROWS_MATCH_NO_SCENARIO` message to name the offending row ids; update the
      finding's test expectations.
- [ ] 4. `proof-input-fingerprint.ts`: add `canonicalizeCheckboxMarkers` and apply it in
      `extractTaskProofData` / `extractFeatureProofData`; comment the one-time digest-change note.
- [ ] 5. Add the four fingerprint test cases (tick-only identical, text edit differs, marker variants
      identical, section add/remove differs).
- [ ] 6. Replay the recorded reproduction end-to-end (prose-keyed rows → done gate PASS without re-keying;
      checkbox flip → digest unchanged) and record the before/after evidence.
- [ ] 7. `bun run gate` green; no suppressions added.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent feature: `docs/features/F91_corpus-gate-integrity-content-verified-evidence-anchors-external-evidence-notation-ac-altitude-carve-out-and-a-two-sided-warning-ratchet.md`
- Related: `docs/features/F93_durable-verification-evidence-the-completion-gate-reads-the-tracked-task-record-not-a-gitignored-artifact.md` (the completion gate reads the tracked record — Defect A is the same gate failing to read valid evidence)
- Source: `packages/app/src/services/feature-check.ts` (`scenarioAliases` :793, L4 findings :916-935, `rowMatchesScenario` :1206)
- Source: `packages/app/src/services/task-verdict.ts` (`deriveVerdict` — row id derivation from the answer tables)
- Source: `packages/domain/src/bdd/coverage.ts:61` (`normalizeTitle` / `stripScenarioPrefixes`)
- Source: `apps/cli/plugins/sp/scripts/verify-answer-lint.ts` (verify-exit lint, 0726 R3)
- Source: `packages/app/src/workflow/proof-input-fingerprint.ts` (`extractTaskProofData` :302, `extractFeatureProofData` :343, `computeProofInputFingerprint` :376)
- Source: `packages/app/src/workflow/actions/proof-fingerprint.ts` (the `proof.fingerprint` action)
- Source: `config/workflows/task-pipeline.yaml` (proofDigest capture at `test` entry; R6 carve-out comment; `test-recheck` R4 re-capture)
- Evidence of record: batch run `runall-d6-4440` (knowledge-kit, feature D6, 2026-09-25) — `.spur/run/runall-d6-4440-batch-report.md`, verdict artifacts `.spur/run/0164-verdict.json`, `.spur/run/0165-verdict.json` (rows verbatim in Background), `.spur/run/0166-verdict.json`
- Sibling workaround (do not duplicate): `docs/tasks5/0956_satisfy-the-d64-feature-done-gate-scenario-key-verdict-evide.md` — data-level re-key of D64 evidence (tasks 0937–0946)
- Related in-flight work: `docs/tasks5/0957_feature-receipt-verifier-identity-must-not-bind-the-absolute.md`

### History
