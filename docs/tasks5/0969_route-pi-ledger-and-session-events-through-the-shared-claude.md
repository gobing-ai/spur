---
schema_version: 1
name: Route Pi ledger and session events through the shared Claude hook cores
status: done
template: feature-impl
created_at: 2026-09-26T06:13:43.199Z
updated_at: "2026-09-28T23:09:54.918Z"
feature_id: H21

priority: P2
estimate_hours: 5
---

## 0969. Route Pi ledger and session events through the shared Claude hook cores

### Background

The Pi extension `plugins/sp/hooks/pi/guard-extension.ts` re-implements the indexed-context ledger and session lifecycle that Claude Code gets from `context-post-tool.ts`, `context-session-start.ts` and `context-session-stop.ts`. The copy has drifted repeatedly: raw secrets in summaries (fixed 2d430c7f5), `timestamp` instead of `ts` so `parseLedgerLine` (`packages/app/src/services/token-ledger-service.ts:97`) dropped every Pi row, and `path` instead of `file` (both fixed 3571e710a). It still differs from the Claude hooks in these places (verified 2026-09-25 against HEAD 3571e710a):

| # | Behavior | Claude (authority) | Pi today |
|---|---|---|---|
| D1 | `.session.json` id key | `session` (`context-session-start.ts:150`) | `session_id` (`guard-extension.ts:186`), read back at `:166-167` |
| D2 | Start timestamp key | `started` | `started_at` |
| D3 | Session id format | `session-YYYY-MM-DD-HHMM` (`context-session-start.ts:144`) | `<base36 ms>-<random>` (`guard-extension.ts:175-179`) |
| D4 | Nested-run reuse | `resolveActiveSession` via `SPUR_RUN_ID` and a 4h idle window (`context-session-start.ts:84-114`) | always mints a new session and overwrites the pointer |
| D5 | `session_start.contextFreshness` | set (`:176-189`) | missing |
| D6 | `session_end` totals | nested `totals:{reads,writes,tokens}` (`context-session-stop.ts:73-78`), which the reader parses at `token-ledger-service.ts:114` | flat `reads/writes/tokens` (`guard-extension.ts:233-240`), so the reader drops them |
| D7 | Tool type | `mapToolType` gives read/write/bash/grep/glob (`context-post-tool.ts:139-156`) | only `read` or `write`; bash/grep/find are logged as `write` |
| D8 | Tokens | `resolveTokenEstimate` cascade from the response, Write content, Edit strings or the Read file size (`:209-250`) | `ceil(bytes(command)/4)` for bash, otherwise 0 |
| D9 | `action` create/edit, `agent`/`model` on tool rows | set (`:303-316`) | missing; Pi adds a non-schema `tool` field |
| D10 | Freshness stamp on Write/Edit of `.spur/context/*.md` (task 0711) | `stampContextFreshness` (`:293-295`) | missing |
| D11 | Row filter | only `ALLOWED_TOOLS` (`:29`); Read/Write/Edit need a path; Bash/Grep/Glob need a summary | every tool, including `ls` and custom tools |

Origin: `/sp:dev-review plugins` architecture candidate (major: tight coupling and weak locality).

### Requirements

- [x] R1. Pi `tool_result` events are recorded by the shared `recordToolUseEvent` (`plugins/sp/hooks/context-post-tool.ts:266`) after a pure Pi→Claude payload normalization; Pi rows then equal Claude rows for the same event on every ts-independent field (fixes D7–D11).
- [x] R2. Pi `session_start` is handled by the shared `recordSessionStart` (`plugins/sp/hooks/context-session-start.ts:125`), with the agent hint falling back to `'pi'`. `.session.json` uses the Claude schema; nested-run reuse and `contextFreshness` apply (fixes D1–D5).
- [x] R3. The session-stop logic in `context-session-stop.ts` is extracted into an exported, testable `recordSessionEnd(dir, now?)` core that Claude's `main()` and Pi's `session_shutdown` both call; Pi `session_end` rows carry nested `totals` (fixes D6).
- [x] R4. `guard-extension.ts` no longer defines `appendToLedger`, `summarizeToolEvent`, `readSessionId`, `generateSessionId`, `initSession` or `cleanupSession`; its only ledger/session code is the normalizer plus three one-line event handlers.
- [x] R5. Claude hook behavior is unchanged: existing `context-hooks.test.ts` and `token-estimate.test.ts` assertions pass with no edits to `expect(` lines.

### Acceptance Criteria

Graduates all five of feature H21's scenarios (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R1 — Pi tool rows match Claude tool rows (req: R1)
- [x] AC2 — R2 — Pi session file uses the Claude schema (req: R2)
- [x] AC3 — R3 — Pi reuses an in-flight session like Claude (req: R2)
- [x] AC4 — R4 — Pi shutdown rolls up like Claude (req: R3)
- [x] AC5 — R5 — Pi has no private ledger or session implementation (req: R4, R5)

**Verify lens**

- **AC1**: a new `describe('Pi/Claude ledger parity')` in `plugins/sp/hooks/pi/guard-extension.test.ts` does the following for each Pi tool `read`, `write`, `edit`, `bash`, `grep` and `find`. It records one event through the extension's `tool_result` handler into temp dir A. It records the equivalent Claude payload (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`) through `recordToolUseEvent` into temp dir B, which has the same `.session.json`. It then asserts that the two rows are deep-equal after deleting `ts`. The Pi fixtures use the real Pi input shapes (pi-coding-agent 0.87.1):
  - read `{path}`
  - write `{path, content}`
  - edit `{path, edits:[{oldText,newText}]}`
  - grep `{pattern, path?, glob?}`
  - find `{pattern, path?}`
  - bash `{command}`
  - `content: [{type:'text', text}]`

  One more case: an `ls` event and an unknown custom tool write no row.
- **AC2**: with no `.session.json`, firing `session_start` writes a `.session.json` whose keys include `session` matching `/^session-\d{4}-\d{2}-\d{2}-\d{4}$/` and `started`, and does not include `session_id` or `started_at`. Exactly one `session_start` row is appended, with a `contextFreshness` object. `agent` is `'pi'` when no agent env var is set.
- **AC3**: with a fresh `.session.json` (`started` = now) and `SPUR_RUN_ID=x`, a second `session_start` leaves `.session.json` byte-identical and the ledger line count unchanged.
- **AC4**: after one read row and one write row with tokens, `session_shutdown` appends `{type:'session_end', totals:{reads:1, writes:1, tokens:<sum>}}` and removes `.session.json`. The row satisfies the reader contract at `packages/app/src/services/token-ledger-service.ts:97-117`: string `ts`/`session`/`type` and an object `totals` (assert on the JSON shape; plugin tests do not import `packages/app`). A unit test on `recordSessionEnd` in `context-hooks.test.ts` covers the missing-file and corrupt-file cases, which return null and write nothing.
- **AC5**: `rg -n "function (appendToLedger|summarizeToolEvent|readSessionId|generateSessionId|initSession|cleanupSession)" plugins/sp/hooks/pi` returns nothing. `git diff 3571e710a -- plugins/sp/hooks/context-hooks.test.ts plugins/sp/hooks/token-estimate.test.ts | rg '^-.*expect\('` returns nothing. `bun test plugins/sp/hooks` (run from the repo root), `bun run plugin-smoke`, `bun run typecheck` and `bun run spur-check` are green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T06:15:08.916Z

- **Q:** Normalize Pi into the Claude payload, or make the cores host-neutral with a new DTO? **A:** Normalize into the existing Claude `ToolPayload`. It is already the de-facto canonical shape, the cores and their tests key on it, and a new DTO would be a second schema to keep in sync. The normalizer is one pure function in the Pi file.
- **Q:** Where does the normalizer live? **A:** It is exported as `normalizePiToolEvent` from `guard-extension.ts`. Only Pi needs it. Do not create a new module for one function.
- **Q:** Make `mapToolType` case-insensitive instead? **A:** No. Normalization maps Pi names to the Claude canonical names before `recordToolUseEvent`, so `ALLOWED_TOOLS`, `resolveTokenEstimate` and `buildToolSummary` (which all compare against `'Read'`, `'Bash'` and so on) work unchanged. Lower-casing only `mapToolType` would leave the other three branches blind.
- **Q:** Pi `find` → `Glob`? **A:** Yes. Both take a pattern plus an optional path. `ls` and custom tools map to nothing, so no row is written, matching Claude's `ALLOWED_TOOLS`.
- **Q:** Existing Pi `.session.json` files with `session_id` from before this change? **A:** Stale session pointers are ephemeral. `resolveActiveSession` returns null for a body without `session`, so a new session is minted. No migration.
- **Q:** Pi `session_start` currently fires without `SPUR_RUN_ID` awareness. Is inheriting the reuse semantics correct for Pi? **A:** Yes. It is the same nested-`agent.run` problem (task 0398 R3). Pi subprocesses spawned by `spur agent run` inherit `SPUR_RUN_ID` the same way.
- **Q:** Project dir: Claude uses `CLAUDE_PROJECT_DIR ?? cwd`, Pi uses `cwd`. **A:** Keep Pi on `process.cwd()` (the existing `spurContextDir()`, `guard-extension.ts:37`). The cores take `dir` as a parameter, so the host keeps choosing.
- **Q:** Pi currently skips logging when `.spur/context/` is absent (`guard-extension.ts:137`), while `recordSessionStart` does `mkdirSync`. **A:** Adopt Claude's behavior. `session_start` creates the dir. `recordToolUseEvent` already returns null without a session. This is the parity goal.

### Design

**Shape.** The shared cores stay in the Claude hook files; Pi becomes a thin adapter. All imports are relative (plugin standalone contract, `sp-plugin-standalone` rule, `bun run plugin-smoke`).

1. **`context-session-stop.ts`**: extract `main()` (`:56-90`) into
   ```ts
   export function recordSessionEnd(dir: string, now: () => Date = () => new Date()): Record<string, unknown> | null
   ```
   It reads `.session.json` → `session`, computes totals with the existing `computeSessionTotals`, appends `{ts, session, type:'session_end', totals}`, `rmSync`s the pointer (best-effort) and returns the event. It returns null on every fail-open path. `main()` becomes `recordSessionEnd(join(getEnvVar('CLAUDE_PROJECT_DIR') ?? process.cwd(), '.spur', 'context'))` under `import.meta.main`. Keep `exitOk` semantics: the process exits 0.
2. **`context-session-start.ts`**: add an optional agent fallback without changing Claude behavior:
   ```ts
   export function recordSessionStart(dir, env = getEnvVars(), now = () => new Date(), agentFallback?: string)
   ```
   Line 143 becomes `resolveAgentHint(env, agentFallback)`. Claude passes nothing.
3. **`context-post-tool.ts`**: export the `ToolPayload` interface (currently module-private at `:37`) as `export interface ToolPayload`. No logic change.
4. **`guard-extension.ts`**:
   - Add a pure exported normalizer:
     ```ts
     const PI_TO_CLAUDE: Record<string, string> = { read: 'Read', write: 'Write', edit: 'Edit', bash: 'Bash', grep: 'Grep', find: 'Glob' };
     export function normalizePiToolEvent(toolName: string, input: Record<string, unknown> | undefined, content: unknown): ToolPayload | null
     ```
     - Unmapped name → `null`.
     - For Read/Write/Edit, `file_path = input.path` (and keep `input.file_path` if present).
     - For Grep/Glob, keep `path` as `path`. Do NOT set `file_path`, or `recordToolUseEvent` would treat a search dir as a file.
     - Edit: `old_string = edits.map(e => e.oldText).join('')`, `new_string = edits.map(e => e.newText).join('')` (only for the token estimate; never written to the ledger).
     - Write: pass `content`.
     - Bash: `command`. Grep: `pattern`, `path`, `glob`. Find: `pattern`, `path`.
     - Response: `tool_response = { content: <text parts of event.content joined by '\n'> }` only. `responseTextForEstimate` (`context-post-tool.ts:194`) already reads `content` for Bash/Grep/Glob; do not also set `stdout`, or the estimate double-counts.
   - Handlers:
     ```ts
     pi.on('tool_result', async (e) => { const p = normalizePiToolEvent(e.toolName, e.input, e.content); if (p) recordToolUseEvent(spurContextDir(), p); });
     pi.on('session_start', async () => { recordSessionStart(spurContextDir(), getEnvVars(), undefined, 'pi'); });
     pi.on('session_shutdown', async () => { recordSessionEnd(spurContextDir()); });
     ```
     Wrap each handler in try/catch (fail-open, as today).
   - Delete `ToolEvent`, `summarizeToolEvent`, `appendToLedger`, `readSessionId`, `generateSessionId`, `initSession`, `cleanupSession`, and the now-unused imports (`truncateSummary`, `cappedByteLength`, `resolveAgentHintShared`/`resolveModelHintShared`, `writeFileSync`/`mkdirSync`/`rmSync`/`appendFileSync` if unused). Update the header comment (`:7-12`) to say the ledger/session cores are shared.

**Invariants.**
- Rows match the reader schema (`ts`, `session`, `type` strings; optional `file`, `totals` object).
- No row for unmapped tools.
- Every hook path is fail-open.
- The Claude hooks' observable output is byte-for-byte unchanged.
- No new module and no new dependency.

**Rejected.**
- A host-neutral DTO plus two adapters: a second schema to keep in sync, for no gain.
- A case-insensitive `mapToolType`: partial, see Q&A.
- Moving the cores into `packages/app`: violates the plugin standalone contract.

### Plan

- [x] Branch `refactor/pi-hook-core-parity` from main.
- [x] Add the AC1–AC4 tests first in `plugins/sp/hooks/pi/guard-extension.test.ts` (reuse the existing temp-dir + fake `pi` harness in the `session lifecycle and token ledger` describe at `:278`). Confirm they fail against current code.
- [x] `context-session-stop.ts`: extract `recordSessionEnd`. Add unit tests in `context-hooks.test.ts` (`describe('context-session-stop — session finalization')` at `:362`) for the happy path, a missing pointer and a corrupt pointer.
- [x] `context-session-start.ts`: add the `agentFallback` parameter. `context-post-tool.ts`: export `ToolPayload`.
- [x] `guard-extension.ts`: add `normalizePiToolEvent`, rewire the three handlers, delete the private helpers and unused imports.
- [x] Update existing Pi ledger tests that assert the old Pi-only shapes (`session_id`, flat totals, `type:'write'` for bash). The new shape is the requirement; note each changed assertion in Solution.
- [x] Gates: `bun test plugins/sp/hooks` (run from the repo root), `bun run typecheck`, `bunx biome check plugins/sp`, `bun run plugin-smoke`, `bun run spur-check`. Run the AC5 `rg` and `git diff` checks.
- [x] Commit: `refactor(plugins): route Pi ledger and session events through the shared hook cores`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `plugins/sp/hooks/context-hooks.test.ts:733` |
| `plugins/sp/hooks/context-post-tool.ts:37` |
| `plugins/sp/hooks/context-session-start.ts:129` |
| `plugins/sp/hooks/context-session-start.ts:144` |
| `plugins/sp/hooks/context-session-stop.ts:52` |
| `plugins/sp/hooks/context-session-stop.ts:60` |
| `plugins/sp/hooks/context-session-stop.ts:67` |
| `plugins/sp/hooks/context-session-stop.ts:70` |
| `plugins/sp/hooks/context-session-stop.ts:75` |
| `plugins/sp/hooks/context-session-stop.ts:84` |
| `plugins/sp/hooks/context-session-stop.ts:93` |
| `plugins/sp/hooks/context-session-stop.ts:96` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:22` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:287` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:296` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:300` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:303` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:308` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:311` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:314` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:317` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:322` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:339` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:344` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:357` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:366` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:373` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:376` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:379` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:446` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:459` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:480` |
| `plugins/sp/hooks/pi/guard-extension.test.ts:56` |
| `plugins/sp/hooks/pi/guard-extension.ts:10` |
| `plugins/sp/hooks/pi/guard-extension.ts:118` |
| `plugins/sp/hooks/pi/guard-extension.ts:140` |
| `plugins/sp/hooks/pi/guard-extension.ts:143` |
| `plugins/sp/hooks/pi/guard-extension.ts:178` |
| `plugins/sp/hooks/pi/guard-extension.ts:238` |
| `plugins/sp/hooks/pi/guard-extension.ts:240` |
| `plugins/sp/hooks/pi/guard-extension.ts:25` |
| `plugins/sp/hooks/pi/guard-extension.ts:252` |
| `plugins/sp/hooks/pi/guard-extension.ts:254` |
| `plugins/sp/hooks/pi/guard-extension.ts:261` |
| `plugins/sp/hooks/pi/guard-extension.ts:263` |
| `plugins/sp/hooks/pi/guard-extension.ts:30` |
| `plugins/sp/hooks/pi/guard-extension.ts:41` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/hooks/pi/guard-extension.ts` `normalizePiToolEvent` (pure Pi→Claude adapter) feeds the shared `recordToolUseEvent`; `plugins/sp/hooks/pi/guard-extension.test.ts` "Pi/Claude ledger parity" records each of read/write/edit/grep/find/bash through the extension into dir A and the equivalent Claude payload through `recordToolUseEvent` into dir B, asserting deep-equality after deleting `ts`; `ls` and an unknown tool write no row |
| R2 | MET | The `session_start` handler calls `recordSessionStart(spurContextDir(), getEnvVars(), undefined, 'pi')`; `context-session-start.ts` gained the optional `agentFallback` (line 143 → `resolveAgentHint(env, agentFallback)`). Test asserts `session` matches `/^session-\d{4}-\d{2}-\d{2}-\d{4}$/`, `started` present, no `session_id`/`started_at`, `agent === 'pi'`, one `session_start` row with `contextFreshness`, and byte-identical reuse under `SPUR_RUN_ID` |
| R3 | MET | `context-session-stop.ts` exports `recordSessionEnd(dir, now?)` (reads the pointer, computes totals, appends `{ts, session, type:'session_end', totals}`, removes the pointer, returns the event/null); its entrypoint and Pi's `session_shutdown` both call it. Unit tests cover happy path, missing pointer, corrupt pointer and empty id |
| R4 | MET | `rg -n "function (appendToLedger\|summarizeToolEvent\|readSessionId\|generateSessionId\|initSession\|cleanupSession)\b" plugins/sp/hooks/pi/guard-extension.ts` → none; the file keeps 4 `pi.on(` handlers and only the normalizer plus three one-line handlers |
| R5 | MET | `git diff HEAD -- plugins/sp/hooks/context-hooks.test.ts` has no removed `expect(` line; the Claude-side hook tests (80 tests across `context-hooks` + `guard-extension`) pass; `bun run spur-check` → 9428 pass / 0 fail |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Pi tool rows match Claude tool rows | MET | test | "every mapped Pi tool row deep-equals the Claude row for the same event after ts" (6 tool cases) + "an ls event and an unknown custom tool write no row" |
| R2 — Pi session file uses the Claude schema | MET | test | "session_start writes the Claude schema with a pi agent fallback and a freshness stamp" |
| R3 — Pi reuses an in-flight session like Claude | MET | test | "a fresh session with SPUR_RUN_ID is reused byte-identically with no new row" |
| R4 — Pi shutdown rolls up like Claude | MET | test | "session_end carries nested totals, satisfies the reader contract, and removes the pointer" + `recordSessionEnd` core unit tests |
| R5 — Pi has no private ledger or session implementation | MET | command | AC5 `rg` probe → none; `bunx biome check plugins/sp` clean; `bun run plugin-smoke` PASS; `bun run spur-check` EXIT 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:e96fbffa3bed6447378948dab7cfe5e415bd41ef4270f8fd2ec8cca3f8932734 |

### References

- `plugins/sp/hooks/pi/guard-extension.ts:37-39` (dir helpers), `:122-240` (private ledger/session copy), `:288-309` (handlers)
- `plugins/sp/hooks/context-post-tool.ts:29` (`ALLOWED_TOOLS`), `:37` (`ToolPayload`), `:139` (`mapToolType`), `:161` (`buildToolSummary`), `:209` (`resolveTokenEstimate`), `:266` (`recordToolUseEvent`)
- `plugins/sp/hooks/context-session-start.ts:84` (`resolveActiveSession`), `:125` (`recordSessionStart`)
- `plugins/sp/hooks/context-session-stop.ts:29` (`computeSessionTotals`), `:56` (`main`)
- `packages/app/src/services/token-ledger-service.ts:92-117` (`parseLedgerLine`, reader schema)
- Pi event and tool types: `@earendil-works/pi-coding-agent` 0.87.1 `dist/core/extensions/types.d.ts:791-837`, `dist/core/tools/{read,write,edit,grep,find,bash}.d.ts`
- Prior drift fixes: commits 2d430c7f5 and 3571e710a; tasks 0398 (session reuse), 0711 (freshness), 0246/0248 (token cascade)

### History

- 2026-09-26T06:18:47.624Z backlog → todo (system)
- 2026-09-28T23:09:32.691Z todo → wip (system)
- 2026-09-28T23:09:33.404Z wip → testing (system)
- 2026-09-28T23:09:54.918Z testing → done (system)

