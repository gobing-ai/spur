---
schema_version: 1
name: Fix verdict-row scenario crediting and proof-digest checkbox invalidation in the completion gate
status: done
template: feature-impl
created_at: 2026-09-26T00:29:55.505Z
updated_at: "2026-09-28T03:25:57.348Z"
feature_id: F91

ac_altitude: task-local
priority: P1
estimate_hours: 6
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

`spur feature check D6 --as done` then reported (run in knowledge-kit; its run-artifact path is root-qualified below):

```
D6 (done): FAIL
  [ERR] L4 Acceptance Criteria: Task 0165 verdict evidence (knowledge-kit/.spur/run/0165-verdict.json) carries 5
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

- [x] R1. The feature done gate credits a verdict row to a scenario when the row's `id` carries an explicit reference to that scenario. The accepted embedded forms are a parenthesised `(feature R<n>)`, a parenthesised `(covers: R<n>)`, and a bracketed `[R<n>]` tag. The reference must be one of these delimited tokens; a bare `R<n>` substring anywhere else in the row does not count. Both alias builders (`scenarioAliases` and `indexScenarioAliases`) carry the scenario label, so the gate and the verified-scenario lookup agree.
- [x] R2. `spur task verdict --from-answer` exits non-zero with an actionable message when three conditions all hold: the task covers at least one scenario of its linked feature (the same `checkAcCoverage` semantics the done gate uses to select covering tasks), that feature's scenarios parse, and no derived row names any of those scenarios. The message lists the offending row ids and the accepted key forms. The check reuses `rowMatchesScenario` in-process, so the check and the done gate cannot disagree.
- [x] R3. The proof digest is unchanged when the only difference in a proof-input section is checkbox tick-state (`- [ ]` against `- [x]`, including `*`/`+` bullets, indentation and case variants).
- [x] R4. The proof digest still changes when the text of a proof-input section changes (any edit other than the checkbox marker), and when a proof-input section is added or removed.
- [x] R5. The `L4.verdict-rows-match-no-scenario` finding names the offending row ids (bounded: the first 5 plus a count) and the accepted key forms, so the repair can be derived from the finding alone.
- [x] R6. Existing behaviour is preserved. A row keyed by the scenario's exact title or by `AC-<n>` still matches. A task with no linked feature, a task that covers no scenario (task-local rows), and a feature with no parseable scenarios are unaffected and never trip R2.

### Acceptance Criteria

- [x] AC1 — An embedded `(feature R<n>)` reference is credited by that scenario at the done gate (req: R1)
- [x] AC2 — An embedded `(covers: R<n>)` or `[R<n>]` reference is credited by that scenario (req: R1)
- [x] AC3 — A row whose only scenario-like token is an unrelated bare `R<n>` substring is NOT credited, so the new rule cannot over-credit (req: R1)
- [x] AC4 — `spur task verdict --from-answer` fails with a named message for a covering task whose rows name no linked-feature scenario, and passes once a row is re-keyed (req: R2)
- [x] AC5 — A checkbox-only edit to Requirements or Acceptance Criteria leaves the proof digest byte-identical; a text edit changes it (req: R3, R4)
- [x] AC6 — The done-gate finding names the offending row ids (req: R5)
- [x] AC7 — Title-keyed, `AC-<n>`-keyed, orphan-task, non-covering task-local and scenario-less-feature cases are unchanged (req: R6)

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

- [x] 1. `feature-check.ts`: add `label` to both alias builders (:796, :1262). Extend `rowMatchesScenario` (:1206) with the three explicit embedded-reference forms, evaluated over the raw id. Unit tests: credited forms, bare-`R<n>` non-match, unchanged title/alias paths, and a scenario without an `R<n>` label.
- [x] 2. `feature-check.ts`: add `verdictScenarioKeyGap` (covering-task scoped, reusing `verdictRowsMatchScenarios`). Wire it into `task verdict` (`apps/cli/src/commands/task.ts:1265`): no artifact write and a non-zero exit on a gap. Replace the 0700 R3 comment with the reason this check differs. Tests: covering-task fail (including the AC1 vs AC-1 case from 0966/0985), pass-after-rekey, non-covering task-local, orphan task, scenario-less feature.
- [x] 3. Improve the `L4_VERDICT_ROWS_MATCH_NO_SCENARIO` message to name the offending row ids and accepted forms; update the finding's test expectations.
- [x] 4. `proof-input-fingerprint.ts`: add `canonicalizeCheckboxMarkers` and apply it in `extractTaskProofData` (:302) and `extractFeatureProofData` (:343); comment the one-time digest-change note.
- [x] 5. Add the four fingerprint test cases: tick-only identical, text edit differs, marker variants identical, section add/remove differs.
- [x] 6. Replay the recorded reproduction end-to-end: prose-keyed rows reach done-gate PASS without re-keying, and a checkbox flip leaves the digest unchanged. Record the before/after evidence.
- [x] 7. Update the `task verdict` entry in the owning design satellite (new failure mode on an existing verb; no new noun/verb). `bun run spur-check` green; no suppressions.

### Solution

Change map (0958; F91). **R1** — `feature-check.ts`: explicit embedded-reference extractor (`EMBEDDED_SCENARIO_REF_RES` + `embeddedScenarioRefs`, `packages/app/src/services/feature-check.ts:1243-1253`) runs over the RAW row id (`:1280`, before `bodyStripped` strips the carrying parenthetical) against a scenario `label` carried by both alias builders (`scenarioKeys` `:1208`, `indexScenarioAliases` `:1331`); a bare `R<n>` substring never credits (AC3). **R2** — `verdictScenarioKeyGap` (`:1414`) decides "covering" with the gate's own `checkAcCoverage` call and reuses `verdictRowsMatchScenarios`, so check and gate cannot disagree; `task verdict` (`apps/cli/src/commands/task.ts:1254-1277`) fails before any artifact write, naming the feature id, bounded offending ids, and `VERDICT_SCENARIO_KEY_FORMS` (`:1379`); `verify-answer-lint.ts` unchanged (plugin-standalone). **R5** — the done-gate `L4.verdict-rows-match-no-scenario` message names the first 5 offending ids, `(+N more)`, and all five accepted forms (`packages/app/src/services/feature-check.ts:917-926`). **R3/R4** — `canonicalizeCheckboxMarkers` (`packages/app/src/workflow/proof-input-fingerprint.ts:309`) folds every checkbox marker (`-`/`*`/`+`, any indent, `[ ]`/`[x]`/`[X]`) to one form inside `extractTaskProofData` (`:340`) and `extractFeatureProofData` (`:373`); only the marker is canonicalized — item text, bullets, ordering still move the digest (R4) — and the git-tree half is untouched. **Enumeration parity (re-review P3):** `indexScenarioAliases` now mirrors `parseFeature` — it counts `Scenario Outline:` entries and skips `"""` doc-strings in the parser's line order — so certify-time AC-N ordinals match the gate; pinned by the parity tests in `packages/app/tests/services/feature-check.test.ts`.

Digest compatibility (Q&A 2026-09-26, closed): checkbox-canonicalized digests change ONCE, when 0958 lands, for any spec whose proof-input sections contain checkboxes — per-run state re-captured at the pipeline's proof capture points, not a persisted cross-version contract; noted beside the helper (`packages/app/src/workflow/proof-input-fingerprint.ts:296-308`) so a live run spanning the upgrade is diagnosable, not mysterious.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/feature-check.ts:1243-1253` EMBEDDED_SCENARIO_REF_RES + embeddedScenarioRefs; raw-id branch `packages/app/src/services/feature-check.ts:1280`; label in both builders `packages/app/src/services/feature-check.ts:1213` and `:1348`; tests `packages/app/tests/services/feature-check.test.ts:3561` (155 pass fresh) |
| R2 | MET | `packages/app/src/services/feature-check.ts:1414` verdictScenarioKeyGap (covering via `taskCoversScenario` `:1359`); CLI `apps/cli/src/commands/task.ts:1280-1292` no artifact + non-zero exit; tests `apps/cli/tests/commands/task.test.ts:3762` / `:3795` (191 pass fresh) |
| R3 | MET | `packages/app/src/workflow/proof-input-fingerprint.ts:309` canonicalizeCheckboxMarkers applied `:340` (task) / `:373` (feature); tests `packages/app/tests/workflow/proof-input-fingerprint.test.ts:584` / `:608` |
| R4 | MET | text-edit + section add/remove digest tests `packages/app/tests/workflow/proof-input-fingerprint.test.ts:596` / `:616` |
| R5 | MET | `packages/app/src/services/feature-check.ts:915-926` finding names `summarizeRowIds` (`:1368`) + VERDICT_SCENARIO_KEY_FORMS (`:1379`); test `packages/app/tests/services/feature-check.test.ts:3779` / `:3802` |
| R6 | MET | tests `packages/app/tests/services/feature-check.test.ts:3600` (title/AC-N), `:3945` / `:3952` / `:3960` (task-local, orphan, scenario-less); CLI `apps/cli/tests/commands/task.test.ts:3822` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/feature-check.test.ts:3562`; D6 replay `packages/app/tests/services/feature-check.test.ts:3763` |
| AC2 | MET | test | `packages/app/tests/services/feature-check.test.ts:3569` |
| AC3 | MET | test | `packages/app/tests/services/feature-check.test.ts:3585` |
| AC4 | MET | test | `packages/app/tests/services/feature-check.test.ts:3926` / `:3937`; CLI `apps/cli/tests/commands/task.test.ts:3762` / `:3795` |
| AC5 | MET | test | `packages/app/tests/workflow/proof-input-fingerprint.test.ts:584` (Requirements), `:633` (Acceptance Criteria — added this verify pass, fix-all), `:596` text edit |
| AC6 | MET | test | `packages/app/tests/services/feature-check.test.ts:3779` |
| AC7 | MET | test | `packages/app/tests/services/feature-check.test.ts:3600`, `:3945`, `:3952`, `:3960` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0958 (fifth review; fresh post-incident verification pass superseding the fourth)

**Scope:** working-tree diff vs `1196be573` (10 files, +1052/−64) — `feature-check.ts`, `proof-input-fingerprint.ts`, `task.ts` (CLI), `index.ts`, three test files, design satellite, task markdown, generated bundle. This pass re-verified the restored task file (12:12 `taskfile-section-wipe` incident: Requirements/AC/Plan restored from HEAD with ticks, Solution recovered) and re-ran all scoped evidence fresh.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | architecture | The CLI inlines the bounded first-5 + `(+N more)` row summary instead of reusing `summarizeRowIds` (still private) — two copies of one presentation rule can drift (gate message calls the helper; the CLI re-implements it). Accept or export the helper in a follow-up. | `apps/cli/src/commands/task.ts:1265-1268` |
| 2 | P4 (advisory) | architecture | Weak locality: `readFeatureAcBody` re-implements the `<id>_*.md` prefix scan already present in `task-service.resolveFeatureAcBody` and the CLI's `isFeatureFile` — third copy of the feature-resolution rule; fold into one shared helper if it ever changes shape. | `packages/app/src/services/feature-check.ts:1456-1467` |
| 3 | P4 (advisory) | correctness | The four digest tests (tick-only, text-edit, marker variants, add/remove) exercise only the Requirements section; AC5's "or Acceptance Criteria" half is covered by mechanism (`TASK_SPEC_SECTIONS` canonicalizes every proof-input section uniformly, `packages/app/src/workflow/proof-input-fingerprint.ts:337-341,367-374`), not by an AC-section digest assertion. | `packages/app/tests/workflow/proof-input-fingerprint.test.ts:584-640` |
| 4 | P4 (advisory) | correctness | Plan 6's "replay the reproduction against the OLD build" half was not literally executed; the AC6 negative-path done-gate test covers the equivalent failing behavior on the new build. | `docs/tasks5/0958_…md` Plan 6 |

No P1–P3 findings. Incident cross-check: the restored Requirements/AC/Plan text is byte-identical to HEAD modulo the checkbox ticks (diff shows tick flips only), and the recovered `### Solution`'s digest-compatibility citation (`packages/app/src/workflow/proof-input-fingerprint.ts:296-308`) resolves to the real note this run.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `packages/app/src/services/feature-check.ts:1243-1253` — `EMBEDDED_SCENARIO_REF_RES` + `embeddedScenarioRefs` over the RAW id (branch at `:1280`, before `bodyStripped` strips the carrying parenthetical); `R<n>` label carried by both builders (`scenarioKeys:1208`, `indexScenarioAliases:1331`); bare-`R<n>` non-credit pinned by AC3 tests (`packages/app/tests/services/feature-check.test.ts:3561` describe) — anchors re-resolved in current source this run |
| R2 | MET | `verdictScenarioKeyGap:1414` reuses the gate's own `checkAcCoverage` covering decision (`taskCoversScenario:1359`) and `verdictRowsMatchScenarios`, so check and gate cannot disagree; CLI wiring `apps/cli/src/commands/task.ts:1254-1277`: gap → named error, no artifact write, exit 1 (fail/pass CLI pair asserts both halves incl. artifact absence); `parseFeature` parity pinned (`feature-check.test.ts:3621-3666`) |
| R3 | MET | `canonicalizeCheckboxMarkers` at `packages/app/src/workflow/proof-input-fingerprint.ts:309`, applied `:340` (task) and `:373` (feature); tick-only and marker-variant digest tests green fresh this run (26 pass / 0 fail) |
| R4 | MET | text-edit (`:596`) and section add/remove (`:616`) digest tests green fresh this run; the git-tree half of the digest is untouched |
| R5 | MET | the done-gate finding names bounded offending ids plus all five accepted forms (`packages/app/src/services/feature-check.ts:915-926`, `summarizeRowIds:1368`, shared `VERDICT_SCENARIO_KEY_FORMS:1379`); bounded-summary test (7 rows → 5 + `(+2 more)`, `Req6` absent) green |
| R6 | MET | AC7 tests: title-keyed and `AC-<n>` rows unchanged; orphan task, unresolvable wbs, non-covering task-local task, scenario-less feature, empty rows → no gap (`feature-check.test.ts:3825` describe; D6 done-gate reproduction at `:3672`) |

AC1–AC7: all MET — each AC maps to a named test in the three suites below, all green in this run's fresh execution. Security lens: the diff adds only pure string transforms, `matchAll` over module-level global regexes (safe — `matchAll` iterates a clone, never advancing the source's `lastIndex`), corpus reads scoped to the features dir, and no new shell/exec/secret surface.

##### Verification Evidence

Fresh this run:

- `bun test packages/app/tests/workflow/proof-input-fingerprint.test.ts` → 26 pass / 0 fail (91 expect)
- `bun test packages/app/tests/services/feature-check.test.ts` → 129 pass / 0 fail (592 expect)
- `bun test apps/cli/tests/commands/task.test.ts` → 190 pass / 0 fail (622 expect)
- `spur task check 0958` → `0958 (wip): PASS`, zero findings, exit 0
- Delta proof: `git diff --numstat` = 10 files, +1052/−64; mtimes — only the task markdown (12:35) postdates the last code/test edit (`feature-check.ts` 12:03, its test 12:05, everything else ≤ 11:11)
- All pass-4 line anchors re-resolved in current source (`EMBEDDED_SCENARIO_REF_RES:1243`, raw-id branch `:1280`, `verdictScenarioKeyGap:1414`, `canonicalizeCheckboxMarkers:309/340/373`, CLI gap `:1254-1277`)
- Test hygiene: no `apps/cli/tests/.tmp-task-gap-*` or verdict-artifact leftovers after the run

Carried from pass 2/4 (valid — nothing outside the task markdown changed since, per the delta proof above):

- `bun run spur-check` → lint + pre-check (49 rules) + post-check (2 rules) green; full suite 9339 pass / 0 fail (42096 expect)
- `biome check` clean over the touched files; `tsc --noEmit` exit 0 in `packages/app` and `apps/cli`
- `plugins/sp/lib/inline-run.generated.mjs` carries the new code (`canonicalizeCheckboxMarkers` present; re-grep fresh this run)

Design conformance: Plan items 1–7 DONE (Plan 6's old-build replay half → advisory #4); design satellite row for `task verdict` updated (`docs/design/planning-record-contracts.md`, cites `apps/cli/src/commands/task.ts:1253-1277`).

**Next:** `/sp:dev-verify 0958` → `spur task record` to fill `## Testing` and proceed toward `done`; the four P4s are accept-or-fold.

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
- Evidence of record: batch run `runall-d6-4440` (knowledge-kit, feature D6, 2026-09-25) — `knowledge-kit/.spur/run/runall-d6-4440-batch-report.md`, verdict artifacts `knowledge-kit/.spur/run/0164-verdict.json`, `knowledge-kit/.spur/run/0165-verdict.json` (rows verbatim in Background), `knowledge-kit/.spur/run/0166-verdict.json`
- Sibling workaround (done): `docs/tasks5/0956_satisfy-the-d64-feature-done-gate-scenario-key-verdict-evide.md`: data-level re-key of D64 evidence (tasks 0937–0946)
- Related (done, no overlap): `docs/tasks5/0957_feature-receipt-verifier-identity-must-not-bind-the-absolute.md`
- Folded-in pointers: **0975** (F3, capture ordering; removed there), **0976** (Background pointer)
- Provenance owner: **0960**, project-first script resolution (the stale vendored `inline-run-setup.ts`)

### History

- 2026-09-27T16:45:00.539Z backlog → todo (system)
- 2026-09-27T18:13:22.759Z todo → wip (system)
- 2026-09-27T19:49:46.477Z wip → testing (system)
- 2026-09-27T19:50:16.348Z testing → done (system)

