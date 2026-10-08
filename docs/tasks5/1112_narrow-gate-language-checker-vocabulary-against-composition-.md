---
schema_version: 1
name: Narrow gate-language checker vocabulary against composition prose false positives
status: wip
template: feature-impl
created_at: 2026-10-07T07:29:50.751Z
updated_at: "2026-10-07T23:27:51.815Z"
feature_id: F91

ac_altitude: task-local
priority: P3
estimate_hours: 2
---

## 1112. Narrow gate-language checker vocabulary against composition prose false positives

### Background

`hasGateLanguage()` at `packages/app/src/services/task-check.ts:457` flags bare words (`merged`, `approved`, `HITL`, …) anywhere in task prose. Factual hit during task 1106 enrichment (2026-10-07): the composition sentence "…merged back into one step" tripped the L4 gate-language WARN in a test-hardening task with no merge surface. Advisory WARNs that fire on prose train operators to dismiss them — an integrity cost to the F91 corpus-gate surface.

**Refine corrections (2026-10-07)**

- Line refs: the predicate is `hasGateLanguage()` at `packages/app/src/services/task-check.ts:456-460` (regex `:457`), with its doc comment at `:455` and `GATE_LANGUAGE_SECTIONS` at `:454`. A stray doc comment for `hasSolutionFileLineCitation` sits at `:445-451`, above the gate-language block, detached from its function at `:463` — move it while touching this block.
- Consumers: `task check` L4 (`task-check.ts:1492`) and the TaskService write-time warning (`packages/app/src/services/task-service.ts:1275`). Both skip the advisory when frontmatter `dependencies[]` is non-empty.
- Existing true-positive fixtures: `packages/app/tests/services/task-check.test.ts:4215` ("HITL approval merge event before the capstone") and `packages/app/tests/services/task-service.test.ts:2506` ("Blocked until HITL approval of the parent"). Neither isolates `merged` or `approved` alone, so R2 adds cue-bearing true positives for those words.
- The vocabulary is restated in `plugins/sp/skills/spur-dev/references/ac-style-guide.md:103` and `plugins/sp/skills/spec-decomposition/references/decomposition.md:565`; both must describe the new rule.
- R1's "either/or" is resolved in Design: keep the words, require a gating cue in the same sentence.

### Requirements

- [ ] R1. `hasGateLanguage()` splits its vocabulary. Unconditional tokens (`HITL`, `human-in-the-loop`, `merge event`, `content-gate`, `GATED`, `capstone`) fire anywhere. Ambiguous tokens (`approval`, `approved`, `merged`) fire only when the same sentence also carries a gating cue (`until`, `after`, `once`, `before`, `pending`, `blocked`, `wait for`/`waiting for`, `requires`/`require`). A code comment states WHY (composition prose uses these words with no gate).
- [ ] R2. Tests in `packages/app/tests/services/task-check.test.ts`: the 1106 sentence "…merged back into one step" and "the approved design" produce no finding; "Blocked until 1050 is merged" and "Requires operator approval before starting" warn; the 0700 R6 fixtures stay green. One test in `task-service.test.ts` shows the write-time path is silent for the composition sentence.
- [ ] R3. `ac-style-guide.md:103` and `decomposition.md:565` describe the cue rule for the ambiguous words.
- [ ] R4. The orphaned `hasSolutionFileLineCitation` doc comment (`task-check.ts:445-451`) is moved onto its function.

### Acceptance Criteria

- [ ] AC1 — Composition and testing prose no longer triggers the gate-language WARN; true human-confirmation vocabulary still warns (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T16:17:03.423Z

- **Q: Cue co-occurrence or drop the words?** A: Cue co-occurrence (2026-10-07 refine). Dropping `merged` loses real "until X is merged" gates; the git-context cue list in the original R1 (branch/commit/PR) would miss "Blocked until 1050 is merged".

### Design

**Approach:** change the shared predicate only; both consumers follow (single source of truth, `task-check.ts:455`).

**Frozen shape**

```ts
const GATE_TOKENS = /(?<![\w-])(HITL|human[- ]in[- ]the-loop|merge event|content-gate|GATED|capstone)(?![\w-])/i;
const AMBIGUOUS_GATE_TOKENS = /(?<![\w-])(approval|approved|merged)(?![\w-])/i;
const GATE_CUES = /\b(until|after|once|before|pending|blocked|wait(?:ing)? for|requires?)\b/i;
// sentence = split on /[.!?](?:\s|$)|\n/
```

`hasGateLanguage(body)` = `GATE_TOKENS.test(body)` OR some sentence matches both `AMBIGUOUS_GATE_TOKENS` and `GATE_CUES`. Signature and export unchanged.

**Known ceiling:** "after the stages were merged back" still warns (cue + token). Accepted: advisory only, and a cue-bearing sentence is the likelier gate. Mark with a `ponytail:` comment naming the upgrade path (syntactic subject check) if it recurs.

**Anti-patterns**

- Changing the call sites at `task-check.ts:1492` or `task-service.ts:1275`.
- Dropping `approval`/`merged` from the vocabulary entirely (loses "Blocked until X is merged").
- Rewording this task's own Background/Requirements to avoid its WARN (Notes: the residual hit is evidence).

**Dependency handoff:** none. Independent of H15.

### Plan

1. Add the R2 tests (they fail on the current predicate for the false-positive cases).
2. Rewrite `hasGateLanguage()` per Design; move the orphaned doc comment.
3. Update `ac-style-guide.md:103` and `decomposition.md:565`.
4. `(cd packages/app && bun test tests/services/task-check.test.ts tests/services/task-service.test.ts)`; `bun run spur-check`.
5. `spur task check 1106 --json` — confirm no gate-language finding on the restored wording if the operator reverts the 1106 reword (optional).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: F91
- `packages/app/src/services/task-check.ts:445-460`, `packages/app/src/services/task-check.ts:1492`, `packages/app/src/services/task-service.ts:1275`
- Fixtures: `packages/app/tests/services/task-check.test.ts:4208-4234`, `packages/app/tests/services/task-service.test.ts:2494-2521`
- Vocabulary docs: `plugins/sp/skills/spur-dev/references/ac-style-guide.md:103`, `plugins/sp/skills/spec-decomposition/references/decomposition.md:565`
- Origin: task 1106 enrichment, 2026-10-07

### History

- 2026-10-07T07:34:14.858Z backlog → todo (system)
- 2026-10-07T23:27:51.815Z todo → wip (system)

### Notes

This task's own body deliberately quotes the flagged vocabulary (Background, R1, R2) — the residual L4 gate-language WARN on those sections is self-referential evidence for R1 and MUST NOT be reworded away. Factual reproduction: 2026-10-07 task 1106 enrichment, composition sentence "…integrated back into one step" (originally the git verb) tripped the WARN with no merge surface. Vocabulary source of truth: `hasGateLanguage()` at `packages/app/src/services/task-check.ts:457-460`; shared by `task check` L4 and TaskService write-time warnings — fix both consumers by changing the predicate, not the call sites (single source of truth comment, :455).

