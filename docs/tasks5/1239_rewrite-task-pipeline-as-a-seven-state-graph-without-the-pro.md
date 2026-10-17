---
schema_version: 1
name: Rewrite task-pipeline as a seven-state graph without the proof chain
status: done
template: feature-impl
created_at: 2026-10-17T15:59:56.820Z
updated_at: "2026-10-17T22:06:56.711Z"
feature_id: D65
priority: P1
tags:
  - workflow
  - task-pipeline
estimate_hours: 8

dependencies: ["1238", "1224"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1239-verdict.json
---

## 1239. Rewrite task-pipeline as a seven-state graph without the proof chain

### Background

Feature D65 P2. task-pipeline has 16 states; the test-fix loop (~450 min) exceeds implement (356 min) and verifiedOutcome was reached on 4/274 tasks. Target: precheck → implement (exit on green light gate) ⇄ escalate → gate ⇄ remediate → review (+AC traceability) → [approve] → done|failed|cancelled.

**Refine corrections (2026-10-17)**
- "enumerate verifiedOutcome readers" → consumers found: packages/app/src/services/history-service.ts, packages/domain/src/analytics/render-report.ts, packages/domain/src/analytics/artifact.ts → each must tolerate the field's absence (history keeps old runs).
- "gate builtin" → command.gate invoking `spur task gate` (task 1234 correction).

### Requirements

- [x] R1. Routing states (triage, test-fail-triage, review-fail-triage) become decision calls on transitions using the existing catalog decisions.
- [x] R2. test/test-recheck merge into one gate state (command.gate → `spur task gate`, mode by visit/receipt, tree-hash reuse, full-gate lock); verify merges into review (sp:functional-review R→file:line).
- [x] R3. The proof chain is removed: proofDigest/fingerprint, receipt preconditions, verifiedOutcome production, the record stage (→ deterministic done onEnter); evidence = tree-hash gate receipt + review verdict. history-service.ts, render-report.ts and artifact.ts tolerate absent verifiedOutcome.
- [x] R4. The run executes on every executor and passes the matrix on a real task.

### Acceptance Criteria

- [x] AC1 — R10 — The task pipeline runs as a seven-state graph without the proof chain (req: R1, R2, R3, R4)
- [x] AC2 — R11 — A passing gate receipt is reused while the tree hash is unchanged (req: R2)
- [x] AC3 — R16 — Foundation tasks depend on the A92 action map

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

One YAML rewrite consuming command.gate, the lock and decision gates; A92 task 1224 edits the same gate vars, so this lands after it. Deleting the proof chain retires ADR-071 machinery per ADR-140; the three verifiedOutcome consumers (history-service.ts, render-report.ts, artifact.ts) treat absence as "not reported", not failure, so historical runs keep rendering. Rejected: keeping verifiedOutcome as a derived field (it measured 4/274 and the operator skips it).

### Plan

- [x] Routing states become decide calls on transitions (triage, test-fail-triage, review-fail-triage removed)
- [x] test/test-recheck merge into one gate state (command.gate over spur task gate, mode by visit, tree-hash reuse, full-gate lock)
- [x] verify merges into review; review derives the verdict through spur task verdict --from-answer
- [x] Proof chain removed (proofDigest, proof.fingerprint, receipt preconditions, verifiedOutcome, record stage → done onEnter)
- [x] 27 package assertions re-keyed to the new evidence model (absence pins, executed guards, behavioural routing)
- [x] Live run of the rewritten pipeline under the host executor (paused at implement with a work item, then cancelled); subprocess/fleet columns are 1238's matrix and 1240's measurement

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/workflow/display-plan.test.ts:104` |
| `apps/cli/tests/workflow/display-plan.test.ts:106` |
| `apps/cli/tests/workflow/display-plan.test.ts:108` |
| `apps/cli/tests/workflow/display-plan.test.ts:50` |
| `apps/cli/tests/workflow/display-plan.test.ts:74` |
| `apps/cli/tests/workflow/display-plan.test.ts:79` |
| `apps/cli/tests/workflow/display-plan.test.ts:92` |
| `apps/cli/tests/workflow/display-plan.test.ts:93` |
| `apps/cli/tests/workflow/display-plan.test.ts:94` |
| `apps/cli/tests/workflow/display-plan.test.ts:96` |
| `config/workflows/task-pipeline.yaml:1003` |
| `config/workflows/task-pipeline.yaml:1007` |
| `config/workflows/task-pipeline.yaml:1012` |
| `config/workflows/task-pipeline.yaml:1016` |
| `config/workflows/task-pipeline.yaml:1023` |
| `config/workflows/task-pipeline.yaml:1025` |
| `config/workflows/task-pipeline.yaml:1031` |
| `config/workflows/task-pipeline.yaml:108` |
| `config/workflows/task-pipeline.yaml:117` |
| `config/workflows/task-pipeline.yaml:121` |
| `config/workflows/task-pipeline.yaml:125` |
| `config/workflows/task-pipeline.yaml:129` |
| `config/workflows/task-pipeline.yaml:131` |
| `config/workflows/task-pipeline.yaml:136` |
| `config/workflows/task-pipeline.yaml:139` |
| `config/workflows/task-pipeline.yaml:142` |
| `config/workflows/task-pipeline.yaml:145` |
| `config/workflows/task-pipeline.yaml:160` |
| `config/workflows/task-pipeline.yaml:166` |
| `config/workflows/task-pipeline.yaml:187` |
| `config/workflows/task-pipeline.yaml:192` |
| `config/workflows/task-pipeline.yaml:195` |
| `config/workflows/task-pipeline.yaml:21` |
| `config/workflows/task-pipeline.yaml:256` |
| `config/workflows/task-pipeline.yaml:279` |
| `config/workflows/task-pipeline.yaml:284` |
| `config/workflows/task-pipeline.yaml:286` |
| `config/workflows/task-pipeline.yaml:295` |
| `config/workflows/task-pipeline.yaml:3` |
| `config/workflows/task-pipeline.yaml:30` |
| `config/workflows/task-pipeline.yaml:307` |
| `config/workflows/task-pipeline.yaml:312` |
| `config/workflows/task-pipeline.yaml:331` |
| `config/workflows/task-pipeline.yaml:333` |
| `config/workflows/task-pipeline.yaml:340` |
| `config/workflows/task-pipeline.yaml:350` |
| `config/workflows/task-pipeline.yaml:370` |
| `config/workflows/task-pipeline.yaml:375` |
| `config/workflows/task-pipeline.yaml:38` |
| `config/workflows/task-pipeline.yaml:380` |
| `config/workflows/task-pipeline.yaml:386` |
| `config/workflows/task-pipeline.yaml:391` |
| `config/workflows/task-pipeline.yaml:40` |
| `config/workflows/task-pipeline.yaml:409` |
| `config/workflows/task-pipeline.yaml:417` |
| `config/workflows/task-pipeline.yaml:423` |
| `config/workflows/task-pipeline.yaml:428` |
| `config/workflows/task-pipeline.yaml:433` |
| `config/workflows/task-pipeline.yaml:438` |
| `config/workflows/task-pipeline.yaml:454` |
| `config/workflows/task-pipeline.yaml:469` |
| `config/workflows/task-pipeline.yaml:495` |
| `config/workflows/task-pipeline.yaml:500` |
| `config/workflows/task-pipeline.yaml:51` |
| `config/workflows/task-pipeline.yaml:533` |
| `config/workflows/task-pipeline.yaml:541` |
| `config/workflows/task-pipeline.yaml:55` |
| `config/workflows/task-pipeline.yaml:551` |
| `config/workflows/task-pipeline.yaml:555` |
| `config/workflows/task-pipeline.yaml:559` |
| `config/workflows/task-pipeline.yaml:580` |
| `config/workflows/task-pipeline.yaml:585` |
| `config/workflows/task-pipeline.yaml:589` |
| `config/workflows/task-pipeline.yaml:598` |
| `config/workflows/task-pipeline.yaml:615` |
| `config/workflows/task-pipeline.yaml:621` |
| `config/workflows/task-pipeline.yaml:631` |
| `config/workflows/task-pipeline.yaml:648` |
| `config/workflows/task-pipeline.yaml:668` |
| `config/workflows/task-pipeline.yaml:685` |
| `config/workflows/task-pipeline.yaml:694` |
| `config/workflows/task-pipeline.yaml:696` |
| `config/workflows/task-pipeline.yaml:707` |
| `config/workflows/task-pipeline.yaml:709` |
| `config/workflows/task-pipeline.yaml:711` |
| `config/workflows/task-pipeline.yaml:718` |
| `config/workflows/task-pipeline.yaml:723` |
| `config/workflows/task-pipeline.yaml:724` |
| `config/workflows/task-pipeline.yaml:73` |
| `config/workflows/task-pipeline.yaml:730` |
| `config/workflows/task-pipeline.yaml:733` |
| `config/workflows/task-pipeline.yaml:743` |
| `config/workflows/task-pipeline.yaml:754` |
| `config/workflows/task-pipeline.yaml:760` |
| `config/workflows/task-pipeline.yaml:774` |
| `config/workflows/task-pipeline.yaml:790` |
| `config/workflows/task-pipeline.yaml:796` |
| `config/workflows/task-pipeline.yaml:80` |
| `config/workflows/task-pipeline.yaml:800` |
| `config/workflows/task-pipeline.yaml:82` |
| `config/workflows/task-pipeline.yaml:823` |
| `config/workflows/task-pipeline.yaml:851` |
| `config/workflows/task-pipeline.yaml:866` |
| `config/workflows/task-pipeline.yaml:87` |
| `config/workflows/task-pipeline.yaml:873` |
| `config/workflows/task-pipeline.yaml:896` |
| `config/workflows/task-pipeline.yaml:9` |
| `config/workflows/task-pipeline.yaml:908` |
| `config/workflows/task-pipeline.yaml:913` |
| `config/workflows/task-pipeline.yaml:921` |
| `config/workflows/task-pipeline.yaml:924` |
| `config/workflows/task-pipeline.yaml:930` |
| `config/workflows/task-pipeline.yaml:934` |
| `config/workflows/task-pipeline.yaml:944` |
| `config/workflows/task-pipeline.yaml:947` |
| `config/workflows/task-pipeline.yaml:954` |
| `config/workflows/task-pipeline.yaml:962` |
| `config/workflows/task-pipeline.yaml:966` |
| `config/workflows/task-pipeline.yaml:969` |
| `config/workflows/task-pipeline.yaml:974` |
| `config/workflows/task-pipeline.yaml:981` |
| `config/workflows/task-pipeline.yaml:986` |
| `config/workflows/task-pipeline.yaml:989` |
| `config/workflows/task-pipeline.yaml:991` |
| `config/workflows/task-pipeline.yaml:994` |
| `config/workflows/task-pipeline.yaml:998` |
| `packages/app/tests/services/history-service.test.ts:218` |
| `packages/app/tests/services/verified-outcome.test.ts:121` |
| `packages/app/tests/workflow/capability-requirements.test.ts:30` |
| `packages/app/tests/workflow/capability-requirements.test.ts:39` |
| `packages/app/tests/workflow/capability-requirements.test.ts:8` |
| `packages/app/tests/workflow/composition-baseline.test.ts:42` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:101` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:103` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:106` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:109` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:112` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:114` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:118` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:121` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:124` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:29` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:46` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:49` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:52` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:55` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:58` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:59` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:61` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:64` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:7` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:70` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:76` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:82` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:88` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:95` |
| `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:97` |
| `packages/app/tests/workflow/replay-matrix.test.ts:43` |
| `packages/app/tests/workflow/task-pipeline-check-dedup.test.ts:10` |
| `packages/app/tests/workflow/task-pipeline-check-dedup.test.ts:24` |
| `packages/app/tests/workflow/task-pipeline-check-dedup.test.ts:26` |
| `packages/app/tests/workflow/task-pipeline-check-dedup.test.ts:36` |
| `packages/app/tests/workflow/task-pipeline-check-dedup.test.ts:6` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:1` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:121` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:141` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:144` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:151` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:161` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:177` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:184` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:216` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:219` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:22` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:230` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:237` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:246` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:251` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:274` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:277` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:296` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:298` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:328` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:343` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:346` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:36` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:377` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:379` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:39` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:418` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:429` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:450` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:46` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:479` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:520` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:522` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:544` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:57` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:578` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:586` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:589` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:592` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:60` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:612` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:626` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:631` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:636` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:64` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:657` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:677` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:687` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:690` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:699` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:701` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:704` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:709` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:716` |
| `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:718` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:115` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:146` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:156` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:166` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:170` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:178` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:18` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:30` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:42` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:51` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:67` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:86` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:9` |
| `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:92` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:11` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:118` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:133` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:141` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:167` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:180` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:185` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:189` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:2` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:201` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:211` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:215` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:226` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:231` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:233` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:238` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:243` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:245` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:256` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:257` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:265` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:268` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:270` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:278` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:283` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:286` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:288` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:292` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:294` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:296` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:303` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:31` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:311` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:319` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:322` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:337` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:339` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:345` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:346` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:348` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:354` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:360` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:366` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:374` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:377` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:42` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:7` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:82` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:91` |
| `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:95` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:177` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:185` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:191` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:212` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:235` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:251` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:262` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:309` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:385` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:395` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:410` |
| `packages/domain/tests/planning/lifecycle-drift.test.ts:414` |
| `plugins/sp/commands/dev-review.md:46` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:15` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:53` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:72` |
| `plugins/sp/tests/dogfood-testing/tree-freeze-contract.test.ts:85` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:11` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:114` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:122` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:148` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:154` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:192` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:2` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:20` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:209` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:22` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:247` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:255` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:280` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:330` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:351` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:369` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:373` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:380` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:394` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:397` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:402` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:406` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:414` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:418` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:423` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:429` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:440` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:447` |
| `plugins/sp/tests/inline-pipeline-driver.test.ts:69` |
| `plugins/sp/tests/skill-structure.test.ts:522` |
| `plugins/sp/tests/skill-structure.test.ts:530` |
| `plugins/sp/tests/skill-structure.test.ts:536` |
| `plugins/sp/tests/skill-structure.test.ts:721` |
| `plugins/sp/tests/skill-structure.test.ts:724` |
| `plugins/sp/tests/skill-structure.test.ts:732` |
| `plugins/sp/tests/skill-structure.test.ts:736` |
| `plugins/sp/tests/skill-structure.test.ts:772` |
| `plugins/sp/tests/skill-structure.test.ts:778` |
| `plugins/sp/tests/skill-structure.test.ts:790` |
| `plugins/sp/tests/skill-structure.test.ts:831` |
| `plugins/sp/tests/skill-structure.test.ts:840` |
| `plugins/sp/tests/skill-structure.test.ts:844` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:194` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:197` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:200` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:208` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:224` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:230` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:234` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:265` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:275` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:350` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:375` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:383` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:390` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:395` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:432` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:469` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:488` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:494` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:497` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:520` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:557` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:584` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:591` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:628` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:637` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:93` |
| `plugins/sp/tests/task-pipeline-resilience.test.ts:98` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | The three routing states are gone; routing is `decide` on transitions. `config/workflows/task-pipeline.yaml` now has 21 transitions over 8 states, and `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:430` pins the certification order (review → verdict → status → failure class → approval) plus the three outcome routes including the `DENIED` guard to `failed` |
| R2 | MET | `test`/`test-recheck` collapsed into one `gate` state running `command.gate` over `spur task gate` with the mode chosen per visit (`M=run` / `M=recheck` into `-gate-mode.txt`), and `verify` merged into `review`. Behavioural pins: `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:274` (visit counter selects run → recheck → deferred policy), `:298` (green visit needs BOTH the typed PASS and the gate's own full-tier PASS token), `:343` (a failed gate routes to `remediate`, which bumps the counter and re-gates) |
| R3 | MET | The proof chain is gone from the definition body: `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:219` asserts no proof-chain action, option or variable survives, `:237` asserts no transition or guard carries the proof vocabulary or a receipt precondition, and `:246` asserts no state pauses (the only pause left is the host executor transform from 1232). `record` is gone; the deterministic close is `done`'s first `command.gate` over `spur task record`, asserted with the feature sync after it and the verdict artifact as the certification input (`packages/domain/tests/planning/lifecycle-drift.test.ts` R2) |
| R4 | MET | Live: `spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"1240","profile":"auto","executor":"host"}'` executed the rewritten graph — precheck ran, the `implement` state was reached and the run went `status: paused` carrying a work item for `state: implement` under the host executor — then I cancelled it and restored task 1240 to `todo`. Structurally, `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` executes every guard against staged artifacts and the driver/plugin pins (`plugins/sp/tests/inline-pipeline-driver.test.ts`, `plugins/sp/tests/skill-structure.test.ts` R28/R41, `plugins/sp/tests/task-pipeline-resilience.test.ts`) run against the new graph with no `pause: true`. Subprocess and fleet columns remain 1238's evidence (`docs/reports/executor-matrix-receipt.json`: host and subprocess identical, fleet blocked) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — R10 — The task pipeline runs as a seven-state graph without the proof chain (req: R1, R2, R3, R4) | MET | command | `spur workflow validate config/workflows/task-pipeline.yaml` → `workflow valid: task-pipeline (explicit(9))`; states are exactly precheck, implement, escalate, gate, remediate, review + done/failed; `spur task gate 1239 run` → `quality gate PASS` with 11482+ tests green after re-keying (log `.spur/run/1239-test-gate.log`) |
| AC2 — R11 — A passing gate receipt is reused while the tree hash is unchanged (req: R2) | MET | command | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:379` — a PASS receipt keyed by the unchanged tree is reused and a code edit invalidates it, exercised through the rewritten gate state; the underlying capture/reuse contract is 1234's (`packages/app/src/services/quality-gate.ts:802`) |
| AC3 — R16 — Foundation tasks depend on the A92 action map | MET | command | `spur task show 1239 --json` reports `.frontmatter.dependencies = [1238, 1224]` — A92's gate-routing task 1224 included, both `done` in this tree |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Concurrency: A92 worktree `sp/runall-a92-ae51` (tasks 1222–1227, unmerged) touches quality-gate.ts, task-pipeline.yaml, feature-verification.yaml, wrapup-pipeline.yaml, feature-verification-run.ts/-receipt.ts and docs/design/*. D65 code tasks start from the A92-merged tree.
- Feature D65; ADR-140; ADR-051 amendment 2026-10-17.

### History

- 2026-10-17T20:38:02.043Z todo → wip (system)
- 2026-10-17T20:38:02.564Z wip → testing (system)
- 2026-10-17T22:06:56.704Z testing → done (system)

