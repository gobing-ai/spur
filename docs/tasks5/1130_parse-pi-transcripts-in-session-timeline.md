---
schema_version: 1
name: Parse pi transcripts in session-timeline
status: done
template: feature-impl
created_at: 2026-10-08T18:14:00.799Z
updated_at: "2026-10-09T17:00:04.341Z"
feature_id: E5

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1130-verdict.json
---

## 1130. Parse pi transcripts in session-timeline

### Background

All four pi driver sessions that ran `/sp:dev-review-session` on 2026-10-08 reported Time breakdown `n/a`: `plugins/sp/scripts/session-timeline.mjs` resolves only Claude Code transcripts (`~/.claude/projects/<dir>/<CLAUDE_CODE_SESSION_ID>.jsonl`, `session-timeline.mjs:110-125`) and parses only Claude row shapes (`tool_use`/`tool_result`, `message.id` usage). On a pi transcript passed via `--transcript` it returned `{"available":true,"segments":[]}` - a misleading success.

pi rows (`~/.pi/agent/sessions/<cwd-slug>/<ts>_<id>.jsonl`) differ: `{"type":"message","message":{"role":"user|assistant|toolResult", ...}}`, assistant `content[]` items of `type:"toolCall"` with `id`/`name`/`arguments`, `toolResult` rows carrying `toolCallId`, `durationMs` and `details.toolMetadata.startedAt/completedAt`, assistant `usage` `{input, output, cacheRead, cacheWrite}`, plus `compaction` rows with `tokensBefore`. The 2026-10-07/08 slowness review had to be measured by hand from these fields.

**Scope: what `spur history` already covers, and what it does not.** Ended and fleet pi sessions can already be analyzed with `bun run apps/cli/src/index.ts history analyze --source pi --session <file-stem> --json`. The session id is the full file stem, e.g. `2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b`; the bare uuid silently returns zeros, which is fixed by 1131 R4. This review used that path for compaction, token and cost totals. So this task does not build a second forensic plane. It only makes the *active-session* `sp:session-review` Time breakdown work on pi. That skill must not import history, per its evidence boundary, and the plugin standalone contract (`sp-plugin-standalone`) forbids importing `@gobing-ai/ts-llm-jsonl-importer` from `plugins/sp`.

**Mirror, don't import.** The pi field semantics to mirror are already decided in the importer (`/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`, v0.5.18):
- `piRole` (line 1454) maps `toolResult` / `bashExecution` / `tool` to the `user` role. Such rows are therefore tool results, never operator prompts; only `role:"user"` rows with text content are prompts.
- `normalizeOmpToolCall` (used at line 561) reads pi assistant `content[]` items of `type:"toolCall"` (`id`, `name`, `arguments`).
- `ompToolResultTiming` (line 1635) pairs results by `message.toolCallId`. Pi's native duration is `message.durationMs`, with `details.toolMetadata.{startedAt,completedAt,durationMs}`; the importer reads only `details.wallTimeMs` today, which 1131 fixes.

**Code anchors.**
- `plugins/sp/scripts/session-timeline.ts` (152 lines) delegates row parsing to `plugins/sp/lib/transcript.ts`. That file provides `parseRows:125`, `promptText:69`, `accumulate:101` and `resolveTranscript:145`, and `plugins/sp/scripts/run-summary.ts` also uses it, so changes there must keep run-summary green.
- The `.mjs` twin is produced by `superskill script convert sp session-timeline.ts`, which is part of `bun run build:scripts`.
- Tests: `plugins/sp/tests/session-timeline.test.ts`.

**Hand-measured reference values for the fixture (session review 2026-10-08).**
- H15 session `…01a1188a-36d8…`: 7 compactions, `tokensBefore` 108–115k each.
- `history analyze` reports 296 tool calls and 905 s assistant duration for H15.
- The fixture can be a trimmed 30–60 line slice of a real pi transcript with secrets and prompt text replaced.

### Requirements

- [x] R1. Format detection: `plugins/sp/lib/transcript.ts` detects the transcript format per file from its rows. A row with `type:"message"` and `message.role` in {user, assistant, toolResult} means pi; Claude's shape is the existing one. `parseRows`, `promptText` and `accumulate` handle pi rows in the same segment model:
  - one segment per pi `role:"user"` message with text content;
  - tool calls counted from assistant `content[]` items of `type:"toolCall"`, keyed by `id`;
  - an `ask_user_question` (or `AskUserQuestion`) tool's call-to-result interval counted as operator wait;
  - tokens summed from assistant `usage` `{input, output, cacheRead, cacheWrite}` into the existing Tokens shape.
- [x] R2. Resolution: when `--transcript` is absent and `CLAUDE_CODE_SESSION_ID` is unset, `resolveTranscript` returns `{ok:false}` with the reason `no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl)`. It does not auto-pick the newest pi file, because concurrent pi sessions in one cwd make that wrong.
- [x] R3. No false success: a non-empty transcript that yields zero segments reports `{available:false, reason:"unrecognized transcript format"}`. It never reports `available:true` with empty segments.
- [x] R4. Compactions: the pi output adds `compactions: <count>` to `totals`, counted from `type:"compaction"` rows, and adds per-segment `compactions` as well. The field is absent for Claude transcripts.
- [x] R5. Skill pointer: the `sp:session-review` SKILL.md, in its "When to use" section, imported-history sentence, names the pi forensic route `spur history analyze --source pi --session <file-stem>`, where `<file-stem>` is the transcript basename without `.jsonl`, not the bare uuid.
- [x] R6. Twin: edit only the `.ts` sources and regenerate `session-timeline.mjs` and `run-summary.mjs` with `bun run build:scripts`. Both stay node-builtin and relative-import only.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A real pi transcript slice yields measured segments (req: R1, R4)
  Given a fixture `plugins/sp/tests/fixtures/pi-session.jsonl` trimmed from a real pi transcript with 2 operator prompts, ≥3 toolCall/toolResult pairs, ≥1 assistant usage row and 1 compaction row
  When `main(['--transcript', fixture])` runs
  Then the output has available=true, 2 segments, each with workMs > 0, toolCalls equal to the fixture's toolCall count, non-zero total tokens, and totals.compactions = 1

Scenario: AC2 — Unknown JSONL shape is reported, not hidden (req: R3)
  Given a JSONL file whose rows are valid JSON with an unknown shape
  When session-timeline reads it
  Then the output is {available:false, reason:"unrecognized transcript format"} with exit 0

Scenario: AC3 — No host id names the --transcript remedy (req: R2)
  Given env without CLAUDE_CODE_SESSION_ID and no --transcript
  When session-timeline runs
  Then available=false and reason contains "--transcript"

Scenario: AC4 — Claude and run-summary behavior unchanged (req: R1, R6)
  Given the existing Claude fixtures
  When `(cd plugins/sp && bun test tests/session-timeline.test.ts)` and the run-summary tests run after `bun run build:scripts`
  Then all pass and the regenerated .mjs twins are committed with the change

Scenario: AC5 — Skill names the file-stem pi route (req: R5)
  Given plugins/sp/skills/session-review/SKILL.md
  When it is read
  Then the imported-history sentence names `spur history analyze --source pi --session <file-stem>`
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T18:35:07.915Z

- **Reuse `spur history` instead of parsing pi in the plugin?** For ended or fleet forensics, yes; R5 points there. The active-session review cannot: the skill's boundary forbids history import, and `plugins/sp` cannot import the importer package (standalone contract, which broke installs in 0.3.81–0.3.88). The plugin parser stays small (row shape plus usage) and mirrors the importer's field semantics by citation, not by copy.
- **Auto-discover the pi session file?** No. The 2026-10-07 fleet ran 3–4 pi sessions in one cwd at once, so "newest file" would pick the wrong one. An explicit `--transcript` is required on pi.

### Design

- **Where.** All parsing changes go in `plugins/sp/lib/transcript.ts`; `session-timeline.ts` only adds the R3 zero-segment check and the R4 `compactions` total. A format sniff in `parseRows` returns `format: 'claude' | 'pi' | 'unknown'` alongside the rows, set by the first row that matches a known shape.
- **Pi row mapping.**
  - prompt: `row.type==='message' && row.message.role==='user'` with text content;
  - tool call: assistant `message.content[i].type==='toolCall'`, using `id`;
  - tool result: `message.role==='toolResult'`, using `toolCallId`;
  - usage: assistant `message.usage` mapped to `{input, cacheCreation: cacheWrite, cacheRead, output}`;
  - message id for once-per-message token counting is the row `id`;
  - timestamp is the row `timestamp`.
- **Invariant.** Claude parsing paths are untouched; pi is an additive branch keyed on format.

### Plan

1. Build the AC1 fixture from a real pi transcript (`~/.pi/agent/sessions/…/2026-10-07T22-44-33-625Z_…jsonl`). Replace prompt and tool text with placeholders; keep the structure, ids, timestamps and usage.
2. Write the AC1–AC3 tests in `plugins/sp/tests/session-timeline.test.ts`; they fail.
3. Implement the pi branch in `lib/transcript.ts`, then R3/R4 in `session-timeline.ts`.
4. Edit the session-review SKILL.md (R5).
5. Run `bun run build:scripts`, then the session-timeline and run-summary tests, then `bun run spur-check`.

### Solution

- R1 `plugins/sp/lib/transcript.ts:78` `promptText` gained a pi branch (`type:"message"` + `role:"user"` with text content); `accumulate` (:101) gained the pi branch — assistant `content[]` `toolCall` blocks keyed by `id`, `ask_user_question`/`AskUserQuestion` call→`toolResult` (`toolCallId`) interval as operator wait, assistant `usage {input,cacheWrite,cacheRead,output}` mapped to the existing Tokens shape and deduped by the pi row `id`; `sniffFormat` (:125 area) returns `'claude'|'pi'|'unknown'` from the first known row (`type:"message"` + pi role → pi; `type:"user"/"assistant"` → claude); `parseRows` returns `format` alongside rows. Claude paths untouched (additive branch keyed on row/format shape).
- R2 `resolveTranscript` (`plugins/sp/lib/transcript.ts:202`) no-id reason now names the pi remedy: `no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl)`; no auto-pick of newest pi file (concurrent sessions make that wrong).
- R3 `plugins/sp/scripts/session-timeline.ts` `main` reports `{available:false, reason:"unrecognized transcript format"}` (exit 0) when a transcript yields zero segments — never `available:true` with empty segments.
- R4 `Acc`/`newAcc` carry `compactions`; `accumulate` counts `type:"compaction"` rows; `buildTimeline` adds per-segment and totals `compactions` only when format is pi — the key is absent for Claude output.
- R5 `plugins/sp/skills/session-review/SKILL.md` "When to use" imported-history sentence now names `spur history analyze --source pi --session <file-stem>` (file-stem = basename without `.jsonl`).
- R6 Only `.ts` sources edited; `bun run build:scripts` regenerated `session-timeline.mjs` and `run-summary.mjs`; both remain node-builtin + relative-import only. Fixture `plugins/sp/tests/fixtures/pi-session.jsonl` trimmed from the real pi session `2026-10-08T18-45-04-192Z_01a11cd5…` (30 rows; prompt/tool text placeholders; structure, ids, timestamps, usage, toolMetadata kept): 2 operator prompts, 10 toolCall/toolResult blocks, 7 assistant usage rows, 1 compaction row, 1 synthesized real-shaped `ask_user_question` pair.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/lib/transcript.ts:169` sniffFormat returns claude/pi/unknown from the first known row; `plugins/sp/lib/transcript.ts:78` promptText pi branch (user-role text only); `plugins/sp/lib/transcript.ts:119-146` accumulate pi branch: toolCall blocks keyed by id (:128), ask_user_question/AskUserQuestion via OPERATOR_TOOLS (`plugins/sp/lib/transcript.ts:48`) paired by toolCallId (:141-142), usage mapped to Tokens; re-verify 2026-10-09: session-timeline + run-summary tests 36 pass / 0 fail; fixture smoke 2 segments, toolCalls 9+1=10 equal to the 10 toolCall blocks in the fixture. |
| R2 | MET | `plugins/sp/lib/transcript.ts:212` exact reason text naming --transcript and the pi path; resolveTranscript (`plugins/sp/lib/transcript.ts:202`) has no pi auto-pick; `env -u CLAUDE_CODE_SESSION_ID node plugins/sp/scripts/session-timeline.mjs` printed the remedy, exit 0 (re-run 2026-10-09). |
| R3 | MET | `plugins/sp/scripts/session-timeline.ts:152` zero-segment guard writes available=false, reason "unrecognized transcript format"; re-run on a 2-row unknown-shape JSONL in $TMPDIR returned that object, exit 0. |
| R4 | MET | `plugins/sp/lib/transcript.ts:146` counts type compaction rows; `plugins/sp/scripts/session-timeline.ts:98` and `plugins/sp/scripts/session-timeline.ts:110` add per-segment and totals compactions only when isPi (:72); fixture smoke totals.compactions=1; test 'Claude output carries no compactions field' (`plugins/sp/tests/session-timeline.test.ts:281`) passes. |
| R5 | MET | `plugins/sp/skills/session-review/SKILL.md:28` "When to use" imported-history sentence names `spur history analyze --source pi --session <file-stem>`, defines file-stem as basename without .jsonl, not the bare uuid (re-read 2026-10-09). |
| R6 | MET | Re-verify 2026-10-09: snapshotted both twins, ran `bun run build:scripts` (exit 0), diff -q clean for `plugins/sp/scripts/session-timeline.mjs` and `plugins/sp/scripts/run-summary.mjs`; git status clean after build; twin imports are fs, node:fs, node:os, node:path only (`plugins/sp/scripts/session-timeline.mjs:5-15`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A real pi transcript slice yields measured segments (req: R1, R4) | MET | test | Test 'AC1: a real pi transcript slice yields measured segments' (`plugins/sp/tests/session-timeline.test.ts:250`) passes in `(cd plugins/sp && bun test tests/session-timeline.test.ts tests/run-summary.test.ts)` 36 pass / 0 fail; smoke on `plugins/sp/tests/fixtures/pi-session.jsonl`: available=true, 2 segments, workMs 161826 and 20000, toolCalls 10 total = 10 fixture toolCall blocks, tokens 165614 input / 393476 cacheRead / 1721 output, totals.compactions=1 = 1 fixture compaction row. |
| AC2 — Unknown JSONL shape is reported, not hidden (req: R3) | MET | test | Test 'AC2' (`plugins/sp/tests/session-timeline.test.ts:264`) passes; command smoke on unknown-shape JSONL returned available=false, reason "unrecognized transcript format", exit 0. |
| AC3 — No host id names the --transcript remedy (req: R2) | MET | test | Test 'AC3' (`plugins/sp/tests/session-timeline.test.ts:272`) passes; `env -u CLAUDE_CODE_SESSION_ID node plugins/sp/scripts/session-timeline.mjs` returned available=false with reason containing --transcript, exit 0. |
| AC4 — Claude and run-summary behavior unchanged (req: R1, R6) | MET | test | `(cd plugins/sp && bun test tests/session-timeline.test.ts tests/run-summary.test.ts)` 36 pass / 0 fail after `bun run build:scripts`; twins diff-clean and committed in d2a96133b. |
| AC5 — Skill names the file-stem pi route (req: R5) | MET | command | `grep -n "history analyze --source pi --session <file-stem>" plugins/sp/skills/session-review/SKILL.md` exit 0, hit at `plugins/sp/skills/session-review/SKILL.md:28` containing `spur history analyze --source pi --session <file-stem>` (grep -n hit, re-read 2026-10-09). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1130 (Parse pi transcripts in session-timeline)
**Scope:** worktree diff vs HEAD (7 modified files + 1 new fixture) in spur-new-runall-1130-1131-b70b
**Dimensions:** functional traceability, SECUA (security/efficiency/correctness/usability/architecture), architecture depth
**Verdict:** PASS

##### Fresh verification evidence (run in the worktree during this review)
- `(cd plugins/sp && bun test tests/session-timeline.test.ts)` → 28 pass / 0 fail (64 expect calls).
- `bun test tests/run-summary.test.ts` (plugins/sp) → 8 pass / 0 fail.
- `node plugins/sp/scripts/session-timeline.mjs --transcript plugins/sp/tests/fixtures/pi-session.jsonl` → exit 0; available:true, 2 segments (work 2:42 / 0:20; wait 0:13 / 0:30 ask gate), toolCalls 9+1=10, totals.compactions=1, per-segment compactions 1/0.
- `node plugins/sp/scripts/session-timeline.mjs --transcript /tmp/unknown.jsonl` (one `type:"mystery"` row) → `{"available":false,"reason":"unrecognized transcript format"}`, exit 0 (AC2).
- No-arg run → `{"available":false,"reason":"no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl)"}`, exit 0 (AC3/R2).
- Twin sync (R6): snapshotted both .mjs, ran `bun run build:scripts`, `diff` against snapshots → byte-identical (TWINS-IN-SYNC); both twins import node builtins (`fs`/`node:fs`, `node:os`, `node:path`) only; `git status --porcelain` after build shows no drift.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | Operator-wait interval is computed from row timestamps (result.ts − call.ts), not from the pi-native `message.durationMs` / `details.toolMetadata.{startedAt,completedAt}` carried on toolResult rows. Equal to true wall wait when rows are appended per event (the normal case), and consistent with the Claude path which has no duration field; precision upgrade belongs to 1131's importer fidelity work. | `plugins/sp/lib/transcript.ts:141-143` | ACCEPTED |
| 2 | P4 (advisory) | correctness | An ask gate whose toolResult lands after the next user prompt loses its wait: `asks` is per-segment, so the result row finds an empty map in the new segment. Inherited unchanged from the Claude path (`tool_use`/`tool_result` has the same shape); rare in practice. | `plugins/sp/lib/transcript.ts:128-143` | ACCEPTED |
| 3 | P4 (advisory) | usability | A recognized-but-promptless transcript (valid Claude rows, zero user prompts) now reports reason "unrecognized transcript format" even though the format was recognized. R3 mandates exactly this output for any non-empty zero-segment transcript, so this is per-spec wording, not a defect. | `plugins/sp/scripts/session-timeline.ts` | ACCEPTED |
| 4 | P4 (advisory) | security/usability | Fixture retains the real local cwd `/Users/robin/xprojects/spur-new` (session row `cwd` and the compaction row's systemMessage cwd section). Not a secret and it is this repo's own path, but a committed absolute personal path could have been placeholdered like the prompt text. | `plugins/sp/tests/fixtures/pi-session.jsonl:1,15` | ACCEPTED |
| 5 | P4 (advisory) | usability | The R2 remedy text drops the env-var name `CLAUDE_CODE_SESSION_ID` that the old message named ("no host session id (CLAUDE_CODE_SESSION_ID); …"). The new text is exactly what R2 specifies and names the pi path, but an operator debugging a mis-set env var lost the variable name from the message. | `plugins/sp/lib/transcript.ts:208-213` | ACCEPTED |
| 6 | P4 (advisory) | correctness | Negative ask intervals are unguarded (`ts - asks.get(id)` can go negative on clock skew/out-of-order timestamps, inflating waitMs and shrinking workMs by the same amount). Pre-existing shape in the Claude branch; pi inherits it symmetrically. | `plugins/sp/lib/transcript.ts:142-143,163` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/lib/transcript.ts:79-86` promptText pi branch (user-role message with text content only; toolResult excluded); `:117-146` accumulate pi branch (toolCall blocks keyed by `id` at :121-126, `ask_user_question`/`AskUserQuestion` in OPERATOR_TOOLS at :51, call→toolResult interval via `toolCallId` at :141-143, usage `{input,cacheWrite,cacheRead,output}` → Tokens deduped by row `id` at :130-139); one segment per pi user prompt via buildTimeline's existing prompt-open logic (`plugins/sp/scripts/session-timeline.ts:77-82`). Fixture: 2 prompts, 10 toolCall blocks, 7 usage rows, 1 compaction — smoke output matches hand-run values. |
| R2 | MET | `plugins/sp/lib/transcript.ts:208-213` — exact required reason text incl. the pi path; no auto-pick anywhere (resolveTranscript only scans `~/.claude/projects` under CLAUDE_CODE_SESSION_ID, :214-221); verified live (no-arg run prints the remedy, exit 0). |
| R3 | MET | `plugins/sp/scripts/session-timeline.ts:151-154` zero-segment guard in `main` → `{available:false, reason:"unrecognized transcript format"}`, exit 0; verified via node twin on an unknown-shape file; no `available:true` with empty segments path remains (the only `available:true` write is after the guard). |
| R4 | MET | `plugins/sp/lib/transcript.ts` counts `type:"compaction"` rows into Acc; `plugins/sp/scripts/session-timeline.ts:95-101,112-116` add per-segment and totals `compactions` only when `format==='pi'`; Claude-output-absence guarded by test (`session-timeline.test.ts` 'Claude output carries no compactions field'); smoke shows totals.compactions=1, segments 1/0. |
| R5 | MET | `plugins/sp/skills/session-review/SKILL.md:26-29` — "When to use" imported-history sentence names `spur history analyze --source pi --session <file-stem>`, defines `<file-stem>` as the transcript basename without `.jsonl`, and explicitly warns "not the bare uuid" with an example stem. |
| R6 | MET | Only `.ts` sources + SKILL.md/tests/fixture/task-doc changed; twins regenerated via `bun run build:scripts` and verified byte-identical to a fresh rebuild this review; both twins are node-builtin + relative-import only (headers inspected). run-summary.ts itself needed no source change (it consumes lib/transcript.ts) and its tests stay green (8/8). |

AC coverage: AC1 (fixture → 2 segments, workMs>0, toolCalls=fixture count, non-zero tokens, compactions=1) — test + smoke MET; AC2 (unknown shape reported, exit 0) — test + smoke MET; AC3 (no-host-id reason contains `--transcript`, plus pi path) — test + smoke MET; AC4 (Claude + run-summary unchanged after build:scripts) — 28/8 tests green, twins in sync MET; AC5 (skill names file-stem pi route) — MET.

Key invariants checked: Claude parse paths untouched (diff is purely additive branches keyed on `type:"message"`/format; existing user/assistant branch code identical); no `@gobing-ai/ts-llm-jsonl-importer` import added to plugins/sp (standalone contract respected — no new imports at all); `spur history` not imported by the plugin; fixture is a realistic 30-row pi slice exercising every code path AC1 names (sniff→pi, prompt open, toolCall count, ask gate, usage dedup, compaction).

##### SECUA
- Security: no new surface; transcript paths still only read, SESSION_ID path-char guard intact (`plugins/sp/lib/transcript.ts:215`); fixture placeholders keep prompt/tool text out of the repo (residual cwd path noted as finding 4).
- Efficiency: sniffFormat is one O(n) pass over already-parsed rows; no added allocation in hot loops beyond the per-segment span object; maps sized by row counts as before.
- Correctness: usage dedup keyed by pi row `id` (unique per row, overwrite semantics mirror the Claude message-id comment at `plugins/sp/lib/transcript.ts:166`); usage fields tolerated with `?? 0`; unknown/missing usage or id rows are skipped, not crashed; malformed lines still counted in skippedLines. Findings 1/2/6 are bounded, inherited-shape notes.
- Usability: exit codes preserved (0 for all JSON reports incl. R3/R2 paths, 2 for usage/IO errors — verified AC2/AC3 exit 0); remedy text is actionable on pi (finding 5 notes the lost env-var name).
- Architecture: see below.

##### Architecture depth
The pi support lands as an additive branch inside the existing segment model (sniff → format flag → same Acc/accumulate/buildTimeline machinery), not a second forensic plane: no new module, no duplicated timeline assembly, no importer dependency (mirror-by-citation of importer semantics, per the task's "Mirror, don't import" decision). The standalone-import rule holds — the twin `.mjs` files still inline only node builtins and relative imports, verified by a clean regeneration. The one structural cost is the format flag threading through buildTimeline (`isPi` ternaries at three sites in `session-timeline.ts:79,101,113-116`); a format-object strategy would be over-engineering at two formats. Depth is adequate: consumers (session-review skill) see one shape with an optional `compactions` key.

**Residual risk:** Low. The parser is validated against a placeholdered-but-structurally-real fixture plus live twin smoke; the known gaps (timestamp-based ask waits, cross-segment ask gates, promptless-transcript wording) are inherited-shape or 1131-scoped and recorded as accepted P4s. No open P1–P3 findings.

VERDICT: PASS

### References

- Session review 2026-10-08 (all four pi `/sp:dev-review-session` runs reported `n/a`).
- `plugins/sp/scripts/session-timeline.ts`, `plugins/sp/lib/transcript.ts:69,101,125,145`, `plugins/sp/scripts/run-summary.ts`, `plugins/sp/skills/session-review/SKILL.md`.
- Importer semantics: ts-libs mappers (`piRole` at mappers.ts line 1454, `normalizeOmpToolCall` at :561 (`normalizeOmpToolCall`), `:1635` (`ompToolResultTiming`).
- Related: 1131 (history import fidelity for pi; the analyze `--session` no-match warning).

### History

- 2026-10-08T18:35:28.292Z backlog → todo (system)
- 2026-10-08T19:14:51.537Z todo → wip (system)
- 2026-10-08T19:39:51.820Z wip → testing (system)
- 2026-10-08T19:52:55.613Z testing → done (system)

