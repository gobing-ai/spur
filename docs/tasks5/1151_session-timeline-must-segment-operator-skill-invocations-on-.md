---
schema_version: 1
name: Session-timeline must segment operator skill invocations on pi, not count them as injected bodies
status: todo
template: issue
created_at: 2026-10-10T02:49:17.069Z
updated_at: "2026-10-10T02:49:49.859Z"
feature_id: E5

ac_altitude: task-local
ac_numbering: task-local
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

### Requirements

- [ ] R1. **An operator skill invocation opens a segment on pi.** A pi user message whose text is
  a `<skill name="…" …>…</skill>` wrapper **followed by non-whitespace text** is segmented like any
  other operator prompt, and that trailing text (the invocation's arguments) is the segment's prompt.
- [ ] R2. **An injected skill body is still never segmented.** A pi user message that is *only* the
  wrapper (no text after the closing tag) keeps counting in `injectedPrompts` and opens no segment —
  task 1138's AC2/R2 behaviour is preserved verbatim, and a Claude transcript's `injectedPrompts`
  stays absent.
- [ ] R3. **The no-argument case is decided, not guessed.** The rule states what it does with a
  `<skill …>` wrapper that carries no trailing arguments (today: injected), and the decision is
  recorded in the task's Q&A with its reasoning — a slash invocation with no arguments is
  indistinguishable from an injected body by text alone, so the choice must be explicit.
- [ ] R4. **Fixtures and pins cover both directions.** `plugins/sp/tests/fixtures/pi-session.jsonl`
  gains an invocation-shaped row (wrapper + trailing args) and the session-timeline suite asserts:
  the invocation opens a segment carrying its args, the body-only row does not, and the segment
  count/token accounting of the existing fixture rows is unchanged.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A skill invocation with arguments becomes an operator segment (req: R1)
  Given a pi transcript row whose user text is a skill wrapper followed by "--triage"
  When session-timeline builds the timeline
  Then that row opens a segment whose prompt contains "--triage"
  And it is not counted in injectedPrompts
```

```gherkin
Scenario: AC2 — An injected skill body stays injected (req: R2)
  Given a pi transcript row whose user text is only the skill wrapper
  When session-timeline builds the timeline
  Then it opens no segment
  And injectedPrompts includes it
  And a Claude transcript still reports no injectedPrompts field
```

```gherkin
Scenario: AC3 — The reviewed session's own transcript attributes every prompt (req: R1, R4)
  Given a transcript with five skill-invocation prompts and four plain prompts
  When session-timeline runs
  Then it reports nine segments
  And no prompt is counted as injected
```

```gherkin
Scenario: AC4 — The rule for a wrapper without arguments is documented (req: R3)
  Given the task's Q&A and the `isInjectedPrompt` doc comment
  Then both state the chosen behaviour for an argument-less wrapper
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- **The discriminator.** Text after the closing `</skill>` tag, trimmed and non-empty. Measured on
  this session: the invocation row ends `…</skill>\n\n--tasks 1135,1142 --auto --next --agent inline
  --worktree --wrap`; the 1138 fixture's injected row is `  <skill name="sp-dev-run"
  location="/x/SKILL.md">\ninjected body\n</skill>` with nothing after the tag.
- **Shape of the change.** One predicate in `isInjectedPrompt`
  (`plugins/sp/scripts/session-timeline.ts`) plus the segment's `prompt` extraction, which must yield
  the trailing argument text rather than the wrapper body — a wrapper-only row never reaches it.
- **Why the caveat matters (R3).** A slash invocation with no arguments carries nothing after the
  tag, so a pure suffix test would file it as injected. That is the current behaviour for that case
  and this task keeps it, but the decision is recorded rather than left implicit; distinguishing it
  would need a harness-side marker (a record field), which is a separate change.
- **Non-goals.** No change to the Claude Code path, to `injectedPrompts` semantics for body-only
  rows, or to token counting. No change to who owns the measurement contract (E5).
- **Failure inventory (write before code):** an invocation whose arguments are whitespace-only; a
  wrapper split across content blocks; a body-only row that nonetheless contains a stray `</skill>`
  in its text; a segment whose prompt must not include the wrapper body; a Claude row that happens to
  contain `<skill name=` (must not enter this branch at all).

### Plan

1. Write the failing fixture case first: add the invocation-shaped row to
   `plugins/sp/tests/fixtures/pi-session.jsonl` and assert the new segment + unchanged injected count.
2. Split the predicate: keep the prefix test for "looks like a wrapper", add the trailing-text rule,
   and extract the argument text as the segment prompt.
3. Record the argument-less-wrapper decision in the task Q&A and in the predicate's doc comment (R3).
4. Re-run `plugins/sp/tests/session-timeline.test.ts`, then `bun run spur-check` once.
5. Re-run this session's own review measurement against `$PI_SESSION_FILE` and record the segment
   count (9) in Testing.

### Root Cause

`isInjectedPrompt` classifies by prefix only:

```js
return typeof text === "string" && text.replace(/^\s+/, "").startsWith('<skill name="');
```

pi uses one record shape for both cases (`type: "message"`, `message.role: "user"`), so the prefix is
not a discriminator between a skill body the harness injected and a slash invocation the operator
typed. The harness appends the invocation's arguments after the wrapper's closing `</skill>`, which
the injected bodies do not carry — that suffix is what the prefix test ignores.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
