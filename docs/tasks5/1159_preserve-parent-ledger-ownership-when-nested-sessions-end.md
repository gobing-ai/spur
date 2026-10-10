---
schema_version: 1
name: Preserve parent ledger ownership when nested sessions end
status: done
template: feature-impl
created_at: 2026-10-10T07:29:43.485Z
updated_at: "2026-10-10T22:52:23.335Z"
feature_id: H21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1159-verdict.json
---

## 1159. Preserve parent ledger ownership when nested sessions end

### Background

Nested SessionStart reuses its parent pointer but nested SessionEnd unconditionally finalizes and deletes it, dropping later parent tool events Evidence: `plugins/sp/hooks/context-session-start.ts:105`; `plugins/sp/hooks/context-session-stop.ts:58`; `plugins/sp/hooks/context-session-stop.ts:88`. Review a71c confirmed this using parent start, nested start with SPUR_RUN_ID, child end, then parent tool event; pointer was absent and next event null. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Start currently returns the reused ledger id without rewriting the pointer; stop unconditionally appends session_end and deletes the pointer. Claude entrypoints ignore hook session_id, and Pi lifecycle handlers ignore ctx. Ownership cannot be based on hook-process PID.
- Pi 0.87.1's installed ReadonlySessionManager exposes getSessionId(); Claude's stable hook identity is payload.session_id, with CLAUDE_CODE_SESSION_ID as fallback. Freeze host+native-session identity at both start and end, not SPUR_RUN_ID alone.
- Existing tests are hooks/context-hooks.test.ts and hooks/pi/guard-extension.test.ts. Legacy pointers contain no owner, so owner-only shutdown needs an explicit conservative legacy policy; do not let the implementer silently choose to delete them.
- Exactly-once end must survive failed pointer cleanup: inspect existing session_end evidence before appending again, and never remove a pointer replaced since it was read.

### Requirements

- [x] R1. Record session owner identity at pointer creation and allow only that owner to finalize or remove the pointer across Claude and Pi adapters
- [x] R2. Owner shutdown emits exactly one session_end and nested starts continue reusing the parent ledger
- [x] R3. Add the reproducing regression and validate the affected callers through the existing test seams.
- [x] R4. Missing/mismatched identity and legacy ownerless pointers cannot be finalized or removed by a child. A repeated owning end, including replay after pointer-removal failure, emits at most one session_end; append failure or pointer replacement cannot destroy a newer pointer. Historical ledger data is never rewritten.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Child shutdown preserves parent ledger ownership (req: R1, R3)
  Given parent owner A created a ledger pointer and nested owner B reused it
  When B shuts down and A records another tool event
  Then the pointer remains owned by A and the event persists under the same ledger session
  And this holds through both Claude stdin and Pi session-manager adapters

Scenario: AC2 — Owning shutdown is idempotent (req: R2, R3, R4)
  Given owner A ends its session, including when A carries SPUR_RUN_ID
  When A repeats shutdown or retries after pointer removal failed
  Then exactly one session_end exists with correct totals
  And only A's unchanged pointer can be removed

Scenario: AC3 — Unknown and replaced ownership stays safe (req: R1, R3, R4)
  Given an ownerless legacy pointer, missing caller identity, a mismatched host, or a pointer replaced during end recording
  When shutdown runs
  Then no unowned or replacement pointer is removed
  And append failure retains the pointer and historical rows remain unchanged
```

### Q&A

- Closed: owner identity is {host,native sessionId}; Claude payload.session_id with known env fallback and Pi ctx.sessionManager.getSessionId() supply it. PIDs and SPUR_RUN_ID cannot identify the owner.
- Closed: reused starts never transfer ownership; a genuine owner with SPUR_RUN_ID can still close.
- Closed: legacy/unknown ownership fails closed for end/delete while tool recording remains available; existing idle expiry applies. No fabricated migration.
- Closed: detect a prior end row before replay append and recheck pointer identity before removal. Simultaneous independent-session arbitration is a separate design.

### Design

**Identity contract / signatures.** Add an optional owner field to the private .session.json pointer: owner:{host:'claude'|'pi',sessionId:string}. Identity is the trimmed nonempty host-native session id, never ledger id, process.pid or SPUR_RUN_ID. Define an exported type SessionOwner in context-session-start.ts (type-only import in stop is standalone-safe). Preserve existing positional arguments and return types; add owner?:SessionOwner as the fifth recordSessionStart argument and third recordSessionEnd argument. A newly created pointer stores owner only when identity is valid. Reused starts return the ledger id without changing owner, even if the child's native id differs. Existing correlation/idle reuse ordering stays intact.

**Adapters.** Claude start/end main functions read hook JSON stdin and use a nonempty session_id; fallback to CLAUDE_CODE_SESSION_ID only when payload id is absent. Malformed input fails open with no output and cannot finalize a pointer. Pi session_start/session_shutdown handlers accept (_event,ctx), pass {host:'pi',sessionId:ctx.sessionManager.getSessionId()} to the same core; update fake contexts with a stable per-session manager. No Pi SDK value import, adapter fork, sessionId env invention or generated hand edit.

**End algorithm.** Read and validate pointer ledger session + owner. If caller owner is missing, mismatched, malformed, or pointer is legacy ownerless, return null without writes/removal. An owning caller may finalize even when SPUR_RUN_ID is set. Compute totals for that ledger; if an existing session_end row for it exists, do not append another. Otherwise append one existing-shape end event; on append failure return null and retain pointer. Before deletion reread the pointer and require both original ledger id and owner still equal; if replaced, leave it untouched. Removal failure is best-effort, but a replay detects the end row and may retry authorized cleanup without duplicating it. No new ledger event shape or new IPC. This guarantees sequential replay idempotence; concurrently independent sessions and lock/atomic multiwriter redesign remain out of scope.

**Legacy policy.** Ownerless pointers stay readable/reusable by tool recording, but shutdown cannot prove ownership and must not finalize/remove them. They expire under the existing uncorrelated idle-start behavior or are deliberately replaced by the operator; do not claim a legacy session_end that cannot be attributed. Document this bounded compatibility limit and update tests that currently seed ownerless happy-path pointers to seed an explicit owner. Corrupt/missing inputs remain null/fail-open.

**Tests / all callers.** hooks/context-hooks.test.ts: parent owner A start, nested B start with SPUR_RUN_ID returns same ledger, B end no-op, next real recordToolUseEvent attributed to A, A end once, A repeat no duplicate. Cover A itself carrying SPUR_RUN_ID, unknown identity, legacy pointer, mismatched host, malformed JSON, append failure, cleanup failure replay, pointer replacement before remove. hooks/token-estimate.test.ts preserves existing start behavior; pi/guard-extension.test.ts drives distinct ctx.sessionManager ids through real registered handlers and subsequent tool_result. Claude subprocess pins supply JSON stdin identities at both ends; never use test runner PID as identity. Update only hooks and indexed-context / docs/design/observability-contracts.md pointer/lifecycle ownership prose through doc-evolve. No migration/rewrite of historical ledgers.

**Scope/sequence.** No new public CLI surface or external dependency. 1158 owns redaction in the shared tool recorder, so preserve its summary behavior; no task dependency is required. Existing hook files import only builtins/relative/type references. Run focused hooks/Pi tests, standalone/smoke and required task gate; verify platform installation only via Superskill.

### Plan

1. [ ] R1/R3: add parent/child/next-tool regressions using distinct explicit identities in shared core and Claude/Pi adapters; observe current child teardown failure.
2. [ ] R1: store optional private pointer owner on creation, preserve reused ownership, thread real native identities from both adapters.
3. [ ] R2/R4: enforce owner-only finalization, prior-end deduplication and unchanged-pointer removal; preserve append-failure data.
4. [ ] R3/R4: cover legacy/malformed/missing identity, owner-with-run-id, replay/removal failure and replacement pointer paths; update seeded happy paths to owned pointers.
5. [ ] Run plugins/sp hooks/context-hooks.test.ts, hooks/token-estimate.test.ts and hooks/pi/guard-extension.test.ts from plugins/sp, update owning pointer prose, standalone/smoke and task gate; review/verify/record and commit.

### Solution

Owner-gated session finalization (task 1159): a nested run reuses its parent's ledger for tool
recording but can no longer finalize or delete it, and an owning shutdown is exactly-once.

The Claude stdin→owner derivation was extracted from both hooks' subprocess entrypoints (whose
bodies Bun's coverage never attributes) into a pure import-free module, so the adapter stays a few
lines and every derivation branch is directly unit-tested.

Change map (file:line):

- `plugins/sp/hooks/context-owner.ts:21` — `export interface SessionOwner { host: 'claude'|'pi'; sessionId: string }`, the frozen identity contract (never ledger id / pid / `SPUR_RUN_ID`).
- `plugins/sp/hooks/context-owner.ts:33` — `claudeSessionOwner(payload, env)`: payload `session_id`, falling back to `CLAUDE_CODE_SESSION_ID` only when the payload id is absent/empty.
- `plugins/sp/hooks/context-owner.ts:48` — `claudeHookOwnerFromPayloadText(text, env)`: exported, import-free stdin→owner derivation (`JSON.parse` in try/catch; malformed/empty → env-only fallback), shared by both hooks.
- `plugins/sp/hooks/context-session-start.ts:26` — re-exports `SessionOwner` and (line 29) `claudeSessionOwner` / `claudeHookOwnerFromPayloadText` from `./context-owner`, preserving this module as the hook surface consumers (`context-session-stop` type-only import, `pi/guard-extension`, tests) reach for.
- `plugins/sp/hooks/context-session-start.ts:89` — `resolveActiveSession`: exact ancestor `SPUR_RUN_ID` signal, else the idle-window heuristic.
- `plugins/sp/hooks/context-session-start.ts:126` — `recordSessionStart(dir, env, now, agentFallback, owner?)`: owner is the 5th argument; existing args/return preserved.
- `plugins/sp/hooks/context-session-start.ts:158` — owner id trimmed and host-validated inline (an invalid identity is dropped and the pointer is stored ownerless); a reused start returns the ledger id and writes nothing, so ownership is never transferred.
- `plugins/sp/hooks/context-session-start.ts:164` — pointer write guarded; a write failure returns null (the covered `catch` path).
- `plugins/sp/hooks/context-session-start.ts:208` — `recordSessionStartFromPayloadText(text, env)`: resolves the project context dir from `CLAUDE_PROJECT_DIR` and threads the derived owner into the core — the testable half of the adapter.
- `plugins/sp/hooks/context-session-start.ts:214` — `if (import.meta.main)` adapter: stdin read → pure helper → `process.exit(0)`, fail-open; a plain top-level-await block, not an IIFE, so it adds no uncovered function.
- `plugins/sp/hooks/context-session-stop.ts:43` — pointer-side `validSessionOwner` for the untrusted `.session.json` owner field.
- `plugins/sp/hooks/context-session-stop.ts:97` — `findSessionEnd` detects a prior `session_end` row so a replay never appends a second one.
- `plugins/sp/hooks/context-session-stop.ts:133` — `recordSessionEnd(dir, now?, caller?)`: owner added as the 3rd argument; existing args/return preserved.
- `plugins/sp/hooks/context-session-stop.ts:145` — ownership gate: missing / mismatched / malformed caller or a legacy ownerless pointer returns null with no writes and no removal.
- `plugins/sp/hooks/context-session-stop.ts:173` — prior end row suppresses the append; append failure returns null and retains the pointer; removal re-reads and requires both ledger id and owner unchanged, leaving a replaced pointer untouched.
- `plugins/sp/hooks/context-session-stop.ts:189` — `recordSessionEndFromPayloadText(text, env)`: testable stdin→finalize half mirroring the start adapter; the local `claudeSessionOwner` mirror is gone (imports `./context-owner`).
- `plugins/sp/hooks/context-session-stop.ts:198` — `if (import.meta.main)` adapter: stdin read → helper → `process.exit(0)`, fail-open.
- `plugins/sp/hooks/pi/guard-extension.ts:52` — `piSessionOwner(ctx)` from `ctx.sessionManager.getSessionId()`.
- `plugins/sp/hooks/pi/guard-extension.ts:265` — Pi `session_start` passes the session-manager identity.
- `plugins/sp/hooks/pi/guard-extension.ts:274` — Pi `session_shutdown` passes the identity, so a nested child's handler is a no-op.
- `plugins/sp/hooks/context-hooks.test.ts:821` — core regressions (parent A / nested B with `SPUR_RUN_ID` / next tool event / A end once / A repeat; owner-with-run-id; unknown, mismatched and malformed identity; legacy pointer; append failure; replay after removal failure; pointer replacement).
- `plugins/sp/hooks/context-hooks.test.ts:1023` — Claude stdin adapter regressions (child no-op, env fallback, payload precedence, malformed input, legacy pointer).
- `plugins/sp/hooks/context-hooks.test.ts:1130` — `claudeHookOwnerFromPayloadText` units (payload id, env fallback, precedence, empty/whitespace/non-string id, malformed JSON, `{}`/null/non-object, payload-supplied host ignored).
- `plugins/sp/hooks/context-hooks.test.ts:1202` — `recordSessionStartFromPayloadText` / `recordSessionEndFromPayloadText` units (dir resolution + owner recording, ownerless on malformed stdin, owner-matched finalize).
- `plugins/sp/hooks/context-hooks.test.ts:1260` — `recordSessionStart` pointer-write failure (EISDIR) and invalid-host owner rejection.
- `plugins/sp/hooks/pi/guard-extension.test.ts:663` — Pi regressions (nested child reuse/no-op/parent close, mismatched host, legacy pointer); fake contexts carry a stable session manager.
- `plugins/sp/skills/indexed-context/SKILL.md:147` — pointer/lifecycle ownership prose for the private session pointer.
- `docs/design/observability-contracts.md:74` — owner-gated teardown prose for the ledger surface.

No new ledger event shape, IPC, public CLI surface or dependency. Task 1158's tool-recorder
redaction is untouched. `plugins/sp/hooks/context-session-start.ts` is 221 lines, inside the
250-line plugin glue budget (`GLUE_BUDGET_LINES`, `scripts/commands/script-contract-check.ts:489`);
the change was a compaction only — no exported symbol, behaviour or test assertion was removed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Owner is frozen at pointer creation and only it may finalize/remove: `plugins/sp/hooks/context-owner.ts:21` (SessionOwner = host + host-native id, never pid/ledger id/SPUR_RUN_ID), `plugins/sp/hooks/context-session-start.ts:160` (owner stored only when host+id valid), `plugins/sp/hooks/context-session-stop.ts:148` (owner-equality gate), `plugins/sp/hooks/pi/guard-extension.ts:52` (Pi identity from the session manager). Verified end-to-end on the plugin Claude stdin adapter (parent A start -> child B end no-op -> parent end once) and the Pi handler path. One layer deferred: the installed Claude host dispatches SessionStart/SessionEnd to an external in-CLI runner (`plugins/sp/hooks/hooks.json:33`), so the Claude half's deployed effect is a cross-repo follow-up (reviewer P3 #1, DEFER). |
| R2 | MET | Exactly-once owning shutdown and nested reuse: `plugins/sp/hooks/context-session-start.ts:142` returns the reused ledger id and writes nothing, `plugins/sp/hooks/context-session-stop.ts:148` admits only the owner, `plugins/sp/hooks/context-session-stop.ts:153` suppresses a duplicate append on replay. Reproduced on the Claude stdin adapter: parent start -> child start with SPUR_RUN_ID -> child end (no row, pointer kept) -> parent tool event under the same ledger -> parent end once -> repeat end no second row. Tests `plugins/sp/hooks/context-hooks.test.ts:827` and `plugins/sp/hooks/pi/guard-extension.test.ts:667`. |
| R3 | MET | Reproducing regressions added at the existing seams and re-run fresh: `plugins/sp/hooks/context-hooks.test.ts:827` (core), `:1024` (Claude stdin adapter), `:1130` (owner derivation), `:1202` (stdin-to-core halves), `:1260` (pointer-write + invalid-host guards), `plugins/sp/hooks/pi/guard-extension.test.ts:663` (Pi). Focused suite 174 pass / 0 fail (443 expect); hooks/ dir 386 pass / 0 fail. Falsification: the pre-fix `plugins/sp/hooks/context-session-stop.ts` source destroys the parent pointer on a child end (one session_end row, pointer removed), while the current source writes no row and retains it. |
| R4 | MET | Fail-closed for missing/mismatched/malformed caller and legacy ownerless pointers (`plugins/sp/hooks/context-session-stop.ts:146-148` returns null with no writes/removal); replay after removal failure dedups (`:153`); append failure returns null and retains the pointer (`:166`); removal re-reads and requires id+owner unchanged (`:172-174`). Reproduced: legacy pointer untouchable with ledger bytes unchanged, append-failure (dir at ledger path) keeps pointer, pointer replaced during recording survives, unknown/mismatched identity cannot finalize. Tests `plugins/sp/hooks/context-hooks.test.ts:886`, `:906`, `:961`, `:986`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Child shutdown preserves parent ledger ownership (req: R1, R3) | MET | test | Child end leaves the parent owner and pointer intact and the parent closes once, through both plugin adapters: Claude stdin regression `plugins/sp/hooks/context-hooks.test.ts:1024` and Pi session-manager regression `plugins/sp/hooks/pi/guard-extension.test.ts:667`; fresh focused suite 174 pass / 0 fail. Confirmed at the plugin adapter seam only; the deployed Claude wiring is the deferred layer noted on R1. |
| AC2 — Owning shutdown is idempotent (req: R2, R3, R4) | MET | test | `plugins/sp/hooks/context-hooks.test.ts:867` (owner end with SPUR_RUN_ID set emits one session_end), `:961` (replay after removal failure yields exactly one row and retries cleanup), repeat-end no-duplicate assertions in `:827`; reproduction totalled `{reads:1,writes:0,tokens:3}`. |
| AC3 — Unknown and replaced ownership stays safe (req: R1, R3, R4) | MET | test | `plugins/sp/hooks/context-hooks.test.ts:906` (legacy ownerless pointer never finalized, historical bytes unchanged), `:886` (missing/host-mismatch/id-mismatch/malformed caller cannot finalize), `:986` (pointer replaced during recording left untouched, append failure retains pointer); Pi legacy + host-mismatch coverage in `plugins/sp/hooks/pi/guard-extension.test.ts:663`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — no blocking (P1-P3) findings on the reviewed revision.

Review note: the reviewed revision carries two gate-driven remediation hops that preceded this review (hop 1 compacted `context-session-start.ts` inside the 250-line plugin glue budget; hop 2 extracted the Claude stdin→owner derivation into the pure `context-owner.ts` module to clear the 90/90 per-measured-file coverage threshold). They moved code only; nothing was dropped or weakened, and the frozen exported surface (`SessionOwner` re-exported from `context-session-start.ts`, type-only import in `context-session-stop.ts`) is intact.

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | functional/integration | The changed Claude hook files are not the runtime on the installed Claude path: `hooks.json` routes SessionStart/SessionEnd to `superskill hook run sp context-session-*`, and the installed superskill implements those runners in-CLI with its own `.session-<sha16>.json` pointer and no owner field, so the plugin's `.session.json` ownership never appears there. Pre-existing duplication (tasks 0398/0600); cross-repo and outside this task's declared scope. The Pi extension path (live via `plugin.json`) does exercise the fix. | `plugins/sp/hooks/hooks.json:33,88` | DEFER — cross-repo superskill runner duplication; pre-existing and out of task scope (follow-up candidate) |
| 2 | P3 (minor) | correctness | `findSessionEnd` dedups `session_end` by ledger id, but ids are minute-granular (`session-YYYY-MM-DD-HHMM`), so a new session started in the same minute as an already-ended one shares the id and receives no `session_end` row. Pre-existing id scheme; the dedup itself is frozen by the design's end algorithm. | `plugins/sp/hooks/context-session-stop.ts:97,153` | DEFER — pre-existing minute-granular id scheme; dedup is design-frozen (follow-up candidate) |
| 3 | P4 | architecture | `SessionOwner`'s canonical definition moved to `context-owner.ts` (re-exported from `context-session-start.ts`); the frozen exported surface and the type-only stop→start import are preserved, but the type's home deviates from the design's literal wording. | `plugins/sp/hooks/context-owner.ts:21` | ACCEPTED |
| 4 | P4 | security | The `CLAUDE_CODE_SESSION_ID` env fallback is not protected against inheritance: a nested child whose payload omits `session_id` but inherits the parent env id would derive the parent owner. The payload id normally takes precedence; the fallback is design-frozen. | `plugins/sp/hooks/context-owner.ts:33-41` | ACCEPTED |
| 5 | P4 | functional | Independent concurrent sessions in one project can strand one another (B reuses A's pointer via the idle heuristic, B's end no-ops, A's teardown removes the shared pointer). Explicitly out of scope per Design ("Simultaneous independent-session arbitration is a separate design"); pre-existing. | `plugins/sp/hooks/context-session-start.ts:89-110,142` | ACCEPTED |
| 6 | P4 | correctness | Both entrypoints now `await Bun.stdin.text()`; an open-but-silent stdin delays the hook until the 15 s hook timeout. Bounded by that timeout and moot on the `superskill hook run` path (bounded reader). | `plugins/sp/hooks/context-session-start.ts:214-218` | ACCEPTED |

Verification performed in review: read the implementation and both adapters; 18 of the new tests were confirmed to fail against the pre-fix source (falsification); owner-gating, legacy-pointer, host-mismatch, append-failure, replay-after-removal-failure and pointer-replacement probes reproduced independently; Pi and Claude adapters driven with distinct explicit identities. Focused suite: 174 pass / 0 fail. Per-file coverage on the touched hooks: `context-session-start.ts` 100 % funcs / 95.65 % lines, `context-session-stop.ts` 100 % / 96.04 %, `context-owner.ts` 100 % / 100 %.

### References

`plugins/sp/hooks/context-session-start.ts:105`; `plugins/sp/hooks/context-session-stop.ts:58`; `plugins/sp/hooks/context-session-stop.ts:88`

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

- 2026-10-10T07:29:47.546Z backlog → todo (system)
- 2026-10-10T18:04:34.879Z todo → wip (system)
- 2026-10-10T22:52:13.898Z wip → testing (system)
- 2026-10-10T22:52:23.325Z testing → done (system)

