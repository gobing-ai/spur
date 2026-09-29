---
schema_version: 1
name: Harden published authoring-example validation against unmarked code fences
status: todo
template: feature-impl
created_at: 2026-09-29T03:05:28.279Z
updated_at: "2026-09-29T03:18:43.096Z"
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

- [ ] R1. Every ` ```yaml ` / ` ```yml ` fence in `docs/design/downstream-board-modules.md` is parsed through
  `spurConfigSchema` and its `bootstrap.modules` through `validateBoardModuleDeclarations`; a fence that fails
  either fails the test. Rule: in this guide, a YAML fence *is* a config example — a non-config snippet uses a
  different fence language (e.g. ` ```text `). No exemption marker.
- [ ] R2. Keep the sentinel-selected fence's detailed shape assertions (exact `team-board` / `docs` declarations,
  exactly one sentinel fence) unchanged.
- [ ] R3. A failing fence's message names its 1-based start line in the guide and the parse/validation error.
- [ ] R4. Guard against a vacuous pass: assert at least one YAML fence was found (not an exact count).

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature A8, scenario R14 (`spur feature show A8`).
- 0992 Review residual P3 (sentinel-gated extraction).
- `packages/config/tests/board-modules.test.ts:172-218`; `docs/design/downstream-board-modules.md:46`, `:149`.

### History

- 2026-09-29T03:18:43.096Z backlog → todo (system)

