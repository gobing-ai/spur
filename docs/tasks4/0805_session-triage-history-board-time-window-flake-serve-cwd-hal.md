---
schema_version: 1
name: "Session triage: history-board time-window flake, serve --cwd half-scoping, startup drain gap"
status: todo
template: issue
created_at: 2026-09-08T05:46:02.113Z
updated_at: "2026-09-08T06:10:01.327Z"

---

## 0805. Session triage: history-board time-window flake, serve --cwd half-scoping, startup drain gap

### Background

Complete inventory of unsolved issues and findings from the 2026-09-07/08 session (B5 batch 0796-0799 + dogfood + merge), consolidated so none is re-discovered. Each item carries symptom, evidence, root-cause status, and fix direction. Resolved-by-fix items are NOT here (see Notes for what was fixed where): the serve.ts quota-consumer comment overpromise was corrected in ac6754991; the two lens SAFETY-comment false positives were durably suppressed inline.

1. **Flaky time-window test — history-board 4h rollup** — `packages/app/tests/services/history-board-service.test.ts:293`, assertion `expect(rtcSummary.kpis.sessionsCount).toBe(1)` (Expected 1, Received 0).
   - Evidence matrix: full-suite runs at 05:04 / 05:10 / 05:13 UTC → 7795 pass / 1 fail each, same assertion; identical command at 05:32 UTC → 7796/0. All subset/prefix combos green (8/8): `./packages` 4303/0; cli+server+web+packages 6440/0; full-minus-scripts 7713/0; full-minus-plugins 6523/0; cli+file 1011/0; server+app 3135/0; web+file 785/0; apps-prefix+file 2162/0. Failure output appears ~30% into the dot stream (~2300 tests in).
   - Boundary facts: manifestation required BOTH `./plugins` and `./scripts` in the invocation; `rg setSystemTime|MockDate|TZ=` across plugins/ and scripts/ returned empty (no clock mutator found). Neither merge side touched history-board code (git log on both sides of merge-base `5d435e63a` empty for the file). Pre-merge main (`b524a6e76`) full run at 05:15 UTC passed (7724/0) — inconclusive exoneration (ran just outside the failing window).
   - Test seeds: `nowTs = Date.now() - 30min`, `imported_at` literal '2026-08-31T00:00:00Z', range '4h' (`refreshHistoryRollups` / `LiveHistoryBoardService.getSummary` path).
   - Hypothesis (unproven): UTC clock-boundary math in the 4h rollup window; the failing window started 4-13 minutes past the 05:00 UTC hour boundary. Needs confirmation by frozen-clock repro at 05:04-05:13 UTC or direct read of the window computation.
   - URGENCY: recurs daily in the ~05:04-05:13 UTC window until fixed; will fail tomorrow's morning gate run.
   - Fix direction: inject a clock into the rollup service (or correct the boundary condition). The test is the victim — do NOT weaken its semantics.

2. **`serve --cwd` half-scoping** — `apps/cli/src/commands/serve.ts:11` `resolveServeDbUrl(cwd, env, configuredUrl)` scopes ONLY the dbUrl; `projectRoot`/`loadSpurConfig` derive from `process.cwd()` throughout serve.ts (:49, :434, :459, :462, :631).
   - Symptom: launching from tree A with `--cwd` tree B half-scopes — config from A, DB from B — silently. Cost a full dogfood diagnosis cycle during B5 (dogfood S3/S5 were drive bugs caused by exactly this), before the drive switched to in-project subshell launch.
   - Verified sound (no need to re-check): consumer lifecycle (SIGINT handlers, `quotaConsumer.stop()` final drain before teardown); direct `drainPendingAgentQuotaUpdates` call applied 1 row and acked ({applied:1}).
   - Fix is a public-surface decision (full scoping vs loud failure on cwd mismatch) requiring operator design consent per harness-surface governance (`docs/design/harness-surface-governance.md`). Dogfood report: `docs/dogfood/2026-09-07-B5-executor-quota-dogfood.md` finding F2 (RUN_ID 54D294E4D301).

3. **No synchronous first drain in the quota consumer** — consumer start only subscribes; first drain is the 30s `setInterval` poll, so an autostarted agent can select a to-be-disabled executor within the first poll interval; the disable lands at the next launch boundary (now documented in serve.ts:523-529).
   - Observe-only dogfood finding F1; AC letter was met (subscriptions precede autostart). Product decision needed: drain-at-start (synchronous first drain at consumer start; drain path verified sound via shutdown final drain) or explicit not-wanted with rationale.

4. **DB-lock incident: gate remediation recommends SIGTERM on a daemon that was working, not stale** — `test-post-check` inside `bun run spur-check` failed on `.spur/spur.db` lock; holder was `spur self serve` PID 64749 (started 21:40:31) with active child 94051 (`history daily`, a scheduled job). Gate's remediation message (identify via `lsof .spur/spur.db`, stop stale serve) was followed and worked.
   - Nuance: remediation guidance assumes "stale", but a serve daemon running scheduled jobs is a legitimate holder; killing it is operator judgment, not a mechanical step. Earlier in the session, dogfood S-series also hit DB contention (compacted evidence).
   - Fix direction (pick one, needs small design): gate distinguishes active serve (live scheduled child) from truly stale daemon before recommending SIGTERM; OR serve daemon auto-exits after idle TTL; OR daemon releases/uses WAL + busy_timeout so gates never block.

5. **Parallel-session concurrent writes in the shared checkout** — a second agent session worked in the same tree during this session's merge phase: `c7f56a616` (ts-libs version bump) landed on main mid-gates (between 22:32 and 22:39 checks); `packages/app/tests/services/agent-service.test.ts` (+131) and `docs/tasks4/0796-0799_*.md` went dirty unannounced; at ~23:00 `packages/app/src/services/agent-service.ts` gained concurrent `executor: executor.name` hunks interleaved with this task's suppress comments (selective-staged around: commit landed with only the 2 comment hunks).
   - Risk: one-writer violations (repo convention: "One writer per working tree" — parallel agents must use worktrees), mixed-task diffs, accidental commits of others' work.
   - Fix direction: process enforcement — adopt worktree-per-session for any concurrent work; optionally a pre-commit guard warning when staged files overlap a second session's dirty set.

6. **pi-lens advisory false positives persist in the blocker view** — (a) `agent-service.ts` L853/L1466 "as unknown as without SAFETY comment": rule cannot see the SAFETY comments 2 lines above (invariant IS stated; pre-existing since `d054d1282`); 4 false-positive dispositions recorded, advisory refired twice; durable inline `// pi-lens-ignore: require-safety-comment-for-as-unknown-as` written at both sites (committed). (b) yaml-ls cannot load `spur-config.schema.json` for `.spur/config.yaml` and `config/config.example.yaml`: schemaPath mapping points at the linked-CLI bundle layout (`.spur/@gobing-ai/spur/schemas/`, `config/@gobing-ai/spur/schemas/`) which does not exist in a fresh checkout (`ls` confirmed); real schema at `apps/cli/schemas/spur-config.schema.json`; gates green (spur-check exit 0) proves the files are valid.
   - Fix direction for (b): generate/symlink schemas into the referenced bundle paths at build time, OR update the lens yaml-ls schemaPath mapping to a path that exists in fresh checkouts (host-side lens config, outside repo — coordinate with operator).

### Requirements

- R1: History-board 4h-rollup flake root-caused with a reproducible failing-window demonstration (frozen/mocked clock at ~05:04-05:13 UTC or equivalent proof); existing test semantics preserved — no weakening of `sessionsCount` assertion or seeds.
- R2: `serve --cwd` scoping made coherent — either full scoping (config AND projectRoot AND dbUrl all follow `--cwd`) or loud failure when `--cwd` differs from `process.cwd()` — after recorded operator design consent (public surface).
- R3: Quota consumer at-launch behavior explicitly decided: synchronous first drain at consumer start, or documented not-wanted decision with rationale referencing dogfood F1.
- R4: DB-lock holder classification: gate remediation (or serve daemon behavior) distinguishes an active serve daemon (live scheduled child such as `history daily`) from a truly stale one before recommending SIGTERM; OR the daemon self-retires (idle TTL) / unlocks (WAL + busy_timeout) so gates never block on it.
- R5: yaml-ls schema resolution for `spur-config.schema.json` succeeds in a fresh checkout — schemas present at the mapped paths (generated/symlinked by build) or the mapping updated to an existing path (host-side, coordinated with operator).

### Acceptance Criteria

- AC1: Failing time window reproduced (mocked clock or written proof naming the exact boundary condition and file:line in the rollup window math); fix applied; full suite green at the previously failing window (05:04-05:13 UTC equivalent, via clock injection); `sessionsCount` test semantics unchanged; targeted run `cd packages/app && bun test tests/services/history-board-service.test.ts` green plus one full `bun run test` green.
- AC2: Design decision for `serve --cwd` recorded in this task's Design section with operator consent evidence; chosen behavior implemented; targeted tests cover the cross-tree launch scenario (config/db co-location); `apps/cli` tests green.
- AC3: Decision recorded (drain-at-start implemented with a targeted test proving an autostart-spawned agent observes the disable before the first poll tick) OR not-wanted decision documented in this task with rationale; either way the serve.ts comment and behavior agree.
- AC4: Chosen remediation (gate-side holder classification, daemon idle TTL, or WAL/busy_timeout) implemented; a full `bun run spur-check` passes while a serve daemon with a scheduled child is alive, or the scenario is proven impossible; targeted test or documented manual repro evidence.
- AC5: `yaml-ls` loads `spur-config.schema.json` without error in a fresh checkout (simulate: clone/worktree without `.spur/@gobing-ai`, verify no schema-load diagnostic; or lens config change verified against both yaml files).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Merge: `02dbb8716` (parents `b524a6e76` + `194ed5daf`); branch tip `194ed5daf`; merge-base `5d435e63a`.
- Direct fixes this session: `ac6754991` serve.ts drain-cadence comment (F1); suppress commit (agent-service.ts L853/L1468 `pi-lens-ignore`); `.gitignore` + local schema copies for lens yaml mapping.
- Task artifacts: task file `docs/tasks4/0805_session-triage-history-board-time-window-flake-serve-cwd-hal.md`; commits "docs(tasks): file task 0805 ..." (94c7d6427) and this update.
- Dogfood: `docs/dogfood/2026-09-07-B5-executor-quota-dogfood.md` (RUN_ID `54D294E4D301`, findings F1/F2, S-series); live evidence `.spur/run/dogfood/54D294E4D301.md`; `docs/dogfood/INDEX.md`.
- Flake evidence: `packages/app/tests/services/history-board-service.test.ts:293`; gate logs `/tmp/merge-gate-final.log` (spur-check exit 0), `/tmp/merge-testcf.log` (test-cf exit 0); full-suite green run 05:32 UTC → 7796/0.
- Governance: `docs/design/harness-surface-governance.md` (R2 consent path); repo convention "One writer per working tree" (AGENTS.md).

### History
### Notes

Process and environment notes from the session (no code fix required; recorded to prevent re-diagnosis):

- **cog commit-msg hook rejects default merge messages** ("Missing commit type separator `:`"). Convention: `chore: merge branch '<name>' (<description>)`. Precedents: `65a1ef486`, `df48b7900`, `a343bf7aa`; this session's `02dbb8716` followed it.
- **Commit `c7f56a616` carries type typo `docs(proect):`** (parallel session's ts-libs version bump). Pushed local main; amending would rewrite shared history — left as-is.
- **Dependency drift after merge is expected**: when a merge carries catalog bumps (this session: ts-* 0.4.56→0.4.57, 18 packages), run `bun install` before gates. The drift gate caught it pre-test — working as designed.
- **Lens suppression state**: 2 cast sites carry durable `pi-lens-ignore:` comments (commit "chore(app): suppress known-false-positive SAFETY-comment advisory"); first insertion landed mid-sentence and was repositioned adjacent to the cast (amended into same commit). 6 false-positive dispositions also recorded in the lens registry. yaml-ls remnant on `config/config.example.yaml` is a cached load failure: local schema copies now exist at both mapped paths (`.spur/@gobing-ai/`, `config/@gobing-ai/`, gitignored); the sibling `.spur/config.yaml` cleared with the identical fix, so the remaining diagnostic should clear on yaml-ls server restart.
- **Bun coverage pitfall (documented, task 0699 R4)**: single-file test runs from repo root fail the whole-repo coverage denominator; run targeted tests from inside the workspace.
- **Session shape**: two compactions; pre-compaction timing evidence unavailable (marked n/a in review). flake diagnosis was the avoidable-cost center: 3 failed full-gate runs before the time-window classification; a frozen-clock repro at the failing window is the cheapest path for AC1.

