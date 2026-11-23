---
schema_version: 1
name: Fix local startup beside same-path remote registry entries
status: done
template: issue
created_at: 2026-11-23T17:44:33.925Z
updated_at: "2026-11-23T17:56:59.926Z"
feature_id: K4

done_forced: "false"
done_reason: unforced close
---

## 1443. Fix local startup beside same-path remote registry entries

### Background

The one-port gateway resolves the local `knowledge-kit` entry correctly, but its spawned `spur self serve` exits before opening the Board. Reproduction: `curl -i http://localhost:3000/knowledge-kit/board` returns 502 after a 10-second startup poll. The registry contains the same project path twice: `192.168.87.27:3003` and `localhost:0`. The daemon refuses startup because port 3003 answers on loopback, although that port belongs to the remote entry's routing hint (and currently to an unrelated local test listener), not to the local entry being started.

### Requirements

- [x] R1. Local server startup must ignore same-path remote-host registry entries when checking for a duplicate local server, even when the remote entry's numeric port answers on loopback.
- [x] R2. A live same-path local entry must still refuse duplicate startup without mutating the registry.
- [x] R3. The gateway must serve the local knowledge-kit Board through /knowledge-kit/board while preserving the same-path remote registry entry.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Keep the existing startup guard and registry identity model. Make the smallest behavior change: filter `assertProjectServerAvailable` to local-host entries before matching the normalized project path. Do not probe remote entries locally, change public CLI/HTTP surfaces, or alter port allocation. Add the mixed-host regression beside the existing guard tests and prove the local duplicate-server guard remains intact. Update this satellite's guard description in the same change because it owns the serve-start behavior.

### Plan

- [x] Add a mixed-host same-path regression test and prove it fails before the fix.
- [x] Apply the smallest host-scoped startup-guard fix and run focused tests.
- [x] Verify the real gateway Board flow and record evidence.

### Root Cause

`packages/app/src/services/project-start.ts:355` selects the first registry entry whose path matches, without requiring a local host. `assertProjectServerAvailable` then probes that entry's port on loopback at line 356. With the same-path remote entry ordered before the local entry, local startup therefore treats the remote routing hint as a live local server and refuses the gateway-spawned daemon. Restricting the guard to local entries should remove this false refusal while retaining duplicate-local-server protection.

### Solution

| File | Change |
| --- | --- |
| `packages/app/src/services/project-start.ts:355-358` | Select only same-path local-host entries in the duplicate-local-server guard; remote routing hints are never probed on loopback. |
| `packages/app/tests/services/project-start.test.ts:690-713` | Add the remote-first/local-second regression, including proof that a live local entry still refuses startup. |
| `docs/design/project-switcher.md:181` | Document the local-host scope of the serve-start guard. |

Public-flow probe: a source-run gateway on port 3100 started the local `knowledge-kit` upstream on 3002; `GET /knowledge-kit/board` returned 200 HTML. The requested gateway at `http://localhost:3000/knowledge-kit/board` then returned 200, `GET 127.0.0.1:3002/api/project` identified `/Users/robin/xprojects/knowledge-kit`, and the remote registry entry remained `192.168.87.27:3003`. The temporary 3100 gateway was stopped; the local project upstream remains available.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/project-start.ts:355-358` filters to local hosts; `packages/app/tests/services/project-start.test.ts:690-706` proves a live remote port is never probed. Focused test: 41 pass, 0 fail. |
| R2 | MET | `packages/app/tests/services/project-start.test.ts:668-687` proves live-local refusal without registry mutation; lines 708-713 prove the same refusal with a remote entry ordered first. |
| R3 | MET | `curl http://localhost:3000/knowledge-kit/board` → 200 HTML; `curl http://127.0.0.1:3002/api/project` → the knowledge-kit path; registry inspection preserved remote `192.168.87.27:3003` and local prefix `/knowledge-kit`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-N | N/A | n/a | No acceptance criteria are declared; R1–R3 are the task's complete verification targets. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1443
**Scope:** working tree; no `(1443)` implementation commit exists. Reviewed `packages/app/src/services/project-start.ts`, `packages/app/tests/services/project-start.test.ts`, `docs/design/project-switcher.md`, and the task record.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P4 (advisory) | correctness | No P1–P3 findings: the guard reuses the registry's existing host classifier, preserves its signature and error behavior, and the mixed-host test covers both remote exclusion and local duplicate refusal. | `packages/app/src/services/project-start.ts:355-358` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/project-start.ts:355-358` filters to local hosts; `packages/app/tests/services/project-start.test.ts:690-706` proves a live remote port is never probed. Focused test: 41 pass, 0 fail. |
| R2 | MET | `packages/app/tests/services/project-start.test.ts:668-687` proves live-local refusal without registry mutation; lines 708-713 prove the same refusal with a remote entry ordered first. |
| R3 | MET | `curl http://localhost:3000/knowledge-kit/board` → 200 HTML; `curl http://127.0.0.1:3002/api/project` → the knowledge-kit path; registry inspection preserved remote `192.168.87.27:3003` and local prefix `/knowledge-kit`. |

##### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC-N | N/A | n/a | No acceptance criteria are declared; R1–R3 are the task's complete verification targets. |

##### Checks

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | All design claims DONE: existing guard retained, local-host filter only, no public surface or port-allocation change, regression and owning satellite updated. |
| regression | pass | Exact test failed before the fix with the port-3003 refusal and passed after it; project-start suites: 41 pass, 0 fail. |
| consumers-and-types | pass | `apps/cli/tests/commands/projects.test.ts`: 28 pass, 0 fail; `@gobing-ai/spur-app` and `@gobing-ai/spur` typechecks exited 0. |
| quality-gate | pass | Pipeline gate outcome PASS; small-diff DEFERRED tier with all seven light checks PASS on the bound tree. |

**Next:** Close the task; no code remediation is required.

Verdict: PASS

### References

- Incident log: `/Users/robin/xprojects/knowledge-kit/.spur/run/serve-spawn.log`
- Existing host-scoped registry identity tests: `packages/app/tests/services/project-start-identity.test.ts`
- Owning design satellite: `docs/design/project-switcher.md` §5

### History

- 2026-11-23T17:53:41.250Z todo → wip (system)
- 2026-11-23T17:56:57.953Z wip → testing (system)
- 2026-11-23T17:56:59.819Z testing → done (system)

