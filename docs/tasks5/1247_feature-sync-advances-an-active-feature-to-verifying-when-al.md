---
schema_version: 1
name: feature sync advances an active feature to verifying when all linked tasks are terminal
status: done
template: feature-impl
created_at: 2026-10-18T05:10:06.870Z
updated_at: "2026-10-19T01:30:13.397Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - feature-lifecycle

dependencies: ["1246"]
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1247-verdict.json
---

## 1247. feature sync advances an active feature to verifying when all linked tasks are terminal

### Background

Covers feature scenario R4. Design: docs/design/workflow-consolidation.md §3.2.

**Refine correction (2026-10-18, depth ready).** The filed premise "a feature reaches verifying only by an explicit `spur feature update`" is false:

- `deriveFeatureStatus` (packages/app/src/services/feature-service.ts:539-609) already proposes `active→verifying` when every linked task is terminal and at least one is done. It proposes `→verifying→done` when the receipt is valid, and stops at `verifying` with `receiptPending` when it is missing (1119).
- `runSyncFeature` (feature-service.ts:675-731) applies each hop through `transition` → write service → `lifecycle.requestTransition` (packages/app/src/services/planning-write-service.ts:471). So the guarded edge and the `verifying` onEnter already run during a sync (packages/app/src/workflow/lifecycle-adapter.ts:336).
- Sync also advances `backlog`/`blocked` features; the filed R3 "a feature not in active is left unchanged" contradicts that shipped behaviour and is dropped.
- task-pipeline's `done` close already calls `spur feature sync <fid>` best-effort, and `deferFeatureSync` already skips it (config/workflows/task-pipeline.yaml:755). The filed R4 is a no-change constraint, kept as out-of-scope.

The valid residual gap after 1246: the `verifying` onEnter now runs `spur feature verify` directly. A sync with a missing receipt plans only `['verifying']`, because the hops were derived before the pass ran. A PASS recorded by that onEnter therefore needs a second `feature sync` to reach `done`, and today no test proves the onEnter → receipt → done chain.

### Requirements

- [x] R1. After a sync hop lands in `verifying` and the derived proposal stopped there on `receiptPending`, `runSyncFeature` re-derives once. When the new proposal is `verifying→done` (PASS receipt from the onEnter pass), it applies that hop in the same call.
- [x] R2. A FAIL or missing receipt after the re-derive leaves the feature in `verifying`. The result's reason names the receipt finding and the rework edge (`spur feature update <id> active`), and sync exits 0.
- [x] R3. The re-derive runs at most once per call, and never when the verifying hop was not applied (guard denied, goal conflict, dry-run).
- [x] R4. An E2E proof drives a fixture feature (one task done, one cancelled) from `active` through one `feature sync`: it runs the verifying onEnter exactly once and lands in `done` on PASS, or in `verifying` on FAIL. A sibling feature with one `wip` task stays `active`.

Out of scope:
- Derivation rules (≥1 done, backlog/blocked hops, reopen, deprecated sticky).
- `deferFeatureSync`.
- The 1004 blocked-sync fingerprint.
- An all-cancelled feature never advances. That is the shipped "at least one done" rule.

### Acceptance Criteria

- [x] AC1 — A feature with every linked task terminal can advance to verifying on its own (req: R1, R2, R3, R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-18T05:46:48.134Z

- Q: Should sync also advance a feature whose linked tasks are all cancelled? A: No. The shipped rule requires at least one done task (feature-service.ts:539). The D66 R4 Given ("done or cancelled") is met by a mixed fixture.
- Q: Re-derive inside sync, or let task-pipeline call sync twice? A: Re-derive in sync. One owner, and every caller (CLI, task-pipeline done close, `check --fix`) gets it.

### Design

Chosen: one bounded re-derive in `runSyncFeature`, after the hop loop, when the last applied hop is `verifying` and the original proposal had `receiptPending`. It calls `deriveFeatureStatus` again. Only a `to: 'done'` proposal with hops `['done']` is applied, through the same `transition` path inside the existing `finally` refresh.

Rejected:
- An auto-advance edge in feature-lifecycle: it is externally driven, and `requestTransition` never chains.
- Deriving hops after each transition generally: that widens blast radius to every sync path.
- Running `feature verify` from sync: the onEnter already owns the pass (1246).

Frozen names: none new. The extension stays inside `runSyncFeature`, and `FeatureSyncResult.appliedHops` reports both hops.

File targets:
- packages/app/src/services/feature-service.ts:675-731 — the re-derive.
- packages/app/tests/services/feature-service.test.ts — the receiptPending → re-derive cases (PASS → done, FAIL → verifying, denied hop → no re-derive).
- apps/cli/tests/commands/feature.test.ts — the E2E: a fixture project, the bundled feature-lifecycle, and a stub `spurBin` whose `feature verify` writes a PASS/FAIL receipt.
- plugins/sp/skills/spur-cli/references/features.md:243-275 — sync section: the single-call `active→verifying→done` on PASS.

Invariants:
- Sync never writes status directly.
- The `verifying→done` guard stays the authority.
- The verify pass runs once per sync.

Anti-patterns:
- No loop to a fixpoint.
- No new sync flag.
- No YAML change; 1246 owns the onEnter.

Handoffs:
- Depends on 1246 (direct onEnter and receipt identity).
- 1249's wrapup no longer moves feature state, so this is the forward path.
- 1252 sweeps the dev-wrap and dev-runall wording.

Execution budget: about 4h. Persisted artifacts: test files plus the features.md diff. requireDiff: yes.

### Plan

- [x] Write the failing unit cases in feature-service.test.ts: receiptPending + onEnter PASS → `appliedHops: ['verifying','done']`; FAIL → `['verifying']` with the rework reason; guard-denied verifying → no re-derive.
- [x] Write the failing E2E in apps/cli/tests/commands/feature.test.ts with the stub verifier: one sync from active → done on PASS; FAIL → verifying; a wip sibling stays active; onEnter call count is 1.
- [x] Implement the bounded re-derive in `runSyncFeature`.
- [x] Update the features.md sync section.
- [x] Run the targeted tests (`cd packages/app && bun test tests/services/feature-service.test.ts`; `cd apps/cli && bun test tests/commands/feature.test.ts`); the full `bun run spur-check` is the pipeline's `test` hop, not an in-pass step.

### Solution

Bounded re-derive in `runSyncFeature` — one owner, so every caller (CLI, task-pipeline done close,
`check --fix`) gets it. `requestTransition` never chains, and the `verifying` onEnter (1246) is the
only thing that can turn a receipt-missing stop into a receipt-present one; the hop list cannot see
it because it was derived before the pass ran.

- `packages/app/src/services/feature-service.ts:723-746` — after the hop loop, when the original
  proposal had `receiptPending` and the last applied hop is `verifying`, re-derive exactly once. Only
  a `to: 'done'` proposal with hops `['done']` is applied, through the same `transition` path. Anything
  else stays in `verifying` and rewrites `proposal.reason` to name the receipt finding code(s) and the
  rework edge (`spur feature update <id> --status active`). A goal conflict returns at
  `packages/app/src/services/feature-service.ts:708` and a denied guard throws out of `transition`, both
  before this block; `--dry-run` returns at `packages/app/src/services/feature-service.ts:683` — so the
  re-derive never runs when the verifying hop was not applied.
- `packages/app/src/services/feature-service.ts:696` and `:756` — `appliedProposal` carries the
  re-derived proposal out of the `try`/`finally`, so the returned `proposal` describes what was applied
  (`from` = the original `from`, `to: 'done'`, `appliedHops: ['verifying','done']`).

Tests:
- `packages/app/tests/services/feature-service.test.ts:1364-1435` — PASS re-derive (`appliedHops`
  `['verifying','done']`), FAIL rework reason, and the no-re-derive guard (denied hop + dry-run) via a
  `deriveFeatureStatus` spy. `recordVerificationReceipt` (`:52`) gained a `status` parameter for the
  FAIL fixture; `makeOnEnterService` (`:87`) simulates the onEnter pass.
- `apps/cli/tests/commands/feature.test.ts:1128-1181` — spawned-CLI E2E on a throwaway root: fixture
  feature F1 (one done + one cancelled task) plus wip sibling G1, with the verification command stubbed
  on PATH. One `feature sync` lands `active → done` on PASS (the onEnter pass ran exactly once, G1 stays
  `active`); a FAIL pass leaves F1 `verifying`, names the rework edge, and exits 0.
- `apps/cli/tests/commands/feature.test.ts:41-44` — the file-level fixture now roots at
  `mkdtempSync(tmpdir())` like every other fixture in the file, instead of `tests/.tmp-feature-test-*`
  inside the checkout. Required to run this task's E2E at all: the nested `.git/` the fixture creates is
  unwritable under a sandboxed run (`could not write config file …/.git/config: Operation not
  permitted`), which aborted the whole file in `beforeAll`.

Docs: `plugins/sp/skills/spur-cli/references/features.md:275-281` — the single-call completion bullet.

Plan step 5: the targeted tests ran (evidence in `## Testing`); the full `bun run spur-check` is the
pipeline's `test` hop, which implement scope forbids running in-pass
(`sp-code-implementation` "Implement scope: do not run the project quality gate").

Known residual, not a code defect: `spur task gate 1247 light` reports `rules:post` FAIL with
`coverage-artifact: lcov-mismatch` — the gitignored `.coverage/lcov.info` certification was
invalidated by the targeted workspace test runs above. Its documented recovery is a canonical
`bun run test:full`, which is the pipeline's `test` hop. Every other light-gate check passed
(format-lint:changed, rules:pre, typecheck apps/cli + packages/app, tests apps/cli + packages/app +
plugins/sp).

**D66 forced re-verification repair (2026-10-18):** corrected the FAIL receipt recovery hint to the CLI positional form `spur feature update <id> active` at `packages/app/src/services/feature-service.ts:742`; the feature-sync CLI regression now executes that recovery command and confirms the feature returns to active. The service expectation and spur-cli feature reference use the same form.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/feature-service.ts:729` — bounded re-derive applies done in the same call. |
| R2 | MET | `apps/cli/tests/commands/feature.test.ts:1189` — FAIL retains verifying, reports recovery, exits 0. |
| R3 | MET | `packages/app/tests/services/feature-service.test.ts:1438` — denied-hop and dry-run derivation counts; `packages/app/src/services/feature-service.ts:705` — goal-conflict return. |
| R4 | MET | `apps/cli/tests/commands/feature.test.ts:1161` — PASS flow; `apps/cli/tests/commands/feature.test.ts:1189` — FAIL flow; `apps/cli/tests/commands/feature.test.ts:1124` — wip sibling remains active. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A feature with every linked task terminal can advance to verifying on its own (req: R1, R2, R3, R4) | MET | test | `apps/cli/tests/commands/feature.test.ts:1156` — spawned-CLI E2E cases passed, including exactly-once verification and the non-terminal sibling. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1247

Scope: working-tree implementation diff; no implementation commit tagged (1247) exists. Reviewed the feature service, both changed test files, and the CLI reference against all four task requirements, task AC1 / D66 scenario R4, and docs/design/workflow-consolidation.md section 3.2.
Dimensions: functional traceability, security, efficiency, correctness, usability, architecture.

##### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P2 (major) | functional / testing | The previously reported incomplete negative E2E proof is resolved: both outcome cases invoke sync for the wip sibling itself and assert active status, zero applied hops, and no extra verifier invocation. Both outcome cases also prove exactly one verification pass for the terminal-task feature. Fresh execution passed these assertions. | `apps/cli/tests/commands/feature.test.ts:1124`; `apps/cli/tests/commands/feature.test.ts:1177`; `apps/cli/tests/commands/feature.test.ts:1206` | RESOLVED |

No open P1-P3 findings, no new findings, and no carried residual.

##### Assessment

The implementation matches the bounded design: one additional derivation after an applied receiptPending verifying hop, accepting only a single done hop through the existing guarded transition. Dry-run and goal-conflict paths return before this block; a denied verifying hop throws before it. The finally refresh remains effective after any applied hop. FAIL and missing receipts retain verifying and report the receipt finding and rework command.

The behavior remains in the application service and is shared by existing callers. There is no new dependency, flag, abstraction, direct status write, or workflow edit. Verification remains owned by the lifecycle entry and completion remains guarded. The CLI reference describes the resulting behavior at plugins/sp/skills/spur-cli/references/features.md:275. No architectural deepening candidate is justified by this diff.

##### Verification

- Fresh command from packages/app: bun test tests/services/feature-service.test.ts exited 0; 69 pass, 0 fail, 999 assertions. Repeatable artifact: .spur/run/1247-review-service-fresh.log.
- Fresh command from apps/cli: bun test tests/commands/feature.test.ts exited 0; 54 pass, 0 fail, 174 assertions. Repeatable artifact: .spur/run/1247-review-cli-fresh.log. The E2E uses the real lifecycle, receipt writer and completion guard; only the repo-wide check command is stubbed to return PASS or FAIL.
- The CLI suite and gate probe used a temporary writable GIT_OBJECT_DIRECTORY with the repository object store as GIT_ALTERNATE_OBJECT_DIRECTORIES, accommodating sandbox write restrictions without bypassing hooks or guards.
- Fresh spur task gate 1247 status returned {"reuse":true,"reason":"ok"}; the full-tier PASS receipt matches tree ac8b4371e7fd656c0c40a441971ea3d75ed52828. The full quality gate was reused, not rerun by this review.
- Fresh spur task check 1247 --strict-core --json passed. It emitted two existing Solution anchor-subject warnings for return statements at feature-service.ts lines 683 and 708. Inspection of the immediately enclosing dry-run and goal-conflict conditions confirms the cited behavior; these heuristic warnings do not establish a defect.
- git diff --check exited 0. Review changed no production code or tests. Feature-wide release readiness is outside this task review.

| WBS | Outcome | P1 open | P2 open |
| --- | --- | --- | --- |
| 1247 | PASS | 0 | 0 |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/feature-service.ts:729` bounds the re-derive to an applied receiptPending verifying hop; line 731 admits only the single guarded done hop. `packages/app/tests/services/feature-service.test.ts:1375` proves both hops in one call. Fresh service tests exited 0. |
| R2 | MET | `packages/app/src/services/feature-service.ts:736` reports receipt finding codes and the rework command while retaining verifying; `packages/app/tests/services/feature-service.test.ts:1340` covers missing evidence; `packages/app/tests/services/feature-service.test.ts:1398` covers FAIL. `apps/cli/tests/commands/feature.test.ts:1191` proves FAIL sync exits 0 with the expected finding and rework command. Both fresh suites passed. |
| R3 | MET | `packages/app/src/services/feature-service.ts:682` exits on dry-run; `packages/app/src/services/feature-service.ts:705` checks goal conflicts before applying hops; `packages/app/src/services/feature-service.ts:719` applies the guarded transition before the single additional derivation at line 730. `packages/app/tests/services/feature-service.test.ts:1438` proves denied-hop and dry-run derivation counts. `apps/cli/tests/commands/feature.test.ts:1206` proves FAIL does not rerun verification. Both fresh suites passed. |
| R4 | MET | `apps/cli/tests/commands/feature.test.ts:1161` drives one sync through verifying to done on PASS; `apps/cli/tests/commands/feature.test.ts:1189` drives FAIL to verifying. Exactly-once assertions are at `apps/cli/tests/commands/feature.test.ts:1177` and `apps/cli/tests/commands/feature.test.ts:1206`. Both invoke `apps/cli/tests/commands/feature.test.ts:1124`, explicitly syncing the wip sibling and asserting no hop or extra pass. Fresh CLI execution exited 0: 54 pass, 0 fail. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R4 — A feature with every linked task terminal can advance to verifying on its own | MET | test | Task AC1 / D66 R4: `apps/cli/tests/commands/feature.test.ts:1161` proves the mixed done/cancelled fixture completes through verifying in one sync on PASS; `apps/cli/tests/commands/feature.test.ts:1189` proves FAIL remains verifying with exit 0. `apps/cli/tests/commands/feature.test.ts:1124` explicitly syncs the non-terminal sibling and proves active status, zero hops and no extra verification. Fresh CLI run exited 0: 54 pass, 0 fail, 174 assertions. |

Confidence: HIGH
Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)
- 2026-10-18T17:13:01.654Z todo → wip (system)
- 2026-10-18T17:34:21.512Z wip → testing (system)
- 2026-10-18T17:34:22.250Z testing → done (system)

