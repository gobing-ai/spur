---
schema_version: 1
name: session-timeline must measure the pi host transcript so the review skill's time and token contract is available on pi
status: done
template: feature-impl
created_at: 2026-10-09T05:34:59.326Z
updated_at: "2026-10-10T00:08:16.241Z"
feature_id: E5

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "true"
done_reason: "AC4 conditional: bun run build:scripts passes and the suite is 10721/0, but bun run spur-check cannot exit 0 because of 20 pre-existing no-scratch-verdict-pointer findings in docs/tasks4/* and docs/tasks5/*. Reproduced at the pre-1138 base 0304f3830 in an untouched worktree, so unrelated to 1138; owned by task 1141 (rule: durable records must not cite run scratch), whose batch is running concurrently in another worktree. Verdict rows: R1-R5 MET, AC1-AC3 MET, AC4 PARTIAL."
---

## 1138. session-timeline must measure the pi host transcript so the review skill's time and token contract is available on pi

### Background

**Origin.** Found while running this session's review (`sp-dev-review-session --triage`, 2026-10-08): the review protocol requires the time/token table to come from `session-timeline.mjs`, and on the pi host it cannot produce one.

**Observed behaviour (verbatim, pi session `01a11d1c-f88c-76a7-81a7-896de0295d30`).**
1. Without a host session id the script reports that it has none:
   `{"available":false,"reason":"no host session id (CLAUDE_CODE_SESSION_ID); pass --transcript <path>"}` — pi does not set `CLAUDE_CODE_SESSION_ID`.
2. Passed the pi transcript explicitly, it reports **success with zero segments**:
   `{"available":true,"segments":[],"totals":{…all zero…},"skippedLines":0,"transcript":"…/2026-10-08T20-03-20-333Z_01a11d1c-….jsonl"}`
   i.e. a *false available*: the review skill renders `n/a` only when the measurement says `available:false` or omits a value, so this shape would print an authoritative-looking all-zero timeline for a session with ~1 100 messages.

**Root causes (read from `/Users/robin/.agents/scripts/sp/session-timeline.mjs`, generated from `plugins/sp/scripts/session-timeline.ts`).**
- **Schema**: `promptText(row)` (`session-timeline.mjs:37`) requires `row.type === "user"` and reads `row.message.content` with `isMeta`/`isCompactSummary` flags — the Claude Code transcript shape. A pi transcript has **no `type:"user"` rows**: operator and injected messages arrive as `type:"message"` with `message.role` (`user` / `assistant` / `toolResult` / `system`). This session's transcript row census: `message 1096` (542 assistant, 544 toolResult, 8 user, 2 system), `custom 248`, `compaction 2`, `context_edit 3`, `session_info 5`, `model_change 3`, `thinking_level_change 2`. So the segment scanner finds no prompt boundary at all — hence `segments: []` and `skippedLines: 0` (nothing was even counted as skipped).
- **Usage naming**: the script's token model is `input, cacheCreate, cacheRead, output`; pi's assistant rows carry `{input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost}` (sample: `{"input":67749,"output":472,"cacheRead":0,"cacheWrite":0,"reasoning":390,"totalTokens":68221,"cost":{…all zero…}}`). `cacheWrite` must map to `cacheCreate`; `reasoning` is already inside `output` for pi and must not be double-counted; `cost` stays outside the token contract (the review skill's token cells are session counts, not the 0912 USD claims).
- **Prompt classification**: two of the eight `role:"user"` rows in this session are **skill-injected bodies** (`<skill name="sp-dev-run" location="…">…` and `<skill name="sp-dev-review-session" …>`), while the operator's own prompts are plain text (`continue`, `1, please comfirm whether we can remove branch …`). Segmenting on `role:"user"` alone would manufacture six phantom segments (skill bodies, and each `continue`) and mis-attribute the wait time. The skill's own contract is explicit that wait is *operator* wait — so the classifier needs a rule for injected bodies, and pi offers no `isMeta` to key on.
- **Fail-safe direction**: the review skill renders `n/a` only for an explicit unavailability, so the script must report `available:false` **with a reason** whenever it recognises no segments in a transcript that clearly has turns.

**Why it matters.** `sp-dev-review-session` / `sp-session-review` is a supported surface on six hosts including pi; its time/token table is one of its two evidence planes, and the 0912 baseline diagnostics (F1/F2/F4) are drawn from exactly this measurement. On pi the table is silently zero, which is worse than absent: it looks measured. This session had to fall back to artifact timestamps (run row span, gate-receipt `durationMs`, dispatch durations), which is a different and lossier plane.

**Observation from the H1 batch (2026-10-08, pi host).** Running
`session-timeline.mjs --transcript <pi session jsonl>` returns
`{"available":true,"segments":[],"totals":{"workMs":0,"waitMs":0,"toolCalls":0,"tokens":{…all 0…}},
"skippedLines":0}` — the measurement reports itself *available* while parsing nothing, so the review
skill's time/token contract renders as a silent zero instead of the `{"available":false,"reason":…}`
R5 prescribes. The reviewed session was ≈11.7 h of one pi transcript with hundreds of rows.

**Session evidence (2026-10-09), reproduced while reviewing the session that filed this task.** (a) The review skill's documented invocation — `node scripts/session-timeline.mjs --group "..."`, with no `--transcript` — returns `{"available":false,"reason":"no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl)"}` on this pi host, so the measurement ran only with an explicit transcript path. (b) The segment list opened a segment for each skill-injection body: segment 1's prompt is the `<skill name="sp-dev-runall" …>` wrapper and segment 10's is the `<skill name="sp-dev-review-session" …>` wrapper, which is the R3 case in live data.

**Refine corrections (2026-10-09)**

**Most of the original scope shipped with task 1130 (done).** The task is narrowed to the residue.

What 1130 already delivered, in `plugins/sp/lib/transcript.ts`, `plugins/sp/scripts/session-timeline.ts` and `plugins/sp/tests/session-timeline.test.ts` (pi block at `:245-286`):
- pi schema detection (`sniffFormat`, `transcript.ts:169-175`);
- pi prompt and tool parsing (`promptText` at `:78-86`, `accumulate` at `:121-145`);
- usage mapping `cacheWrite → cacheCreate` with `reasoning` not added (`:135-140`);
- `compaction` counting (`:146`);
- a zero-segment result reported as `available:false` (`session-timeline.ts:151-153`);
- a committed pi fixture (`plugins/sp/tests/fixtures/pi-session.jsonl`).

Old R1, R2, R4, R6 (pi half) and most of R5 are therefore met and are removed.

What is still open, verified on the current tree:
1. **Old R8: the pi session is not resolved from the environment.** `resolveTranscript` (`transcript.ts:202-221`) reads only `CLAUDE_CODE_SESSION_ID`. pi exports `PI_SESSION_FILE` and `PI_SESSION_ID` into its bash tool env (`@earendil-works/pi-coding-agent/dist/core/tools/bash.js:137-147`), so the documented no-arg invocation fails on pi. The resolver is shared with `run-summary.ts:220`, so one fix covers both scripts, including 1146's summary.
2. **Old R3: injected skill bodies still open segments on pi.** `promptText` returns the text of every `role:"user"` row, including `<skill name="…">` wrappers. The fixture has no such row, so nothing tests it.
3. **The R5 reason is generic.** It says `unrecognized transcript format` even when the format was detected as `pi` and only prompts were missing, so the operator cannot tell a schema miss from an empty session.

### Requirements

- [x] R1. **Resolve the pi transcript from the environment.** In `resolveTranscript` (`plugins/sp/lib/transcript.ts`), the order is:
  1. an explicit `--transcript` override;
  2. `CLAUDE_CODE_SESSION_ID` (unchanged);
  3. `PI_SESSION_FILE` when it is set and exists.

  When `PI_SESSION_FILE` is set but missing on disk, the result is `{ok:false, reason:"PI_SESSION_FILE <path> does not exist"}`. `PI_SESSION_ID` is not used for lookup, because pi's session-file name is not derivable from the id alone. The change is shared, so `run-summary` gains it with no edit of its own.
- [x] R2. **Injected bodies do not open segments.** A `role:"user"` pi row whose first text block, after leading whitespace, starts with `<skill name="` is injected. It is accumulated into the open segment as activity, does not open a segment, and is counted in a new top-level `injectedPrompts` number on the timeline. Operator text that merely contains `<skill` later in the body is still a prompt. Claude rows are unchanged: their injected bodies already arrive as `isMeta`.
- [x] R3. **The unavailable reason names what was detected.** For zero segments the reason is:
  - `"pi transcript with no operator prompts (<n> rows, <k> injected)"` when the format is known;
  - `"unrecognized transcript format (row types: <top-5 type census>)"` when the format is `unknown`.

  The census uses `row.type` counts from the parsed rows.
- [x] R4. **Fixtures and tests.**
  - Extend `plugins/sp/tests/fixtures/pi-session.jsonl` with one `<skill name="sp-dev-run" …>` user row and one operator prompt containing `<skill` mid-text.
  - Assert: the segment count is unchanged by the injected row; `injectedPrompts` is 1; the mid-text prompt opens a segment.
  - Add tests for R1: `PI_SESSION_FILE` resolves; a missing file gives the named reason; the Claude id still wins when both are set.
  - Add tests for both R3 reasons.
  - Each test must be shown to fail before its fix.
- [x] R5. **Docs and generated parity.**
  - `plugins/sp/skills/session-review/SKILL.md:93` and `plugins/sp/commands/dev-review-session.md` state that pi resolves via `PI_SESSION_FILE`.
  - The no-host-id reason in `transcript.ts:212` names `PI_SESSION_FILE`.
  - `bun run build:scripts` regenerates the `.mjs` files; the installed copy refreshes through `superskill install`, never by hand.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A pi session resolves from PI_SESSION_FILE (req: R1)
  Given an environment with PI_SESSION_FILE pointing at an existing pi transcript and no Claude session id
  When session-timeline and run-summary run without --transcript
  Then both measure that transcript
  And with PI_SESSION_FILE pointing at a missing path the result is available false naming that path
  And when a Claude session id is also set the Claude transcript is resolved
```

```gherkin
Scenario: AC2 — A skill-injected body is counted, not segmented (req: R2)
  Given the pi fixture with one skill-injected user row and one operator prompt containing "<skill" mid-text
  When the timeline is built
  Then the injected row opens no segment and injectedPrompts is 1
  And the mid-text operator prompt opens its own segment
```

```gherkin
Scenario: AC3 — Zero-segment results say what was detected (req: R3)
  Given a pi transcript containing only assistant and toolResult rows
  When session-timeline runs on it
  Then the result is available false with a reason naming the pi format and the row count
  And an unknown-format file yields a reason listing its row-type census
```

```gherkin
Scenario: AC4 — Tests fail without fixes and docs match (req: R4, R5)
  Given the new tests
  When each fix is reverted
  Then the corresponding test fails
  And with fixes in place "bun run spur-check" and "bun run build:scripts" pass
  And the session-review skill names PI_SESSION_FILE resolution
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:12:09.555Z

- **Q: What happens to the original R1, R2, R4, R6 and R7?** A (closed 2026-10-09): they shipped with 1130 (see Refine corrections) and were removed rather than re-implemented. The fixture-based tests at `session-timeline.test.ts:245-286` are their evidence.
- **Q: Should resolution also use `PI_SESSION_ID`?** A: no. pi's session file is named `<iso-timestamp>_<id>.jsonl`, so a lookup by id needs a directory scan and a cwd-slug guess. `PI_SESSION_FILE` is exact and is always set alongside the id.
- **Q: What about other injected wrappers, such as `<command …>`?** A: only `<skill name="` is observed on pi. Widen the rule only when a transcript shows another shape. `injectedPrompts` makes such a miss visible.

### Design

- **`transcript.ts`.**
  - In `resolveTranscript`, after the Claude-id branch fails for lack of an id, try `env.PI_SESSION_FILE` with `existsSync`.
  - Add `isInjectedPrompt(row)` (pi-only `<skill name="` prefix test). `promptText` returns `undefined` for injected rows. The caller counts them by calling `isInjectedPrompt` before `promptText`.
- **`session-timeline.ts`.**
  - In `buildTimeline`, count injected rows and `accumulate` them into the open segment.
  - Add `injectedPrompts` to `Timeline` only when `format === 'pi'`, as `compactions` is emitted only for pi, so Claude output is unchanged.
  - `main` builds the R3 reason from `format`, the row count and a type census. `parseRows` already returns the rows.
- **Boundaries.**
  - No new flags.
  - No change to the aggregation math.
  - `run-summary` needs no edit beyond inheriting R1.
  - `node:*` imports only (plugin standalone contract).
- **Failure inventory (tests first).**
  - An injected row dropped instead of accumulated, which loses its tool and usage time.
  - Mid-text `<skill` misclassified.
  - `PI_SESSION_FILE` taking precedence over an explicit `--transcript`.
  - The Claude output gaining a new field, which breaks `session-timeline.test.ts:281`.

### Plan

1. Extend the fixture and write the R4 tests. Confirm they fail.
2. R1: change `resolveTranscript` and the reason text.
3. R2: add `isInjectedPrompt` and the `injectedPrompts` counter.
4. R3: add the reason builder.
5. R5: update the docs and run `bun run build:scripts`.
6. Acceptance drill. In a pi session, run `node "$(superskill script path sp session-timeline.mjs)"` with no arguments and record the populated output.
7. Run `bun run spur-check`.

### Solution

| Change | Location | Why |
| --- | --- | --- |
| `resolveTranscript` resolves `PI_SESSION_FILE` after the Claude id | `plugins/sp/lib/transcript.ts:222` | pi sets `PI_SESSION_FILE` and no `CLAUDE_CODE_SESSION_ID`, so the documented invocation measured nothing; a missing file names itself |
| `isInjectedPrompt` — a pi `role:"user"` row whose first text block opens with `<skill name="` | `plugins/sp/lib/transcript.ts:102` | pi has no `isMeta`, so skill wrappers manufactured phantom segments and mis-attributed wait |
| `promptText` returns `undefined` for an injected row | `plugins/sp/lib/transcript.ts:78` | one predicate, so every consumer agrees |
| `buildTimeline` counts and accumulates injected rows without opening a segment | `plugins/sp/scripts/session-timeline.ts:83` | the injected body's tools and usage are real work; only operator prompts segment |
| `Timeline.injectedPrompts`, emitted for pi only | `plugins/sp/scripts/session-timeline.ts:44` | makes a missed injection shape visible instead of silent |
| `zeroSegmentReason` — detected format + row/injected counts, or a top-5 type census | `plugins/sp/scripts/session-timeline.ts:145` | the review renders `n/a` only on an explicit unavailability, so a false `available:true` printed an authoritative all-zero timeline |
| `main` uses the reason builder and parses the rows once | `plugins/sp/scripts/session-timeline.ts:193` | the census needs the parsed rows, which `parseRows` already returns |

Tradeoff: `injectedPrompts` is a new optional field on the pi timeline only, so Claude output is byte-unchanged (same rule as `compactions`). `resolveTranscript` gains a third source, so a stale `PI_SESSION_FILE` now yields a named reason instead of the generic no-host-id one — a strictly more specific failure.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/lib/transcript.ts:233` resolves PI_SESSION_FILE after the Claude id and names a missing file (`plugins/sp/lib/transcript.ts:237`); `plugins/sp/tests/session-timeline.test.ts` 37 pass; mutant (branch disabled) → 2 fail, this run |
| R2 | MET | `plugins/sp/lib/transcript.ts:102` isInjectedPrompt; `plugins/sp/scripts/session-timeline.ts:83` counts and accumulates; mutant (predicate false) → 2 fail, this run |
| R3 | MET | `plugins/sp/scripts/session-timeline.ts:145` zeroSegmentReason; mutant (always unknown) → 1 fail, this run |
| R4 | MET | `plugins/sp/tests/fixtures/pi-session.jsonl` injected + mid-text rows; `bun test tests/session-timeline.test.ts` 37 pass / 0 fail this run; all three mutants killed |
| R5 | MET | `plugins/sp/skills/session-review/SKILL.md:98`, `plugins/sp/commands/dev-review-session.md:20`, `docs/design/session-review.md:59` name PI_SESSION_FILE; `bun run build:scripts` exit 0 this run with zero git drift in `.mjs` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A pi session resolves from PI_SESSION_FILE (req: R1) | MET | test | `plugins/sp/tests/session-timeline.test.ts` PI_SESSION_FILE cases, 37 pass this run; run-summary shares `resolveTranscript` (`plugins/sp/scripts/run-summary.mjs:171`) |
| AC2 — A skill-injected body is counted, not segmented (req: R2) | MET | test | `plugins/sp/tests/session-timeline.test.ts` injected-row cases, 37 pass this run |
| AC3 — Zero-segment results say what was detected (req: R3) | MET | test | `plugins/sp/tests/session-timeline.test.ts` reason cases, 37 pass this run |
| AC4 — Tests fail without fixes and docs match (req: R4, R5) | MET | command | mutants killed (2/2/1) and `bun run build:scripts` exit 0 this run; operator-run unsandboxed `bun run gate` (format + spur-check) this turn: lint/typecheck clean, 51 pre-check rules pass, 10734 pass / 0 fail across 629 files, 2 post-check rules pass; `plugins/sp/scripts/session-timeline.ts` 100% lines |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No findings (verify verdict PASS) |

Residual risk:

- **The injected-body rule is narrow by design.** Only a first text block starting with
  `<skill name="` (after leading whitespace) is treated as injected. Another wrapper shape
  (`<command …>`, a future injection form) still segments. The task's Q&A decided to widen only on
  observed evidence, and `injectedPrompts` makes a miss visible rather than silent.
- **A one-word operator prompt stays a prompt.** `continue` opens a segment and carries that
  session's work time; only skill bodies were excluded. This is R2's literal contract, and it keeps
  genuinely short operator turns attributable rather than folding them into a neighbour.
- **`PI_SESSION_FILE` is preferred only when no Claude id is present.** A stale `PI_SESSION_FILE`
  alongside a valid Claude id is ignored, so the Claude transcript wins (asserted).
- **`bun run spur-check` cannot go green on this base** — 20 pre-existing
  `no-scratch-verdict-pointer` findings in `docs/tasks4/*` and `docs/tasks5/*`, reproduced at the
  pre-change base `0304f3830`. Reported, not fixed: repairing 20 unrelated task files is outside this
  task and the invoking tree is being written by another session.
- **Machine contention.** At load ~10 one unrelated fleet test timed out at bun's 5 s default; it
  passes 13/13 in isolation and the suite is green with only the per-test timeout raised.

Untested paths: the acceptance drill measured this live pi session, so the pi path is exercised on
real data; the Claude half of R1 (id precedence) and the unknown-format census are covered by unit
tests on synthesised files, not by a real Claude transcript or a real unrecognised file.

### References

- Shipped base: task 1130. Code: `plugins/sp/lib/transcript.ts:78-221`, `plugins/sp/scripts/session-timeline.ts:68-160`, `plugins/sp/scripts/run-summary.ts:220`. Tests: `plugins/sp/tests/session-timeline.test.ts:245-286`. Fixture: `plugins/sp/tests/fixtures/pi-session.jsonl`.
- pi env export: `@earendil-works/pi-coding-agent/dist/core/tools/bash.js:137-147` (`PI_SESSION_ID`, `PI_SESSION_FILE`).
- Docs: `plugins/sp/skills/session-review/SKILL.md:93`, `plugins/sp/commands/dev-review-session.md:18`.
- Consumer: task 1146 (the execution summary reuses `resolveTranscript`).

### History

- 2026-10-09T05:36:13.650Z backlog → todo (system)
- 2026-10-09T21:46:41.064Z todo → wip (system)
- 2026-10-09T23:21:57.921Z wip → testing (system)
- 2026-10-09T23:22:19.150Z testing → done (system)

