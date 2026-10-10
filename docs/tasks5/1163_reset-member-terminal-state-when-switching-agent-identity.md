---
schema_version: 1
name: Reset member terminal state when switching agent identity
status: todo
template: feature-impl
created_at: 2026-10-10T07:30:32.317Z
updated_at: "2026-10-10T16:34:44.763Z"
feature_id: G63

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
---

## 1163. Reset member terminal state when switching agent identity

### Background

Reusing MemberTerminal for a different member retains prior output, input, status and last sequence; beta replay below alpha sequence is dropped Evidence: `apps/web/src/modules/projects/MemberTerminal.tsx:143`; `apps/web/src/modules/projects/MemberTerminal.tsx:150`; callers `apps/web/src/modules/projects/MemberDetail.tsx:386` and `apps/web/src/modules/projects/ProcessesView.tsx:559`. Review a71c confirmed this using render alpha output sequence 100, rerender beta, deliver beta sequence 20; beta connected with sinceSeq=100 and displayed alpha output. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Current-tree search finds ONE MemberTerminal JSX call, MemberDetail.tsx:386. ProcessesView.tsx:559 now renders MemberDetail, not MemberTerminal; its selectedEntry.instanceId derives from the same agentId passed through the detail. Fix the shared terminal call once and cover both selection paths.
- Stream identity is agentId, sourced from entry.instanceId. sessionId is display metadata and the component intentionally resumes sequence across same-agent respawn. Do not key by sessionId, PID, status or process registry row key.
- Existing cleanup already closes EventSource, clears reconnect timeout, aborts the active status fetch and clears its interval. A React key change invokes that cleanup and resets all terminal state/refs; no parallel prop-reset effect or protocol change is needed.

### Requirements

- [ ] R1. Key the shared MemberDetail terminal by entry.instanceId, the agentId used in its stream URL, so selecting a different agent remounts all identity-owned state and closes the old stream across both fleet and ProcessesView selection.
- [ ] R2. Same-agent rerenders/reconnects/respawns preserve the sequence cursor; changing display session metadata alone does not remount. Unmount cancels the old reconnect timer, status poll and stream.
- [ ] R3. Add real terminal selection regressions for alpha sequence100 to beta20, caller coverage and same-agent reconnect/cleanup controls.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given alpha terminal output, typed input and sequence 100 followed by selecting beta
  When beta sends its replay beginning at sequence 20
  Then beta displays only beta output, starts a fresh cursor and has cleared input and prior status

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given a transient disconnect and reconnect for the same member
  When the existing supported operation executes
  Then Reconnecting to the same member preserves its sequence cursor and cleanup cancels old timers and streams
```

### Q&A

- Closed: one shared JSX site in MemberDetail; ProcessesView is a caller of that detail. Use entry.instanceId exactly as the stream agentId.
- Closed: same-agent reconnect and session display changes preserve state; agent identity changes remount.
- Closed: reuse existing cleanup; a key-only source fix is sufficient unless the real cleanup regression demonstrates otherwise. No server/protocol changes.

### Design

**Minimal fix.** Add key={entry.instanceId} to the sole MemberTerminal render in apps/web/src/modules/projects/MemberDetail.tsx, alongside its existing agentId={entry.instanceId}. ProcessesView renders that shared detail, so no duplicate terminal or outer MemberDetail key is needed. Keep MemberTerminal internals and other detail state untouched unless a targeted cleanup regression exposes a pre-existing defect necessary to this invariant. No new API, wrapper or reset effect. Terminal state includes frames, input/inputError, connection/status, lastSeqRef and backoff; all reset by the key. sessionId/PID/status changes for the SAME instance keep the same key and cursor, including respawn. Re-selecting after an actual unmount starts fresh as today; this task does not persist per-agent scrollback.

**Tests / observability.** Extend apps/web/tests/modules/projects/MemberDetail.test.tsx using real MemberTerminal and a fake EventSource (mock fetch/context only). Render alpha, deliver sequence100, set typed input and non-default status, rerender the same detail with beta, and deliver beta sequence20. Assert alpha stream closed, beta URL has no sinceSeq, alpha output/input/error/status absent, beta output visible and input submission targets beta if exercised. Pending alpha fetch completions and old stream callbacks must not alter beta's DOM. Add ProcessesView.test.tsx selection coverage that reaches the shared detail; its fixture must not mock away the terminal/key behavior. A mocked terminal may supplement identity wiring but cannot replace the real alpha→beta regression.

Extend MemberTerminal.test.tsx reconnect test: deliver seq100, disconnect, advance a scoped fake timer, assert new SAME-agent stream includes sinceSeq=100 and dedup remains intact; change only sessionId via the keyed caller and confirm no new stream/reset. Schedule reconnect then switch/unmount; advance timers and ensure no new alpha stream. Verify status interval cleared/active request aborted and restore timer/fetch/EventSource globals in finally/afterEach. No wall-clock multi-second sleeps or server protocol fixtures needed. Read root DESIGN.md before editing; preserve current terminal accessibility/layout.

**Scope / dependencies.** No dependency on 1162 (Markdown-only). No server replay/sequence redesign, historical terminal cache, project-switch semantics, transport changes or outer-detail state cleanup. InstanceId matches the existing stream identity contract, not a newly invented identifier.

### Plan

1. [ ] R1/R3: add real MemberDetail alpha100→beta20 rerender regression with typed input/status and old-stream/fetch completion controls.
2. [ ] R1: key the sole terminal JSX by entry.instanceId; verify fleet and ProcessesView reach the shared seam.
3. [ ] R2/R3: strengthen same-agent sinceSeq reconnect and session-metadata controls; verify pending reconnect/status poll cancellation on switch/unmount using scoped timers.
4. [ ] Run MemberDetail, MemberTerminal and ProcessesView suites from apps/web; preserve existing stdin/error/sequence behavior and UI accessibility.
5. [ ] Run task gate, review/verify, record evidence and commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`apps/web/src/modules/projects/MemberTerminal.tsx:143`; `apps/web/src/modules/projects/MemberTerminal.tsx:150`; callers `apps/web/src/modules/projects/MemberDetail.tsx:386` and `apps/web/src/modules/projects/ProcessesView.tsx:559`

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 3.

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

- 2026-10-10T07:30:37.658Z backlog → todo (system)

