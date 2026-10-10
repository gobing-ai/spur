---
schema_version: 1
name: Session-timeline must segment operator skill invocations on pi, not count them as injected bodies
status: done
template: issue
created_at: 2026-10-10T02:49:17.069Z
updated_at: "2026-10-10T17:02:40.747Z"
feature_id: E5

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1151-verdict.json
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

**Refine corrections (2026-10-10)**
- Shared predicate/promptText still discard pi wrapper rows (now transcript.ts:92/116); current callers are session-timeline.ts and lib/run-summary-core.ts:323, not a direct run-summary.ts:130 call. Update the actual shared consumer and regenerate its script bundle.
- Historic census is reported evidence, not proof about every future pi version. The task freezes the current protocol rule: pi user wrappers are operator invocations; Claude isMeta handling remains separate.
- Named local transcript exists but has grown to 15 user rows (four wrapper-containing rows in a coarse count), so the fixed twelve-segment AC is stale. Replace it with a timestamped eligible-user-row oracle and committed deterministic fixtures.
- run-summary token accounting should remain unchanged, but prompt reclassification can affect span endpoints; test both window boundary and token behavior rather than assuming the entire sibling output is unchanged.

### Requirements

- [x] R1. **Every pi skill invocation opens a segment.** A pi `role:"user"` row whose first text block,
  after leading whitespace, opens with `<skill name="X"` is an operator prompt. Its segment prompt is
  `/X` followed by the trimmed text after the last `</skill>` when non-empty (e.g.
  `/sp-dev-runall --tasks 1135,1142 --auto …`), else `/X` alone. The wrapper body never appears in the
  prompt excerpt.
- [x] R2. **Delete the injected-body class.** Remove `isInjectedPrompt` (`lib/transcript.ts`), the
  pi-only `injectedPrompts` timeline field and its counter (`session-timeline.ts:44,78-87,128`), and
  the `, N injected` fragment of the zero-segment reason (`session-timeline.ts:160-161`). Claude output
  is unchanged (it never had the field).
- [x] R3. **The argument-less decision is recorded** in Q&A and in the `promptText` doc comment: an
  argument-less wrapper is an operator invocation (census evidence above), rendered `/X`.
- [x] R4. **Fixture and pins reflect real shapes.** In `plugins/sp/tests/fixtures/pi-session.jsonl`,
  replace the synthetic body-only row (`new00002`) with a real-shaped invocation
  (`<skill name="sp-dev-run" location="/x/SKILL.md">\nbody\n</skill>\n\n--triage`) and add one
  argument-less wrapper row. The 1138 "injected skill body is counted, never segmented" tests are
  replaced (they pinned the wrong behaviour), the segment-count assertions are updated to the new
  count, and the "operator note … `<skill name=` later in the body" row still segments as plain text.
- [x] R5. **Prose owners follow.** Update the injected-body sentences in
  `plugins/sp/skills/session-review/SKILL.md:105`, `plugins/sp/commands/dev-review-session.md:21`, and
  `docs/design/session-review.md:62-66` to the invocation rule.
- [x] R6. **Sibling consumer and twins.** `run-summary` tests preserve token totals and correctly exclude user prompts from accumulation; add a window-boundary regression if existing coverage does not observe it; regenerate both twins with
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
  Then the segment count equals the independently counted timestamped pi user rows with a first text block or string content in that captured input
  And every well-formed wrapper row has a /<name> prompt, with no body excerpt
  And the captured input hash and observation time are recorded without persisting private transcript content
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

#### Q&A entry — 2026-10-10T16:25:08.901Z

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
- Closed in this review: twelve is a stale real-data count; use an independently counted hashed capture and deterministic committed fixture.
- Closed: run-summary-core is the current caller; preserve token totals and test prompt/window timing semantics explicitly. No new command or public flag is needed.

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

**Frozen parser details / callers.** Normalize only pi type:message + role:user. Support string content and first type:text array block; inspect text.trimStart() for the anchored complete quoted name. Use the last closing tag only if its index is nonnegative; if absent return /<name> alone. Empty/whitespace suffix yields /<name>; malformed name stays plain text. Preserve existing excerpt truncation after normalization. Test leading whitespace, strings/blocks, argument-less, missing close, malformed quote, repeated close and mid-body mention explicitly. Do not inspect Claude wrappers through the pi path.

**Scope and observability.** The shared promptText has two current consumers: session-timeline.ts and lib/run-summary-core.ts (imported by run-summary.ts). Remove injectedPrompts from type, serialization and unavailable reason; update the pi fixture and downstream hardcoded segment/work/wait assertions based on timestamps, and assert total tool/token accounting remains conserved. For run-summary, assert a wrapper at the end of a selected window is treated like other user prompts: excluded from accumulate, with unchanged token totals. Update only the three named prose owners via the docs owner process; do not modify broader governance.

**Real-data acceptance.** AC5 uses an independent count of parseable timestamped user rows with string/first text content, not a constant or the implementation predicate itself. Snapshot metadata/hash only; never commit a private full transcript. If the file is unavailable at implementation, record that limitation and use the committed fixture as the required reproducible gate; do not fabricate a twelve-row result. For this refinement the file exists.

**Generated surfaces.** Use superskill script convert sp session-timeline.ts --json and superskill script convert sp run-summary.ts --json from this checkout, verify outputs land under plugins/sp/scripts, run script-contract and standalone smoke checks. Do not manually patch generated .mjs. No new API or CLI flags; the removal of the internal pi-only injectedPrompts output property is intentional, all current code/prose consumers identified. No logical sibling dependency; 1159 owns unrelated ledger session cleanup.

### Plan

1. Fixture first: edit `plugins/sp/tests/fixtures/pi-session.jsonl` (R4) and rewrite the 1138
   injected-body tests in `plugins/sp/tests/session-timeline.test.ts` (~lines 252, 291-320) to AC1-AC4.
   Run `(cd plugins/sp && bun test tests/session-timeline.test.ts)` → red; include the parser edge cases and conserved token/tool totals listed in Design.
2. Implement the Design change in `plugins/sp/lib/transcript.ts` and `plugins/sp/scripts/session-timeline.ts`.
   Re-run → green; run `(cd plugins/sp && bun test tests/run-summary.test.ts)` with a prompt-window boundary pin and unchanged token assertions.
3. Update the three prose owners (R5).
4. Regenerate twins: `superskill script convert sp session-timeline.ts && superskill script convert sp run-summary.ts`;
   `git diff --stat plugins/sp/scripts/*.mjs` shows only those two.
5. AC5 manual measurement against a hashed capture of the named transcript; compare to the independent eligible-user oracle and record segment count in `## Testing`.
6. `bun run spur-check` once; commit `fix(sp): segment pi skill invocations as operator prompts (1151)`.

### Root Cause

Task 1138 assumed pi delivers skill bodies as user messages (it has no `isMeta`) and classified every
user row starting `<skill name="` as injected. pi in fact records the **operator's** `/skill` invocation
in that wrapper shape — the skill body is expanded into the wrapper and the arguments follow
`</skill>` — and does not inject bodies as separate user rows (census in Background). The prefix test
therefore discards exactly the prompts that start each batch.

### Solution

Reclassified the pi `<skill name="X">` user row: it is the operator's own `/skill` invocation, not a skill-injected body, so it now opens an operator segment rendered `/X <args>` (or `/X` with no arguments). The pi-only `injectedPrompts` class and its counter are deleted.

Change map (one anchor per row):

| file:line | What changed |
| --- | --- |
| `plugins/sp/lib/transcript.ts:101` | `promptText`: the pi user branch no longer drops wrapper rows — it returns `skillInvocationPrompt(text) ?? text`, so a wrapper becomes `/X <args>` and every other row is unchanged. |
| `plugins/sp/lib/transcript.ts:117` | `firstTextContent`: the string-or-first-`type:text`-block read extracted so the pi branch and the wrapper detector cannot disagree on what "the text" is. |
| `plugins/sp/lib/transcript.ts:133` | `skillInvocationPrompt`: the anchored `^\s*<skill name="([^"]+)"` detector; arguments are the text after the LAST `</skill>` (a body may quote the tag), a missing closing tag renders `/X` alone, a malformed name is not a wrapper. `isInjectedPrompt` is deleted. |
| `plugins/sp/scripts/session-timeline.ts:35` | `Timeline`: the pi-only `injectedPrompts?: number` field is removed — it could never be non-zero (pi injects no user-row bodies) and read as misleading evidence. |
| `plugins/sp/scripts/session-timeline.ts:71` | `buildTimeline`: the injected-body branch, its counter and the conditional field spread are deleted; the loop is back to prompt-vs-activity only, so a wrapper row opens a segment like any operator prompt. |
| `plugins/sp/scripts/session-timeline.ts:132` | `zeroSegmentReason`: the `, N injected` fragment is dropped; the reason names the format and the row count (unknown formats keep the top-5 row-type census). |
| `plugins/sp/tests/fixtures/pi-session.jsonl` | The synthetic body-only row is replaced by a real-shaped invocation (`… </skill>\n\n--triage`), an argument-less `rd3-anti-hallucination` wrapper row is added, and an assistant activity row keeps each new segment's span measurable. |
| `plugins/sp/tests/session-timeline.test.ts:309` | The 1138 tests that pinned the wrong behavior (injected body counted, never segmented) are replaced by AC1-AC4: invocation rendering, argument-less rendering, the deleted class (field + reason + a source scan of `plugins/sp/lib` and `plugins/sp/scripts`), the unaffected mid-body mention, and explicit parser edges (leading whitespace, string content, missing/repeated/malformed closing tags, non-user role, Claude rows). |
| `plugins/sp/tests/run-summary.test.ts:551` | The sibling consumer regression: a wrapper row on the implement window's END boundary is classified as a prompt and the windowed summary (`rows`, `total`) is identical with and without it — token accounting conserved (R6). |
| `plugins/sp/skills/session-review/SKILL.md:105` | Prose owner: the transcript note now states the wrapper row is the operator's invocation, rendered `/<name> <args>`. |
| `plugins/sp/commands/dev-review-session.md:21` | Prose owner: same correction in the command's measurement note. |
| `docs/design/session-review.md:63` | Prose owner: the design owner's transcript paragraph replaces the injected-body sentences and the "injected counts" zero-segment wording. |
| `plugins/sp/scripts/session-timeline.mjs` | Regenerated twin (`superskill script convert sp session-timeline.ts`). |
| `plugins/sp/scripts/run-summary.mjs` | Regenerated twin (`superskill script convert sp run-summary.ts`). |
| `plugins/sp/scripts/inline-run-setup.mjs` | Regenerated twin: it bundles `lib/transcript.ts`, so the deleted helper would otherwise survive in `plugins/sp/scripts` (AC3). |

Rationale: the prefix test (`startsWith('<skill name="')`) discarded exactly the prompts that start every batch. pi has no `isMeta`, but it also never injects skill bodies as user rows — a 2,452-row census found none, and the only body-only row in the fixture was synthetic. The class therefore had no true positives on pi and was deleted rather than kept as an always-zero field.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/lib/transcript.ts:101` routes a pi user row through `skillInvocationPrompt` (`:133`), which returns `/X` plus the trimmed text after the LAST `</skill>`; `plugins/sp/tests/session-timeline.test.ts:309` pins the invocation, argument-less and seven parser-edge cases |
| R2 | MET | `isInjectedPrompt` is deleted from `plugins/sp/lib/transcript.ts`; the `injectedPrompts` field, counter and reason fragment are removed at `plugins/sp/scripts/session-timeline.ts:35,71,132`; three `.mjs` twins regenerated so no copy survives under `plugins/sp/scripts` (AC3 source scan) |
| R3 | MET | The argument-less decision is recorded in the `promptText` doc comment at `plugins/sp/lib/transcript.ts:94` and in the task Q&A; `plugins/sp/tests/session-timeline.test.ts:322` pins `/rd3-anti-hallucination` |
| R4 | MET | `plugins/sp/tests/fixtures/pi-session.jsonl` replaces the synthetic body-only row with a real-shaped `--triage` invocation, adds the argument-less wrapper row and keeps the mid-body-mention row as plain text, pinned at `plugins/sp/tests/session-timeline.test.ts:333` |
| R5 | MET | `plugins/sp/skills/session-review/SKILL.md:105`, `plugins/sp/commands/dev-review-session.md:21`, `docs/design/session-review.md:63` all state the invocation rule; `grep injectedPrompts` over the three owners returns nothing |
| R6 | MET | `plugins/sp/tests/run-summary.test.ts:551` pins the sibling consumer's conserved windowed totals; `session-timeline.mjs`, `run-summary.mjs`, `inline-run-setup.mjs` regenerated via `superskill script convert`; `bun run script-contract-check` reports 23 scripts baselined, 0 violations |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A skill invocation with arguments becomes an operator segment (req: R1) | MET | test | `plugins/sp/tests/session-timeline.test.ts:319` asserts the fixture invocation segment renders `/sp-dev-run --triage` and contains neither `body` nor `<skill`; `(cd plugins/sp && bun test tests/session-timeline.test.ts)` 39 pass / 0 fail |
| AC2 — An argument-less wrapper is still an operator segment (req: R1, R3) | MET | test | `plugins/sp/tests/session-timeline.test.ts:322` asserts `/rd3-anti-hallucination` for the added argument-less fixture row |
| AC3 — The injected-body class is gone (req: R2) | MET | test | `plugins/sp/tests/session-timeline.test.ts:326` asserts no `injectedPrompts` field, no `injected` fragment in the zero-segment reason, and no `isInjectedPrompt` token in any `.ts`/`.mjs` under `plugins/sp/lib` or `plugins/sp/scripts` |
| AC4 — Plain operator text mentioning <skill is unaffected (req: R4) | MET | test | `plugins/sp/tests/session-timeline.test.ts:333` keeps the `operator note: the <skill name="x"> wrapper above is injected…` fixture row verbatim as a segment prompt |
| AC5 — Real transcript attributes every prompt (req: R1) | MET | command | `bun plugins/sp/scripts/session-timeline.ts --transcript <snapshot>` on the hashed 2026-10-09 capture (sha256 `f0a4c78d4c6d064d438ec5e43ca44fa95518cda3fb29ad499c4a1d2043d839af`, observed 2026-10-10T16:45:42Z) yields 15 segments equal to the independent timestamped-eligible-user-row oracle (15), with 0 wrapper body leaks and 4 `/`-rendered invocations; this session's capture (`30673e29…`) yields 1 = 1 and renders `/sp-dev-runall --tasks 1155,1160,1161,1164,1153,1151,1165 --agent inline --auto …` |
| AC6 — Twins and sibling stay consistent (req: R6) | MET | command | `bun run script-contract-check` PASS (23 baselined, 0 violations); `(cd plugins/sp && bun test tests/session-timeline.test.ts tests/run-summary.test.ts)` 61 pass / 0 fail; `node plugins/sp/scripts/session-timeline.mjs --transcript <fixture>` produces the same five prompt renderings as the `.ts` entry |
| AC7 — Prose owners describe the invocation rule (req: R5) | MET | command | `grep -n injectedPrompts plugins/sp/skills/session-review/SKILL.md plugins/sp/commands/dev-review-session.md docs/design/session-review.md` returns no match (exit 1); each of `plugins/sp/skills/session-review/SKILL.md:105`, `plugins/sp/commands/dev-review-session.md:21`, `docs/design/session-review.md:63` states the wrapper row is the operator's invocation rendered `/<name> <args>` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1151
**Scope:** 1151 diff (12 files: `plugins/sp/lib/transcript.ts`, `plugins/sp/scripts/session-timeline.ts`, `plugins/sp/tests/{session-timeline,run-summary}.test.ts`, `plugins/sp/tests/fixtures/pi-session.jsonl`, three regenerated `.mjs` twins, three prose owners)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | testing | The sibling `run-summary` regression pins invariance plus a direct classification assertion; a pi user row carries no usage or tool calls, so the windowed summary cannot distinguish prompt from activity on its own — the fail-before pins live in `session-timeline.test.ts` | `plugins/sp/tests/run-summary.test.ts:551` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/lib/transcript.ts:101` (`promptText` → `skillInvocationPrompt`), `:133` (last-`</skill>` argument slice, missing-close → `/X`); pinned by `plugins/sp/tests/session-timeline.test.ts:309` (invocation + argument-less + parser edges) |
| R2 | MET | `isInjectedPrompt` deleted (`plugins/sp/lib/transcript.ts`), `injectedPrompts` field/counter removed (`plugins/sp/scripts/session-timeline.ts:35,71`), reason fragment removed (`:132`); three twins regenerated so no copy survives in `plugins/sp/scripts` — pinned by the AC3 source scan |
| R3 | MET | Argument-less decision recorded in the `promptText` doc comment and in the task Q&A; pinned by the `rd3-anti-hallucination` fixture row |
| R4 | MET | `plugins/sp/tests/fixtures/pi-session.jsonl` — real-shaped `--triage` invocation replaces the synthetic body-only row, argument-less wrapper row added, `new00001` mid-body mention still segments |
| R5 | MET | `plugins/sp/skills/session-review/SKILL.md:105`, `plugins/sp/commands/dev-review-session.md:21`, `docs/design/session-review.md:63` — no `injectedPrompts`, each states the invocation rule |
| R6 | MET | `plugins/sp/tests/run-summary.test.ts:551`; `session-timeline.mjs` / `run-summary.mjs` / `inline-run-setup.mjs` regenerated via `superskill script convert`; `bun run script-contract-check` PASS (23 scripts, 0 violations) |

##### Acceptance Criteria Verification

All seven scenarios are task-local and were exercised in the implement stage: AC1 (invocation →
`/sp-dev-run --triage`), AC2 (argument-less → `/rd3-anti-hallucination`), AC3 (no field, no reason
fragment, no helper in `plugins/sp/lib` or `plugins/sp/scripts`), AC4 (mid-body mention unchanged),
AC5 (real transcript: independent timestamped-eligible-user-row oracle 15 = segments 15 on the
2026-10-09 capture, 1 = 1 on this session's capture; zero body leaks), AC6 (twin + sibling suites
green), AC7 (three prose owners clean).

##### Residual Risk

The pi wrapper rule is a protocol frozen from a 2,452-row census, not a guarantee about future pi
versions — the task's refinement records that explicitly and scopes a future structural marker to
its own task. No security, efficiency or architecture concern: the change is a read-only text
classification with one anchored regex plus a `lastIndexOf`, inside an existing deep module.

**Next:** proceed to verify.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 4.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T16:45:58.839Z todo → wip (system)
- 2026-10-10T17:02:23.602Z wip → testing (system)
- 2026-10-10T17:02:40.739Z testing → done (system)

