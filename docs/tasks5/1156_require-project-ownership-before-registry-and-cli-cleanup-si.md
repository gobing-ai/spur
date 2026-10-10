---
schema_version: 1
name: Require project ownership before registry and CLI cleanup signal a listener
status: done
template: feature-impl
created_at: 2026-10-10T07:29:30.396Z
updated_at: "2026-10-10T23:26:00.132Z"
feature_id: K3

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1156-verdict.json
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

- [x] R1. Require verified Spur server and exact project ownership before signaling any process in refresh or CLI stop; make unverified listeners non-destructive
- [x] R2. Existing project listings and verified owned-server cleanup remain supported, and foreign listeners survive
- [x] R3. Add the reproducing regression and validate the affected callers through the existing test seams.
- [x] R4. Before each SIGTERM/SIGKILL, verify service:spur and exact canonical project path over the same loopback host, and rediscover the listener PID unchanged. Missing/malformed/mismatched identity, network timeout, self/parent PID or PID change means no signal. Do not signal a replacement listener while waiting/escalating.
- [x] R5. Report termination only after a signal succeeded and the original listener disappeared. Explicit stop of a live unverified listener uses the existing error/exit-1 response and leaves its registry port intact; absent listener is an idempotent successful stop and clears the stale port. Refresh may purge a deleted registration but leaves terminated empty for unverified/failed cleanup.

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

Implemented the shared ownership-verified stop (1156) so no registry or CLI cleanup path signals an unverified listener.

**File:line change map**

- `packages/app/src/services/project-stop.ts:172` — new `stopRegisteredProject(entry, options)`: absent listener → idempotent `stopped:true`; verified listener → SIGTERM, bounded wait, SIGKILL only after full ownership revalidation with the same PID; `terminated` reported only after the original listener is observed gone; every failure mode returns `{stopped:false, reason}` for the caller's existing error channel.
- `packages/app/src/services/project-stop.ts:122` — internal `verifyProjectListener`: discovers the PID (rejecting undefined, ≤1, self, parent), probes identity, then rediscovers the PID unchanged immediately before signaling.
- `packages/app/src/services/project-stop.ts:83` — internal `probeOwnershipIdentity`: `GET /api/health` (`service==='spur'`) and `GET /api/project` (normalized path exact match) over one loopback host (127.0.0.1 → [::1] fallback, never mixed), `redirect:'error'`, finite 1s timeout; malformed/absent/mismatched identity or network failure fails closed.
- `packages/app/src/services/project-stop.ts:52` — `setProjectStopFetchForTests` process-wide fetch seam (CLI tests cannot pass options through `main()`).
- `packages/app/src/services/project-registry.ts:592,607` — `refreshProjects` routes deleted-entry cleanup through the helper (dynamic import avoids a module cycle with the process helpers); purged registrations still purge, `terminated` only carries confirmed outcomes. `RefreshProjectsOptions` gains `fetchImpl`/`requestTimeoutMs` (packages/app/src/services/project-registry.ts:34-35).
- `apps/cli/src/commands/projects.ts:428` — `projects stop` replaces the unverified fuser kill loop with `stopRegisteredProject`; refusal throws through the existing `{ok:false,error}` / `Error:` + exit-1 channel (port preserved, never prints `Stopped`); absent listener keeps the existing success shape and clears the port.
- `packages/app/src/index.ts:600-605` — facade exports `stopRegisteredProject`, its option/result types, and the fetch seam.
- `docs/design/project-switcher.md:87-93,202` — owning satellite updated: ownership-verified termination algorithm and the new `stop` verb contract.

**Tests**

- `packages/app/tests/services/project-stop.test.ts` (new, 18 cases): foreign service, other-project Spur, missing/malformed identity, non-OK health, both-host timeout, IPv4→IPv6 fallback, absent listener, unsafe self/parent/system PID, no PID, PID switch before TERM and before KILL, identity loss before KILL, SIGTERM/SIGKILL success, failed SIGTERM, SIGKILL survivor, path normalization equivalence.
- `packages/app/tests/services/project-registry.test.ts` — kill tests now supply ownership fetch; new AC1 regression: foreign listener on a deleted project's port is purged-but-never-signaled.
- `apps/cli/tests/commands/projects.test.ts` — stop success via seams, idempotent absent-listener stop, foreign-listener refusal (exit 1, no `Stopped`, port preserved, no signals), self-PID refusal, clean with verified termination, clean purging a foreign listener with empty `terminatedProcesses`. The removed fuser-loop test was replaced by the refusal matrix (that code path no longer exists).

Residual (documented in module header and Q&A): local ownership verification is not authentication against a malicious local server, and a portable PID-reuse race remains between the final check and the signal.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both cleanup paths route through the ownership-verified helper (packages/app/src/services/project-registry.ts:604-615, apps/cli/src/commands/projects.ts:428-444; guards at packages/app/src/services/project-stop.ts:122-147,190-217); unverified listeners are never signaled. Executed: project-stop.test.ts 18 pass / project-registry.test.ts 29 pass / projects.test.ts 23 pass (0 fail), plus full gate PASS. |
| R2 | MET | Existing success shapes preserved (apps/cli/src/commands/projects.ts:436-444 unchanged success branch; refusal uses the pre-existing error channel at :445-457); listings unchanged except refresh internals (packages/app/src/services/project-registry.ts:423-441). Executed: projects.test.ts 23 pass covering existing text/JSON success shapes; full gate PASS. |
| R3 | MET | Regression tests added and executed green: packages/app/tests/services/project-stop.test.ts (18 cases), AC1 foreign-listener regression at packages/app/tests/services/project-registry.test.ts:455-481, CLI refusal matrix at apps/cli/tests/commands/projects.test.ts:599-661 — 70/70 pass, 0 fail, all through injected fetch/executor/pid/signal seams with fake PIDs. |
| R4 | MET | Pre-signal verification chain at source: service==='spur' + exact normalized path over one loopback host (packages/app/src/services/project-stop.ts:93-118), PID guards (:130-137), PID rediscovery before TERM (:142-146), full revalidation before KILL (:205-211). Executed: project-stop.test.ts 18 pass (PID switch before TERM/KILL, self/parent, malformed identity, timeout cases). |
| R5 | MET | Terminated records gated on observed disappearance (packages/app/src/services/project-stop.ts:196-199,214-217); CLI refusal preserves port + exit 1 (apps/cli/src/commands/projects.ts:430-435); absent-listener idempotence (project-stop.ts:178-183); refresh purges with empty terminated on refusal (project-registry.ts:610-613). Executed: projects.test.ts 23 pass (refusal: no Stopped, port preserved; absent-listener idempotent success); implement-stage public-surface probe against a throwaway root: foreign listener → cli-exit=1 with refusal error and port preserved, listener still alive; after listener exit → cli-exit=0, Stopped, port cleared. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Foreign listeners survive automatic and explicit cleanup (req: R1, R3, R4, R5) | MET | test | project-registry.test.ts:455-481 (refresh purges foreign listener, zero signals, empty terminated) 29 pass; projects.test.ts:599-640 (exit 1, no Stopped, port preserved, zero signals) 23 pass; project-stop.test.ts:147-169 (foreign service / other-path refusals) 18 pass. Plus live probe: python http.server on the registered port → exit 1 refusal, listener alive, port preserved. |
| AC2 — Verified cleanup keeps existing success responses (req: R2, R3, R4, R5) | MET | test | project-stop.test.ts:116-132,235-251 (verified TERM and KILL-escalation with confirmed termination) 18 pass; projects.test.ts:410-452 (existing stopped JSON + Stopped project text shapes) and :572-597 (idempotent absent-listener stop, port cleared, zero signals) 23 pass. Live probe: absent listener → exit 0, Stopped, port cleared. |
| AC3 — Changed or unknown identity blocks every signal (req: R3, R4, R5) | MET | test | project-stop.test.ts:171-233,253-304 (malformed JSON, non-OK health, both-host timeout, self/parent/system PID, no PID, PID switch before TERM and before KILL, identity loss before KILL, failed TERM, KILL survivor — all refusal with no terminated record) 18 pass. Guards at packages/app/src/services/project-stop.ts:130-146,205-217. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Second-pass multi-dimensional review (functional traceability + SECUA + architecture depth) by an independent fresh reviewer after the doc-fix remediation. Verdict: PASS — no P1/P2 findings; the first pass's only OPEN item (spur-cli reference drift) is verified fixed and faithful; implementation matches R1–R5 and AC1–AC3 with direct source evidence.

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P3 (minor) | refreshProjects holds the advisory registry lock across up to 4×1s HTTP probe timeouts plus 2×2s kill waits per stale entry; list()/board /api/projects route through it. Bounded and fail-closed; probe window is new, lock-held kill wait pre-existed | packages/app/src/services/project-registry.ts:586-615 | DEFER — revisit with sibling task 1157's lock work; restructuring probes outside withLock would reopen the check-to-act race this task froze |
| P4 (advisory) | Feature file K3 AC I2 still says "the listening process receives a termination signal" unconditionally; 1156 deliberately narrows to verified-owned listeners. Feature records are tool-owned (T4) — reconcile at feature wrap | docs/features/K3_project-registry-freshness-purge-non-existent-projects-kill-orphaned-serve-ports-and-clean-worktree-leftovers.md:47-53 | ACCEPTED |
| P4 (advisory) | Test-only seam setProjectStopFetchForTests exported from the public facade; consistent with the established setPortProbeForTests/setProcessHelpersForTests pattern and required because CLI tests cannot pass options through main() | packages/app/src/index.ts:600-605 | ACCEPTED |
| P4 (advisory) | Drive-by test-hermeticity fix (scratch-root cwd for agent doctor keeping .spur/run artifacts out of the byte-identical baseline); outside 1156's core scope but minimal, commented, and justified by an observed gate failure in this run tree | packages/app/tests/services/json-envelope-adoption.test.ts:81-88 | ACCEPTED |

Residual risks (honestly documented in-module and in Q&A): local identity proof is not authentication against a malicious local server; the portable PID-reuse check-to-signal race remains (no pidfd redesign per Q&A); a replacement listener binding the port instantly after a verified kill yields a conservative refusal rather than a false terminated record (fail-closed, per R5).

Correct-with-evidence highlights: spur-cli reference remediation verified faithful (plugins/sp/skills/spur-cli/references/projects.md:25,39-40,79-82 vs project-stop.ts:122-145, apps/cli/src/commands/projects.ts:428-434); ownership algorithm matches the frozen Design (PID guards, single-host identity probes, PID rediscovery before signaling); server wire shapes verified at source (apps/server/src/modules/health/index.ts:60,89-91); R5 confirmed-disappearance-only termination records preserved.

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
- 2026-10-10T17:03:28.935Z todo → wip (system)
- 2026-10-10T23:14:39.734Z wip → testing (system)
- 2026-10-10T23:26:00.127Z testing → done (system)

