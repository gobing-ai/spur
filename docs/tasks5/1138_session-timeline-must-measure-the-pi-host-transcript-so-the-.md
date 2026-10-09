---
schema_version: 1
name: session-timeline must measure the pi host transcript so the review skill's time and token contract is available on pi
status: todo
template: feature-impl
created_at: 2026-10-09T05:34:59.326Z
updated_at: "2026-10-09T06:41:15.346Z"
feature_id: E5

ac_altitude: task-local
ac_numbering: task-local
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

### Requirements

- [ ] R1. **Parse the pi transcript schema in addition to the Claude one, with no new flag.** Recognise `type:"message"` rows with `message.role` and content blocks (`text`, `tool_use`, `tool_result`), and use `row.timestamp` (ISO) for boundaries exactly as the Claude path does. Auto-detect by row shape; `--transcript <path>` stays the only input surface.
- [ ] R2. **Map pi usage onto the existing token model correctly.** `cacheWrite` → `cacheCreate`; keep `cacheRead` as cache-read; do not double-count `reasoning` (it is already inside pi's `output`); ignore `cost` for token cells (it may be surfaced separately only if a caller asks). Verify the total = input + cacheCreate + cacheRead + output invariant and the `total / non-cached` rendering on a fixture.
- [ ] R3. **Segment on operator prompts only.** A skill-injected body must not open a segment: classify `role:"user"` rows whose content is a `<skill name=…>` wrapper (and the injected-command shapes the hosts use) as injected, and count them in the transcript's metadata rather than as segments. Operator wait stays the idle gap before the next operator prompt plus `AskUserQuestion` answer time, unchanged.
- [ ] R4. **Handle every observed row type explicitly and count what is skipped.** `custom`, `compaction`, `session_info`, `model_change`, `thinking_level_change`, `context_edit` must be recognised (skipped with a reason) rather than falling through, and `skippedLines` must be non-zero whenever unparseable content exists — the zero-segment case must never be reported as a successful measurement.
- [ ] R5. **Honest availability.** When a transcript yields no segments, or its schema is unrecognised, the result is `{"available":false,"reason":"…"}` naming the detected schema and what was missing — never `available:true` with an empty segment list. (`--help` keeps the current two-flag surface.)
- [ ] R6. **Fixture tests for both host shapes.** Committed fixtures: a Claude transcript and a pi transcript containing (a) three operator prompts including `continue`, (b) one skill-injected body, (c) one `compaction` row, (d) a fenced code block containing text that looks like a prompt, (e) assistant rows with pi's usage keys. Assertions: segment count and boundaries, work/wait split, token total and non-cached split, `skippedLines` behaviour, and the `available:false` path for an unrecognised schema.
- [ ] R7. **Docs and install parity.** The review skill's Protocol step 1 and the script's usage/known-hosts notes name the supported transcript schemas and the pi mapping; `bun run build:scripts` regenerates `plugins/sp/scripts/session-timeline.mjs`, and the installed `~/.agents/scripts/sp/session-timeline.mjs` is refreshed by the normal plugin install path (no hand-edited copies).

### Acceptance Criteria

```gherkin
Scenario: AC1 — A pi transcript yields real segments (req: R1)
  Given a pi transcript fixture with three operator prompts
  When "session-timeline --transcript <fixture>" runs
  Then it reports available true with exactly three segments
  And each segment boundary is the operator prompt's timestamp
  And no extra flag was required
```

```gherkin
Scenario: AC2 — pi usage maps onto the token model without double counting (req: R2)
  Given assistant rows carrying input, output, cacheRead, cacheWrite, reasoning and totalTokens
  When the timeline is measured
  Then cacheWrite is counted as cacheCreate and reasoning is not added on top of output
  And the total equals input plus cacheCreate plus cacheRead plus output
  And the non-cached cell equals total minus cacheRead
```

```gherkin
Scenario: AC3 — A skill-injected body does not open a segment (req: R3)
  Given a transcript whose skill-injected user row is followed by an operator prompt
  When the timeline is measured
  Then the injected body is not a segment boundary
  And the injected row is reported in the transcript metadata rather than as a prompt
  And operator wait time is unchanged by the injected row
```

```gherkin
Scenario: AC4 — Unrecognised rows and schemas are reported, never silently zeroed (req: R4, R5)
  Given a transcript containing custom, compaction, model_change and malformed rows
  When the timeline is measured
  Then recognised-but-skipped rows are counted and malformed content raises skippedLines
  And a transcript with turns but no recognised segments returns available false with a named reason
  And an unrecognised schema returns available false rather than an empty success
```

```gherkin
Scenario: AC5 — Both host shapes are covered by committed fixtures (req: R6)
  Given the two fixture transcripts
  When the test suite runs
  Then segments, work/wait split, token split, skipped-line counting and the unavailable path are all asserted
  And each assertion is shown to fail when its mapping is removed
```

```gherkin
Scenario: AC6 — Docs and regenerated script agree (req: R7)
  Given the implementation is complete
  When "bun run build:scripts" and the test suite run
  Then the regenerated .mjs is byte-identical to a fresh conversion
  And the review skill and the script usage note name the supported schemas
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **One measurement, two adapters.** Do not fork the script per host. Introduce a thin adapter layer: `detectSchema(rows)` → `claude` | `pi` | `unknown`, then per-schema `promptText(row)`, `isInjected(row)`, `usageOf(row)`, `isBoundaryRow(row)`. The existing segment/work/wait/token aggregation stays untouched, so both hosts share one accounting model and one set of assertions. This also makes a third host (codex/omp) a small adapter rather than a rewrite — the codex transcript shape is already known to the history importer, so the seam is worth having.

- **Injected-prompt classification is the subtle part.** The Claude path keys on `isMeta`/`isCompactSummary`. Pi has no such flags: skill bodies arrive as ordinary `role:"user"` rows beginning with `<skill name="…"`. The rule must therefore be content-based (a `<skill …>` wrapper, and the analogous injected-command wrappers), and it must be **reported** (a count in the transcript metadata) rather than silently dropped, so a future host whose injected shape differs is visible instead of being miscounted as an operator prompt. Bias the rule toward *not* segmenting: a missed operator prompt merges two stages (a bounded error), while a misclassified injected body invents a stage and corrupts the wait split (an unbounded one).

- **Honest unavailability is a contract, not politeness (R5).** The review skill's rule is "`n/a` only when the measurement reports `available:false` or omits it". A `{available:true, segments:[]}` result therefore *forces* a false measurement into the report. The script's own contract should be: segments parsed → available; turns present but none recognised → unavailable with a reason naming the detected schema; schema unrecognised → unavailable with the schema fingerprint (row types + a key census). That is what makes the failure self-announcing on the next host.

- **Boundaries.** Do not change the aggregation math (work/wait/token invariants) or the CLI surface (`--transcript`, `--group`); do not add a host-detection flag; do not import history-import machinery (this script reads one transcript file, it is not an importer); do not hand-edit the installed `.agents/scripts/sp/*.mjs` copy — the source of truth is `plugins/sp/scripts/session-timeline.ts` and `bun run build:scripts` regenerates the `.mjs`.

- **Failure inventory to write before code:** (a) pi fixture misdetected as Claude (fields are absent → must not throw); (b) the Claude path regressing while adding pi (both fixtures must run through the same assertions); (c) double-counting `reasoning` inside `output`; (d) an injected body counted as an operator prompt (the phantom-segment case); (e) an operator prompt that *starts* with `<` being wrongly classified as injected (bias: only a `<skill …>`/`<command …>` wrapper counts, and the count is reported so it is auditable); (f) a transcript with only tool rows reporting a bogus success; (g) `compaction`/`context_edit` rows shifting neither work nor wait incorrectly; (h) the regenerated `.mjs` drifting from the `.ts` source.

### Plan

1. **Capture the fixtures first** — the pi transcript for this session already exists at `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-10-08T20-03-20-333Z_01a11d1c-f88c-76a7-81a7-896de0295d30.jsonl`; take a small, redacted slice (three operator prompts, the two skill bodies, a compaction row, a fenced block, assistant usage rows) as the committed fixture, plus a Claude fixture for regression.
2. **Failure inventory first** (Design's list), one row per way the adapter can be wrong.
3. **Tests before implementation** — assertions on segment count/boundaries, work/wait split, token total + non-cached split, `skippedLines`, and both unavailable paths; each mapping demonstrated to fail when removed.
4. **Implement the adapter seam (R1/R2)** — `detectSchema`, per-schema `promptText`/`usageOf`, and the `cacheWrite → cacheCreate` mapping with the reasoning guard.
5. **Implement R3/R4/R5** — injected-body classification with a reported count, explicit handling of `custom`/`compaction`/`session_info`/`model_change`/`thinking_level_change`/`context_edit`, `skippedLines` truthfulness, and the honest `available:false` reasons.
6. **Docs and install parity (R7)** — the review skill's Protocol step 1 note, the script's usage note, `bun run build:scripts`; confirm the regenerated `.mjs` matches a fresh conversion.
7. **Acceptance drill** — run the script against (a) this session's real pi transcript (`--group` on the real operator prompts) and (b) the Claude fixture, and record both outputs; then re-run the review skill's step 1 and confirm the time table is now populated rather than `n/a`.
8. `bun run spur-check` once on the final tree; record the evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Observed in this session (pi host, session `01a11d1c-f88c-76a7-81a7-896de0295d30`): `{"available":false,"reason":"no host session id (CLAUDE_CODE_SESSION_ID)…"}` without an id; `{"available":true,"segments":[],"totals":{…zero…},"skippedLines":0}` with `--transcript` — a false `available`.
- Script under test: `/Users/robin/.agents/scripts/sp/session-timeline.mjs` (generated) ← `plugins/sp/scripts/session-timeline.ts` (source; listed in the repo's `build:scripts` conversion chain). Claude-shaped parsing at `session-timeline.mjs:37` (`promptText`), usage model at `:81` (`row.message?.usage`), segment open at `:151-153`.
- Transcript evidence: pi rows `{type:"message", message:{role, content[], usage}}` with usage keys `input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost`; census for this session: 1096 `message` rows (8 user, 2 of them `<skill …>` bodies), 248 `custom`, 2 `compaction`, 3 `context_edit`, 5 `session_info`, 3 `model_change`, 2 `thinking_level_change`.
- Consumers: `sp-session-review` / `sp-dev-review-session` Protocol step 1 (the time/token table), and the 0912 workflow-baseline diagnostics drawn from that measurement (`docs/reports/i31/0912-workflow-baseline.md`, F1/F2/F4 anchors).
- Related: ADR-117 (structured trace on every execution surface), E5 (session forensics), E71/E7 (run record), and the history importer's existing per-host adapters as prior art for schema detection.

### History

- 2026-10-09T05:36:13.650Z backlog → todo (system)

