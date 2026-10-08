---
schema_version: 1
name: Parse pi transcripts in session-timeline
status: todo
template: feature-impl
created_at: 2026-10-08T18:14:00.799Z
updated_at: "2026-10-08T18:40:24.321Z"
feature_id: E5

ac_numbering: task-local
ac_altitude: task-local
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

- [ ] R1. Format detection: `plugins/sp/lib/transcript.ts` detects the transcript format per file from its rows. A row with `type:"message"` and `message.role` in {user, assistant, toolResult} means pi; Claude's shape is the existing one. `parseRows`, `promptText` and `accumulate` handle pi rows in the same segment model:
  - one segment per pi `role:"user"` message with text content;
  - tool calls counted from assistant `content[]` items of `type:"toolCall"`, keyed by `id`;
  - an `ask_user_question` (or `AskUserQuestion`) tool's call-to-result interval counted as operator wait;
  - tokens summed from assistant `usage` `{input, output, cacheRead, cacheWrite}` into the existing Tokens shape.
- [ ] R2. Resolution: when `--transcript` is absent and `CLAUDE_CODE_SESSION_ID` is unset, `resolveTranscript` returns `{ok:false}` with the reason `no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl)`. It does not auto-pick the newest pi file, because concurrent pi sessions in one cwd make that wrong.
- [ ] R3. No false success: a non-empty transcript that yields zero segments reports `{available:false, reason:"unrecognized transcript format"}`. It never reports `available:true` with empty segments.
- [ ] R4. Compactions: the pi output adds `compactions: <count>` to `totals`, counted from `type:"compaction"` rows, and adds per-segment `compactions` as well. The field is absent for Claude transcripts.
- [ ] R5. Skill pointer: the `sp:session-review` SKILL.md, in its "When to use" section, imported-history sentence, names the pi forensic route `spur history analyze --source pi --session <file-stem>`, where `<file-stem>` is the transcript basename without `.jsonl`, not the bare uuid.
- [ ] R6. Twin: edit only the `.ts` sources and regenerate `session-timeline.mjs` and `run-summary.mjs` with `bun run build:scripts`. Both stay node-builtin and relative-import only.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Session review 2026-10-08 (all four pi `/sp:dev-review-session` runs reported `n/a`).
- `plugins/sp/scripts/session-timeline.ts`, `plugins/sp/lib/transcript.ts:69,101,125,145`, `plugins/sp/scripts/run-summary.ts`, `plugins/sp/skills/session-review/SKILL.md`.
- Importer semantics: ts-libs `packages/llm-jsonl-importer/src/mappers.ts:1454` (`piRole`), `:561` (`normalizeOmpToolCall`), `:1635` (`ompToolResultTiming`).
- Related: 1131 (history import fidelity for pi; the analyze `--session` no-match warning).

### History

- 2026-10-08T18:35:28.292Z backlog → todo (system)

