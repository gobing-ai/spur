---
schema_version: 1
name: Require project ownership before registry and CLI cleanup signal a listener
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:30.396Z
updated_at: "2026-10-10T16:28:18.810Z"
feature_id: K3

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 5
---

## 1156. Require project ownership before registry and CLI cleanup signal a listener

### Background

Registry list automatically terminates whatever PID owns a stale deleted project port, and CLI stop has the same unverified port-to-PID boundary Evidence: `packages/app/src/services/project-registry.ts:600` (discovery) and `packages/app/src/services/project-registry.ts:605` (signal). Review a71c confirmed this using injected port/PID/signal seams that recorded ordinary list sending SIGTERM to an unrelated PID. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Confirmed refreshProjects:600–613 signals a port-discovered PID and CLI projects stop:427–444 independently signals fuser output. list/getByName/getByPath reach refresh indirectly, so the shared app seam must cover both explicit and automatic cleanup.
- isPortLive and defaultResolveOwnerPort are TCP probes, not HTTP identity proof. Existing /api/health exposes service:spur and /api/project exposes normalized path; neither returns PID. Combine those endpoints with stable PID rediscovery, rather than trusting a health probe or inventing a second wire identity.
- The server-owner claim lives in the deleted directory and may be unavailable during stale cleanup; do not require reading that file or treat its absence as proof of ownership. The documented local HTTP identity plus stable PID is the selected proof.
- Existing termination arrays claim success even when sendSignalToPid returns false or a replacement listener appears. Require observed disappearance of the verified listener before recording termination; CLI refusal must not print Stopped.

### Requirements

- [ ] R1. Require verified Spur server and exact project ownership before signaling any process in refresh or CLI stop; make unverified listeners non-destructive
- [ ] R2. Existing project listings and verified owned-server cleanup remain supported, and foreign listeners survive
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.
- [ ] R4. Before each SIGTERM/SIGKILL, verify service:spur and exact canonical project path over the same loopback host, and rediscover the listener PID unchanged. Missing/malformed/mismatched identity, network timeout, self/parent PID or PID change means no signal. Do not signal a replacement listener while waiting/escalating.
- [ ] R5. Report termination only after a signal succeeded and the original listener disappeared. Explicit stop of a live unverified listener uses the existing error/exit-1 response and leaves its registry port intact; absent listener is an idempotent successful stop and clears the stale port. Refresh may purge a deleted registration but leaves terminated empty for unverified/failed cleanup.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Foreign listeners survive automatic and explicit cleanup (req: R1, R3, R4, R5)
  Given a deleted project port belongs to a foreign service or a Spur server serving a different path
  When registry list or refresh observes it
  Then no signal is sent and the deleted registration is purged with no terminated entry
  And explicit stop of an existing project on that foreign port returns an error without clearing its port or reporting Stopped

Scenario: AC2 — Verified cleanup keeps existing success responses (req: R2, R3, R4, R5)
  Given a live Spur listener whose project path exactly matches the selected registration and whose PID remains stable
  When the shared stop operation confirms shutdown after SIGTERM or verified SIGKILL
  Then the confirmed termination is reported and CLI stop clears the port with its existing success shape
  And an already absent listener stops idempotently without signals

Scenario: AC3 — Changed or unknown identity blocks every signal (req: R3, R4, R5)
  Given malformed identity, a request timeout, a self or parent PID, or listener replacement during discovery or escalation
  When cleanup considers sending SIGTERM or SIGKILL
  Then no unverified or replacement process is signaled
  And failed signals or unconfirmed shutdown never produce a terminated record
```

### Q&A

- Closed: use the existing /api/health service and /api/project canonical path plus stable PID rediscovery. TCP liveness and a process name are insufficient.
- Closed: deleted paths need no surviving server-owner marker; absent HTTP identity is a conservative refusal.
- Closed: a live unverified CLI stop exits1 through the existing error shape and preserves the port; registry refresh may purge the deleted entry but cannot claim a kill.
- Closed: every escalation revalidates ownership; no blind KILL after health disappears. Portable PID reuse has a residual check-to-signal race, no pidfd/platform redesign in this task.

### Design

**Shared app owner / frozen names.** Add packages/app/src/services/project-stop.ts with stopRegisteredProject(entry, options) and internal verifyProjectListener(entry, options) used by both refreshProjects and the thin CLI stop transport. Export stopRegisteredProject from the app facade; no new CLI verb/flag/contract DTO, no dependency. Reuse findListeningPid, sendSignalToPid, isPortLive and normalizeProjectPath; preserve the existing registry result aliases. Internal result is {stopped:boolean, terminated?:TerminatedProcessInfo, reason?:string}; caller maps refusal to its existing error channel, not a new public success shape. Options carry existing executor/timeout seams and an injectable fetch implementation for tests. Keep process operations in packages/app.

**Ownership algorithm.** Discover PID and reject undefined, pid<=1, process.pid or process.ppid. Probe http://127.0.0.1:<port>/api/health then /api/project with redirect:error and a finite 1s request timeout; if host unavailable, retry both on http://[::1]:<port> (never mix identity responses across hosts). Require successful status, parsed object health.service==='spur', and a string project.path whose normalized path equals the selected already-normalized registry path exactly. Invalid JSON/null/project mismatch/network failure fails closed. Rediscover listener PID after the probes; require equality to the initial PID immediately before signaling. A legacy server without project identity cannot be stopped automatically. No directory-existence/port/process-name-only ownership inference. This is local ownership verification, not authentication against a malicious local server, and portable PID checks cannot make OS kill atomic; state that residual race honestly.

**Termination / reporting.** Call shared helper from refresh only when terminateProcesses is enabled and deleted entry has a live port; unrelated listeners survive and deleted entries are still purged. CLI stop uses the same helper after lookup. For an absent listener return stopped:true, clear port, preserve existing successful output. For an unverified live listener return refusal, preserve port and exit1 using the existing {ok:false,error} shape. If SIGTERM fails, return refusal. Poll within the existing killTimeoutMs; a different PID is a replacement and is never signaled. Escalate only if the original PID, service and exact project identity all revalidate; inability to revalidate after shutdown means retain/refuse rather than blind SIGKILL. A successful signal alone is not terminated: observe original listener disappearance; if still live after bounded escalation, return refusal. Refresh terminated arrays contain only confirmed outcomes, preserving aliases.

**Tests.** packages/app/tests/services/project-registry.test.ts and new project-stop.test.ts cover foreign service, other-project Spur, malformed/absent project path, timeout, IPv4/IPv6, same-owned PID, PID switch before TERM and before KILL, self/parent, failed signals and timeout. Use injected fetch/executor/pid/signal seams with fake PIDs; never kill actual host processes. Update existing registry kill tests to supply positive ownership responses. apps/cli/tests/commands/projects.test.ts covers existing text/JSON success, idempotent no-listener, refusal/no Stopped, unchanged foreign port and the list/refresh implicit path. Restore process-wide helpers/fetch/ports after each test.

**Contracts / scope.** Update docs/design/project-switcher.md termination/refresh sentences through doc-evolve; health/project wire shapes stay unchanged. No general supervisor redesign, persistent PID storage, new identity protocol or real-process attack fixture. 1157 owns registry lock exclusivity in the same source/tests: serialize implementation and preserve its withLock changes; neither task requires the other to define its behavior. CLI source edits require bun link in apps/cli then build:bundle.

### Plan

1. [ ] R1/R3: capture the existing foreign-listener regression with fake signal seams; add identity and PID-change matrix cases before implementation.
2. [ ] R4/R5: implement shared app verification/stop helper with bounded same-host endpoint probes, exact path matching and PID rediscovery, using existing process helpers.
3. [ ] R1/R2: route registry refresh/list and thin CLI stop through the helper; preserve confirmed result aliases, error/success response shapes and idempotent no-listener behavior.
4. [ ] R3–R5: run app project-stop/registry tests and CLI projects tests inside their workspaces; prove failed signals and replacement listeners are never reported killed.
5. [ ] Update project-switcher owning contract, relink/bundle CLI, run task gate and review/verify/record. Keep 1157 lock edits intact and commit this task independently.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`packages/app/src/services/project-registry.ts:600` (discovery) and `packages/app/src/services/project-registry.ts:605` (signal)

- `apps/cli/src/commands/projects.ts:427` — fuser discovery.
- `apps/cli/src/commands/projects.ts:444` — unverified PID signaling.
- `apps/cli/src/commands/projects.ts:452` — success reporting.

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

- 2026-10-10T07:29:34.355Z backlog → todo (system)

