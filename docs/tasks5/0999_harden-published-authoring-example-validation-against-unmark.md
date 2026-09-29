---
schema_version: 1
name: Harden published authoring-example validation against unmarked code fences
status: done
template: feature-impl
created_at: 2026-09-29T03:05:28.279Z
updated_at: "2026-09-29T04:16:36.376Z"
feature_id: A8

---

## 0999. Harden published authoring-example validation against unmarked code fences

### Background

0992 made the published authoring guide's config example executable evidence: the test extracts a YAML fence
from `docs/design/downstream-board-modules.md` and parses it through `spurConfigSchema` and
`validateBoardModuleDeclarations`, so a documented shape the schema rejects cannot ship as guidance
(feature A8 scenario **R14**; 0992 R5).

The extraction is sentinel-gated (`packages/config/tests/board-modules.test.ts:179-183`: keep fences where
`block.includes('# board-modules-authoring-example')`). **The hole is already open, not hypothetical:** the guide
has two YAML fences — the §4 contract example at `docs/design/downstream-board-modules.md:46` is *unmarked* and
unvalidated today; only the §6 fence at `:149` carries the sentinel. Both happen to pass the schema and validator
right now (verified 2026-09-28 by parsing every fence), so nothing is broken yet — but any edit to the §4 example,
or any new example, ships unchecked.

**Evidence:** 0992 Review residual (P3): "A future example block added without the sentinel is not validated."

### Requirements

- [x] R1. Every ` ```yaml ` / ` ```yml ` fence in `docs/design/downstream-board-modules.md` is parsed through
  `spurConfigSchema` and its `bootstrap.modules` through `validateBoardModuleDeclarations`; a fence that fails
  either fails the test. Rule: in this guide, a YAML fence *is* a config example — a non-config snippet uses a
  different fence language (e.g. ` ```text `). No exemption marker.
- [x] R2. Keep the sentinel-selected fence's detailed shape assertions (exact `team-board` / `docs` declarations,
  exactly one sentinel fence) unchanged.
- [x] R3. A failing fence's message names its 1-based start line in the guide and the parse/validation error.
- [x] R4. Guard against a vacuous pass: assert at least one YAML fence was found (not an exact count).

### Acceptance Criteria

```gherkin
Scenario: AC1 — Downstream authors can follow the published module contract (req: R1; R2; R3; R4)
  Given the authoring guide contains YAML fences, with or without the authoring-example sentinel
  When the published-examples test runs
  Then every YAML fence is parsed through the production config schema and cross-declaration validator
  And the sentinel fence still matches its exact documented declarations
  And a YAML fence that fails parsing or validation fails the test naming its line in the guide
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T03:18:34.602Z

- **No exemption marker (2026-09-28).** The original design proposed `# board-modules-authoring-example:exempt`.
  Rejected: (1) YAGNI — the guide has no non-config YAML fence; the escape hatch for a future one is choosing a
  different fence language, which costs nothing and is already explicit and greppable. (2) The proposed marker
  contains the validating sentinel as a substring, so with the current `includes()` filter an "exempt" fence
  would be selected as *the* validated example — a latent bug the marker would introduce.
- **Validate all YAML fences rather than partition into validated/exempt:** smaller diff and closes the live
  hole at `:46` immediately. Both current fences pass (probe run 2026-09-28), so this lands green without guide
  edits.
- **Fragment examples:** the rule requires each YAML fence to be a parseable config document. Both current
  fences are full `bootstrap:` documents; if a future author wants a fragment, they use ` ```text ` or make it
  a full document. Accepted constraint.
- **Scope:** only this guide (unchanged from original). Other docs' fences are out of scope.
- Traceability fix: the AC's original `(req: R5; R6)` pointed at 0992's requirements; now maps to this task's.

### Design

**Change map** — `packages/config/tests/board-modules.test.ts` only (`:172-218`):

- Replace `authoringExamples()` with one extractor returning every YAML fence with its start line:
  ```ts
  /** Every fenced YAML block in the guide, with its 1-based opening-fence line. */
  function yamlFences(markdown: string): { line: number; body: string }[] {
      return [...markdown.matchAll(/^```ya?ml[^\n]*\n([\s\S]*?)^```/gm)].map((match) => ({
          line: markdown.slice(0, match.index).split('\n').length,
          body: match[1] ?? '',
      }));
  }
  ```
- Existing test: select the sentinel fence with
  `yamlFences(guide).filter((f) => f.body.includes('# board-modules-authoring-example'))`; keep all its current
  assertions (R2).
- New test `every YAML fence in the guide is a valid declaration example (R1)`: for each fence, parse +
  validate inside try/catch and collect failures as `` `downstream-board-modules.md:${line}: ${message}` ``;
  `expect(fences.length).toBeGreaterThan(0)` (R4); `expect(failures).toEqual([])` so the message lists every
  offending line (R3).
- Update the block comment above `AUTHORING_GUIDE` to state the rule: every YAML fence in the guide is validated;
  use a non-YAML fence language for non-config snippets.

**Constraints:** no guide edits (both fences already pass); keep reading the guide by path; no fence count
hard-coded beyond the existing "exactly one sentinel fence".

**Out of scope:** other documents; rewriting guide content.

### Plan

1. Add `yamlFences()` and switch the sentinel test to it; keep its assertions — green.
2. Add the all-fences test (R1/R3/R4) — green on the current guide.
3. Prove it can fail: temporarily add an unknown field (e.g. `web: {}`) to the §4 fence at
   `docs/design/downstream-board-modules.md:46`; confirm the failure names `downstream-board-modules.md:46`;
   revert the guide.
4. `(cd packages/config && bun test tests/board-modules.test.ts)`, then `bun run spur-check`.

### Solution

`packages/config/tests/board-modules.test.ts` only, per the Design change map:

- Replaced the sentinel-filtering `authoringExamples()` with `yamlFences()`
  (packages/config/tests/board-modules.test.ts:181): one multiline-regex extractor returning every
  ` ```yaml `/` ```yml ` fence in the guide with its 1-based opening-fence line
  (`markdown.slice(0, match.index).split('\n').length`). No exemption marker (Q&A decision): a
  non-config snippet in the guide must use a different fence language.
- Sentinel test (packages/config/tests/board-modules.test.ts:191) now selects the fence whose body
  contains `# board-modules-authoring-example` and still asserts exactly one such fence plus the exact
  `team-board`/`docs` declarations and the host-inventory validation — unchanged (R2).
- New test `every YAML fence in the guide is a valid declaration example (R1)`
  (packages/config/tests/board-modules.test.ts:217): parses each fence through `spurConfigSchema`, runs
  its `bootstrap.modules` through `validateBoardModuleDeclarations` against the reserved inventory;
  failures collect as `` `downstream-board-modules.md:${line}: ${message}` `` and the test asserts
  `failures` `[]` so every offending line is named (R3). `expect(fences.length).toBeGreaterThan(0)`
  guards the vacuous pass (R4).
- Block comment above `AUTHORING_GUIDE` (packages/config/tests/board-modules.test.ts:174-177) now
  states the rule: every YAML fence in the guide is a validated config example; use a non-YAML fence
  language for other snippets.

Guide unedited — both existing fences (§4 at docs/design/downstream-board-modules.md:46, §6 sentinel at
docs/design/downstream-board-modules.md:149) pass unchanged, closing the live validation hole at :46.
No production source changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Every ```yaml/```yml fence extracted by `yamlFences()` regex `^```ya?ml[^\n]*\n` at `packages/config/tests/board-modules.test.ts:181-185` (column-0, info-strings allowed, no exemption marker); new all-fences test `packages/config/tests/board-modules.test.ts:217-233` parses each fence via `spurConfigSchema.parse` (`:225`) and validates `bootstrap.modules` via `validateBoardModuleDeclarations` (`:226`); failures accumulate → `expect(failures).toEqual([])` (`:231`). Re-verified on the real guide: exactly 2 YAML fences matched (`docs/design/downstream-board-modules.md:46`, `:149`); ```ts fences at `:75`/`:178` correctly excluded. Targeted run: 15 pass / 0 fail. |
| R2 | MET | Sentinel test intact `packages/config/tests/board-modules.test.ts:189-215`: still filters to sentinel (`:191`), asserts exactly one sentinel fence (`:192` `toHaveLength(1)`), exact team-board/docs shape assertions (`:197-212`), host-inventory validation (`:214`); only the extraction fn was swapped (diff vs base shows shape assertions unchanged). |
| R3 | MET | Failure template `downstream-board-modules.md:${fence.line}: ${(thrown as Error).message}` at `packages/config/tests/board-modules.test.ts:228`; 1-based line math independently re-probed: `yamlFences` yields lines 46,149 matching `grep -n '^```' docs/design/downstream-board-modules.md`; poisoned-fence probe produced `downstream-board-modules.md:46: Map keys must be unique at line 5, column 3: ...`. |
| R4 | MET | Vacuous-pass guard `expect(fences.length).toBeGreaterThan(0)` at `packages/config/tests/board-modules.test.ts:220` — at-least-one, not an exact count. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Downstream authors can follow the published module contract (req: R1; R2; R3; R4) | MET | test | Unmarked YAML fence (`docs/design/downstream-board-modules.md:46`) is now parsed through the production schema + cross-declaration validator by `packages/config/tests/board-modules.test.ts:217-233`; sentinel fence (`:149`) still matched exactly by `packages/config/tests/board-modules.test.ts:189-215`; failing-fence line-naming proven by probe (R3); guard R4 at `:220`. Live targeted run `(cd packages/config && bun test tests/board-modules.test.ts)`: 15 pass / 0 fail (49 expect calls), including the new "every YAML fence in the guide is a valid declaration example (R1)" test. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

---
schema_version: 1
name: Harden published authoring-example validation against unmarked code fences
status: testing
template: feature-impl
created_at: 2026-09-29T03:05:28.279Z
updated_at: "2026-09-29T04:12:26.355Z"
feature_id: A8

---

## 0999. Harden published authoring-example validation against unmarked code fences

#### Background

0992 made the published authoring guide's config example executable evidence: the test extracts a YAML fence
from `docs/design/downstream-board-modules.md` and parses it through `spurConfigSchema` and
`validateBoardModuleDeclarations`, so a documented shape the schema rejects cannot ship as guidance
(feature A8 scenario **R14**; 0992 R5).

The extraction is sentinel-gated (`packages/config/tests/board-modules.test.ts:179-183`: keep fences where
`block.includes('# board-modules-authoring-example')`). **The hole is already open, not hypothetical:** the guide
has two YAML fences — the §4 contract example at `docs/design/downstream-board-modules.md:46` is *unmarked* and
unvalidated today; only the §6 fence at `:149` carries the sentinel. Both happen to pass the schema and validator
right now (verified 2026-09-28 by parsing every fence), so nothing is broken yet — but any edit to the §4 example,
or any new example, ships unchecked.

**Evidence:** 0992 Review residual (P3): "A future example block added without the sentinel is not validated."

#### Requirements

- [x] R1. Every ` ```yaml ` / ` ```yml ` fence in `docs/design/downstream-board-modules.md` is parsed through
  `spurConfigSchema` and its `bootstrap.modules` through `validateBoardModuleDeclarations`; a fence that fails
  either fails the test. Rule: in this guide, a YAML fence *is* a config example — a non-config snippet uses a
  different fence language (e.g. ` ```text `). No exemption marker.
- [x] R2. Keep the sentinel-selected fence's detailed shape assertions (exact `team-board` / `docs` declarations,
  exactly one sentinel fence) unchanged.
- [x] R3. A failing fence's message names its 1-based start line in the guide and the parse/validation error.
- [x] R4. Guard against a vacuous pass: assert at least one YAML fence was found (not an exact count).

#### Acceptance Criteria

```gherkin
Scenario: AC1 — Downstream authors can follow the published module contract (req: R1; R2; R3; R4)
  Given the authoring guide contains YAML fences, with or without the authoring-example sentinel
  When the published-examples test runs
  Then every YAML fence is parsed through the production config schema and cross-declaration validator
  And the sentinel fence still matches its exact documented declarations
  And a YAML fence that fails parsing or validation fails the test naming its line in the guide
```

#### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-29T03:18:34.602Z

- **No exemption marker (2026-09-28).** The original design proposed `# board-modules-authoring-example:exempt`.
  Rejected: (1) YAGNI — the guide has no non-config YAML fence; the escape hatch for a future one is choosing a
  different fence language, which costs nothing and is already explicit and greppable. (2) The proposed marker
  contains the validating sentinel as a substring, so with the current `includes()` filter an "exempt" fence
  would be selected as *the* validated example — a latent bug the marker would introduce.
- **Validate all YAML fences rather than partition into validated/exempt:** smaller diff and closes the live
  hole at `:46` immediately. Both current fences pass (probe run 2026-09-28), so this lands green without guide
  edits.
- **Fragment examples:** the rule requires each YAML fence to be a parseable config document. Both current
  fences are full `bootstrap:` documents; if a future author wants a fragment, they use ` ```text ` or make it
  a full document. Accepted constraint.
- **Scope:** only this guide (unchanged from original). Other docs' fences are out of scope.
- Traceability fix: the AC's original `(req: R5; R6)` pointed at 0992's requirements; now maps to this task's.

#### Design

**Change map** — `packages/config/tests/board-modules.test.ts` only (`:172-218`):

- Replace `authoringExamples()` with one extractor returning every YAML fence with its start line:
  ```ts
  /** Every fenced YAML block in the guide, with its 1-based opening-fence line. */
  function yamlFences(markdown: string): { line: number; body: string }[] {
      return [...markdown.matchAll(/^```ya?ml[^\n]*\n([\s\S]*?)^```/gm)].map((match) => ({
          line: markdown.slice(0, match.index).split('\n').length,
          body: match[1] ?? '',
      }));
  }
  ```
- Existing test: select the sentinel fence with
  `yamlFences(guide).filter((f) => f.body.includes('# board-modules-authoring-example'))`; keep all its current
  assertions (R2).
- New test `every YAML fence in the guide is a valid declaration example (R1)`: for each fence, parse +
  validate inside try/catch and collect failures as `` `downstream-board-modules.md:${line}: ${message}` ``;
  `expect(fences.length).toBeGreaterThan(0)` (R4); `expect(failures).toEqual([])` so the message lists every
  offending line (R3).
- Update the block comment above `AUTHORING_GUIDE` to state the rule: every YAML fence in the guide is validated;
  use a non-YAML fence language for non-config snippets.

**Constraints:** no guide edits (both fences already pass); keep reading the guide by path; no fence count
hard-coded beyond the existing "exactly one sentinel fence".

**Out of scope:** other documents; rewriting guide content.

#### Plan

1. Add `yamlFences()` and switch the sentinel test to it; keep its assertions — green.
2. Add the all-fences test (R1/R3/R4) — green on the current guide.
3. Prove it can fail: temporarily add an unknown field (e.g. `web: {}`) to the §4 fence at
   `docs/design/downstream-board-modules.md:46`; confirm the failure names `downstream-board-modules.md:46`;
   revert the guide.
4. `(cd packages/config && bun test tests/board-modules.test.ts)`, then `bun run spur-check`.

#### Solution

`packages/config/tests/board-modules.test.ts` only, per the Design change map:

- Replaced the sentinel-filtering `authoringExamples()` with `yamlFences()`
  (packages/config/tests/board-modules.test.ts:181): one multiline-regex extractor returning every
  ` ```yaml `/` ```yml ` fence in the guide with its 1-based opening-fence line
  (`markdown.slice(0, match.index).split('\n').length`). No exemption marker (Q&A decision): a
  non-config snippet in the guide must use a different fence language.
- Sentinel test (packages/config/tests/board-modules.test.ts:191) now selects the fence whose body
  contains `# board-modules-authoring-example` and still asserts exactly one such fence plus the exact
  `team-board`/`docs` declarations and the host-inventory validation — unchanged (R2).
- New test `every YAML fence in the guide is a valid declaration example (R1)`
  (packages/config/tests/board-modules.test.ts:217): parses each fence through `spurConfigSchema`, runs
  its `bootstrap.modules` through `validateBoardModuleDeclarations` against the reserved inventory;
  failures collect as `` `downstream-board-modules.md:${line}: ${message}` `` and the test asserts
  `failures` `[]` so every offending line is named (R3). `expect(fences.length).toBeGreaterThan(0)`
  guards the vacuous pass (R4).
- Block comment above `AUTHORING_GUIDE` (packages/config/tests/board-modules.test.ts:174-177) now
  states the rule: every YAML fence in the guide is a validated config example; use a non-YAML fence
  language for other snippets.

Guide unedited — both existing fences (§4 at docs/design/downstream-board-modules.md:46, §6 sentinel at
docs/design/downstream-board-modules.md:149) pass unchanged, closing the live validation hole at :46.
No production source changed.

#### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Every ```yaml/```yml fence extracted by `yamlFences()` regex `^```ya?ml[^\n]*\n` at `packages/config/tests/board-modules.test.ts:181-185` (column-0, info-strings allowed, no exemption marker); new all-fences test `packages/config/tests/board-modules.test.ts:217-233` parses each fence via `spurConfigSchema.parse` (`:225`) and validates `bootstrap.modules` via `validateBoardModuleDeclarations` (`:226`); failures accumulate → `expect(failures).toEqual([])` (`:231`). Re-verified on the real guide: exactly 2 YAML fences matched (`docs/design/downstream-board-modules.md:46`, `:149`); ```ts fences at `:75`/`:178` correctly excluded. Targeted run: 15 pass / 0 fail. |
| R2 | MET | Sentinel test intact `packages/config/tests/board-modules.test.ts:189-215`: still filters to sentinel (`:191`), asserts exactly one sentinel fence (`:192` `toHaveLength(1)`), exact team-board/docs shape assertions (`:197-212`), host-inventory validation (`:214`); only the extraction fn was swapped (diff vs base shows shape assertions unchanged). |
| R3 | MET | Failure template `downstream-board-modules.md:${fence.line}: ${(thrown as Error).message}` at `packages/config/tests/board-modules.test.ts:228`; 1-based line math independently re-probed: `yamlFences` yields lines 46,149 matching `grep -n '^```' docs/design/downstream-board-modules.md`; poisoned-fence probe produced `downstream-board-modules.md:46: Map keys must be unique at line 5, column 3: ...`. |
| R4 | MET | Vacuous-pass guard `expect(fences.length).toBeGreaterThan(0)` at `packages/config/tests/board-modules.test.ts:220` — at-least-one, not an exact count. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Downstream authors can follow the published module contract (req: R1; R2; R3; R4) | MET | test | Unmarked YAML fence (`docs/design/downstream-board-modules.md:46`) is now parsed through the production schema + cross-declaration validator by `packages/config/tests/board-modules.test.ts:217-233`; sentinel fence (`:149`) still matched exactly by `packages/config/tests/board-modules.test.ts:189-215`; failing-fence line-naming proven by probe (R3); guard R4 at `:220`. Live targeted run `(cd packages/config && bun test tests/board-modules.test.ts)`: 15 pass / 0 fail (49 expect calls), including the new "every YAML fence in the guide is a valid declaration example (R1)" test. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

#### Review

**Disposition: APPROVED-WITH-FINDINGS** — P4 residual notes only; no P1–P3. R1–R4 all satisfied with evidence; the remediation hop correctly satisfies `no-globalthis-fetch-mutation` via the existing rpc-client test seam. Review run 4c91df29 (fresh session, diff vs `.spur/run/0999-base.sha` = `7e442aab`).

#### Functional traceability

- **R1 (every YAML fence validated) — PASS.** `yamlFences()` (packages/config/tests/board-modules.test.ts:181-186) matches column-0 ` ```yaml `/` ```yml ` fences incl. info strings; new test (packages/config/tests/board-modules.test.ts:217-233) parses each fence through `spurConfigSchema` and validates its `bootstrap.modules` via `validateBoardModuleDeclarations` against the reserved inventory. Verified against the real guide: exactly two YAML fences matched (`docs/design/downstream-board-modules.md:46`, `:149`); the ` ```ts ` fences at `:75`/`:178` are correctly excluded.
- **R2 (sentinel assertions unchanged) — PASS.** Sentinel test (packages/config/tests/board-modules.test.ts:191-215) still asserts `toHaveLength(1)` sentinel fence, exact `team-board`/`docs` declarations, and host-inventory validation; only the extraction was swapped.
- **R3 (failure names line + error) — PASS.** Message template `` `downstream-board-modules.md:${fence.line}: ${message}` `` (packages/config/tests/board-modules.test.ts:229). Line math independently verified on the guide (46/149, matching the task claims); negative probe with a poisoned §4 fence produced `downstream-board-modules.md:46: Nested mappings are not allowed...`.
- **R4 (vacuous-pass guard) — PASS.** `expect(fences.length).toBeGreaterThan(0)` (packages/config/tests/board-modules.test.ts:222) — at-least-one, not an exact count.
- **AC1** satisfied; task maps to feature A8 scenario R14 (published module contract as executable evidence). Guide unedited per constraint (both fences already pass); no production source changed.

#### SECUA

- **Security — clean.** Test-only diff plus task record; no secrets, no suppression comments. The hop *improves* isolation: stubbed fetch no longer leaks across tests via a mutated `globalThis.fetch`.
- **Correctness — clean, with residuals.** Both parse and schema-validate failures land in the same try/catch (packages/config/tests/board-modules.test.ts:220-231); failures accumulate so one run names every offending line (usability win over fail-fast). See residuals F1–F2 below.
- **Efficiency — clean.** Single regex pass over one doc.
- **Architecture — clean.** Remediation reuses the pre-existing seam (`setFetchForTesting`/`resetFetchForTesting`, apps/web/src/lib/rpc-client.ts:15-23; `_testFetch` consumed at rpc-client.ts:63 in `fetchWithTimeout`), which sits on the live path of the singleton `api` client (`fetch: apiFetchWithTimeout`, rpc-client.ts:91). Grep confirms zero direct `fetch()` callers in `apps/web/src`, so the seam stub intercepts everything the old `globalThis.fetch` swap did. `resetFetchForTesting()` in afterEach (BoardLayoutFramed.test.tsx:55, ThemeToggle.test.tsx:47) matches the seam contract; no `realFetch` leftovers.

#### Findings

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Correctness (residual F1, accepted) | packages/config/tests/board-modules.test.ts:181-186 | Unclosed YAML fence at EOF is silently unmatched by `yamlFences` and skips validation; R4 at-least-one guard cannot catch a second unclosed fence. Ceiling accepted for a two-fence guide; upgrade path: fence-pairing/count-parity assertion if the guide grows. |
| P4 | Architecture (residual F2, accepted) | apps/web/tests/components/BoardLayoutFramed.test.tsx:50 | Seam stub intercepts only rpc-client-routed fetch (`_testFetch`, apps/web/src/lib/rpc-client.ts:63); a future raw `fetch()` in a component would reintroduce happy-dom CORS noise — loud failure, not silent. Grep confirms zero direct fetch callers in apps/web/src today. |
| P4 | Isolation (pre-existing, out of diff) | apps/web/tests/components/ThemeToggle.test.tsx:49 | afterEach still clears `globalThis.matchMedia` between tests — global mutation, but outside the `no-globalthis-fetch-mutation` rule scope and untouched by this diff. |
| P1–P3 | none (Security/Correctness/Efficiency/Architecture clean) | — | Test-only diff plus task record; no suppressions, no secrets; remediation strengthens the http-boundaries rule via the pre-existing rpc-client test seam. |
#### Residual risk

Low. The change strictly widens validation coverage (2/2 YAML fences now validated vs 1 before); the only new failure mode is the unclosed-fence gap (F1), which requires malformed markdown that would visibly break the published guide anyway.

#### Verification (this review, targeted only)

- `(cd packages/config && bun test tests/board-modules.test.ts)` — 15 pass / 0 fail.
- `(cd apps/web && bun test tests/components/BoardLayoutFramed.test.tsx tests/components/ThemeToggle.test.tsx)` — 8 pass / 0 fail.
- Independent regex/line-number probe and poisoned-fence negative probe on the real guide (read-only).

#### References

- Feature A8, scenario R14 (`spur feature show A8`).
- 0992 Review residual P3 (sentinel-gated extraction).
- `packages/config/tests/board-modules.test.ts:172-218`; `docs/design/downstream-board-modules.md:46`, `:149`.

#### History

- 2026-09-29T03:18:43.096Z backlog → todo (system)
- 2026-09-29T03:42:50.263Z todo → wip (system)
- 2026-09-29T04:12:26.355Z wip → testing (system)

### References

- Feature A8, scenario R14 (`spur feature show A8`).
- 0992 Review residual P3 (sentinel-gated extraction).
- `packages/config/tests/board-modules.test.ts:172-218`; `docs/design/downstream-board-modules.md:46`, `:149`.

### History

- 2026-09-29T03:18:43.096Z backlog → todo (system)
- 2026-09-29T03:42:50.263Z todo → wip (system)
- 2026-09-29T04:12:26.355Z wip → testing (system)
- 2026-09-29T04:16:36.376Z testing → done (system)

