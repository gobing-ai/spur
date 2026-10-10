---
schema_version: 1
name: Preserve parent ledger ownership when nested sessions end
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:43.485Z
updated_at: "2026-10-10T16:30:37.903Z"
feature_id: H21

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
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

- [ ] R1. Record session owner identity at pointer creation and allow only that owner to finalize or remove the pointer across Claude and Pi adapters
- [ ] R2. Owner shutdown emits exactly one session_end and nested starts continue reusing the parent ledger
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.
- [ ] R4. Missing/mismatched identity and legacy ownerless pointers cannot be finalized or removed by a child. A repeated owning end, including replay after pointer-removal failure, emits at most one session_end; append failure or pointer replacement cannot destroy a newer pointer. Historical ledger data is never rewritten.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

