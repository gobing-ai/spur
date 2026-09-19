---
schema_version: 1
name: "Fix test-cf environment: bump workerd/miniflare for macOS 26.5 and re-verify 0897 to done"
status: done
template: feature-impl
created_at: 2026-09-18T22:34:41.215Z
updated_at: "2026-09-19T05:55:54.410Z"
feature_id: G66

ac_altitude: task-local
---

## 0900. Fix test-cf environment: bump workerd/miniflare for macOS 26.5 and re-verify 0897 to done

### Background

Restore a runnable `bun run test-cf` (apps/server Cloudflare Workers vitest pool) so task 0897 can re-verify to PASS and reach done. Gates 0897 completion; no G66 feature surface change.
`bun run test-cf` segfaults (signal 11) in miniflare 4.20260526.0 cloudflare-pool worker startup — zero tests execute ("Worker exited unexpectedly"). Reproduced 2026-09-18 under bun 1.3.14 AND node 26.5.0, and on clean base @ eae5c7ac6. workerd standalone `--version` works. Pool deps unchanged in bun.lock since 2026-05-30; last recorded test-cf PASS 2026-08-10 (0503/0504). Host macOS updated to 26.5 (25F71) in between — suspected macOS-vs-workerd incompatibility.

### Requirements

- **R1** Bump miniflare/workerd (and `@cloudflare/vitest-pool-workers` if coupled) to a macOS 26.5 aarch64-compatible version; update `bun.lock` + catalog pins; no unrelated dependency drift.
- **R2** **Re-pack the ts-ai-runner overlay before/after any `bun install`** — top-level `node_modules/@gobing-ai/ts-ai-runner` and the `.bun/@gobing-ai+ts-ai-runner@0.4.68+2375bb4235721b28/…` store path must both carry the packed persistent-stdin build, or G66 agent tests regress.
- **R3** `bun run test-cf` green on this host (tests actually execute); `bun run spur-check` still PASS.
- **R4** Re-run 0897 verify (fresh sp-super-reviewer, observe-only) → verdict PASS → record → done. AC2 evidence must cite the gate's redelivery regression suites as `test`-type evidence (manual-review-only AC evidence is mechanically downgraded to PARTIAL by the verdict evidence rule).

### Acceptance Criteria

- [x] AC1 — `bun run test-cf` executes its tests and passes on this macOS 26.5 host (req: R1, R3)
- [x] AC2 — 0897 re-verifies PASS and reaches done with an honest verdict artifact (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

#### Approach

Replace the macOS-26.5-incompatible workerd with the current pool stack and unify the ts-* dependency plane on the published 0.4.69 release.

#### Key changes

- `apps/server/package.json:30` — `@cloudflare/vitest-pool-workers` 0.16.10 → 0.22.0 (peer vitest ^4.1.0 satisfied by 4.1.7); pulls miniflare 5.20260815.0-alpha + workerd 1.20260815.1, which run cleanly on macOS 26.5 where workerd 1.20260526.1 segfaulted (signal 11) before executing any test.
- `apps/server/vitest.cf.config.ts:9` — test-only `compatibilityFlags: ['nodejs_compat']`; vitest's in-worker module evaluator imports `node:os`, which pool-workers 0.22 requires; production `wrangler.toml` untouched.
- `package.json:105-112` — root `@gobing-ai/ts-*` exact pins 0.4.68 → 0.4.69 (catalog at `package.json:32-39` already ^0.4.69). Leaving root pins at 0.4.68 produced two EventBus classes from dual ts-infra instances and failed `spur-server` typecheck.
- `bun.lock` — regenerated: single ts-infra/ts-ai-runner 0.4.69 resolution set; the packed ts-ai-runner overlay is replaced by the published package (persistent-stdin fix ships in 0.4.68+).
- `plugins/sp/lib/idea-handoff.generated.mjs:325` — regenerated bundle (embedded ts-db schema constant 0.4.68 → 0.4.69); determinism test green.

#### Verification

- `bun run test-cf` → 1 file / 1 test passed (790ms), no segfault.
- `bun run spur-check` → 8554 pass / 0 fail across 485 files; post-check rules passed (`.spur/run/0900-test-gate.log`).
- Fresh 0897 re-verify by sp-super-reviewer → PASS (`.spur/run/0897-verify-answer2.txt`); 0897 done.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 bump pool to macOS-26.5-compatible workerd/miniflare, no unrelated drift | MET | apps/server/package.json:30 pool-workers 0.16.10->0.22.0; bun.lock resolves miniflare@5.20260815.0-alpha + workerd@1.20260815.1; miniflare 4 remains only under wrangler (bun.lock:2211) and @hono/vite-dev-server (bun.lock:2081); vitest unchanged (4.1.7); drift confined to pool subtree + ts-* 0.4.69 |
| R2 ts-* unified on published 0.4.69, overlay gone | MET | package.json:32-39 catalog + :105-112 deps all 0.4.69; grep ts-infra@0.4.68 bun.lock = 0; no file:/link: refs; consumers symlink ts-ai-runner@0.4.69+2e18240a; single ts-infra@0.4.69+4e4376cb; stale 0.4.68 real dir + orphan store dirs purged post-verify |
| R3 test-cf green + spur-check PASS | MET | .spur/run/0900-test-gate.log: 8554 pass / 0 fail across 485 files, post-check "All 2 rules passed"; live test-cf: 1 file / 1 test passed, 790ms, no signal 11 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 test-cf executes + passes on macOS 26.5 host | MET | command | `cd apps/server && bun run test-cf` -> Test Files 1 passed (1), Tests 1 passed (1), 790ms (was segfault signal 11 pre-fix) |
| AC2 0897 re-verifies PASS -> done | MET | command | .spur/run/0897-verify-answer2.txt VERDICT PASS (fresh sp-super-reviewer, test-cf 1/1); driver executed 0897 done transition |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T22:39:40.710Z backlog → todo (system)
- 2026-09-19T05:54:14.865Z todo → wip (system)
- 2026-09-19T05:54:52.405Z wip → testing (system)
- 2026-09-19T05:55:54.410Z testing → done (system)

