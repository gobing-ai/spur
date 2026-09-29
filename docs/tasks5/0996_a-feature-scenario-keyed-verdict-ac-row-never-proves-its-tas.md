---
schema_version: 1
name: A feature-scenario-keyed verdict AC row never proves its task AC box
status: done
template: issue
created_at: 2026-09-28T23:16:58.188Z
updated_at: "2026-09-29T00:10:53.491Z"
feature_id: D62

ac_altitude: task-local
priority: P2
ac_numbering: task-local
estimate_hours: 3
---

## 0996. A feature-scenario-keyed verdict AC row never proves its task AC box

### Background

Found during the 0968 and 0969 runs (2026-09-28), both feature-linked tasks (G67, H21). Two surfaces disagree about how a verdict AC row is keyed:

- `spur task verdict --from-answer` requires every row keyed to a feature scenario. Keying the AC rows as `AC1`/`AC2` made it exit non-zero: `Verdict rows key to no scenario of linked feature G67: R1, R2, R3, R4, R5 (+2 more)`.
- Keying the AC rows by the feature scenario title (`R3 — The agent loop is an application service`, the tool's first-listed accepted form) satisfies the verdict, but `flipVerifiedCheckboxes` (`packages/app/src/services/task-record.ts`) derives its proof set through `prefixId`, whose `/^(?:AC|R)\d+/` maps that key to `R3` — the **Requirements** namespace — while the task's AC checkbox is `AC1`. The AC box is therefore never flipped.

Consequence, observed twice: `task record` leaves the AC boxes `[ ]`, the record-stage residual sweep classifies them blocking, folds `PASS → PARTIAL`, and the `record → done` gate fails (`Task is done but carries N unchecked checklist box(es)`). Recovery required a manual `spur task update <wbs> --section "Acceptance Criteria"` tick, then a **second** verdict derivation + residual sweep + done gate.

The task file already carries the alias on the AC line itself (`- [ ] AC1 — R3 — The agent loop is an application service`), so the mapping information exists where the flip runs; only the lookup is missing. `prefixId`'s own comment names the intended contract ("Without the AC form, an AC row keyed by scenario title for feature credit could never tick its own task box") — it handles `AC1 — <scenario title>` but not the reverse, `<scenario> — <title>` for an AC that aliases a feature scenario.

### Requirements

- [x] R1. A verdict AC row keyed by a feature-scenario identifier proves the task AC checkbox that aliases that scenario, so a feature-linked task needs no manual AC tick between `record` and `done`.
- [x] R2. Existing keying forms keep their behavior: `AC1`, `AC1 — <scenario title>`, and `R1`-style requirement keys flip exactly what they flip today; a scenario key that the task does not alias flips nothing.
- [x] R3. Tests cover the aliased-scenario key flipping its AC box, the non-aliased key flipping nothing, and the existing forms staying green.

### Acceptance Criteria

- [x] AC1 — A feature-linked task whose AC lines alias feature scenarios reaches `done` from `record` with no manual AC tick and no PASS→PARTIAL downgrade (req: R1)
- [x] AC2 — `AC1`, `AC1 — <title>` and `R1` keying still flip exactly their boxes; an unaliased scenario key flips none (req: R2)
- [x] AC3 — Focused `task-record` tests cover all three cases and the full gate is green (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-28T23:26:06.645Z

#### Q&A entry — 2026-09-28T23:25:00.000Z

- **CLOSED — alias resolution at flip time (Design shape 1), not an answer-schema rule.** The alias
  (`AC1 — R3 — <title>`) already lives in the Acceptance Criteria body that the flip function holds,
  so resolving it there needs no change to the verdict answer schema and keeps the id→box mapping in
  the one place that turns verdict ids into boxes. Shape 2 (`AC1 (feature R3)`) would first have to be
  verified against both `verify-answer-lint`'s accepted forms and the verdict tool's scenario keying;
  making a delegated implementation depend on that verification is the larger risk. Revisit shape 2
  only if flip-time resolution turns out to need context the function does not have.
- **CLOSED — a scenario key the task does not alias proves nothing.** No "first unchecked box"
  fallback: silence stays non-proof (0692's conservative contract), so an unrelated feature key can
  never tick an AC it does not name.

### Design

Resolve the id in `flipVerifiedCheckboxes` against the section body before matching — **chosen shape 1** (see Q&A). After computing `proven`, resolve each proven id that is not already an `AC\d+`/`R\d+` prefix to the AC label whose checklist line aliases it: a proven key `R3` matches the item whose text is `AC1 — R3 — <title>`, proving `AC1`. `parseChecklist` already returns the per-line item text and the function already holds the body, so this is a local lookup — no signature change, no new module, no engine change.

Keep `prefixId`'s existing forms intact: `AC1` and `AC1 — <title>` must still resolve to `AC1`, and an `R1` requirement key must still prove the `R1` box. A scenario key the task does not alias proves nothing.

Verify by reproducing the 0968/0969 path end to end (feature-linked task + scenario-keyed AC rows) and confirming the AC boxes flip during `task record`, with no manual `spur task update --section` step and no `PASS → PARTIAL` downgrade.

### Plan

- [x] Reproduce the two-keying conflict in a focused test (feature-linked task, scenario-keyed AC row).
- [x] Implement the chosen alias resolution; keep `prefixId`'s existing forms intact.
- [x] Cover the three R3 cases in the `task-record` suite, then run `bun run spur-check`.
- [x] Update the verdict-answer authoring guidance with the keying rule that works for feature-linked tasks.

### Root Cause

`flipVerifiedCheckboxes` (`packages/app/src/services/task-record.ts`) normalizes each proven verdict id through `prefixId`, whose `/^(?:AC|R)\d+/` keeps only a leading `AC<n>`/`R<n>` token:

```ts
function prefixId(id: string): string {
    const m = /^(?:AC|R)\d+/.exec(id);
    return m ? m[0] : id;
}
```

A verdict row keyed to a feature scenario — the form `spur task verdict` requires for a feature-linked task — begins with the **feature's** own `R<n>`, e.g. `R3 — The agent loop is an application service`. `prefixId` therefore yields `R3`, a Requirements-namespace id. The task's AC checkbox is labelled `AC1` (`- [ ] AC1 — R3 — …`), so `proven` never contains `AC1` and the box is never flipped.

The alias information is present in the section body the function already holds, and `prefixId`'s own comment names the intended contract — it handles the forward direction (`AC1 — <scenario title>` → `AC1`) but not a bare scenario key resolving back to the AC label that aliases it.

Observed on 0968 (feature G67) and 0969 (feature H21): the record-stage residual sweep counted the untouched AC boxes as blocking, folded `PASS → PARTIAL`, and the `record → done` gate failed with `Task is done but carries N unchecked checklist box(es)`. Recovery was a manual `spur task update <wbs> --section "Acceptance Criteria"` tick followed by a second verdict derivation, residual sweep and done gate.

### Solution

Chosen shape 1: resolve the AC row against the section body the flip already holds.

| Change (`file:line`) | Rationale |
|---|---|
| `packages/app/src/services/task-record.ts:207` | `acRowProves` maps a MET AC row to the AC label whose checklist line aliases it (`AC1 — R3 — <title>`, full key or title-only). An unaliased `R<n> — <title>` scenario key proves nothing, so it no longer ticks the same-numbered task R box. `AC1`, `AC1 — <title>` and `R1 (context)` keep the `prefixId` path. |
| `packages/app/src/services/task-record.ts:231` | `flipVerifiedCheckboxes` parses the checklist first and routes AC rows through `acRowProves`; Requirements rows unchanged. |
| `packages/app/tests/services/task-record.test.ts:1395` | Aliased scenario key, title-only key, unaliased key, existing forms. The three new-behavior cases fail against the pre-fix source. |
| `plugins/sp/skills/code-verification/references/verdict-schema.md:127` | Authoring rule: alias every graduated scenario on its AC line so a scenario-keyed row ticks it. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-record.ts:207` `acRowProves` resolves a scenario-keyed AC row to the aliasing AC label, called at `packages/app/src/services/task-record.ts:245`; `packages/app/tests/services/task-record.test.ts:766` (through `TaskService.record`) and `packages/app/tests/services/task-record.test.ts:1427` |
| R2 | MET | `packages/app/tests/services/task-record.test.ts:1457` (bare `AC1`, `R1` keys), `packages/app/tests/services/task-record.test.ts:1415` (`AC1 — <title>`), `packages/app/tests/services/task-record.test.ts:1448` (unaliased scenario key flips nothing) |
| R3 | MET | `(cd packages/app && bun test tests/services/task-record.test.ts)` → 99 pass / 0 fail (re-run 2026-09-28); against pre-fix `task-record.ts` (4fade1730~1) 4 fail: `packages/app/tests/services/task-record.test.ts:766`, `:1427`, `:1439`, `:1448` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/task-record.test.ts:766` record ticks `AC1 — R3 — …` from an `R3 — …` row with no manual tick and leaves task R3 unticked |
| AC2 | MET | test | `packages/app/tests/services/task-record.test.ts:1457`, `packages/app/tests/services/task-record.test.ts:1415`, `packages/app/tests/services/task-record.test.ts:1448` |
| AC3 | MET | test | `packages/app/tests/services/task-record.test.ts:1427`, `packages/app/tests/services/task-record.test.ts:1439`, `packages/app/tests/services/task-record.test.ts:1448`; 99 pass / 0 fail. `bun run spur-check` re-run: lint + typecheck + pre-check pass, tests 9391 pass / 1 fail — sole failure `apps/cli/tests/commands/feature.test.ts:33` fixture `git init` denied by the agent sandbox (nested `.git/hooks` write); post-check coverage-gate on `apps/cli/src/commands/feature.ts` is the knock-on of that skipped suite. Neither file is touched by 4fade1730 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- Flip site: `packages/app/src/services/task-record.ts` (`flipVerifiedCheckboxes`, `prefixId`)
- Verdict keying requirement: `plugins/sp/scripts/verify-answer-lint.ts` and the `spur task verdict` scenario-key gate; the error text observed was `Verdict rows key to no scenario of linked feature G67: R1, R2, R3, R4, R5 (+2 more)`
- Aliasing source (task side): the task file's AC lines carry both labels, e.g. `- [ ] AC1 — R3 — The agent loop is an application service`
- Related tasks: 0692 (verdict-driven checkbox auto-flip, feature F94), 0956 (D64 scenario-key verdict evidence), 0968 (G67) and 0969 (H21) where the conflict was observed

### History

- 2026-09-28T23:40:59.022Z todo → wip (system)
- 2026-09-28T23:47:06.283Z wip → testing (system)
- 2026-09-28T23:47:06.815Z testing → done (system)

