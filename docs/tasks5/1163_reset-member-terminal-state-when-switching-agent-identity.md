---
schema_version: 1
name: Reset member terminal state when switching agent identity
status: done
template: feature-impl
created_at: 2026-10-10T07:30:32.317Z
updated_at: "2026-10-10T18:54:49.135Z"
feature_id: G63

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 3
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1163-verdict.json
---

## 1163. Reset member terminal state when switching agent identity

### Background

Reusing MemberTerminal for a different member retains prior output, input, status and last sequence; beta replay below alpha sequence is dropped Evidence: `apps/web/src/modules/projects/MemberTerminal.tsx:143`; `apps/web/src/modules/projects/MemberTerminal.tsx:150`; callers `apps/web/src/modules/projects/MemberDetail.tsx:386` and `apps/web/src/modules/projects/ProcessesView.tsx:559`. Review a71c confirmed this using render alpha output sequence 100, rerender beta, deliver beta sequence 20; beta connected with sinceSeq=100 and displayed alpha output. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Current-tree search finds ONE MemberTerminal JSX call, MemberDetail.tsx:386. ProcessesView.tsx:559 now renders MemberDetail, not MemberTerminal; its selectedEntry.instanceId derives from the same agentId passed through the detail. Fix the shared terminal call once and cover both selection paths.
- Stream identity is agentId, sourced from entry.instanceId. sessionId is display metadata and the component intentionally resumes sequence across same-agent respawn. Do not key by sessionId, PID, status or process registry row key.
- Existing cleanup already closes EventSource, clears reconnect timeout, aborts the active status fetch and clears its interval. A React key change invokes that cleanup and resets all terminal state/refs; no parallel prop-reset effect or protocol change is needed.

### Requirements

- [x] R1. Key the shared MemberDetail terminal by entry.instanceId, the agentId used in its stream URL, so selecting a different agent remounts all identity-owned state and closes the old stream across both fleet and ProcessesView selection.
- [x] R2. Same-agent rerenders/reconnects/respawns preserve the sequence cursor; changing display session metadata alone does not remount. Unmount cancels the old reconnect timer, status poll and stream.
- [x] R3. Add real terminal selection regressions for alpha sequence100 to beta20, caller coverage and same-agent reconnect/cleanup controls.

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

Change map (paths repo-relative; one anchor per row):

| Change | Location |
| --- | --- |
| Fix — key the SOLE `<MemberTerminal>` render by `entry.instanceId` (the value already passed as `agentId`), so selecting another agent remounts the terminal and React runs its existing cleanup: close the EventSource, clear the reconnect timer, abort the in-flight status fetch, clear its interval. `ProcessesView` renders this same `MemberDetail`, so one JSX site covers fleet and watch-list selection | `apps/web/src/modules/projects/MemberDetail.tsx:390` |
| AC1 isolated real-renderer probe — real `MemberDetail` + real `MemberTerminal`: alpha output at seq 100 plus typed input and a non-default status, then beta replaying from seq 20; asserts alpha's stream closed, beta's URL carries no `sinceSeq`, alpha output/input/error/status gone, beta output rendered | `apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:165` |
| AC1 containment probe — the aborted pending alpha status poll and a late callback on alpha's closed stream cannot set beta's status or render into beta's DOM, and a late alpha error schedules no reconnect | `apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:206` |
| AC2 probe — a sessionId-only change for the SAME `instanceId` keeps one stream, the frames and the seq cursor (replayed seq 20 deduped, 21 appended) | `apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:276` |
| AC2 probe — unmount clears the `STATUS_POLL_MS` interval (one recorded `clearInterval`) and aborts the in-flight status request | `apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:342` |
| R1/R3 caller probe — `ProcessesView` selection: opening beta after alpha closes alpha's stream, starts a fresh cursor and drops the shared frame | `apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:350` |
| Design-pinned AC entry (repo's established pattern) — spawns the probe with `bun test --isolate --reporter=junit`, asserts exit code, test count, zero failures, the exact expected regression names and an assertion floor, so a probe that stopped rendering fails instead of passing vacuously | `apps/web/tests/modules/projects/member-terminal-identity.test.ts:49` |
| Extended `MemberTerminal` reconnect regression — seq 100 delivered, disconnect, scoped fake `setTimeout` advanced (no wall-clock sleep), new SAME-agent stream carries `sinceSeq=100` and dedup still drops the replayed 100 | `apps/web/tests/modules/projects/MemberTerminal.test.tsx:618` |
| Keyed-caller control — only `sessionId` changes: no new stream, same cursor, frames preserved | `apps/web/tests/modules/projects/MemberTerminal.test.tsx:662` |
| Keyed-caller control — a scheduled reconnect is cancelled when the caller switches agent: the old key's timer is cleared and advancing it opens no new alpha stream | `apps/web/tests/modules/projects/MemberTerminal.test.tsx:699` |
| Cleanup control — unmount clears the status interval and aborts the in-flight poll | `apps/web/tests/modules/projects/MemberTerminal.test.tsx:741` |
| Scoped timer harness `scopedFakeTimeouts` (globals restored on every exit path) plus the keyed caller the reconnect controls drive | `apps/web/tests/modules/projects/MemberTerminal.test.tsx:84` |
| `ProcessesView` suite keeps its own controllable `EventSource` (installed in `beforeAll`, restored in `afterAll`) so the aggregate-suite caller coverage does not mock the terminal away | `apps/web/tests/modules/projects/ProcessesView.test.tsx:26` |
| `ProcessesView` caller regression — alpha frame at seq 100, then selecting beta: alpha closed, beta URL free of `sinceSeq`, alpha line gone | `apps/web/tests/modules/projects/ProcessesView.test.tsx:547` |

**Why a key only.** `agentId` already is the stream identity (`streamUrl(agentId, lastSeq)`), and `sessionId` is display metadata the component deliberately resumes across a same-agent respawn. Keying exactly by `entry.instanceId` therefore remounts all identity-owned state — frames, `input`/`inputError`, `status`/`connected`, `lastSeqRef`, backoff attempts — while a respawn or a session-display change for the same instance keeps its key, its cursor and its stream. No reset effect, wrapper, second terminal, server or protocol change: the remount drives the cleanup `MemberTerminal` already had.

**Why the probe is a separate process.** Sibling project suites install a process-global fake `EventSource` (MemberDetail/AgentsView/a11y/responsive) and Bun's last registration wins for the whole run, so the real-renderer identity regression cannot own its stream in the aggregate process — the same trap the 1162 sibling hit with `mock.module`. `member-terminal-identity-pipeline.tsx` deliberately omits `.test`/`.spec`, so the aggregate runner never collects it; the entry spawns it under `bun test --isolate` and fails if any expected regression stops running. The aggregate-suite `ProcessesView` coverage installs its fake only inside its own `beforeAll`/`afterAll` window, so no other suite inherits it.

**Non-vacuity (measured, not assumed).** Removing `key={entry.instanceId}` and re-running the probe fails three of its five regressions with `beta`'s stream URL reading `…/processes/beta/stream?sinceSeq=100` (the reported defect), and fails the aggregate `ProcessesView` regression at the same assertion. Restoring the key turns them green again.

**Static checks.** `bunx biome check` clean on the five changed files and `tsc --noEmit` clean in `@gobing-ai/spur-web`; the light gate's `rules:pre` preset passes (51 rules). `probe: not-applicable (no public surface changed)` — no CLI verb/flag, HTTP route or plugin script entry is touched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Sole MemberTerminal JSX site now keyed by entry.instanceId beside its existing agentId, both `entry.instanceId`: apps/web/src/modules/projects/MemberDetail.tsx:389-393. Repo-wide grep '<MemberTerminal' under apps/web/src returns exactly one render site (MemberDetail.tsx:389), and ProcessesView renders that same detail with instanceId set from the row's agentId at apps/web/src/modules/projects/ProcessesView.tsx:263-269 and apps/web/src/modules/projects/ProcessesView.tsx:559. Real-renderer probes assert alpha's stream closed and beta's URL free of sinceSeq for fleet selection (apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:165) and watch-row selection (apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:360); aggregate caller regression at apps/web/tests/modules/projects/ProcessesView.test.tsx:496. |
| R2 | MET | Same instanceId yields same key, so no remount: apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:276 proves one stream plus preserved frames and cursor across a sessionId-only change (replayed seq 20 deduped, 21 appended), and apps/web/tests/modules/projects/MemberTerminal.test.tsx:662 drives the same through the keyed caller. Reconnect resumes the cursor: apps/web/tests/modules/projects/MemberTerminal.test.tsx:618 asserts the new same-agent stream carries sinceSeq=100 with dedup intact. Cleanup on switch/unmount: apps/web/tests/modules/projects/MemberTerminal.test.tsx:699 (pending reconnect timer cleared, advancing it opens no new alpha stream), apps/web/tests/modules/projects/MemberTerminal.test.tsx:741 and apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:302 (one recorded clearInterval, in-flight status request aborted, stream closed). MemberTerminal.tsx is unmodified; the remount invokes its existing effect cleanups at apps/web/src/modules/projects/MemberTerminal.tsx:186-189 and apps/web/src/modules/projects/MemberTerminal.tsx:228-237. |
| R3 | MET | New regressions: the isolated real-renderer probe apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx (alpha100 to beta20, stale-alpha containment at :206, session-metadata control at :276, unmount cleanup at :302, ProcessesView selection at :360), gated by apps/web/tests/modules/projects/member-terminal-identity.test.ts:49, which spawns the probe under bun test --isolate --reporter=junit and fails on exit code, test count, failure count, missing expected names, or an assertion floor above 30. Aggregate caller coverage at apps/web/tests/modules/projects/ProcessesView.test.tsx:496 and extended reconnect/key-control regressions at apps/web/tests/modules/projects/MemberTerminal.test.tsx:618,662,699,741. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Reproducing edge case is safe (req: R1, R3) | MET | test | apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:165 renders real MemberDetail plus real MemberTerminal with alpha output, typed input and status running at seq 100, then rerenders beta and delivers seq 20; it asserts alpha's stream is closed, beta's URL lacks sinceSeq, alpha output/input/error are gone, beta status is unknown, and only beta-line renders. Containment probe at apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:206 shows the aborted alpha poll and a late alpha callback cannot set beta status or render. Ran green this session: 5 pass / 0 fail. |
| Scenario: AC2 — Existing behavior remains supported (req: R2, R3) | MET | test | Reconnect-and-cursor-preservation: apps/web/tests/modules/projects/MemberTerminal.test.tsx:618 delivers seq 100, disconnects, advances a scoped fake timer, and asserts the new same-agent stream carries sinceSeq=100 with replayed seq deduped; sessionId-only control at apps/web/tests/modules/projects/MemberTerminal.test.tsx:662 keeps one stream, frames and cursor. Cleanup cancels old timers and streams: apps/web/tests/modules/projects/MemberTerminal.test.tsx:699,741 and apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:302. Ran green this session: 5 pass / 0 fail isolated probe, 184 pass / 0 fail projects aggregate. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1163

**Scope:** working-tree diff of `apps/web/src/modules/projects/MemberDetail.tsx` (+8/-1) plus the 3 modified and 2 new `apps/web/tests/modules/projects/*` files. Task 1162's committed files (`0505d8c6f`) sat between 1163's precheck base SHA and HEAD; the 23-file `.spur/run/1163-diffstat.json` is that base-SHA artifact and was excluded from this review.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness (docs) | Three Solution change-map anchors drifted a few lines during implementation: the pipeline unmount probe points at `:342` (test body starts `:302`), the pipeline ProcessesView probe at `:350` (a `describe` header; the test is `:360`), and the ProcessesView caller regression at `:547` (mid-test; the test starts `:496`). Every stale anchor still lands inside or on the intended probe, so navigation is unimpaired | `docs/tasks5/1163_reset-member-terminal-state-when-switching-agent-identity.md:81,82,90` | ACCEPTED |
| 2 | P4 (advisory) | correctness (tests) | `MemberTerminal.test.tsx:618` leaves the terminal mounted (live 3000 ms status interval + open fake stream) because global cleanup is trailing in the test body rather than an `afterEach`; a mid-test assertion throw would leak the mock `EventSource` into later tests in the file. Identical to the file's pre-existing convention (`:223`, `:246`, …) — no new risk introduced | `apps/web/tests/modules/projects/MemberTerminal.test.tsx:618` | ACCEPTED |

No P1–P3 findings. The fix is exactly the frozen design: one key, no `MemberTerminal` internals change, no reset effect, no protocol change.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Sole `<MemberTerminal>` JSX site now carries `key={entry.instanceId}` beside `agentId={entry.instanceId}` — `apps/web/src/modules/projects/MemberDetail.tsx:390`. `grep -rn '<MemberTerminal' apps/web/src` → one site; `ProcessesView.tsx:559` renders this same `MemberDetail` with `instanceId: agentId` derived from the selected watch row (`ProcessesView.tsx:263-269`), so fleet and watch-list selection share the seam. Real-renderer probe asserts alpha's stream closed + beta URL without `sinceSeq` (`apps/web/tests/modules/projects/member-terminal-identity-pipeline.tsx:165`) and the watch-row path (`:360`); aggregate caller coverage at `apps/web/tests/modules/projects/ProcessesView.test.tsx:496`. |
| R2 | MET | Same `instanceId` → same key → no remount: `member-terminal-identity-pipeline.tsx:276` asserts one stream, frames and cursor preserved across a sessionId-only change (seq 20 deduped, 21 appended); `MemberTerminal.test.tsx:662` drives the same through the keyed caller. `MemberTerminal.test.tsx:618` asserts a same-agent reconnect resumes `sinceSeq=100` with dedup intact. Unmount cancels the reconnect timer, status poll and stream: `MemberTerminal.test.tsx:699` (cleared timer, no new stream after advancing it), `:741` and `member-terminal-identity-pipeline.tsx:302` (one `clearInterval`, in-flight poll aborted, stream closed). No edit to `MemberTerminal.tsx`; existing cleanup at `MemberTerminal.tsx:175-190,228-237` is what the remount invokes. |
| R3 | MET | New AC1/AC2 regressions: isolated real-renderer probe `member-terminal-identity-pipeline.tsx` (alpha@100→beta@20, stale-alpha containment, session-metadata control, unmount cleanup, ProcessesView selection) gated by `member-terminal-identity.test.ts:49`, which spawns it under `bun test --isolate --reporter=junit` and fails on exit code, count, failure count, missing expected names or an assertion floor (44 assertions observed vs the >30 floor). `ProcessesView.test.tsx:496` covers the caller path inside the aggregate. Non-vacuity was measured by the driver (key removed → 3 of 5 probes fail with `beta`'s URL reading `sinceSeq=100`), not assumed. |
| AC1 | MET | `member-terminal-identity-pipeline.tsx:165` — alpha output/typed input/non-default status present, then beta renders only `beta-line` with empty input, no `data-input-error`, status back to `unknown`, and a beta URL free of `sinceSeq`. |
| AC2 | MET | `member-terminal-identity-pipeline.tsx:276` (same-stream/cursor across session metadata) and `MemberTerminal.test.tsx:618` (reconnect resumes `sinceSeq=100`, replayed seq deduped); `:699`/`:741`/`:302` prove cleanup cancels old timers, polls and streams. |

##### Verification evidence (run this session, tree unmodified)

`(cd apps/web && bun test tests/modules/projects/)`:
```
 184 pass
 0 fail
 777 expect() calls
Ran 184 tests across 19 files. [3.39s]
```

`(cd apps/web && bun test --isolate ./tests/modules/projects/member-terminal-identity-pipeline.tsx)`:
```
(pass) MemberDetail: agent-identity selection (1163 R1) > real MemberDetail: alpha@seq100 → beta@seq20 drops alpha state and replays beta [52.41ms]
(pass) MemberDetail: agent-identity selection (1163 R1) > real MemberDetail: stale alpha callbacks cannot touch beta DOM [19.43ms]
(pass) MemberDetail: agent-identity selection (1163 R1) > real MemberDetail: session metadata changes keep the same stream and cursor [20.89ms]
(pass) MemberDetail: agent-identity selection (1163 R1) > real MemberDetail: unmount aborts the status request and clears the poll interval [21.87ms]
(pass) ProcessesView: selection reaches the shared keyed terminal (1163 R1) > selecting a different watch row remounts the shared detail terminal [41.25ms]

 5 pass
 0 fail
 44 expect() calls
Ran 5 tests across 1 file. [666.00ms]
```

`(cd apps/web && bun test ./tests/modules/projects/member-terminal-identity.test.ts)` → `1 pass / 0 fail` (the isolated probe passed from inside the aggregate process too).
`bunx biome check` on the five changed/new files → `Checked 5 files in 45ms. No fixes applied.` The negative control (key removed) was **not** repeated per instruction; the driver's measurement stands as the non-vacuity evidence.

##### Architecture, security, efficiency, usability

Architecture: the key is placed at the existing ownership boundary — stream identity (`agentId`) already equals `entry.instanceId`, and the component's existing effect cleanup is the reset mechanism, so no new state, wrapper or effect is introduced. Security: no trust boundary, transport, protocol or URL construction touched; keying does not alter the SSE URL or `sinceSeq` semantics. Efficiency: no added renders beyond the intended remount; test harness uses scoped fake timers and no wall-clock sleeps. Usability: switching agent clears the previous agent's output/input/status (intended), and the frozen layout/accessibility attributes (`data-member-terminal`, `data-terminal-status`, `data-terminal-input`, `data-input-error`) are unchanged.

**Next:** task gate already PASS (`1163-test-gate.log`); proceed to verify/record.

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
- 2026-10-10T18:29:39.142Z todo → wip (system)
- 2026-10-10T18:54:41.200Z wip → testing (system)
- 2026-10-10T18:54:49.131Z testing → done (system)

