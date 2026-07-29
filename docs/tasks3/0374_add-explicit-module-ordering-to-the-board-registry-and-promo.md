---
template: feature-impl
schema_version: 1
name: "Add explicit module ordering to the board registry and promote Observability to first module"
description: ""
status: done
type: task
profile: standard
feature_id: J4
parent_wbs: null
priority: P2
tags: ["board", "web", "registry"]
dependencies: []
created_at: "2026-07-29T00:15:02.315Z"
updated_at: "2026-07-29T21:05:24.413Z"
---

## 0374. Add explicit module ordering to the board registry and promote Observability to first module

### Background

Board module order is currently an accident of alphabetization: `discoverViaGlob` sorts discovered modules by id (apps/web/src/modules/discover.ts:73) and `discoverViaFs` sorts directory names (:139), yielding features, observability, task-kanban, teams. `defaultModule` is simply `enabledList()[0]` (registry.ts:53), so Features is also the default landing route. The `WebModule` contract (modules/types.ts) has no ordering field at all, so the only way to reorder today is to rename a directory — which would break the id and route the registry validates on. The operator wants Observability first; this task makes ordering declarative instead of incidental.

### Requirements
- [x] R1. Add an optional ordering key to the `WebModule` interface and honour it in discovery for both the glob path and the fs-fallback path.
- [x] R2. Ordering must be partial: modules declaring the key sort by it; modules without it retain their existing relative order after them, so no untouched module changes position unexpectedly.
- [x] R3. Set Observability's ordering so it is the first enabled module and therefore the default landing route.
- [x] R4. Preserve the registry's fail-fast duplicate id and duplicate route validation, and the disable/enable slot-restoration behaviour.
- [x] R5. Keep discovery pure and deterministic — the same inputs must always yield the same ordering, as the registry factory contract requires.
- [x] R6. Cover the ordering comparator in the fs-fallback path, which is the branch reachable under bun test.
### Acceptance Criteria
```gherkin
Scenario: R1 — Observability is the Board's first module and default landing route
Scenario: R2 — Explicit ordering is declarative and partial
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Add an optional `readonly order?: number` to the `WebModule` interface (modules/types.ts:11, after `sidebarLabel`) and a single partial-ordering comparator applied as a stable final sort in both discovery paths. Declared modules sort ascending by `order`; undeclared modules retain their existing relative order - the id pre-sort in the glob path (discover.ts:73), the directory-name pre-sort in the fs path (discover.ts:139) - because `Array.prototype.sort` is stable and the comparator returns `0` for the undeclared/undeclared case. This is a two-pass design per path: the existing deterministic pre-sort stays as the tiebreaker, then a final `found.sort(compareModules)` lifts only declared modules. `isWebModule` (discover.ts:42-56) needs no change - it narrows only required fields, and `order` is optional.

**Why this over alternatives.** A single combined comparator with an embedded tiebreaker cannot replace the pre-sort: the fs path only has directory names at sort time (module ids are unknown until `require` runs), so the order key must layer on top of the pre-sort, not replace it. Sorting in the registry (`createRegistry`) was rejected because discovery is the documented owner of ordering ("the factory is pure: same inputs -> same ordering", registry.ts:31) and `defaultModule = enabledList()[0]` (registry.ts:53) must reflect the promoted module without registry changes. Promoting by renaming the observability directory is explicitly out - it would break the id and route the registry validates (registry.ts:74-94).

**Invariants preserved.**
- Registry purity/determinism (R5): discovery stays a pure function of inputs; the comparator is pure and the sort is stable, so identical inputs yield identical ordering.
- Fail-fast validation (R4): `validate()` (registry.ts:74-94) runs on the sorted `discoveredOrder` unchanged; `order` does not participate in id/route uniqueness.
- Slot restoration (R4): `discoveredOrder = discovered.slice()` (registry.ts:37) captures the sorted order; `enableModule` (registry.ts:59-61) restores position by deleting from the disabled set against this immutable array.
- Default landing route (R3): `defaultModule = enabledList()[0]` (registry.ts:53) becomes observability once it sorts first; `router.tsx:13,32` redirect to `defaultModule.route` unchanged.

**Impacted surfaces.**
- `apps/web/src/modules/types.ts:11` - add `readonly order?: number;`.
- `apps/web/src/modules/discover.ts` - add exported `compareModules(a, b)` helper (after `isWebModule`, ~:56); append `found.sort(compareModules)` in `discoverViaGlob` after the id sort at :73 and in `discoverViaFs` before `return found` at :156.
- `apps/web/src/modules/observability/index.tsx:18` - add `order: 0,` to the `module` export (after `sidebarLabel`).
- `apps/web/src/modules/discover.ts:42-56` (`isWebModule`) - no change (optional field).
- `apps/web/tests/modules/discover.test.ts` - add comparator coverage for both paths; the fs-fallback case covers R6 (the branch reachable under `bun test`).
### Plan
1. **(R1)** Add `readonly order?: number;` to `WebModule` in `apps/web/src/modules/types.ts:11`, after `sidebarLabel` and before the closing brace. Optional, so no existing caller breaks.
2. **(R1)** Add an exported `compareModules(a: WebModule, b: WebModule): number` helper in `apps/web/src/modules/discover.ts` (after `isWebModule`, ~:56). Semantics: both declared -> `a.order - b.order`; only `a` declared -> `-1`; only `b` declared -> `1`; neither -> `0` (stable sort preserves input order). Exported so tests assert directly.
3. **(R1)** In `discoverViaGlob` (`discover.ts:65-75`), keep the id pre-sort at :73, then append `found.sort(compareModules);` before `return found` at :74.
4. **(R1)** In `discoverViaFs` (`discover.ts:124-157`), keep the dir-name pre-sort at :139 and the require/push loop, then append `found.sort(compareModules);` before `return found` at :156.
5. **(R3)** In `apps/web/src/modules/observability/index.tsx:18`, add `order: 0,` to the `module` export (after `sidebarLabel`). With no other module declaring `order`, observability sorts first, so `defaultModule` (registry.ts:53) becomes observability and `router.tsx:13,32` redirect there.
6. **(R6)** In `apps/web/tests/modules/discover.test.ts`, add a `discoverViaFs` test using the existing `FsSeam`/`dirent`/`shape` helpers: return dirs out of declared order - e.g. `beta-dir` hosts a module with `order: 1`, `alpha-dir` hosts an undeclared module, `gamma-dir` hosts `order: 0`; assert the result is `[gamma, alpha, beta]` (declared sorted by `order` ascending, undeclared `alpha` retaining its dir-name position relative to other undeclared modules). Covers the fs-fallback comparator - the branch reachable under `bun test`.
7. **(R1/R2)** In the same test file, add a `discoverViaGlob` test: inject a fake glob yielding modules where some declare `order` and some do not, given out of id order; assert declared modules appear first sorted by `order`, undeclared modules follow in id order. Covers AC Scenario 2 (declarative + partial).
8. **(R5)** Determinism is structural: the comparator is pure and `Array.prototype.sort` is stable (Bun/V8/JavaScriptCore), so identical inputs yield identical ordering. No extra test beyond steps 6-7; the registry's "same inputs -> same ordering" contract (registry.ts:31) inherits this.
9. **(R4)** Run the existing `apps/web/tests/modules/registry.test.ts` suite unchanged - it is the regression guard for duplicate id/route validation (registry.ts:74-94) and disable/enable slot restoration (registry.ts:56-61). No new registry test: `order` does not touch validation or slot logic.
10. **(AC Scenario 1)** Verify end-to-end: after steps 1-5, `discoverModules()` places observability first and `defaultModule?.id === 'observability'`. Extend the `discoverModules` integration block (discover.test.ts:180-208) to assert the first discovered id is `observability`.
### Solution
- `apps/web/src/modules/types.ts:12-13` - Added `readonly order?: number;` to `WebModule` (after `sidebarLabel`). Optional field; no existing caller breaks.
- `apps/web/src/modules/discover.ts:55-66` - Added `compareModules(a, b)` partial-ordering comparator: declared modules (with `order`) sort ascending; undeclared return `0` so stable sort preserves their relative position.
- `apps/web/src/modules/discover.ts:91` - `discoverViaGlob`: applied `found.sort(compareModules)` after the existing id pre-sort.
- `apps/web/src/modules/discover.ts:175` - `discoverViaFs`: applied `found.sort(compareModules)` after the existing dir-name pre-sort.
- `apps/web/src/modules/observability/index.tsx:18` - Set `order: 0` on the observability module so it sorts first and becomes `defaultModule = enabledList()[0]`.
- `apps/web/tests/modules/discover.test.ts:92-114` - `compareModules` unit tests: both-declared ascending, one-declared lifts, neither-declared returns 0.
- `apps/web/tests/modules/discover.test.ts:143-158` - `discoverViaGlob` ordering test (AC Scenario 2): declared modules sort first by `order`, undeclared follow in id order.
- `apps/web/tests/modules/discover.test.ts:209-227` - `discoverViaFs` ordering test (R6): declared modules sort first by `order`, undeclared retain dir-name position.
- `apps/web/tests/modules/discover.test.ts:267-272` - `discoverModules` integration test (AC Scenario 1): asserts `discovered[0].id === 'observability'` and `order === 0`.

**Rationale:** Single partial-ordering comparator layered on top of each path's existing deterministic pre-sort (id / dir-name). `Array.prototype.sort` is stable (Bun/V8/JavaScriptCore), so undeclared modules retain their relative position. Registry validation, slot restoration, and `defaultModule = enabledList()[0]` are untouched - they inherit the promoted order from discovery.
### Testing
**Forced verification result:** PASS

| Requirement | Status | Fresh evidence |
| --- | --- | --- |
| R1 | MET | `WebModule.order` and both discovery paths are exercised by `apps/web/tests/modules/discover.test.ts`. |
| R2 | MET | Comparator tests cover declared ordering and stable relative order for undeclared modules. |
| R3 | MET | Registry discovery asserts Observability is first; route selection remains derived from the first enabled module. |
| R4 | MET | Existing duplicate-id, duplicate-route, and slot-restoration tests pass unchanged. |
| R5 | MET | Discovery is a pure stable sort over deterministic inputs. |
| R6 | MET | The fs-fallback ordering branch is covered by the discovery suite. |

| Acceptance criterion | Status | Evidence |
| --- | --- | --- |
| Scenario: R1 — Observability is the Board's first module and default landing route | MET | Test: `apps/web/tests/modules/discover.test.ts` in the 137-test focused run and full 3,941-test suite. |
| Scenario: R2 — Explicit ordering is declarative and partial | MET | Test: glob and fs-fallback comparator cases in `apps/web/tests/modules/discover.test.ts`. |

**Checks**

- Focused J4 slice: 137 pass, 0 fail.
- `bun run lint`: PASS (Biome plus all workspace typechecks).
- `bun run test`: PASS (3,941 pass, 0 fail; 12,217 assertions).
- `bun run build`: PASS.
- Design conformance: PASS; existing module-registry contract preserved.
- SECUA: PASS; no blocker or major finding.
- Repository-wide warning: `bun run spur-check` is blocked by the pre-existing out-of-scope `sp-runtime-path` hit at `plugins/sp/skills/issue-finding/SKILL.md:172`.
- Infrastructure warning: `bun run test-cf` crashed twice in the Cloudflare worker pool with SIGSEGV before test discovery; no assertion ran.
- Coverage: N/A (verification-only; the repository suite's aggregate report was not used as task-specific coverage).

Verdict artifact: `.spur/run/0374-verdict.json:1`.
### Review
**Functional traceability** - all 6 requirements MET.

**SECUA review findings:**

| Priority | Finding | File:Line | Status |
|----------|---------|-----------|--------|
| P1 | None | - | - |
| P2 | None | - | - |
| P3 | `as number` cast in comparator could use narrowing helper for consistency | `apps/web/src/modules/discover.ts:63-64` | Accepted - guarded by `typeof` check, not a defect |
| P4 | JSDoc on `order` field is a single long line; could wrap for readability | `apps/web/src/modules/types.ts:12` | Accepted - style preference, not actionable |

**Architecture depth:** Pure `compareModules` comparator layered on each path's existing deterministic pre-sort. No coupling introduced; `WebModule` interface extension is backward-compatible (optional field). Sort applied at discovery boundary so registry factory and downstream consumers inherit ordering without modification.

**Disposition:** PASS - no blockers (P1/P2), no major findings. P3/P4 are advisory only.
### References

J4

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-29T17:11:12.249Z todo → wip (system)
- 2026-07-29T17:13:14.662Z wip → testing (system)
- 2026-07-29T17:14:13.294Z testing → done (system)
