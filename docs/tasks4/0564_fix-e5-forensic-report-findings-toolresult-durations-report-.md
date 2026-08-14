---
template: issue
schema_version: 1
name: "Fix E5 forensic-report findings: toolResult durations, report flag passthrough, omp arguments-shape drift"
description: ""
status: backlog
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T19:04:08.987Z"
updated_at: "2026-08-14T19:06:26.578Z"
---

## 0564. Fix E5 forensic-report findings: toolResult durations, report flag passthrough, omp arguments-shape drift

### Background
The E5 batch forensic analysis (`docs/report/2026-08-14-E5-batch-forensic-report.md`, omp session
2026-08-14) surfaced four findings. Two were fixed by E6 (0557–0559, commit `4a10fa12`: run→session
observer + retro-correlator + cost attribution repoint). This task fixes the three that remain open.
Severity order: R1 (S1) → R2 (S2) → R3 (S3). All three are independently landable; R1 is the
highest-value because it unlocks attribution of the 82% of wall time currently unmeasured.

Source evidence per finding lives in the report's Appendix A; the anchors are repeated inline below
so this task is self-contained.

### Requirements

- [ ] R1. omp toolResult durations at import (F1, S1) — importer computes toolResult wall duration and analyzer folds real `duration_ms` (replaces `run-cost.ts:189` hardcode)
  **Problem.** omp toolResult records carry no durations, so per-message wall-time attribution is
  impossible: only assistant-LLM latency (3.1h of an ~17.8h window, 18%) is measurable. The schema and
  analytics already support durations — the importer just never populates them for omp:
- `packages/domain/src/analytics/run-cost.ts:189` — hardcodes `durationMs: 0` and increments
  `durationUnmeasured` (that counter is the honest signal today).
- `packages/domain/src/analytics/forensic-query.ts:153` — already aggregates
  `SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms IS NULL END)`.
- Column `history_message.duration_ms` exists (importer-owned `HISTORY_IMPORT_SCHEMA_SQL`).
  **Fix — importer side (`@gobing-ai/ts-llm-jsonl-importer`).** omp session logs interleave
  `toolCall` blocks (assistant message) with the matching `toolResult` message (identified by
  `role:"toolResult"` + `toolName`, timestamps as ISO strings). Compute per-toolResult wall duration =
  `toolResult.ts − matching toolCall.ts` while streaming a session file, and populate
  `history_message.duration_ms` for the toolResult row. Guard rails:
- Negative or implausibly large (> 1h) deltas → write NULL (keep `durationUnmeasured` honest) rather
  than poisoning sums.
- Match by (session, toolName, sequence-within-session) as omp does not carry a call id; if a match
  is ambiguous (parallel same-name calls), prefer nearest-preceding unmatched call, else NULL.
- Mirror the retention stance of 0553 (todo/args allowlist): durations are forensic primitives,
  always retained, never redacted (they are numbers, not content).
  **Fix — analyzer side (Spur).** Once importer emits durations, remove the
  `run-cost.ts:189` hardcode: fold real `duration_ms` into bucket `durationMs` and keep
  `durationUnmeasured` for NULL rows. `forensic-query.ts` needs no change (already duration-aware).
  **Release coordination.** Importer change requires ts-libs release + `bun update` of dependent
  workspaces (the 0504 provenance-header contract: record `binary:` + importer version in the
  transcript before any real import). Follow the E6 RC3 lesson: verify the *resolved* package version
  ships the fix before this task leaves implement — do not let it surface as a review-time P2.
  **Acceptance criteria (inline detail):**
```gherkin
Scenario Outline: importer emits toolResult durations for omp
  Given an omp session JSONL with a toolCall at T1 and its toolResult at T2
  When the file is imported
  Then the toolResult's history_message.duration_ms equals (T2 - T1) in ms
Scenario: implausible deltas stay unmeasured
  Given a toolCall/toolResult pair whose delta is negative or > 3600000 ms
  When imported
  Then duration_ms is NULL and durationUnmeasured counts it
Scenario: analyzer folds real durations
  Given imported messages with measured duration_ms
  When analyze runs
  Then bucket durationMs > 0 and equals SUM(duration_ms) for the bucket
```
- [ ] R2. `history report` flag passthrough (F3, S2) — render-time `--task`/`--top` narrowing over the loaded artifact, loud failure on missing dimension
  **Problem.** `spur history report` is a pure renderer over a previously-generated analyze artifact
  and only accepts `--json` / `--mode <name>` (`apps/cli/src/commands/history.ts:117–124`), while
  `analyze` carries `--run` / `--task` / `--top` (`history.ts:134–136`). An operator narrowing a
  report to a task cannot without regenerating the artifact.
  **Fix.** The renderer never opens the database, so true server-side filtering is impossible by
  design — do not break that invariant. Add **render-time narrowing** only:
- `--task <wbs>` / `--top <n>` flags on `report` that filter the already-loaded artifact JSON
  client-side (drop non-matching buckets/leaderboard rows; `--top` re-slices leaderboards).
- When a flag narrows the output, print a one-line banner: `narrowed: task=0564 top=10 (render-time
  filter over artifact <id>)` — so a narrowed report is never mistaken for a full one.
- Unknown/absent data (e.g. `--task` when artifact has no task dimension) → exit 1 with an explicit
  message naming the artifact id and the missing dimension. Never silently render unfiltered output.
  **Acceptance criteria (inline detail):**
```gherkin
Scenario: render-time task narrowing
  Given an analyze artifact containing multiple task_wbs buckets
  When `history report <path> --task 0564` runs
  Then output contains only 0564-scoped rows and the narrowed: banner
Scenario: narrowing against a dimension the artifact lacks fails loudly
  Given an artifact whose selector had no task dimension
  When `history report <path> --task 0564` runs
  Then exit code is 1 and stderr names the artifact id and missing dimension
```
- [ ] R3. omp `arguments` vs fixture `input` drift (F4, S3) — fixture accepts both keys, live-shape regression case, session-formats one-line note
  **Problem.** The 0556 fallback test fixture parses omp toolCall blocks via
  `block.input.command` (`plugins/sp/tests/issue-finding-fallback.test.ts:55`), but live omp emits
  `block.arguments.command` (shape: `message.role:"assistant"`, `content[]:{type:"toolCall", name,
  arguments:{command,…}}`; toolResult via `role:"toolResult"`+`toolName`). Result: the fallback
  categorizer (R4/R5 tests) passes on synthetic fixtures but is blind on real omp logs — the tests
  green-light a parser that cannot see real commands.
  **Fix.**
- Update `parseToolCalls` in the fixture to read `block.arguments ?? block.input` — accept both
  eras of the omp schema (older logs wrote `input`; the drift is real historical data, not a typo).
- Add one regression case to `issue-finding-fallback.test.ts` that feeds a **live-captured** omp
  snippet (arguments-shape) through the categorizer and asserts non-empty command extraction. A
  short 5–10 line anonymized snippet committed under `plugins/sp/tests/fixtures/` is fine.
- Update `plugins/sp/skills/issue-finding/references/session-formats.md` omp section with a one-line
  note documenting the two shapes and the accepted-keys rule (`arguments` current, `input` legacy),
  keeping 0556's stance that `mappers.ts` remains the single field-map authority (no second map).
  **Acceptance criteria (inline detail):**
```gherkin
Scenario: categorizer reads live omp shape
  Given an omp session snippet using toolCall blocks with .arguments.command
  When the fallback test fixture parses and categorizes it
  Then extracted commands are non-empty and categorization counts are non-zero
Scenario: legacy input shape still parses
  Given a toolCall block using the legacy .input.command key
  When parsed
  Then the command is extracted identically
```
### Acceptance Criteria
```gherkin
Scenario Outline: R1 — importer emits toolResult durations for omp
  Given an omp session JSONL with a toolCall at T1 and its toolResult at T2
  When the file is imported
  Then the toolResult's history_message.duration_ms equals (T2 - T1) in ms

Scenario: R1 — implausible deltas stay unmeasured
  Given a toolCall/toolResult pair whose delta is negative or > 3600000 ms
  When imported
  Then duration_ms is NULL and durationUnmeasured counts it

Scenario: R1 — analyzer folds real durations
  Given imported messages with measured duration_ms
  When analyze runs
  Then bucket durationMs > 0 and equals SUM(duration_ms) for the bucket

Scenario: R2 — render-time task narrowing
  Given an analyze artifact containing multiple task_wbs buckets
  When `history report <path> --task 0564` runs
  Then output contains only 0564-scoped rows and a narrowed: banner names the filter

Scenario: R2 — narrowing against a missing dimension fails loudly
  Given an artifact whose selector had no task dimension
  When `history report <path> --task 0564` runs
  Then exit code is 1 and stderr names the artifact id and the missing dimension

Scenario: R3 — categorizer reads live omp shape
  Given an omp session snippet using toolCall blocks with .arguments.command
  When the fallback test fixture parses and categorizes it
  Then extracted commands are non-empty and categorization counts are non-zero

Scenario: R3 — legacy input shape still parses
  Given a toolCall block using the legacy .input.command key
  When parsed
  Then the command is extracted identically to the arguments shape
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- R1 spans two repos: importer duration computation (ts-libs, needs release + lockstep bump) and
  Spur analyzer fold (`run-cost.ts`). Land importer first; Spur-side hardcode removal can only land
  after `bun update` resolves the new version (E6 RC3 lesson).
- R2 is CLI-local (`apps/cli/src/commands/history.ts` + service) — independent of R1/R3.
- R3 is plugins/sp-local (test fixture + one reference note) — independent of R1/R2.
- Suggested order: R3 (smallest, unblocks trustworthy fallback tests) → R2 → R1 (release
  coordination is the long pole).

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
