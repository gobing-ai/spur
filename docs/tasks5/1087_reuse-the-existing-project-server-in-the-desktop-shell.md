---
schema_version: 1
name: Reuse the existing project server in the desktop shell
status: done
template: standard
created_at: 2026-10-05T04:19:48.947Z
updated_at: "2026-10-05T04:43:06.706Z"

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/run/1087-verdict.json
---

## 1087. Reuse the existing project server in the desktop shell

### Background

The operator wants the desktop shell to share a live server for the selected project instead of failing with the exclusive server-owner error. Task 1086 is closed independently; this task changes runtime attachment, not root build composition.

### Requirements

- [x] R1. Discover and reuse a live project owner on IPv4 or IPv6 loopback, including when the global registry has port zero.
- [x] R2. Verify Spur health and the same canonical project, reject redirects and unrelated endpoints, and revalidate the owner claim before attachment.
- [x] R3. Shared shutdown and startup cancellation must preserve the external server, its claim and agents; no-owner startup retains owned-child cleanup.
- [x] R4. Bound discovery retries during owner startup and concurrent child-start races; inspect processes without shell interpolation or registry mutation.
- [x] R5. Document ownership behavior and verify focused regressions, quality gates and real packaged macOS attachment.

### Acceptance Criteria

- [x] AC1 — A live owner with an IPv6 loopback listener and stale registry port zero is attached without spawning another server. (req: R1)
- [x] AC2 — Wrong service/project, redirected responses and a replaced owner claim cannot attach; symlink project selections compare canonically. (req: R2)
- [x] AC3 — Stop and cancellation leave a shared owner untouched, while the existing owned-child lifecycle tests continue passing. (req: R3)
- [x] AC4 — Discovery waits within a deadline for claim-before-bind startup, retries after cleaning a failed owned child, and refuses unsafe inspection failures. (req: R4)
- [x] AC5 — Documentation agrees with implementation, required gates pass, and a packaged app loads the existing server on this Mac and closes without stopping it. (req: R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Keep the server as the exclusive database owner. In the existing Node adapter `apps/desktop/src/server-process.ts`, read the project owner claim without mutation, inspect that PID’s listeners with native argv-based execFile, probe only loopback URLs with redirects rejected, verify `/api/health` service and `/api/project` canonical path, and reread the claim. In `apps/desktop/src/server-process.ts`, attach before spawning, use explicit shared/owned ownership and a no-op shared stop, and retry discovery after owned startup fails. Existing `apps/desktop/src/main.ts` lifecycle calls the same stop interface. Update `apps/desktop/README.md` and `docs/design/desktop-shell.md`; focused tests belong in `apps/desktop/tests/`. No server API or registry format change is needed.

### Plan

- [x] Freeze the requirements and design; preserve external processes.
- [x] Implement readonly discovery, identity verification and owned/shared lifecycle.
- [x] Run focused desktop tests and typecheck; review the final diff.
- [x] Run required quality/build gates and native attachment/quit proof.
- [x] Prepare verification evidence and the reviewed implementation for task closure and integration.

### Solution

| Change | Evidence |
| --- | --- |
| Attach before spawning, distinguish shared/owned ownership, and leave shared stop empty | `apps/desktop/src/server-process.ts:268` |
| Inspect only the claimed PID with native argv-based execution and preserve listener address family | `apps/desktop/src/server-process.ts:390` |
| Validate canonical project and Spur identity without redirects, then recheck the live claim; bound retries and propagate cancellation | `apps/desktop/src/server-process.ts:478` |
| Clean a failed owned child before retrying a concurrently acquired owner | `apps/desktop/src/server-process.ts:364` |
| Regress IPv6/symlink attachment, family/PID filtering, mismatches, redirects, claims, cancellation and startup races | `apps/desktop/tests/server-process.test.ts:359` |
| Document shared vs owned lifetime and keep the Electron/database boundary | `docs/design/desktop-shell.md:51` |

The implementation stays in the existing permitted Node adapter; no new server endpoint, dependency, registry mutation, renderer privilege or external-server shutdown was introduced.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/desktop/tests/server-process.test.ts:376` proves IPv6 attachment without spawning; reviewed-source-probe.log and native-proof.json verify live IPv6 owner 56190 independently of registry port. |
| R2 | MET | `apps/desktop/src/server-process.ts:478` canonicalizes project, rejects redirects, requires Spur identity and rechecks the same claim; focused identity and symlink cases pass. |
| R3 | MET | `apps/desktop/src/server-process.ts:279` returns shared ownership with no-op stop; native delivery app exited 0, health stayed ok and owner marker was unchanged; owned-smoke.log passed. |
| R4 | MET | `apps/desktop/src/server-process.ts:390` preserves listener family/PID, native execFile is bounded and shell-free, discovery retries and failed-child cleanup precedes race attachment; corresponding tests pass. |
| R5 | MET | `apps/desktop/README.md:34` documents packaging alongside shared shutdown instructions; final quality gate exit 0 (10044 pass, 0 fail, coverage, lint/types, 50 pre/2 post rules); CF exit 0; delivery root build exit 0; native attach/quit and DMG checksum passed. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | native-proof.json shows the packaged Board at IPv6 loopback port 3000 with live project owner 56190 and no second server. |
| AC2 | MET | test | desktop-tests-final.log: wrong identity, redirects, owner replacement, non-loopback origin and symlink canonicalization tests pass (62 tests, 0 fail). |
| AC3 | MET | command | native-proof-delivery.log plus app exit 0 prove shared quit preserves claim and health; owned-smoke.log proves own server startup/shutdown; focused cancellation and existing lifecycle tests pass. |
| AC4 | MET | test | desktop-tests-final.log: claim-before-bind retry, shared abort, inspection failure, dead/malformed claim and concurrent-owner cleanup tests pass. |
| AC5 | MET | command | quality-gate-final.log, test-cf.log, build-delivery.log and dmg-verify-delivery.log all pass; native-shared-board.png and native-proof.json prove the final macOS package loads the existing Board and exits without stopping it. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Scope: task 1087 working-tree changes in the desktop Node process/layout adapters, main-process ownership comment, focused lifecycle tests, README and owning desktop/architecture documentation. No server APIs, dependencies, registry format or renderer privileges changed.

Independent sp-super-reviewer functional, SECUA and architecture review: PASS after the fixes below. The desktop still opens no database; a shared handle only loads a verified existing server and has a no-op stop. Native execFile uses argv arrays, bounded execution and cancellation; identity probes reject redirects and require Spur health, canonical project path and the unchanged live marker. Existing owned-child cleanup remains tested.

| Priority | Finding | File:Line | Disposition |
| --- | --- | --- | --- |
| P2 | Wildcard discovery originally lost the owner listener’s address family and could probe another process on the opposite family. | `apps/desktop/src/server-process.ts:390` | Fixed: lsof supplies f/t/n fields, wildcards preserve family, unknown families are ignored; the regression includes an opposite-family same-port listener and PID filtering. |
| P3 | Ownership comments and launch documentation described only the owned child. | `apps/desktop/src/main.ts:9` | Fixed: main/layout comments, README launch qualifier and owning design distinguish shared attachment and owned-child startup/shutdown. |

No blocking findings remain. Native execution evidence covers macOS; Windows/Linux listener output has parser coverage, without claiming native packaging/runtime verification there.

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-05T04:20:37.022Z backlog → todo (system)
- 2026-10-05T04:20:37.291Z todo → wip (system)
- 2026-10-05T04:41:37.679Z wip → testing (system)
- 2026-10-05T04:41:51.116Z testing → done (system)

