---
schema_version: 1
name: Prove a two-install fleet dispatch over A2A
status: done
template: feature-impl
created_at: 2026-11-15T04:06:32.872Z
updated_at: "2026-11-15T20:37:16.105Z"
feature_id: G9
priority: P3
tags:
  - a2a
  - fleet
  - e2e
estimate_hours: 8

dependencies: ["1336", "1334"]
done_forced: "false"
done_reason: unforced close
---

## 1337. Prove a two-install fleet dispatch over A2A

### Background

Implements: R6 — Two Spur installs complete a dispatch over A2A; R7 — A member that declares its own write fencing accepts mutating work.

Joins the sending side (G8, task 1334) to the receiving side (the serve endpoint task) and lifts the read-only limit for remote members that fence their own tree. Contract: `docs/design/a2a-member-transport.md` sections 3.5 and 4.3.

### Requirements

- [x] R1 — An E2E lane starts two isolated Spur homes on one machine, A declaring a member with B's card, and completes a read-only dispatch by name.
- [x] R2 — Both installs hold a durable record: A the request and receipt, B the inbox request and run.
- [x] R3 — B's cards carry a write-fencing extension; A accepts worktree-mutating work for a member whose card has it and still refuses it otherwise.
- [x] R4 — For mutating work A's receipt names the remote branch; A does not fetch or merge it.

### Acceptance Criteria

- [x] AC1 — Two Spur installs complete a dispatch over A2A
- [x] AC2 — A member that declares its own write fencing accepts mutating work

Task-local check: the lane is repeatable from one command and leaves both installs' receipts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**2026-11-15 — not attempted (batch 1331,1334,1337).** Blocked in-batch: dependency 1334 cancelled before implementation (preflight A2). Two-install lane follows 1334.

### Design

Approach: no new mechanism — the lane composes the two existing halves. The fencing signal is one card extension URI that the sender's read-only admission check consults.

Rejected: transferring diffs over A2A artifacts (large, and merging is a human decision); trusting any card for mutating work.

Invariant: without the extension, behavior is exactly G8's.

### Plan

- [x] Failure list first: B down, B restarted mid-run, card without the extension, token mismatch.
- [x] Two-home E2E lane and its receipt artifact.
- [x] Card extension on the server side; admission check on the sender side.
- [x] Update `docs/design/a2a-member-transport.md` invariant 3.

### Solution

| File | Change | Why |
| --- | --- | --- |
| `apps/server/src/modules/a2a/projection.ts:10-19,49,78` | Added the write-fencing extension to every Spur card and `metadata.remoteBranch` to the task contract. | B declares its own write fencing and exposes its working branch. |
| `apps/server/src/modules/a2a/index.ts:122-134,160-166` | Projected the current Git branch onto completed A2A tasks. | A can record the remote branch without fetching or merging. |
| `packages/app/src/services/a2a-member-transport.ts:47-56,204-215,339-342,410-438,509-516` | Parsed card extensions, gated mutating work on them, returned and durably preserved the remote branch; completed members now reply through the inbox. | Extension-free cards keep the old refusal, fenced cards accept work, B returns a real answer, and re-attach stays local. |
| `packages/app/src/workflow/fleet-dispatch.ts:76,211-216,294` | Checked the card before prompt write/enqueue, mapped card failure to `unavailable`, and propagated the branch into fleet receipts. | Pre-send admission, failure handling and receipt share one contract. |
| `packages/app/src/workflow/actions/agent-run.ts:507` | Added `remoteBranch` to successful `agent.run` data. | Workflow callers receive the branch. |
| `packages/app/src/services/member-dispatch.ts:29,204` | Added `remoteBranch` to cold named-member results. | Manual dispatch receives the branch. |
| `apps/cli/src/commands/agent/run.ts:148` | Added `remoteBranch` to A2A JSON output. | The public CLI receipt exposes the branch. |
| `packages/app/src/index.ts:153-166` | Exported the card/fencing contracts. | Server and tests share one URI and parser. |
| `apps/server/tests/modules/a2a/projection.test.ts:23-41` | Pinned the card extension. | Prevents accidental removal. |
| `apps/server/tests/modules/a2a/routes.test.ts:331-345` | Added a real Git-branch completion case. | Proves `metadata.remoteBranch`. |
| `packages/app/tests/services/a2a-member-transport.test.ts:127-145,226-255` | Covered inbox replies, extension-free refusal, fenced mutation and branch. | Preserves both admission modes and B's answer. |
| `packages/app/tests/workflow/fleet-dispatch.test.ts:371-397` | Covered branch propagation and pre-enqueue card failure through `dispatchToFleet`. | Proves the workflow receipt and no-throw failure boundary. |
| `scripts/commands/a2a-two-install-e2e.ts:1-468` | Added a real two-install E2E with all failure legs. | Repeatable end-to-end proof, not a mocked receipt. |
| `scripts/spur-dev.ts:44,61,179-181` and `package.json:102` | Registered `bun run a2a-two-install-e2e`. | One command reruns the lane. |
| `docs/reports/a2a-two-install-e2e-receipt.json` | Captured 9/9 passing E2E steps. | Verifiable artifact for R1-R4. |
| `docs/design/a2a-member-transport.md:193-198,226-240` | Documented conditional fencing and branch receipts. | Keeps the design contract synchronized. |
| `docs/00_ADR.md:2832-2834,2847-2850` | Amended ADR-148 with the extension and branch rule. | Keeps the architectural authority synchronized. |
| `docs/04_DESIGN.md:86` | Updated the A2A implementation index. | Removes stale open-task status. |

Probe: `bun run a2a-two-install-e2e` — 9/9 PASS: two durable ledgers, card extension, no-extension refusal, wrong token, fenced mutation + branch, workflow stage, B down, restart re-attach, and no fetch/merge.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/reports/a2a-two-install-e2e-receipt.json` step `read-only-two-install`: A and B each hold one durable run and B's answer is returned. |
| R2 | MET | Same receipt: A `runs=1`, B `runs=1`; B's inbox request and run are durable. |
| R3 | MET | `apps/server/src/modules/a2a/projection.ts:78`; `packages/app/src/services/a2a-member-transport.ts:47-56,426-438`; `packages/app/src/workflow/fleet-dispatch.ts:211-222`; E2E `write-fencing-card`, `extension-free-refusal`, `fenced-workflow-stage`. |
| R4 | MET | `apps/server/src/modules/a2a/index.ts:160-166`; `packages/app/src/services/a2a-member-transport.ts:410-438,509-516`; E2E `fenced-mutation-and-branch`, `restart-reattach`, `no-fetch-or-merge`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `bun run a2a-two-install-e2e` — `read-only-two-install` PASS with `exec-answer: read only two install` and durable A/B records. |
| AC2 | MET | command | E2E `fenced-mutation-and-branch` and `fenced-workflow-stage` PASS with `remoteBranch=sp/remote-e2e`; `extension-free-refusal` remains `not-started`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Finding | Disposition | Evidence |
| --- | --- | --- | --- |
| P4 (advisory) | Verification found direct inbox SQL in the new E2E harness; replaced it with `InboxDao.findByRequestKey` and re-verified. | RESOLVED | `scripts/commands/a2a-two-install-e2e.ts:285-290`; ownership test 3/3 and E2E 9/9 PASS. |

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | 4/4 claims DONE: failure legs, two-home lane, card extension/admission, and invariant-3 documentation. |
| SECUA | pass | Wrong-token calls stop before B writes; no secret is logged. Card failures map to `unavailable`, never an uncaught exception. |
| architecture | pass | One inbox writer, no fourth dispatch surface, no schema migration, no diff transfer/fetch/merge. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/reports/a2a-two-install-e2e-receipt.json` step `read-only-two-install`: A and B each hold one durable run and B's answer is returned. |
| R2 | MET | Same receipt: A `runs=1`, B `runs=1`; B's inbox request and run are durable. |
| R3 | MET | `apps/server/src/modules/a2a/projection.ts:78`; `packages/app/src/services/a2a-member-transport.ts:47-56,426-438`; `packages/app/src/workflow/fleet-dispatch.ts:211-222`; E2E `write-fencing-card`, `extension-free-refusal`, `fenced-workflow-stage`. |
| R4 | MET | `apps/server/src/modules/a2a/index.ts:160-166`; `packages/app/src/services/a2a-member-transport.ts:410-438,509-516`; E2E `fenced-mutation-and-branch`, `restart-reattach`, `no-fetch-or-merge`. |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | command | `bun run a2a-two-install-e2e` — `read-only-two-install` PASS with `exec-answer: read only two install` and durable A/B records. |
| AC2 | MET | command | E2E `fenced-mutation-and-branch` and `fenced-workflow-stage` PASS with `remoteBranch=sp/remote-e2e`; `extension-free-refusal` remains `not-started`. |

| Verification | Result |
| --- | --- |
| `task gate 1337 recheck` | PASS — full-tier receipt `.spur/run/1337-check-receipt.json`; format/lint, all rules, typechecks and repo-wide coverage accepted. |
| `bun run a2a-two-install-e2e` | 9/9 PASS, including B down, restart, token mismatch, extension-free refusal and no-fetch/no-merge. |
| Focused suites | 31/31 server A2A, 72/72 app transport/CLI/fleet/workflow, 23/23 fleet-dispatch, 16/16 CLI agent-run, and all four workspace typechecks passed. |

Verdict: PASS

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-15T19:46:40.742Z todo → wip (system)
- 2026-11-15T20:37:14.890Z wip → testing (system)
- 2026-11-15T20:37:16.101Z testing → done (system)

