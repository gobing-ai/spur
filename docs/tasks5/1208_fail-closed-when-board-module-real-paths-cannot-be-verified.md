---
schema_version: 1
name: Fail closed when Board module real paths cannot be verified
status: done
template: feature-impl
created_at: 2026-10-14T23:25:06.054Z
updated_at: "2026-10-15T02:42:34.827Z"
feature_id: A8

priority: P2
ac_altitude: task-local
estimate_hours: 3
done_forced: "false"
done_reason: unforced close
---

## 1208. Fail closed when Board module real paths cannot be verified

### Background

Inline advisory review of packages,plugins,apps,scripts on 2026-10-14 confirmed an asset-confinement failure. `apps/server/src/modules/board/index.ts:94` checks real-path containment only when both resolutions succeed, then `apps/server/src/modules/board/index.ts:98` falls back to the lexical path. A real temporary symlink from module/escape.txt to outside.txt, with the injected filesystem realPath throwing, returned HTTP 200 and outside-module bytes. Reproducer: `.spur/run/review-audit.ts` and output `.spur/run/review-audit.log` (gitignored session evidence). Startup has the same conditional check at `packages/app/src/services/board-catalog-service.ts:218`. The normal filesystem backend and existing symlink tests pass; the defect requires absent/failed canonicalization.

This belongs to A8's restricted same-origin asset hosting; A8 was reopened from done to active through the feature CLI. No existing non-terminal task owns this issue. The review directly fixed unrelated composite-primary-key metadata in DatabaseInspector; this task contains no database work.

**Refine corrections (2026-10-14)**
- Startup and request probes were described together → BoardModuleFileProbe.realPath is required and returns string | undefined; FileSystem.realPath is optional → startup tests use a real function returning undefined/throwing, while the HTTP tests also omit the optional filesystem method.
- Startup was described only as a duplicate conditional guard → current startup never canonicalizes stylesheets, and a real escaping stylesheet symlink was accepted → validate project/root/entry/styles together; this is the same confinement issue, not another task.
- The design explicitly named only undefined canonicalization → current project/module/entry resolver exceptions escape as plain Error → normalize thrown resolver failures into BoardModuleConfigError at startup and 403 at request time.
- Missing-file precedence was implicit → a missing target can itself make realPath fail → preserve lexical/traversal gates first, then missing-file 404, then canonical checks for an existing asset.

Premises rechecked with `.spur/run/refineall-1208-1209-audit.ts`; output `.spur/run/refineall-1208-1209-audit.log`: undefined project/module/entry/style resolution accepted on a canonical temporary root; thrown project/module/entry resolution produced raw Error; stylesheet resolution was never called; escaping stylesheet accepted. Both original issues remain valid. No dropped issues.

### Requirements

- [x] R1. Refuse startup for an enabled React declaration when canonical project/module/entry/style paths cannot be resolved or escape their allowed roots.
- [x] R2. Refuse an existing module asset at request time when either canonical module root or canonical target cannot be resolved; never return its bytes via a lexical fallback.
- [x] R3. Preserve valid internal symlinks, ordinary assets, HEAD, disabled modules, missing-asset 404, and application deep-route fallback.

Out of scope: filesystem sandbox redesign, race-free open-by-handle APIs, public CLI/schema changes, UI changes, iframe URL policy, static Board distribution hosting.

### Acceptance Criteria

- [x] AC1 — Startup refuses unverified native paths (req: R1): Given an enabled React declaration with real files and a correctly typed BoardModuleFileProbe, when project, module root, entry or any stylesheet canonicalization returns undefined, throws, or resolves outside its allowed root, then prepareBoardModules rejects with BoardModuleConfigError naming the declaration and path; cover each path and a real escaping stylesheet symlink in packages/app/tests/services/board-catalog-service.test.ts.
- [x] AC2 — Requests never serve unverified symlink bytes (req: R2): Given an existing symlink escaping the declared asset root, when the optional FileSystem.realPath method is absent or root/target resolution throws, then GET and HEAD return 403 without outside bytes; use real files through the mounted HTTP handler in apps/server/tests/board-modules.test.ts.
- [x] AC3 — Valid asset and catalog behavior stays available (req: R3): Given valid normal assets and contained entry/style symlinks, then startup and GET/HEAD succeed with existing URLs and HEAD has no body; missing/non-file/dangling assets stay 404, disabled assets remain inaccessible, empty/disabled/iframe catalogs perform no canonical IO, existing host-version errors remain, and module deep routes reach the SPA. Prove in packages/app/tests/services/board-catalog-service.test.ts and apps/server/tests/board-modules.test.ts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-14T23:26:05.380Z

Closed: fail closed for unavailable canonicalization, using the existing configuration error and 403 refusal. Missing assets retain 404. This is task-local regression coverage under A8; it adds no public surface. No open decisions.

#### Q&A entry — 2026-10-14T23:34:23.502Z

Ready audit decisions closed: startup catches raw resolver errors and uses the existing BoardModuleConfigError; HTTP existing-asset resolution failures use 403. Missing/non-file target 404 is decided before canonicalization after lexical/declaration checks. Required startup probe functions are not removed in typed tests; optional filesystem methods can be omitted. Stylesheet escapes belong to the existing R1 confinement fix. No new API or open decision.

### Design

WHAT: Enforce fail-closed real-path containment at startup and on every existing module asset request. WHY: a lexical path inside a module does not prove where a symlink points.

WHERE: packages/app/src/services/board-catalog-service.ts and apps/server/src/modules/board/index.ts; tests in packages/app/tests/services/board-catalog-service.test.ts and apps/server/tests/board-modules.test.ts. The sole serve caller is apps/server/src/serve.ts:843 using boardModuleProbe; the exported preparation seam is also consumed by tests. Preserve its public signatures and catalog DTO. No new API, schema, dependency or option.

Startup algorithm: retain host-version, lexical-path and existence checks. Only an enabled React declaration requires canonical IO. Lazily resolve the project root for the first such declaration; resolve its module root, entry and every stylesheet. The module root must pass existing isInsideRoot against the canonical project root; entry/styles must pass against that module root. Any undefined resolution or thrown resolver error becomes BoardModuleConfigError naming the current declaration index/id and affected path. Never fall back to a lexical project path. No canonicalization for empty, disabled-only or iframe-only declarations; preserve their existing host-distribution checks. Keep catalog URLs lexical and project-relative, preserving the existing snapshot and root interfaces.

Request algorithm: retain method, decoding, lexical/traversal and declaration checks. Stat the lexical target; a genuinely missing/non-file target keeps 404. For an existing asset, require both root and target canonicalization to succeed before opening bytes; absent FileSystem.realPath, thrown resolution or unresolved helper output means 403. Require isInsideRoot(realRoot, realTarget); never use resolvedTarget ?? target to serve an unverified file. GET/HEAD use the same validation; HEAD returns no asset bytes. Contained internal links remain legal; dangling/missing targets remain 404. Race-free open-by-handle behavior remains explicitly out of scope.

Type-fit: BoardModuleFileProbe.realPath is a required function returning string | undefined; tests must not remove it or cast an invalid object to that type. FileSystem.realPath is optional and returns string when present; HTTP tests may omit it or make it throw to exercise resolvedOrUndefined. The serve-side boardModuleProbe intentionally wraps backend absence/throws into undefined and need not change; retain its existing degradation test. Update stale containment comments in the two modified files to describe fail-closed consumers.

Rejected: lexical fallback (reproduced leak); silently disabling declarations (hides invalid configuration); new filesystem abstraction or exported error type (existing probes/errors suffice). Consult docs/design/downstream-board-modules.md §6.5, which already requires refusal of symlink escapes; no new contract is proposed. Update that satellite only if implementation reveals a factual clarification needed.

Execution boundary: estimate 3 hours, one task pipeline; keep partial evidence in .spur/run/1208-* and rerun against the current task if interrupted. A code change is expected, so requireDiff remains enabled; do not edit adjacent schema/UI/runtime abstractions. No pending dependencies; 1209 is independent. Audit found one worktree and no WIP tasks; the unrelated composite-key fix is already dirty in this tree and must not be swept into a 1208 commit. Recheck clean task ownership before implementation.

### Plan

- [x] R1/R2: add failing startup tests using valid required probe functions returning undefined or throwing for project/root/entry/style; use real canonical temporary paths and real stylesheet symlinks so /tmp aliases cannot mask the premise.
- [x] R1: implement required startup canonicalization for project/root/entry/styles, enforce existing containment and normalize undefined/throws to BoardModuleConfigError; preserve snapshot/catalog URLs and disabled/iframe/no-module IO behavior.
- [x] R2: add real-filesystem HTTP GET/HEAD tests for missing optional realPath and thrown root/target resolution; stat missing/non-file assets to 404 before canonical checks, refuse unverified existing assets with 403, and remove lexical serving fallback.
- [x] R3: retain normal assets, contained entry/style symlinks, escaping symlinks, missing/dangling 404, disabled assets, host-version failures and SPA deep-route tests; update stale comments in the modified files only.
- [x] Run bun test tests/services/board-catalog-service.test.ts inside packages/app and bun test tests/board-modules.test.ts inside apps/server; then use the task pipeline's gate and verify, recording proof under .spur/run/1208-*. Do not rerun unrelated suites per fix or sweep the pre-existing composite-key change into this task.

### Solution

Fail-closed real-path verification at startup and request time; lexical fallback removed from both consumers.

Change map:
- `packages/app/src/services/board-catalog-service.ts:161-181` — replaced the lazy `realPath(...) ?? lexical` project-root fallback with `verifiedRealPath`: every canonical answer is required; absent or THROWN probe resolutions normalize into `BoardModuleConfigError` naming the declaration index/id and the affected path. Project root resolves once, lazily, only when an enabled react declaration needs it (empty/disabled/iframe-only configs still perform no canonical IO).
- `packages/app/src/services/board-catalog-service.ts:200-206` — stylesheet paths now carry their declared name alongside the absolute path (`styles` pairs), removing indexed access and keeping messages exact.
- `packages/app/src/services/board-catalog-service.ts:233-254` — canonical verification is unconditional for enabled react declarations: canonical project root, module root (must satisfy `isInsideRoot(realProject, realRoot)`), entry and EVERY stylesheet (each must satisfy `isInsideRoot(realRoot, real)`); no `undefined` skip-branch remains. Existence checks, host-version checks, lexical `resolveContained` gates, catalog URLs and roots DTO unchanged.
- `packages/app/src/services/board-catalog-service.ts:57-62` — probe contract comment updated: `BoardModuleFileProbe.realPath` stays REQUIRED (`string | undefined`); "cannot verify" now means fail closed (task 1208), no signature change.
- `apps/server/src/modules/board/index.ts:90-105` — request-time order is now: method/decode/traversal/declaration gates (unchanged) → lexical-stat gate (missing, non-file, dangling → 404 BEFORE any canonical IO) → fail-closed canonical gate: absent `FileSystem.realPath`, thrown resolution, or unresolved helper output → 403; `isInsideRoot(realRoot, realTarget)` required; the `resolvedTarget ?? target` lexical serving fallback is deleted. GET/HEAD share the gates; HEAD stays bodyless. Contained internal symlinks verify and serve.
- `apps/server/src/modules/board/index.ts:5-8` — `resolvedOrUndefined` doc updated: absence means "cannot verify" → 403, not skip.
- `packages/app/tests/services/board-catalog-service.test.ts:166-310` — real temp canonical paths + real escaping stylesheet symlink: unresolvable project root (undefined and thrown), unverified module root/entry/style each refused naming path, escaping module root refused, real escaping stylesheet symlink refused, contained real symlinks still prepare.
- `apps/server/tests/board-modules.test.ts:260-357` — mounted-handler GET/HEAD on real files: contained symlink served, escaping symlink 403 (GET + bodyless HEAD, outside bytes never served), absent realPath 403, throwing resolution 403, missing/dangling/non-file 404, normal asset + bodyless HEAD preserved.

Rationale: a lexical path inside a declared module does not prove where a symlink lands, so both consumers now refuse (config error / 403) instead of skipping or falling back when canonicalization is unavailable. No public API, schema, dependency or option changed; docs untouched.

**Verification regression improvements (2026-10-15).** Fresh forced verification extended `packages/app/tests/services/board-catalog-service.test.ts:235` to independently exercise undefined and thrown canonical module, entry and stylesheet answers with declaration/path diagnostics. The contained-link test at `packages/app/tests/services/board-catalog-service.test.ts:300` now actually declares the real entry and stylesheet symlinks it creates and verifies preserved public URLs. `apps/server/tests/board-modules.test.ts:282` refuses an escaping asset on GET/HEAD with no realPath backend; `apps/server/tests/board-modules.test.ts:299` independently exercises root/target undefined and throws before reading bytes. Focused results: 15 app tests (61 assertions), 27 mounted-handler tests (80 assertions), zero failures. No production behavior or public contract changed. Final verification/gate evidence is owned by the fresh Testing record.

**Forced verification close-out (2026-10-15).** `bun run spur-check` exited 0: lint/typechecks, all 51 pre-check rules, 10770 tests across 614 files (0 failures), certified coverage and both post-check rules. Log: `.spur/run/verifyall-1208-1209-gate-final.log`. Fresh canonical verdicts for 1208 and 1209 are PASS and post-record residual folds remain PASS. Source anchors: `packages/app/src/services/board-catalog-service.ts:166` (canonical startup refusal), `apps/server/src/modules/board/index.ts:97` (request gate).

Both were already done at intake; --next is an idempotent no-op, without status demotion or forced-done override. The mixed A8/H1 batch has Shippable N/A under the shared-feature rule. Additional owner checks each pass with zero findings: A8 has 9 complete linked tasks; H1 has 18. The original Review sections are preserved. Full results and current artifact paths: `.spur/run/verifyall-1208-1209-report.md`. No commit was made; no live browser or external-agent session was launched.

**Final shippable confirmation (2026-10-15).** No remaining in-scope work. Task verdict PASS, strict-core check PASS and fresh residual scan/fold PASS with zero items. A8 check PASS with zero findings and all 9 linked tasks complete. An unrelated commit-guard reference accidentally copied from task 1209 into the previous batch close-out was removed from this Solution; it had incorrectly triggered A8's self-referential-workflow dogfood check. The gate and product code are unchanged. Relevant evidence: `packages/app/tests/services/board-catalog-service.test.ts:235`, `apps/server/tests/board-modules.test.ts:299`.

The full task gate passed 10770 tests with no failures (`.spur/run/verifyall-1208-1209-gate-final.log`). Fresh `bun run spur-check-feature` exited 0: all structural checks, 10 repository-wide tests and 28 heavy tests passed (`.spur/run/ship-1208-1209-feature-gate.log`). Coverage provenance still validates after the feature run. Final report: `.spur/run/ship-1208-1209-report.md`. No commit made; no separate live browser/external-agent session launched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/board-catalog-service.ts:166` requires canonical answers and normalizes resolver throws; `packages/app/src/services/board-catalog-service.ts:233` verifies project/module containment and every entry/style. Fresh tests at `packages/app/tests/services/board-catalog-service.test.ts:235` exercise undefined and thrown module/entry/style answers with declaration/path diagnostics; project failure and real escaping links pass in the same 15-test suite. |
| R2 | MET | `apps/server/src/modules/board/index.ts:97` requires both real root and target before opening bytes. `apps/server/tests/board-modules.test.ts:299` independently refuses undefined/throwing root and target on GET and HEAD; `apps/server/tests/board-modules.test.ts:282` refuses a real escaping asset with no realPath backend. Fresh mounted-server suite: 27 pass, 0 fail. |
| R3 | MET | `packages/app/tests/services/board-catalog-service.test.ts:300` now declares the actual contained entry and stylesheet symlinks and checks lexical public URLs; `apps/server/tests/board-modules.test.ts:358` preserves ordinary GET/bodyless HEAD. The 15 app and 27 server tests preserve disabled/iframe behavior, host errors, missing/dangling/non-file 404 and SPA deep routes. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Startup refuses unverified native paths (req: R1): Given an enabled React declaration with real files and a correctly typed BoardModuleFileProbe, when project, module root, entry or any stylesheet canonicalization returns undefined, throws, or resolves outside its allowed root, then prepareBoardModules rejects with BoardModuleConfigError naming the declaration and path; cover each path and a real escaping stylesheet symlink in packages/app/tests/services/board-catalog-service.test.ts. | MET | test | `packages/app/tests/services/board-catalog-service.test.ts:235` independently exercises undefined and throwing module/entry/style resolution; project-root failures, escaped module/entry and real escaping stylesheet links pass in the same freshly executed 15-test suite. Errors name the declaration and affected path. |
| AC2 — Requests never serve unverified symlink bytes (req: R2): Given an existing symlink escaping the declared asset root, when the optional FileSystem.realPath method is absent or root/target resolution throws, then GET and HEAD return 403 without outside bytes; use real files through the mounted HTTP handler in apps/server/tests/board-modules.test.ts. | MET | test | `apps/server/tests/board-modules.test.ts:282` exercises escaping asset GET/HEAD without realPath; `apps/server/tests/board-modules.test.ts:299` independently exercises root/target absence and throws; `apps/server/tests/board-modules.test.ts:328` pins escaping-symlink refusal and no outside bytes. Fresh mounted-handler tests passed. |
| AC3 — Valid asset and catalog behavior stays available (req: R3): Given valid normal assets and contained entry/style symlinks, then startup and GET/HEAD succeed with existing URLs and HEAD has no body; missing/non-file/dangling assets stay 404, disabled assets remain inaccessible, empty/disabled/iframe catalogs perform no canonical IO, existing host-version errors remain, and module deep routes reach the SPA. Prove in packages/app/tests/services/board-catalog-service.test.ts and apps/server/tests/board-modules.test.ts. | MET | test | `packages/app/tests/services/board-catalog-service.test.ts:300` declares and verifies contained entry/style symlinks. `apps/server/tests/board-modules.test.ts:358` pins normal GET/HEAD; missing/dangling/non-file, disabled/iframe, host-version and deep-route regressions passed in the 15 app + 27 server tests. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: A8 — Downstream Spur Board modules and embedded resources.
- Design: docs/design/downstream-board-modules.md.
- Intake evidence: `.spur/run/review-audit.ts` and `.spur/run/review-audit.log` (gitignored).
- Current baseline: apps/server/tests/board-modules.test.ts — 21 passing tests at review intake.
- Fresh premises audit: .spur/run/refineall-1208-1209-audit.ts and .spur/run/refineall-1208-1209-audit.log (gitignored).
- Serve caller/probe: apps/server/src/serve.ts:114 and apps/server/src/serve.ts:843.
- Existing filesystem type: @gobing-ai/ts-runtime dist/file-system.d.ts, realPath optional; inspected locally.
- Readiness/ownership: todo, feature A8 active; one worktree, no WIP tasks at ready audit. Prior unrelated composite-key changes remain in the current working tree.

### History

- 2026-10-14T23:26:13.401Z backlog → todo (system)
- 2026-10-15T00:26:58.857Z todo → wip (system)
- 2026-10-15T00:27:00.075Z wip → testing (system)
- 2026-10-15T00:30:43.477Z testing → done (system)

