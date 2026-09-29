---
schema_version: 1
name: Harden published authoring-example validation against unmarked code fences
status: backlog
template: feature-impl
created_at: 2026-09-29T03:05:28.279Z
updated_at: "2026-09-29T03:06:48.627Z"
feature_id: A8

---

## 0999. Harden published authoring-example validation against unmarked code fences

### Background

0992 introduced a test that makes the published authoring guide's own config example executable
evidence: it extracts the YAML fence and parses it through the production schema and cross-declaration
validator, so a documented shape the schema would reject cannot ship as guidance.

The extraction is sentinel-gated, which leaves a hole. `packages/config/tests/board-modules.test.ts:182`
selects fences by `block.includes('# board-modules-authoring-example')`, and the guide has exactly one
such fence (`docs/design/downstream-board-modules.md:150`). An example added **without** that comment is
silently unvalidated — the test still passes, and a wrong shape ships as documentation.

**Evidence**
- `packages/config/tests/board-modules.test.ts:182` — sentinel-based fence filter.
- `docs/design/downstream-board-modules.md:150` — the single marked fence.
- 0992 Review residual (P3), disclosed and never closed: "A future example block added without the
  sentinel is not validated."

**Why it matters**
The guide is the contract downstream authors follow (A8 R5). The current guard protects only the example
that happens to be marked; the failure mode it was written to prevent — describing a shape the schema
rejects — reopens the moment someone adds a second example. The cost of closing it is small and local.

### Requirements

- [ ] R1. Fail the validation test when the guide contains a fenced config-shaped example that is neither
  validated nor explicitly exempted, so a newly added example cannot ship unvalidated. "Exempt" must be an
  explicit, greppable marker in the fence — not an absence of the validating marker.
- [ ] R2. Keep the existing sentinel path working: the currently validated example must still be parsed
  through `spurConfigSchema` and `validateBoardModuleDeclarations`.
- [ ] R3. Name the offending fence in the failure message — file and line, or the first line of the fence
  content — so the author can find it without searching.
- [ ] R4. Do not turn non-config fences into failures: prose/code fences that are not config examples must
  be exemptable by the same explicit mechanism.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Downstream authors can follow the published module contract (req: R5; R6)
  Given the authoring guide contains one or more fenced config examples
  When the validation test runs
  Then every config-shaped fence is either parsed through the production schema and validator
    or carries an explicit exemption marker
  And a fence that is neither validated nor exempted fails the test, naming its location
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Fix direction**

- Change the fence selection in `packages/config/tests/board-modules.test.ts` from "take the fences that
  carry the validating marker" to "partition every yaml fence into validated and exempted, and fail on
  any fence in neither set".
- Introduce one exemption marker (for example `# board-modules-authoring-example:exempt`) alongside the
  existing validating marker, and document both in a comment in the test so the next author knows the
  rule.
- Report the offending fence's location in the assertion message (R3).

**Constraints**

- Keep the test in `packages/config`; it reads the guide by path, which is already the established
  pattern there.
- Do not hard-code the expected fence count — that would break on every legitimate guide edit. The
  invariant is "no unclassified fence", not "N fences".

**Out of scope**

- Rewriting the guide's content or adding new examples.
- Validating fences in documents other than the downstream board module guide.

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
