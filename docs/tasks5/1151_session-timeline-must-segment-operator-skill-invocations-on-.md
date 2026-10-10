---
schema_version: 1
name: Session-timeline must segment operator skill invocations on pi, not count them as injected bodies
status: todo
template: issue
created_at: 2026-10-10T02:49:17.069Z
updated_at: "2026-10-10T03:31:47.929Z"
feature_id: E5

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
---

## 1151. Session-timeline must segment operator skill invocations on pi, not count them as injected bodies

### Background

Filed from the active-session review of the 2026-10-09/10 batch session (tasks 1136, 1140/1141, 1142/1135).

Task 1138 taught `session-timeline` to read a pi transcript and, in the same change, decided that a pi
user message whose text starts with `<skill name="…">` is an **injected skill body** — counted in
`injectedPrompts`, never opened as an operator segment (`plugins/sp/scripts/session-timeline.ts`,
`isInjectedPrompt`; pinned by `plugins/sp/tests/session-timeline.test.ts` "AC2/R2: an injected skill
body is counted, never segmented").

That rule is wrong for a **skill invocation**. In this session the operator drove five batches with
slash commands, and pi records each one as a user message that starts with the same `<skill name="…">`
wrapper — but the operator's arguments follow the closing tag. Measured on this session's transcript
(`$PI_SESSION_FILE`, 9 user messages):

```
2026-10-09T18:41:45.161Z | <skill name="sp-dev-run" …>            ← dropped (injectedPrompts)
2026-10-09T19:16:36.608Z | continue                                ← segment 1
2026-10-09T21:24:22.697Z | <skill name="sp-dev-runall" …>          ← dropped
2026-10-09T23:21:23.734Z | <skill name="sp-dev-runall" …>          ← dropped
2026-10-09T23:24:14.718Z | hold, before we move to the next one…   ← segment 2
2026-10-09T23:25:38.403Z | in case that complecated…               ← segment 3
2026-10-09T23:49:48.970Z | <skill name="sp-dev-runall" …>          ← dropped
2026-10-10T00:23:07.685Z | continue                                ← segment 4
2026-10-10T02:46:08.047Z | <skill name="sp-dev-review-session" …>  ← dropped (this review)
```

The tool reported `injectedPrompts: 5` and only 4 segments, so **the five requests that carried the
session's actual work are attributed to no stage at all** — the review's own Time breakdown silently
understates the session (measured 7:30:36 elapsed against a transcript span of ~8:06, with every
dropped prompt's activity charged to the segment it happened to follow).

The 1138 fixture shows the shape it was written for: the injected row is exactly
`  <skill name="sp-dev-run" location="/x/SKILL.md">\ninjected body\n</skill>` — the wrapper is the
whole message. A real invocation instead ends `…</skill>\n\n--tasks 1135,1142 --auto --next --agent
inline --worktree --wrap` (7619 chars total). The distinguishing signal is text **after** the closing
tag, with one caveat: a slash invocation with **no** arguments would carry none either, so the rule
needs a decision rather than a bare suffix test.

**Refinement 2026-10-09 — pi does not inject skill bodies as user messages at all.** Census of every
local pi transcript (`~/.pi/agent/sessions/*/*.jsonl`: 2,153 files, 2,452 user rows whose first text
block opens `<skill name="`): **2,450 carry operator arguments after `</skill>`; the 2 argument-less
rows are also operator invocations** — the assistant's next turn reads "The user has triggered the
rd3-anti-hallucination skill…" (`--Users-robin-xprojects-magnifier--/2026-04-22T01-24-15-964Z_…jsonl`)
and likewise for `codex-history-ingest` (`--Users-robin-xprojects-spur--/2026-05-30T23-20-47-949Z_…jsonl`).
No row in any file is a harness-injected body; every wrapper row has exactly one text block. The 1138
fixture row (`plugins/sp/tests/fixtures/pi-session.jsonl:32`) is synthetic and has no real counterpart.

So the bug is wider than "invocations with arguments are dropped": the `injectedPrompts` class has no
true positives on pi. Every `<skill name=` user row is an operator prompt.

**Location correction.** The predicate is `isInjectedPrompt` in the shared
`plugins/sp/lib/transcript.ts:102`, called from `promptText` (`:83`) and from
`plugins/sp/scripts/session-timeline.ts:83,160`. `promptText` is also consumed by
`plugins/sp/scripts/run-summary.ts:130` (excludes prompt rows from a run window's accumulation), so the
change reaches both scripts and both committed `.mjs` twins.

### Requirements

- [ ] R1. **Every pi skill invocation opens a segment.** A pi `role:"user"` row whose first text block,
  after leading whitespace, opens with `<skill name="X"` is an operator prompt. Its segment prompt is
  `/X` followed by the trimmed text after the last `</skill>` when non-empty (e.g.
  `/sp-dev-runall --tasks 1135,1142 --auto …`), else `/X` alone. The wrapper body never appears in the
  prompt excerpt.
- [ ] R2. **Delete the injected-body class.** Remove `isInjectedPrompt` (`lib/transcript.ts`), the
  pi-only `injectedPrompts` timeline field and its counter (`session-timeline.ts:44,78-87,128`), and
  the `, N injected` fragment of the zero-segment reason (`session-timeline.ts:160-161`). Claude output
  is unchanged (it never had the field).
- [ ] R3. **The argument-less decision is recorded** in Q&A and in the `promptText` doc comment: an
  argument-less wrapper is an operator invocation (census evidence above), rendered `/X`.
- [ ] R4. **Fixture and pins reflect real shapes.** In `plugins/sp/tests/fixtures/pi-session.jsonl`,
  replace the synthetic body-only row (`new00002`) with a real-shaped invocation
  (`<skill name="sp-dev-run" location="/x/SKILL.md">\nbody\n</skill>\n\n--triage`) and add one
  argument-less wrapper row. The 1138 "injected skill body is counted, never segmented" tests are
  replaced (they pinned the wrong behaviour), the segment-count assertions are updated to the new
  count, and the "operator note … `<skill name=` later in the body" row still segments as plain text.
- [ ] R5. **Prose owners follow.** Update the injected-body sentences in
  `plugins/sp/skills/session-review/SKILL.md:105`, `plugins/sp/commands/dev-review-session.md:21`, and
  `docs/design/session-review.md:62-66` to the invocation rule.
- [ ] R6. **Sibling consumer and twins.** `run-summary` tests stay green unchanged (a user row carries no
  usage, so reclassifying it as a prompt does not move tokens); regenerate both twins with
  `superskill script convert sp session-timeline.ts` and `superskill script convert sp run-summary.ts`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A skill invocation with arguments becomes an operator segment (req: R1)
  Given a pi row whose user text is a skill wrapper named "sp-dev-run" followed by "--triage"
  When session-timeline builds the timeline
  Then that row opens a segment whose prompt is "/sp-dev-run --triage"
  And the prompt excerpt does not contain the wrapper body
```

```gherkin
Scenario: AC2 — An argument-less wrapper is still an operator segment (req: R1, R3)
  Given a pi row whose user text is only a skill wrapper named "rd3-anti-hallucination"
  When session-timeline builds the timeline
  Then that row opens a segment whose prompt is "/rd3-anti-hallucination"
```

```gherkin
Scenario: AC3 — The injected-body class is gone (req: R2)
  Given the pi fixture and the Claude fixture
  When session-timeline builds each timeline
  Then neither timeline has an "injectedPrompts" field
  And a zero-segment pi reason names format and row count without an "injected" count
  And "isInjectedPrompt" no longer exists in plugins/sp/lib or plugins/sp/scripts
```

```gherkin
Scenario: AC4 — Plain operator text mentioning <skill is unaffected (req: R4)
  Given the fixture row "operator note: the <skill name=\"x\"> wrapper above is injected…"
  When session-timeline builds the timeline
  Then that row opens a segment with its text unchanged
```

```gherkin
Scenario: AC5 — Real transcript attributes every prompt (req: R1)
  Given ~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-10-09T18-40-54-199Z_01a121f7-dbb6-763c-bb33-714a4899f716.jsonl
  When "bun plugins/sp/scripts/session-timeline.ts --transcript <that file>" runs
  Then it reports 12 segments: one prompt starting "/sp-dev-run " and two starting "/sp-dev-runall --tasks"
```

```gherkin
Scenario: AC6 — Twins and sibling stay consistent (req: R6)
  Given the regenerated session-timeline.mjs and run-summary.mjs
  When the plugin script-contract and run-summary tests run
  Then they pass
```

```gherkin
Scenario: AC7 — Prose owners describe the invocation rule (req: R5)
  Given session-review SKILL.md, dev-review-session.md and docs/design/session-review.md
  When each is searched for "injectedPrompts"
  Then none matches
  And each states that a pi skill wrapper row is an operator invocation rendered "/<name> <args>"
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-10T03:31:28.408Z

- **Q: Argument-less wrapper — injected or invocation?** A: Invocation. 2,452/2,452 observed wrapper
  rows are operator-typed; the 2 argument-less ones are answered as "the user has triggered the
  skill". Rendered `/X` so the excerpt is readable and distinct.
- **Q: Keep `injectedPrompts` as an always-0 field for compatibility?** A: No — delete. It is a
  pi-only field added two days ago by 1138, read by no code (only prose in R5's three owners), and a
  field that can never be non-zero is misleading evidence. If a future pi version injects bodies, the
  marker will be a record field, not text, and gets its own task.
- **Q: Why `/X` and not the raw trailing text?** A: The skill name is the stage label the review
  groups by (`--group`); arguments alone ("--triage") lose which command ran.

### Design

- **Shape of the change.** In `promptText` (`plugins/sp/lib/transcript.ts:77`), the pi branch replaces
  `if (isInjectedPrompt(row)) return undefined;` with: take the first text block; if it (left-trimmed)
  matches `^<skill name="([^"]+)"`, return `` `/${name}` `` + (`text.slice(lastIndexOf('</skill>') + 8).trim()`
  prefixed by a space when non-empty). Otherwise return the text as today. Delete `isInjectedPrompt`.
  In `session-timeline.ts`, drop the injected branch, counter, field, and reason fragment.
- **Non-goals.** Claude Code path unchanged (its injected bodies are `isMeta`). No token-accounting
  change. No new CLI flag.
- **Failure inventory (write before code):** wrapper with whitespace-only trailing text → `/X`;
  trailing text containing a second `</skill>` → use the last one; wrapper with no closing tag → `/X`
  plus nothing (do not dump the body); `name` with no closing quote → not a wrapper, plain text;
  Claude row containing `<skill name=` → never enters the pi branch; plain operator text that merely
  mentions `<skill` later → plain text (fixture row `new00001`).

### Plan

1. Fixture first: edit `plugins/sp/tests/fixtures/pi-session.jsonl` (R4) and rewrite the 1138
   injected-body tests in `plugins/sp/tests/session-timeline.test.ts` (~lines 252, 291-320) to AC1-AC4.
   Run `(cd plugins/sp && bun test tests/session-timeline.test.ts)` → red.
2. Implement the Design change in `plugins/sp/lib/transcript.ts` and `plugins/sp/scripts/session-timeline.ts`.
   Re-run → green; run `(cd plugins/sp && bun test tests/run-summary.test.ts)` unchanged-green.
3. Update the three prose owners (R5).
4. Regenerate twins: `superskill script convert sp session-timeline.ts && superskill script convert sp run-summary.ts`;
   `git diff --stat plugins/sp/scripts/*.mjs` shows only those two.
5. AC5 manual measurement against the named transcript; record segment count in `## Testing`.
6. `bun run spur-check` once; commit `fix(sp): segment pi skill invocations as operator prompts (1151)`.

### Root Cause

Task 1138 assumed pi delivers skill bodies as user messages (it has no `isMeta`) and classified every
user row starting `<skill name="` as injected. pi in fact records the **operator's** `/skill` invocation
in that wrapper shape — the skill body is expanded into the wrapper and the arguments follow
`</skill>` — and does not inject bodies as separate user rows (census in Background). The prefix test
therefore discards exactly the prompts that start each batch.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
