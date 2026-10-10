---
schema_version: 1
name: Keep live registry lock owners exclusive past the retry timeout
status: todo
template: feature-impl
created_at: 2026-10-10T07:29:34.693Z
updated_at: "2026-10-10T16:29:00.318Z"
feature_id: K3

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
---

## 1157. Keep live registry lock owners exclusive past the retry timeout

### Background

withLock removes a live lock after 2.5 seconds, enters a second writer, and lets the former owner later remove the replacement lock Evidence: `packages/app/src/services/project-registry.ts:321` and `packages/app/src/services/project-registry.ts:337`. Review a71c confirmed this using two withLock callbacks with the first held pending longer than the retry window; second callback entered before first released. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Confirmed withLock retries 50×50ms, then recursively deletes the lock and reacquires without ownership evidence; its finally recursively deletes whichever lock currently occupies the path. All registry read-modify-write methods share this seam.
- Existing claim has no PID/token, so neither age nor emptiness proves a stale owner. Freeze conservative timeout refusal with no automatic stale recovery, rather than leaving recovery strategy to the implementer.
- Existing project-server-owner.ts already uses a unique marker and successful-own-marker unlink before rmdir; reuse that ownership pattern locally, preserving asynchronous registry waits and avoiding its synchronous handoff loop.

### Requirements

- [ ] R1. Fail acquisition on contention timeout instead of breaking a live or unidentified owner; ensure release removes only its own claim
- [ ] R2. Short contention still waits and serializes registry mutations without lost updates
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.
- [ ] R4. Unknown or abandoned preexisting claims fail closed after the finite retry window; there is no automatic age-based stale recovery. Callback or marker-initialization failure cannot enter a second writer or delete a replacement claim, and non-contention filesystem errors retain their fast failure behavior.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A long-lived holder is never displaced (req: R1, R3)
  Given two registry instances share one temporary lock path and the first callback is held beyond the retry window
  When the second acquisition exhausts its budget
  Then it rejects without entering its callback or removing the first marker
  And a third acquisition succeeds only after the first owner releases

Scenario: AC2 — Short contention preserves both updates (req: R2, R3)
  Given two queued registry updates and an explicitly released first holder
  When both complete
  Then callbacks ran serially and both registry updates remain

Scenario: AC3 — Old release cannot remove a replacement claim (req: R1, R3, R4)
  Given a disposable fixture replaces the first holder's directory with another unique claim
  When the first callback exits or throws
  Then the replacement marker and directory remain unchanged
  And unknown abandoned claims are never reaped merely because time passed
```

### Q&A

- Closed: remove timeout takeover entirely; do not add a stale reaper or PID process probe. Unknown abandoned locks require deliberate manual cleanup.
- Closed: unique own-marker unlink followed by nonrecursive rmdir is the existing ownership pattern; a missing own marker forbids directory removal.
- Closed: preserve async 50×50ms acquisition and explicit permission errors. One bounded real-time contention test is sufficient; other tests use barriers.
- Closed: coordinate sequential edits with 1156; no new dependency, registry schema or supervision work.

### Design

**Smallest complete fix / no API change.** Keep ProjectRegistry.withLock(fn), lockDir path, 50 retries and 50ms async waits. After successful mkdir create one unique marker named process.pid + '-' + crypto.randomUUID() inside the lock with exclusive write. If not acquired, throw the existing Failed to acquire lock for project registry error (add concise contention/retained-claim detail if needed); never rm a lock because its wait expired. No PID liveness or stale-lock reaper is added: unknown/dead/incomplete preexisting claims all remain exclusive until manually resolved. This is an intentional conservative crash-recovery limit, not an open design option. Add one code comment: shortcut: abandoned registry claims need manual cleanup, add proven-dead owner recovery only when operational evidence requires it.

**Release protocol.** In finally unlink only this acquisition's exact marker; only if that unlink succeeds attempt nonrecursive rmdirSync(lockDir). If the marker is missing, leave the path alone. Never recursive-rm a lock in acquisition or release. Preserve current best-effort unlock behavior while ensuring a missing own marker cannot delete a replacement. If marker initialization fails after mkdir, propagate the original failure and remove only the owned empty directory when possible; never run fn. Retry EEXIST contention only; preserve the explicit EACCES/EPERM diagnostics and immediately propagate other filesystem errors. Do not alter registry JSON/atomic writes/port behavior.

**Tests / deterministic scheduling.** In packages/app/tests/services/project-registry.test.ts use two registry instances sharing the same temporary projects file. First callback signals entered and waits on an explicit deferred release promise. Start second; await its bounded acquisition rejection while the first remains held. Assert callback never entered and first marker remains; release first in finally, then verify a third writer enters and updates succeed. Give this one real retry-budget test a finite >=10s test timeout for the existing 2.5s wait; do not extend production budget. Short contention test uses entry/release barriers and two upserts, verifies both entries survive. Replacement test removes/replaces the claim only inside the disposable fixture while the old callback is held; old release must leave replacement marker/directory untouched. Cover callback throw, double acquisition/release flow, unknown empty claim timeout, marker-write failure and fast permission/non-EEXIST errors. Restore all held promises/spies in finally so a failed assertion cannot strand the suite. No actual host registry or live-server locks.

**Owners/siblings.** All six withLock callers inherit the fix; no caller signature/export/schema/config change. Update docs/design/project-switcher.md advisory-lock sentence to describe no timeout takeover and retained abandoned claims, through doc-evolve. 1156 edits refresh body/process identity in the same files; implement sequentially and preserve that independent behavior. The server-owner and quality-gate lock algorithms remain unchanged.

### Plan

1. [ ] R1/R3: add deferred long-holder and replacement-release regressions on two temporary registry instances; observe pre-fix callback overlap without touching the global registry.
2. [ ] R1/R4: write a unique exclusive owner marker after mkdir, remove timeout recursive takeover, and release only through own-marker unlink plus nonrecursive rmdir.
3. [ ] R2–R4: retain short serialization test, add callback/init/error paths, and prove third acquisition only after release with no lost updates.
4. [ ] Run app project-registry suite and affected CLI projects suite inside their workspaces; keep 1156 identity behavior intact.
5. [ ] Update owning lock contract, run task gate, review/verify/record the contention/replacement evidence and commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`packages/app/src/services/project-registry.ts:321` and `packages/app/src/services/project-registry.ts:337`

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

- 2026-10-10T07:29:38.764Z backlog → todo (system)

