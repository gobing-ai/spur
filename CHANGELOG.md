# Changelog

## [0.3.52] — 2026-08-18

### Added

- feat(app): centralize task-completion contract, canonical verdict, target-aware check (5f0663b5)

### Fixed

- fix(app): honor escaped pipes and section bounds in verdict table parsing (0590) (2e966025)

### Changed

- docs: add I6 harness self-improvement program and planning tasks (b90cfc3f)
- docs: add F92 task-completion contract centralization feature with planned tasks (e032b181)
- docs(tasks): update task status after implementation (0d3c7326)

## [0.3.51] — 2026-08-18

### Added

- feat(app): honor accepted baseline debt in the per-task gate (f0e6c1a5)

### Fixed

- fix(sp): refuse pr-review on base branch pre-push, report upstream, probe recheck, coverage opt-in (ff5d31a3)

### Changed

- docs: record 0588 latency decision as ADR-064, close task 0588 (ca15b6cb)
- docs(task): add 0588/0589/0590 plans, update 0511, sync constitution (b559fc51)

### Other

- chore(baseline): drop two stale ratchet entries no longer reproducing (7ec57075)
- chore(project): restore the project configuration (7e87b1e8)

## [0.3.50] — 2026-08-17

### Added

- feat(app): add anchor-qualification pass for evidence citations (812d5ef4)
- feat(app): anchor integrity — qualification, subject-matching, external-evidence form, AC altitude (91f56755)
- feat(app): fail the gate on duplicate baseline keys (14dbccd2)
- feat(corpus): sweep every task folder and ratchet warning severity (e99c933e)
- feat(E5): pi mapper event-envelope fix — port omp fix to piSplit, re-import, correct 0489 (d3b8f082)

### Fixed

- fix: close mapper release+re-import gap (0578) — importer 0.4.37, omp/pi/grok/opencode full re-import, parseTodoItems ops/todoList shapes (fc53a0d9)
- fix: migration 0016 nullable ts + importer 0.4.38 bump and re-import (0580) (13cd7ede)
- fix: sanitize sentinel timestamps out of time-decomposition span math (0579) (807d5fc0)
- fix: add per-step token/time + cache-efficiency sections to history artifact and forensics report (0581) (e231f83b)
- fix(app): classify port-probe bind errors and add bind-free test seam (47743b4d)

### Changed

- docs(projects): add K2 port-probe robustness spec and 0585 task (11af1e0b)
- docs(features): refresh task status tables across feature files (c7be74ed)
- docs(tasks): record E5 re-audit evidence and anchor corrections (551bd3f0)
- docs(tasks): update task status after implementation (c6e2f91b)

### Other

- chore(E5): wrap-up — learnings, metrics, checkpoint for 0576+0577 (5885bf11)
- chore(E5): wrap-up — learnings, metrics, checkpoint for 0578+0580+0579+0581 (6ab3ad54)
- chore(tasks): mark completed plan items on 0576, 0578-0581 (8364f48c)
- chore: harden tests and add SVG titles (4eac0788)

## [0.3.49] — 2026-08-17

### Added

- feat(config): validate agent.roles stage overrides at schema + CLI boundary (0572 R10) (49fc378b)
- feat(history): thread agentConfig through history analyze and refresh paths (J8 R2) (9b96f126)
- feat(history): pairing evidence aggregation + pairings report mode (feature J8) (04b2d25b)
- feat(app): authoring-time task size warning on task update --section (0575) (e4dc09eb)
- feat(sp): tolerate degraded history sources in bare runs (task 0569) (21e61c3a)
- feat(config): move role-tier SSOT into packages/config (task 0572) (c14dc3be)
- feat(sp): make dev-gtd act CI simulation opt-in via --act (2be1e6d2)
- feat(sp): add pr-review skill, dev-pr-review command, and workflow spine (60205044)
- feat(history): feature I5 dev-history-load corpus — feature file, plan, task 0567 (bd21b2a3)
- feat(plugin): add /sp:dev-history-load cumulative import+analyze command (3342a1a6)

### Fixed

- fix(app): parse compound evidence types + monorepo-safe spur resolver (7c8b9863)
- fix(workflow): consume dual-workflow-engine 0.4.35 setVars fix (task 0571) (bbbd66b0)

### Changed

- docs(history): close out feature J8 — mark 0573/0574 requirements done, amend R5 AC (d37e1f6c)
- docs(tasks): record 0575 evidence and wrap artifacts (9d97b58b)
- docs(doc-evolve): wrapup doc sync for 0575 — ADR-051 amendment, 04 frontmatter bump (cf664a30)
- docs(sp): align dev-find-issue docs with CLI and skill SSOT (task 0570) (a34c2acd)
- docs(tasks): update task status after refinment (838a53b1)
- docs(tasks): split 0568 R1 into 0575, drop duplicate J8 R4 scenario (de3c1a6e)
- docs(tasks): record 0572 evidence and wrap doc-sync (812887e1)
- docs(tasks): record 0571 verify re-audit evidence (37e8081e)
- chore(config): update .spur/config.yaml (16422d6d)
- docs(tasks4): ready-refine tasks 0568-0571 (c24e8c9c)
- docs(features): register B3 and J8 in the feature index (5222c39b)
- docs(config): annotate pairing philosophy in agent config comments (ffaef827)
- docs: add J8 pairing-evidence feature spec and tasks 0573-0574 (adf945a2)
- docs: add B3 feature spec and task 0572 for role-routing SSOT move (7ca24a9e)
- docs(tasks): file 0569 degraded-source tolerance and 0571 workflow setVars tasks; sync feature INDEX (076983b6)
- chore(config): role-based executor default with role->tier resolution docs (6caa9703)
- refactor(plugin): rename dev-featurechange command to dev-feature-change (72e7bc2d)
- docs(tasks): file 0568 process-bottleneck fixes and 0570 dev-find-issue doc conformance (2112af1b)
- test(sp): assert pr-review.yaml ships in the scaffold manifest (88dad407)

## [0.3.48] — 2026-08-15

### Added

- feat(cli): narrow history report by task and top at render time (0564 R3) (7f4e4d44)
- feat(domain): fold tool-call durations into cost attribution (0564 R2) (bf2d729a)
- feat(domain): add call_id column to history_tool_call (0564 R1) (efcdc349)
- feat(app): restore inline --agent with host-session-only semantics (G5 0565/0566) (a30e622b)
- feat(server,web): render role routing and token consumption on the Board (0552) (9d770a0f)
- feat(app): exercise tier fallback and executor exhaustion under real failure (0540) (05cdcab5)
- feat(sp): inventory and repair plugins/sp drift against live CLI (0539) (4dd0cc54)
- feat(analytics): attribute token totals to roles via run-to-session mapping (0547) (33a1f2d1)
- feat(teams): role is the primary axis of a team member (0543, 0544) (62283aa8)
- feat(history): merge E3 history refresh worktree (0548-0550) (088b85cc)
- feat(app): operation-triggered history refresh across config, CLI, server (0549/0550, E3) (9b792f37)
- feat(domain): routingSummary one indexed round trip + composite index (0546, J6) (b63b1ad5)
- feat(app): add coalesced opt-in history refresh off the completion path (0549/0550) (0182337d)
- feat(history): watermark live sessions and report refresh coverage honestly (0550) (9e6b858e)
- feat(observability): emit routing decision on agent run events via J5 envelope (task 0545) (01efaa3e)
- feat(history): enqueue coalesced history refresh on work completion (0549) (acc1f6f6)
- feat(agent): propagate declared subagent role across fan-out, inheriting when absent (task 0551) (8d2d0336)
- feat(history): measure incremental import and analyze cost on real data (0548) (3d285c35)
- feat(issue-finding): rewrite dev-find-issue as report-first over the data plane (task 0556, E5) (99fc4072)
- feat(history): report mode registry + forensics renderer (task 0555, E5) (19a5d8e8)
- feat(e6): run-to-session correlation and cost-path repair (0557/0558/0559) (4a10fa12)
- feat(domain): compute derived variables in analyze via MetricRegistry (0554) (492983d3)
- feat(domain): migration 0012 args_raw + reduce session-formats.md (task 0553) (6df7c1a4)
- feat(agent): role-based executor selection (feature B2: 0535-0542) (13d01195)
- feat(cli): gate transition shims behind a two-sided manifest (0541) (65465826)

### Fixed

- fix(workflows,sp): announce empty wrap-up captures, pin capture paths (0563) (c90bf074)
- fix(app): harden verdict AC-row id matching against embedded Gherkin bodies (0561) (33be5021)
- fix(app,cli,sp): harness surface reconciliation and agent exhaustion eventing (0539/0540) (94619e12)

### Changed

- docs(cli): sync help and design docs to live agent/task/feature/workflow surface (0159a559)
- docs(cli): sync projections to live agent/team/history surface (find-conflict) (0a28cd8f)
- docs(tasks): record 0564 done — E5 forensic-report fixes landed (5d9c8a08)
- docs(plugins): record omp tool-call block shapes in session-format reference (0564 R5) (36eaf07a)
- test(plugins): parse live omp arguments shape in fallback fixture (0564 R4) (2ebc40b9)
- docs(tasks): update task status after implementation (4c8b917c)
- docs(tasks): finalize 0547 review record with P3 fixes disposition (d3d52dbb)
- docs(tasks): tick G5 0565/0566 requirement boxes and backfill change-maps (post-verify record) (56bff0f5)
- docs(tasks): record 0562 done — migration-collision prevention verified (2071adda)
- docs: state migration max(prefix)+1 allocation and merge-renumber rule (0562 R4) (c03119a9)
- test(domain): enforce unique, strictly ascending migration prefixes (0562) (57592904)
- docs(dogfood): add G5 inline --agent host-session dogfood report (203572ca)
- docs(tasks): link G5 R5 AC scenario to task 0565 (traceability gate) (d74b8dd8)
- docs(tasks): update task status after implementation (d2035b18)
- test(app): pin alias row id with trailing Gherkin body (0561 R1) (86442e8e)
- docs(tasks): refine 0565/0566 to implement-ready (G5 inline host-session) (27fc4998)
- chore: 0561 wrap learnings, metrics, and doc-sync (9956ead4)
- chore: 0552 wrap learnings and metrics (c306df13)
- docs: G5 inline host-session design, tasks 0565/0566 (backlog) (40f5c496)
- chore(feature): close I3 — verifying→done, dogfood artifact, wrap memory (d1aa1fed)
- chore(memory): record 0547 wrap learnings and metrics (8881a1b5)
- docs(corpus): roll up M5 status and record verification evidence (3751c069)
- chore(history): finalize E3 merge reconciliation (0548-0550) (90bae29b)
- chore(memory): note 0559 ts-libs lockstep release delivery (a9ac1d37)
- chore(drizzle): index (event_name, occurred_at) for the routing aggregate (0546) (b5c59419)
- docs(design): record incremental import/analyze cost measurements (0548) (70eaf3f7)
- docs(history): sync E3 wrap-up docs (0548-0550 batch) (daa55348)
- docs(features): mark J6 routing attribution active (task 0545) (eaf523b5)
- docs(tasks): deepen findings tasks 0561-0564 with verified anchors and R-numbered ACs (ba5355f2)
- docs(report): add E5/E6 batch forensic reports and follow-up findings tasks (9d472393)
- chore(e6): merge main into runall-e6 and renumber history_run_session to 0013 (fa41669c)
- docs(e6): record verifyall write-back and ship E6 status (14bbd8ae)
- chore(task): 0554 verify PASS, transition done (32da928b)
- chore(task): 0554 verify PASS, transition done (8b42f2a2)
- docs(tasks): mark B2 completion bookkeeping (checkboxes, task table, feature done) (e91f59c0)
- chore(sp): record B2 wrap artifacts, dogfood report, and feature completion (99a9925e)
- docs(tasks): append 0535 superseding note to 0344 role vocabulary (99b46497)
- docs(tasks): record B2 batch execution (0535-0538, 0541-0542 done) (1df121aa)
- chore(sp): record wrapup artifacts for 0541 (841a53a4)
- docs(tasks): plan feature B2 wayfind batch (0535-0552) (ba0a6a9a)

## [0.3.47] — 2026-08-13

### Added

- feat(0534): fix harness discoverability defects (c77755ce)

### Changed

- docs(proect): enhance docs/99_PROJECT_CONSTITUTION.md (e7e10b53)

## [0.3.46] — 2026-08-13

### Added

- feat(agent): add occupant identity, caller env, and coordination runs (G4/ADR-057 wave 1) (c6eb4e10)
- feat(agent): identity-pinned wait and atomic send-wait (G4/ADR-057 wave 2) (f9af0dc5)
- feat(app): snapshot-then-follow wait over the system_events ledger (daeb5ba8)
- feat(workflow): load YAML extensions on validate and run (D4, task 0533) (2bf0fdb5)

### Fixed

- fix(agent): add WaitError tsdoc per every-export-has-tsdoc (5e77f492)

### Changed

- chore(0532): record G2 supervision verdict artifacts, close feature G2 (3b64da1e)
- chore(0532): refresh verdict evidence from re-verify pass (81c1a7da)
- chore(deps): bump @gobing-ai/ts-* catalog 0.4.30 → 0.4.31 (85e8be34)
- docs: plan inter-agent control plane and G2 supervision tasks (bbe47ece)
- docs(d4): sync derived docs for workflow YAML extension loading (0533) (1230754e)
- docs(d4): dogfood report + feature D4 done (0533) (b47e6eeb)
- docs(g4): sync derived docs for wave-1 control-plane landing (0529) (2f901ceb)
- docs(g4): sync derived docs for wave-2 control-plane landing (0530) (7ba0f424)
- docs(spur): sync help + derived docs for wave-2 wait and D4 extensions (1304caa9)
- docs(workflow): add feature D4 + task 0533 (workflow YAML rule-style extensions) (3bf2178d)

## [0.3.45] — 2026-08-12

### Added

- feat(app): enrich rule/workflow trace outputs with execution context (7a1b9353)
- feat(web): make system events actionable (fe794b50)
- feat(observability): add actionable system event envelopes (5230c7a7)
- feat(web): list child features in feature detail panel (918155d7)

### Fixed

- fix(app): prefer producer-stamped severity over catalog heuristic (67b015a5)
- fix(app): adapt workflow events to ts-infra 0.4.30 contracts (bb9d62e8)
- fix(app): refine system event severity inference (d0faeaf5)
- fix(web): render unusable board fields as dash, producer-only column (40a5303c)

### Changed

- chore(deps): bump gobing-ai ts workspace catalog to 0.4.30 (ccbbb000)
- chore(deps): bump gobing-ai ts workspace catalog to 0.4.28 (b88954d9)
- docs: add superskill install examples to README (c3541587)
- docs(features): refresh generated task tables (5300ffb3)
- docs(observability): plan actionable event context (532bc7da)
- docs(tasks): update task status after implementation (5875506d)
- docs(features): mark K as verifying in feature index (46068d45)
- docs(rules): align catalog docs with shipped preset composition (eacd6e02)
- docs(K): link child features in board detail panel; dev-find-next --auto (9942357c)
- docs(rules): align catalog docs with shipped composition (C1/0524) (3489ae7e)
- docs(next-feature): full B3 roster before terminal; freeze inputs (0523) (d7f98aa8)
- docs(tasks): remove task 0523 (6f9dde02)

## [0.3.44] — 2026-08-12

### Added

- feat(I2): implement I2 batch — parity harness, content pass, idea-pipeline handoff hardening (19b5a049)
- feat(spur-dev): relink global spur shim to the dev binary on build-cli (49d3618b)
- feat(workspace): add workspace board composing scoped teams, inbox, tasks (7e039c18)
- feat(domain): fence Gherkin AC at the write boundary (96009792)

### Fixed

- fix(cli): resolve WBS-targeted task check across configured folders (5158b562)
- fix(db): provision history schema before index migration (2ae93dea)
- fix(sp): scope dev-runall strict preflight abort to structural findings (c763588c)
- fix(app): rewrite moved feature heading on cascade move (f9e9ba14)

### Changed

- docs(I2): record re-audit evidence; cancel 0523 as implemented (30fbb71f)
- chore(I2): merge sp/runall-i2-c763 into main (2d66f9ec)
- docs(0197): refresh testing evidence and mark done (a4e2ff5f)
- test(workspace): add WORKSPACE_TABS module shape test (7c010067)
- docs(0520): freeze re-verified PASS verdict with live legacy-db repro evidence (cdcb3325)
- docs(tasks): add 0521 mid-pipeline loop-guard and 0522 WBS-scoped check tasks (38d85ce3)
- docs(0519): freeze idea regression verification (99414498)
- docs(0518): freeze idea finalization contract (9fcdf49a)
- docs(0515): freeze idea guidance handoff contract (e532cb11)
- docs(0514): freeze bounded content audit (b79d03cd)
- docs(0513): bound drift fixes to live findings (f66547ec)
- docs(0517): freeze live parity assertion design (9916724e)
- docs(0512): support verb-level help capture (3b73ba52)
- docs(0516): freeze parity scope parser contract (2bf92d01)
- docs(0512): freeze CLI capture helper contract (3d5328e8)
- chore(db): merge history-message index migration fix (5a554b8f)
- docs(I2): decompose 0512/0515 below the 5-R-item pipeline cap (6d236978)
- docs: record completed planning/history task updates (d3232209)
- chore(workflow): run verify with --focus all (6d8be6a9)
- docs: add WBS lookup fast path (1e093efe)
- docs: restructure feature tree to B/I/H ownership (17b7ebbb)
- docs(I2): define plugin-surface parity contract (ADR-053/054/055) (2134bac3)
- docs(G3): approve team-scoped workspace boundary (ADR-052) (efb5f00c)

## [0.3.43] — 2026-08-11

### Added

- Native-subagent-first inline pipeline stages with host fallback (ADR-047 amendment) (0508) (d738c2e7)
- Normalize OMP message envelope via importer 0.4.26, assistant-duration analytics, selected-file history bridge (0507) (d1f591e5)
- Surface importer full-mode reconciliation in fan-out entries (7c61f2bb)
- Authoritative full-mode reconciliation signals + degraded fan-out (0504) (6f32cf0e)

### Fixed

- Precheck notes uncommitted task-corpus dirt (0511) (2bf47397)
- Harden five feature-E batch-run seams (0510) (95b45abe)
- Dedup guard covers unscoped creates; create --json gains wbs/filePath mirrors (0510) (2199a29f)
- Explicit selector-preserving wrap surface, pre-DB single-file full-import guard, schema-first history bridge (0506) (d3885624)

### Other

- Log H reopen and re-verify cycle from 0511 run (384020e9)
- Record feature E verifyall re-audit PASS evidence (2b2dac31)
- Bump `@gobing-ai/ts-*` catalog to 0.4.27 (1d8a8be1)
- Advance H to done after 0510; append 0510 wrap learnings (0ec510c1)
- Update task status after refinement (99aa4c46)
- Record 0505 wrapup learnings and metrics (7e9c3d81)
- Ignore `.spur/backups/` (large SQLite DB backups) (cdd8a294)
- Record 0505 verify PASS and real-data reconciliation evidence (7326e299)
- Record full-mode reconciliation surface and 0505 probe lesson (671dcc90)
- Cover `entries[].reconciliation` in full-mode import JSON (0505 R1) (7b2e954f)
- Add 0505 post-mortem follow-up tasks 0506–0508 (b6064820)
- Reconciliation surface docs, 0504 re-audit evidence, 0505 R1–R5 contract (399d2bfb)
- Bump `@gobing-ai/ts-*` catalog to 0.4.25 (631ceaea)
- 0504 done evidence + 0505 real-data verification follow-up (97da8de0)

## [0.3.42] — 2026-08-10

### Added

- Add typed provider failure-classification registry + pure `classifyDispatch` (0503) (9e3985b5)
- Wire `classifyDispatch` into dispatch escalation with `auth` fallback (0503) (07d1817f)
- Document the interactive inline pipeline driver for full mode (0503) (8d845e74)
- Route opencode history imports through the dedicated importer (a9dfb2df)
- Promote corpus-check to `spur task check --corpus` (0502) (7ee8187b)
- Ship the `sp` plugin + marketplace in the `@gobing-ai/spur` tarball (0dc2edd5)

### Fixed

- Soft precheck doctor gate, transition retry, and gate backoff in task-pipeline (0503) (9435be45)
- Split multi-token `spurBin` before `execFileSync` in task-size-precheck (719c0761)

### Changed

- Switch agent default to `omp-dsv4-flash-opencode` (a0ec5626)
- Record 0503 verify PASS and sync agent entry docs (0c6a3b5c)
- Amend ADR-047 for interactive inline full-mode stages (0503) (72f0cde1)
- Cover inline execution contract for the host driver (0503) (486bea93)
- Switch agent default to `omp-dsv4-flash-volc` and retire ollama executor (0bfa84f3)
- Rename stage-plugins to bundle-plugins for verb convention (86975fe7)
- Bump `@gobing-ai/ts-*` catalog to 0.4.24 (45273b3e)
- Disable unauthenticated omp-zai executor (a3a93661)
- Add projects noun to the CLI surface table (8355311a)
- Add 0503 executor-routing and 0504 history-backfill tasks; re-audit 0502 evidence (6a7cc97f)
- Sync README — pi platforms, super-coder agent, hook events, scripts table (11e8480b)
- Enhance ADR-051 noun discipline; file task 0502 for corpus-check promotion (6a511c02)
- ADR-051 public CLI surface vs internal spur-dev — ownership + consent gate (c3c99c03)
- Re-audit 0500 — PASS verdict with fresh evidence (31ac382f)
- Session memory log — task 0500 entry (b9e4b730)
- Refine 0502 to implement-ready depth (4e2b4c23)
- Refresh 0501 Testing with `--force` re-audit evidence (044c2756)
- Sync stale version/counts/workflow table to 0.3.41 (667c997f)

## [0.3.40] — 2026-08-09

### Added

- Ship `/sp:dev-find-next` + `sp:next-feature` prompt-first feature frontier prioritizer with ranking rubric, signal derivation, handoff routing, and proposal contract references (4669a905)
- Create task 0498 — `--task` flag on `/sp:dev-find-next` to confirm ranked winner and dispatch to planning half (39383129, ce2a11f0)
- Create task 0496 — extend `--worktree` to accept an existing worktree name for batch isolation (0d75afde)

### Changed

- Switch agent default to `omp-zai` and activate `tasks4` folder (563be28d)
- Drop stale corpus-baseline entries for tasks 0368 and 0454 (86e42982)
- Fix 4 stale ADR projections in `docs/03_ARCHITECTURE.md` from dogfood run 0488 (4aa0997b)

### Other

- Resolve task 0493 — ranking-model spike: falsifies frontier premise; surviving signals are AC coverage, churn exposure, dogfood proximity, authority pull (a879dc8d, 629fd930)
- Resolve task 0494 — reuse inventory: bounds next-router, `spur` CLI `--json`, and conflict-finding surfaces that `dev-find-next` must compose (8a0aa017)
- Resolve task 0495 — structure-defect contract: narrows to detector rules; only near-duplicate defects produce `/sp:dev-featurechange` mapping rows (ba7cc911, 1b58e2af)
- Re-verify H12 batch and repair evidence anchors across tasks 0493–0497 (6545abff)
- Chart E2 session-forensics history-plane extension (558d681f)
- Chart H12 feature frontier prioritizer (4a9082dd)
- Close E2 session-forensics wayfinder tickets 0489–0492 (63f62212)
- Refresh feature tree status — 0485/0486 done, E2/H12 indexed, N complete (2b30f8eb)
- Refresh H12 tasks table and feature index — all four tasks done, feature closed (91c0d06b)
- Dogfood `/sp:dev-find-next` live run — H1 frontier, G3/K gated, D1–D4 defect pass (31acd749)

## [0.3.39] — 2026-08-09

### Fixed

- fix(pipeline): harden task-pipeline per 0487 post-mortem (R1-R7) (f26ccdae)

### Changed

- docs(features): N → done (0487 post-mortem hardening complete) (a77f0951)
- docs(00_ADR.md): fine tune on docs/00_ADR.md (d91af80f)

## [0.3.36] — 2026-08-08

### Added

- feat(dev-pipeline): batch worktree lifecycle (task 0477) + dev-ops flag glossary (7e444f1c)
- feat(history): E1 history data plane — forensic ETL, import-all fan-out, analyze/report, daily pipeline (b9963557)
- feat(0477): `--worktree` flag for dev-runall/refineall/verifyall (27ec074c)

### Fixed

- fix(0479): reject empty verdict artifacts, fix cwd-dependent gate, anchor rules (2359b2a1)
- fix(0478): pipeline size-gate pre-check, answer-file contract, single typecheck (3da71595)
- fix(0475): narrow prose-prerequisite heuristic, fix prose-seeded cycles, add premise-verification (92df9764)

### Changed

- docs(0481): 0475-verify retrospective — worktree deps install, worktree-local spur CLI (e3e124fc)
- docs(tasks): land E1/N task corpus for refine-loop friction analysis (ab9a23f2)
- chore(config): update executor roster and local IDE permissions (0504154e)
- chore(pipeline-meta): post-mortem children 0475/0476, batch hardening tasks 0480/0482 (7d8cdfcb)
- chore(deps): bump @gobing-ai/ts-\* to 0.4.23 (02851926)
- chore(tools): bump lefthook to 2.1.10, drop LEFTHOOK_SANDBOX skip guard (5ab3558b)
- chore(hooks): skip pre-commit format in spawn-restricted sandboxes via LEFTHOOK_SANDBOX=1 (a67d09a0)
- chore(0475): merge prose-prerequisite heuristic fix into main (14cc3afe)
- chore(0475): record done — status, solution/testing/review sections (310c4d81)
- style(plugin): format pi extensions array on single line (biome) (c9cf6ded)

## [0.3.34] — 2026-08-06

### Added

- feat(core): done→active lifecycle edge, precheck reopen, sh -n validate, actionable L4 messages (b9191d45)

### Fixed

- fix(core): verdict parser maps Status by header name instead of hardcoded column (230e8509)
- fix(app): agent.run config injection, affinity keying, latch collapse, and pipeline hardening (087ead56)
- fix(feature-check): scan all phase folders for feature_id edges (tasks2 + tasks3) (bd553e39)

### Changed

- docs(core): 0451 companion — H83 follow-up AC, feature N active, task statuses (4330efe3)
- docs(corpus): add task 0453 and feature N for 0451 post-mortem findings (b6526465)
- docs(corpus): update task 0451 status, feature H83 reopen, pipeline YAML fix (3e850c39)
- docs: update AGENTS.md best practices, index, and residual corpus changes (3e29be67)
- docs: verify/implement skill contract hardening — canonical Req table and backtick citations (c542c5fc)
- docs: 0453 pipeline post-mortem — Solution, Testing, Review sections (2af9d56c)

## [0.3.33] — 2026-08-05

### Added

- Run-scoped session affinity (default-on): `agent.run` pins sessions per `runId` across hops under `.spur/run/<runId>/agent-sessions/<agent>`; `discoverSessionId` helper; post-run sidecar JSON; disable knob (`sessionAffinity: false` in config or vars) (H83 / 45f5748c)
- Live pipe streaming for pipeline `agent.run`: non-interactive output policy switched from `buffered` to `pipe` (live `onOutput` callbacks, no child TTY) preserving mid-run log relay (H83 R5 / 45f5748c)
- Unified `--agent inline` on all mode-aware commands: `inline` accepted everywhere as synonym for omit/`agent.default`; ADR-046-era sentinel reject withdrawn (ADR-047 / 45f5748c)
- `sessionAffinity: z.boolean().optional()` added to `AgentConfigSchema` and `AgentConfig` interface (45f5748c)

### Fixed

- Pipeline latch no longer bare-global-resumes the host coding-agent session when affinity is off; `continueFlag` guarded by `affinityOn` check (45f5748c)
- `--agent inline` on headless dispatch surfaces (`spur agent run` / workflow `agent.run`) now resolves to `agent.default` executor rather than exiting with code 2 (45f5748c)

### Changed

- ADR-047 contract: all mode-aware commands (`dev-plan`, `dev-runall`, `dev-run`, `dev-gtd`) updated to `<inline|auto|name>` selector; plugin contract tests and flag-validation script aligned (45f5748c)
- `cross-cutting.md`, `flag-glossary.md`, `workflows.md`, `dev-operations.md`, and `execution-workflow.md` updated to reflect unified ADR-047 surface (no Workflow-driven exception caveat) (45f5748c)

## [0.3.32] — 2026-08-05

### Added

- Run-scoped agent session affinity (default-on): a single workflow `runId` pins a durable coding-agent session across `agent.run` hops for omp, claude, codex, agy, grok, and pi; config knob to disable after dogfood (H83)
- Live agent streaming: `AgentService.runTraced` pipes agent stdout/stderr live into the workflow run log (`trace --follow --output`, no child TTY) (H83)
- Unified `--agent inline` semantics: `inline` resolves to `agent.default` on `spur agent run` / workflow vars, superseding ADR-046's "inline unrepresentable" reject (ADR-047)
- `spur task record` owns the `done` lifecycle walk: a PASS verdict auto-walks `wip → testing → done` and auto-creates the pipeline provenance run-link (ADR-048)

### Fixed

- Pipeline latch no longer bare-global-resumes / hijacks the host coding-agent session; run-scoped `--session-dir` + resume-by-id when supported (H83)
- Multi-command quality gates re-parsed via `sh -c` so `&&` / `;` gate strings execute correctly; `qualityGateCmd` locked to trusted config only (SECUA residual, no untrusted interpolation)
- Dev-pipeline compaction churn / repeated resume-guard churn from unowned run-link writes (single `ensurePipelineRunLink` owner)

### Changed

- ADR-047 supersedes ADR-046: unified `--agent` semantics, run-scoped session affinity, live non-interactive pipe output; Phase D (true host-stage control inversion) explicitly deferred
- ADR-048: `spur task record` owns the `done` walk and pipeline run-link; `ensurePipelineRunLink` shared helper between CLI and service (task 0436 residual — single owner)

### Other

- Update cross-cutting, flag-glossary, dev-run/plan/runall docs and observation runbook (`trace --follow --output`, never `| tail`) for the unified surface (H83)
- Add H52 / H83 feature files and multi-agent affinity/stream dogfood smoke tasks (0445, 0450)

## [0.3.31] — 2026-08-05

### Added

- Add all-in-one per-run workflow run log with `trace --follow` (96312b01)
- Resolve agent run var from `agent.default` config (26a973c1)
- Add `failureStates` schema and cover terminal-failure in tests (f1644ce2)
- Add soft-probe quality gates and pure-slash pipeline inputs (1a4b7659)
- Guard empty implements and resume timed-out steps (c8d60be6)
- Consolidate message surfaces into unified Inbox board module (c6f74312)
- Refine progress logging UX and stream shell output (da46e301)
- Retoken task-kanban onto DESIGN.md surface ladder (8cf97ddf)

### Fixed

- Name `agent.default` in inline reject diagnostic (0434) (e065672a)
- Resolve run schemas via embedded map and inject HITL answer on resume (3173cb1a)
- Evaluate shell-guard vars as data, not code (88a32a63)
- Declare failure terminals and run-scope shared artifacts (ceac9a4a)

### Changed

- Make `inline` unrepresentable on workflow-driven commands (d785668f)

### Other

- Document new agent loop, feature sync, and workflow run/continue verbs (32b6f7c3)
- Add issue-finding task for spur dev-pipeline performance (3ca12d29)
- Record H82 decision on inline inapplicability for workflow-driven commands (ab86e9b0)
- Refine D3 task specs for schema-resolution and headless-HITL defects (4e18683b)
- Add system design best practices to AGENTS.md (34d56c19)
- Add allowWrite path to config (308bc6fe)
- Extend sandbox allowWrite and record 0425 wrapup metrics (cf79daaf)
- Record ADR-044/045 and sync workflow and feature surface docs (b36fff40)
- Distinguish feature refresh from sync (ed724d54)
- Make workflow status authoritative and document agent.default (37485ad5)
- Bump ts-libs to 0.4.18 for engine failureStates (f83275b7)
- Record wrapup learnings for task 0425 / ADR-044 (ff9dfb44)
- Add feature D3 workflow reliability-defect issues (ecf385aa)
- Add feature D2 all-in-one workflow run-log planning artifacts (e92dc811)
- Allow .git/hooks writes in sandbox (b149224c)
- Cover cancel edge on HITL continue resume / 0433 (e175301c)
- Prune agent models and drop `--strict` feature gate (6c900249)
- Bump @gobing-ai/ts-\* packages to 0.4.17 (e3756ccb)
- Refresh feature and task docs for kanban, workflow UX, inbox (36b0e1bf)
- Add task kanban, workflow logging, and inbox board planning docs (3d929370)

## [0.3.29] — 2026-08-02

### Added

- Add cross-surface flag-contract parity gate (5261c555)
- Add no-syscall-emulation-in-boundary-mock lint rule (9df6026c)
- Add per-run agent output capture to workflow runs (fc04326d)
- Add bounded per-run agent output sink (09ffe412)
- Add group-feature matrix variant exempt from AC requirement (1e1b59be)
- Add feature-sync-bounded retry-suppression script and tests (cf9aaf86)
- Accept scenario alias and warn on malformed verdict artifacts (f3e31f04)
- Coherent `--next` flag semantics + canonical glossary (H8) (59f667c3)

### Fixed

- Resolve feature lifecycle deadlock for P0 features in active state (d3aaf3a6)
- Map WBS collision to 409 WBS_COLLISION in server (77809468)
- Surface WBS collisions with exit 3 and duplicate detection in CLI (77809468)
- Guard WBS allocation against collisions and honor baseCounter in app (801b2cf6)
- Rename base_counter to baseCounter in folder schema (1169347e)
- Make feature-sync-bounded spawnSync Bun-API compatible (e1786061)
- Correct flag descriptions and glossary entries after 0412 audit (aab4c30c)
- Correct flag-default descriptions on dev command surfaces (b471fe1b)

### Changed

- Point workflow trace at the live agent-output artifact (8faac124)
- Add agent.output capture-bound schema (bce56d8f)
- Normalize dev-command argument contracts (0412) (70df78de)
- Unify `--agent`/`--inline`/`--subprocess` into one selector (07814d6e)
- Make inline the default execution surface with automatic tier escalation (04cab820)
- Block done transition on placeholder required sections (f373e90b)

### Refactored

- Replace prose-literal test pins with structured markers (d6849636)
- Extract flag glossary out of dev-operations.md into own reference (01f689e7)

### Documentation

- Update task status after implementation (de8e549f, 902fd19d)
- Backfill F4 scenario traceability in task 0419 (15698251)
- Mark 0416 done and sync F2 feature status (a42d26c5)
- Add F2 coverage and deadlock task records (22e169d9)
- Update 0413 and 0415 task records (4c71fe1b)
- Record task 0414 completion and J3 verifying status (4253e80a)
- Document H81 contract, H9 completion, and task 0411 verify record (105a1b4c)
- Document bounded feature-sync retry suppression in execution-batch (36cbfc34)
- Add H81 dev-command argument-flags brainstorm (9debdd38)

### Other

- Ignore .spur memory session checkpoints (d2c510d6)
- Allowlist run-output-sink sync FD writes (8b12bf14)
- Remove 0412 one-shot migration scripts (ee64cf89)
- Refresh 0412 task checkboxes and H81 feature status to done (b66288d6)
- Add 0412 migration tooling scripts (9851eeef)
- Create task 0416, 0415, 0414 records (b449ef66, 8b2bf1c5, dd172e3f)
- Mark task 0412 done with review and testing evidence (ff5aeea2)

## [0.3.28] — 2026-07-31

### Added

- split super-coder (BUILD) from new super-planner (ORCHESTRATION) with mutually exclusive charters; add dispatch-surface rule and promote agent/message/team/init/status/serve to documented Tier B spur-cli nouns (12d377e1)
- gate CLI<->skill parity bidirectionally; record coupling in ADR-038 (12d377e1)
- rename `spur-tdd` -> `test-driven-development` (off the spur namespace) (12d377e1)
- reconcile batch command flag surfaces (`--next` on dev-verifyall, `--mode`/`--continue` on dev-runall) and add `command-flag-parity.test.ts` (12d377e1)
- extract shared `done-housekeeping` reference; four sp agents cite it (12d377e1)
- stage H7 dogfood remediation feature and task 0398 (12d377e1)
- AC-linkage contract and agent.run timeout-recovery runbook in sp docs (21f4aed7)

### Fixed

- strip bracket tags (and `Scenario:`/`R{n}` prefix) in scenario title normalization, so documentation scenarios with `[doc-only]` AC ids are verifiable (a6e792c4)
- accept `doc`/`docs`/`documentation` evidence aliases and report dropped AC rows via diagnostics instead of vanishing silently (33d65803)
- make SessionStart idempotent per in-flight session: reuse `SPUR_RUN_ID`-correlated sessions over nested `agent.run` subprocesses (was minting a fresh session per firing — 332 starts vs 157 ends over 18 days) (a467dd62)
- raise `agent.run` step timeout 600 s -> 1800 s (30 min headroom) for test/review/verify steps (261541ea)

### Other

- bump `@gobing-ai/ts-*` catalog pins `^0.4.14` -> `^0.4.15` — required by the SessionStart fix via `SPUR_RUN_ID` propagation (dc343b69)
- allow WebFetch for `github.com` in local plugin settings (fae89ec4)
- record H6/H7 task and feature completion (0c1ec657, 0fa9b454, 039de5fd)

## [0.3.27] — 2026-07-30

### Added

- feature action job stream, progress tracking UI, and project start service (F83) (40ece606)
- add multi-project registry, spur projects CLI, server endpoints, and UI switcher (aa6498c9)
- add issue-finding skill and dev-find-issue command (37d0a12c, 36e858ab)
- redesign JobsTab as purpose-built queue/scheduler view (c45e5ef6)
- add Tasks tabview backed by run store (53f36a02)
- add Supervisor tab as Teams default (ba3ea3c5)
- rebuild system events tabview on server-side queries (9ff3b4c5)
- add explicit module ordering to board registry (dbf2fa2f)
- redact configured secrets across observability surfaces (ed75fa9e)
- workflow run store read API (55b18904)
- event history filtering + pagination read API (464b1123)
- author and emit team.\* event family for team/member lifecycle (91e60536)
- bridge CLI process/workflow/agent events into the ledger (c3775124)
- add correlation columns to system_events + migration (9503a238)
- demote heartbeat to diagnostic tier + per-prefix retention quotas (1809a48e)
- catalog 0365 observability envelope contract + preservation tests (76278d6c)

### Fixed

- resolve CI test race conditions, mock Bun.spawn, and stabilize token ledger watcher test (79aafc4e)
- pass parseChecklist to checkAcCoverage for checklist-form task AC coverage (bb18b834)
- repair J4 board tab surfaces (01cb442d)
- fix no-daisyui-class-leak false positive on Tailwind select-none (b6c00208)
- resolve every-export-has-tsdoc post-check violations (6ad8e8a0)

### Changed

- split Worker-safe HTTP root and portable server config (93085672)
- update command map 31→34; add dev-refineall, dev-featurechange, dev-find-issue rows (1628af87)
- add H51 batch execution reliability guardrails feature (e117b1e6)
- add J4 batch-execution guardrails (ed1a146f)
- allow Root Cause section on meta tasks; bump design v1.8.0 (6d492046)

### Other

- update skill-structure and command-contract test suite for 34 commands (382f6ebb)
- update spur-dev and code-testing guardrail references (9b823c02)
- add unit test for token ledger watcher schedulePoll timer callback (8ec5e376)
- sync ADR-036 and J4 board surface docs (f3cadc09)

## [0.3.25] — 2026-07-28

### Added

- ship rich workflow progress, `trace --follow`, and `--steer` (4dc1f4ec)
- wire observability and steering through the dispatch path (bd0bf6c8)
- add WorkflowSteeringController for bounded synchronous steering (bda3103c)
- add workflow observability core (versioned envelopes, agent execution lifecycle, pure renderers, JSONL trace) (60e16f19)
- add RunDao.stampFailureReason merge primitive (1564cb85)
- drop `--design` force path and wire idea-eval taste gate (af7b77f8)
- add shippable readiness gate to dev-verify/dev-verifyall (787a4a05)
- feature-service scans all phase folders for cascade rewrites (70ff9925)
- add /sp:dev-featurechange command + hierarchy-mece skill reference (28112478)
- fix sidebar fold/unfold and add FeatureDetail action feedback (56a6e14c)
- require verify verdict artifact for done transition (af2c949e)
- validate task Solution/Testing file:line anchors (8c26bea0)
- add dev-refineall + widen refine target to Design/AC (d61b5a8e)
- author Design/Plan/AC at batch-create by default (6cd1730f)
- cost-aware stage floors — plan capable-2, refine standard fallback (b00e6e2c)
- add dev-refineall command for batch task refinement (62555b82)
- split capable tier into capable-1/2/3 sub-tiers (a780ab42)

### Fixed

- persist vars across pause/resume, surface failure reasons, inject runId provenance (00238972)
- resolve feature verdict runDir to repo root, match AC rows (41aac652)
- split `config/workflows` literal to satisfy sp-runtime-path rule (47caf265)

### Other

- record ADR-035, observability design, and steering control-channel design (220006cc)
- unify design package and taste pre-clear across dev-idea/dev-plan (cfbff893)
- apply feature-tree restructure (9 reparents, ~70 task feature_id rewrites) (4d8ed8d2)
- plan I1 dev-idea redesign and idea-evaluation taste gate (ba9da606)
- harden dev-featurechange protocol with free-digit preflight and sequential prediction (5d06d2a6)
- feature-tree restructure kit — audit, hierarchy guide, restructure map, featurechange command PR (a0cfac95)
- record verify PASS for 0349–0355 and link decision gists on map (9eb3b9e3)
- cache-discipline lessons for batch and re-verify flows (ac2f0b79)
- close feature with full AC matrix; record 0349/0350 inventory (0807a401)
- wayfinder decisions for Board Features detail action group (61573b7c)
- seed F81 wayfinder map (Board detail action group) (edabae02)
- assert resume skips prior onEnter side effects (R5 of 0366) (cb238168)
- harden token-ledger-watcher contract gaps (b10abe5b)
- cover task-check line-anchor extraction and verdict dir helpers (2b614ebb)
- bump @gobing-ai/ts-\* catalog to 0.4.14 (45ac4598)
- resync bun.lock to published @gobing-ai/ts-\* 0.4.12 (48ccf276)
- advance 0365 to done (solution + testing + review + status) (4b7b8251)
- advance 0366 to done (review + status) (2217247c)
- add 0365/0366 task files and orphaned discovery artifact (66c99b22)
- add yaml catalog dep and sync lockfile (c4af81e7)
- gitignore docs/\*\*/.spur/ (8142cba9)
- update task status after implementation (c94c0a0b)

## [0.3.24] — 2026-07-27

### Added

- feature-check strict AC satisfaction (0340) (9874379d)
- batch verdict aggregation, NOT-STARTED outcome, dedup guard (0341) (4745ab0f)
- unify --agent selector with agent.executors (0346) (bf1833e1)
- converge feature-tree status affordance on icon-only glyphs with accessible names (d134b863)

### Fixed

- correct two task-check false-negatives (0339) (5a06da57)

### Changed

- declare executor tiers explicitly and retire default-by-phase (9dce28b6)
- pin dev-fixall/run/runall/changelog agents to omp (539eff4d)

### Other

- polish 0339/0340/0341/0342 records after verify re-audit (c92238c6)
- document 0341 R4 follow-up task dedup discipline in code-verification (3a650853)
- add 0340 R5 dogfood and 0339 R3 double-report guard cases (9c0a61b1)
- add 0340 feature-check strict AC satisfaction satellite (9211ff07)
- polish 0348 decision record after verify re-audit (6879d413)
- polish 0347 inventory after verify re-audit (dcaded69)
- sync design, B2 feature, and 7 task records to shipped state (abe14c4a)
- document verifyall batch verdict rollup and NOT-STARTED grammar (9f13e2fc)
- wrap SSE dispatch in act to clear React act warning (0342) (801b3b80)
- add 0347 backward-compatibility inventory artifact (08c9fd5b)
- update task status after implementation (2ab830a2)
- add 'ask now' tier to wayfinder question-sharpness test (6aca3877)
- reword dogfood ledger cardinality rule to match §2 Steps format (148e38db)
- file verifyall-dogfood follow-ups 0339-0342 (12fe4232)
- chart wayfinder map B2 for invocation-agnostic executor selection (ac3fc72b)

## [0.3.22] — 2026-07-25

### Added

- introduce TaskLocator service to centralize task file discovery (157f3454)
- mirror CORS allowlist in CSRF middleware (b84b223a)
- normalize legacy task statuses to canonical lowercase done, blocked, cancelled (708ca1c1)
- backfill drifted corpus feature status via spur feature sync (8e54f27d)
- author /sp:dev-refresh slash command wrapper (50f9a1ee)
- wire feature sync into task-pipeline record, wrapup feature-transition, and dev-verify PASS (fd602a50)
- implement feature status derivation engine and spur feature sync (1b46ebd2)
- add status filter menu to Features panel header (f5594b4c)
- add status icon to each Features tree node (43842d22)
- add stable finding codes and config-driven severity overrides (24405393)
- generate BDD test scaffolds from Acceptance Criteria (af039271)
- wire stage-registry model routing and fallback into agent resolution (38de9793)

### Fixed

- support digits in skill name resolution during command validation (ed4b0682)
- strengthen careful-guard force push detection and secret redacting (99025b36)
- support refreshKey re-fetching in FeatureDetail and abort stale SSE requests (c24571a5)
- harden http.request action URL validation and template handling (76eebddd)
- add menu dismissal on Escape and outside click (117ef824)
- use design tokens and compose colorClass in status-icons (48bc2583)
- add TSDoc comments and test coverage for TaskScaffoldService (4c15ad38)

### Changed

- wire TaskLocator into task check and done-gate commands (182682fc)
- integrate TaskLocator across services and optimize corpus migrator (2ede45d0)
- restore thin wrapper contract for dev-verify command (1b1d0a45)

### Other

- sync task 0331 verification audit (8abb3474)
- sync task 0330 verification audit (8daa2e8f)
- sync task 0329 verification audit and feature R1 tasks status (3d89e2c5)
- sync task 0328 verification audit and feature R tasks status (5a454969)
- align lifecycle drift test for task-pipeline record step changes (6eb7428b)
- add unit test coverage for feature command error paths and sync options (389ea727)
- update task status after implementation (145fe5e8)

## [0.3.21] — 2026-07-22

### Fixed

- resolve sp-spur-init knowledge-kit dogfood findings — align doc templates with canonical constitution (§4.3 frontmatter, `{{init-date}}` tokens, updated bodies), fix status health to key on `spurConfigExists` (stack-neutral projects now report `ok: true`), add `substituteDocTemplateTokens()` for `{{init-date}}` → `YYYY-MM-DD` at scaffold, update init command to use `--json` and summarize once, fix 3 existing tests that relied on `package.json` for `ok: true`, add docs-contract / stack-neutral status tests (bcf309d7)
- CI: source-vs-bundle template parity no longer reads gitignored `apps/cli/config/` (missing on clean CI). The gate materializes a temp tree via `bundleConfig()` — the same publish path — and compares `config/templates/docs/*` byte-for-byte

### New Features

- **Add `/sp:dev-debug` and `/sp:dev-daily` thin commands (task 0316).** Added `/sp:dev-debug` (backed by `sp:sys-debugging` systematic debugging protocol) and `/sp:dev-daily` (backed by `sp:daily-summary` report generator). Renamed `RD3_DAILY_SUMMARY_NO_PROMPT` → `SP_DAILY_SUMMARY_NO_PROMPT` with dual-read deprecation warning, fixed stale `SKILL.md` script reference link, bumped command count 28 → 30, and synchronized plugin version `0.3.21` across `plugin.json`, `.claude-plugin/marketplace.json`, and README.

### Changed

- **Complete R10 least-privilege `allowed-tools` sweep across all `sp` command wrappers (task 0318).** Traced write paths across all 30 command wrappers and trimmed redundant `Write`/`Edit` permissions from 9 command wrappers (`dev-idea`, `dev-wrap`, `dev-wrapall`, `dev-verify`, `dev-verifyall`, `dev-plan`, `dev-refine`, `dev-parallel`, `dev-runall`). Retained `Write`/`Edit` on code/test/doc authoring commands (`dev-run`, `dev-unit`, `dev-simplify`, `dev-reverse`, `dev-debug`, `dev-dogfood`, `dev-fixall`, `dev-handover`, `rule-add`, `rule-refine`, `spur-init`, `workflow-add`, `workflow-refine`). Added comprehensive regression tests in `command-contract.test.ts` (test block `(j)`).
- **Make `sp:spur-cli` an executable surface SSOT (task 0317).** Added missing `deps`, `sections`, and `run-link` verbs to `sp:spur-cli` task reference (`references/tasks.md` and `references/tasks/verbs.md`). Corrected section-editing matrix documentation to list the complete canonical and universal sections (`Background`, `Requirements`, `Acceptance Criteria`, `Q&A`, `Design`, `Plan`, `Solution`, `Testing`, `Review`, `References`, `History`, `Notes`). Updated `AGENTS.md` and `SKILL.md` to establish the Execute-First Contract (Tier A reference execution without calling `spur --help` every turn). Added unit test suite `plugins/sp/tests/spur-cli-parity.test.ts` to assert reference↔CLI parity across all Tier A nouns.
- **Harden `sp:dev-review` and `sp:dev-handover` command contracts (task 0315).** `dev-review` simplified into deterministic modes (WBS mode: functional traceability + SECUA framework + architectural depth with `Review` section write; Path mode: advisory SECUA + architecture with zero task mutation); deprecated `--fix` and `--next` flags with warning guidance, and trimmed `allowed-tools` to least privilege (`["Bash", "Read", "Skill"]`). `dev-handover` updated so standalone `docs/handover/<date>-<slug>.md` acts as durable SSOT and task association appends a pointer link into `References` / `Notes` without clobbering existing content.
- clarify UI/UX boundary in scaffolded 04_DESIGN.md template (6f370a70)

## [0.3.18] — 2026-07-21

### New Features

- **Workflow trace per-step cost and cache-hit (task 0311).** `spur workflow trace <run-id>` now renders token cost and cache-hit ratio per `agent.run` step, joined from imported history ETL records. Cost appears as `$X.XXX · cache Y%` for exact session-id joins (R1a), `~...` for time-window heuristic estimates (R1b fallback), and `cost n/a` when no usage data is available (never `$0.00` — 0281/0284 never-fabricate invariant). Unjoined steps append a `spur history import` hint. The `--json` output gains an additive, nullable per-action `cost` object. ETL tables are loaded once per trace and matched in memory — no re-scan per action.

- **Workflow run observability design locked (task 0310).** The design record for feature P settles six decisions: engine seam (widened `saveActionStart` with optional 4th param), verbosity model (`--detail <quiet|normal|verbose|debug>` with TTY auto-degrade), two-line step formats with terminal-width-aware truncation and `ActionRedactor` support, FSM transition rendering under verbose mode, CLI-side elapsed liveness timer (TTY) / periodic heartbeat (non-TTY), and `spur workflow trace --follow` for async runs. Token cost display slot reserved with `[cost unavailable]` rendering; acquisition deferred to task 0311.

- **Analytics cache split.** `extractClaudeTokens` now preserves `cache_read_input_tokens` and `cache_creation_input_tokens` separately instead of folding them into `inputTokens`. `CostRecord` gains `cacheReadTokens`, `cacheCreationTokens`, and `usageReported` fields. `cacheHitRatio(totals)` returns `number | null` — `null` means unavailable (never fabricated 0%). `formatSummary` shows cache hit ratio; `formatRatio` renders `n/a` for null and `42.0%` otherwise.

- **Stage-registry adapter from shared metadata (task 0308).** The stage-registry feature pipeline ships a code-generated adapter (`plugins/sp/scripts/stage-registry-adapter.ts`) that maps the stage-registry schema to CLI/Task corpus operations, with command structure validation and batch-preflight logic supporting execution-mode (`--dry-run` / `--auto`) and worktree isolation.

- **CLI `sections` verb (task 0306).** `spur task sections init/add/list` for managing canonical task sections — part of the progressive-disclosure envelope implementation.

- **Task dependency mutation (task 0303).** `spur task depend add <wbs> <dep-wbs>` and `spur task depend rm <wbs> <dep-wbs>` for safe dependency management via the CLI, with validation against circular references.

- **Context-envelope layers (task 0306).** Progressive disclosure, attribution, and invalidation for task envelope storage with canonical serialization — production-grade review findings propagation and disclosure-budget enforcement.

### Improvements

- **run-cost module optimized for single-pass ETL loading.** `matchEtlForAction` split into `loadAllEtlPayloads` (one DB scan per trace) and `matchEtlPayloads` (pure in-memory join per action). `EtlMatch` return type bundles both matched records and the estimated flag, so callers no longer need to extract session ids separately.

- **Commands as SSOT (ADR-032).** The `plugins/sp` skill structure now treats commands as the single source of truth for CLI verb definitions, replacing the prior adapter-generation approach. Adapter validation replaces generation — `validate-commands.ts` checks command structure against the intended contract instead of producing derived code.

### Bug Fixes

- **Feature check accepts scaffold forms in scope delineation.** `spur feature check` no longer rejects features whose acceptance criteria include partial or scaffold-level steps.

- **Web accessibility suppressions removed.** Replaced `biome-ignore` suppressions in `apps/web` with accessible markup patterns — no silently hidden violations in the frontend.

- **Envelope review fixes.** Disclosure budgets now cap correctly; empty-hash guard prevents zero-length content from passing verification; AC and Solution sections are properly filled during envelope serialization.

- **`UNIVERSAL_SECTIONS` included in canonical getter.** The universal section set (History, References) is now included in `canonicalSections` lookups, so they appear in task metadata without special-casing.

- **Feature O tasks wrapped in auto-generated markers.** Auto-generated tasks in feature O now carry correct `<!-- AUTO-GENERATED ... -->` markers for lifecycle tracking.

## [0.3.16] - 2026-07-19

### Fixed

- **Verify line-anchor fidelity rule (anti-stale-citation).** A `--force` re-audit of task 0282 exposed that the prior verify run certified the task `done` citing `file:line` anchors that resolved to a _different ticket's_ content (0281 telemetry text), with requirement rows marked MET on material absent from the deliverable. The `code-verification` skill now requires every `file:line` evidence citation in the Testing table (and in Acceptance Criteria evidence) to be re-read at the cited lines this run and confirmed to name the requirement's subject before a MET row is written. Stale or cross-ticket anchors fail the row to UNMET and surface as a P2+ finding. Closes task 0299 (R1).

- **`--next` no-op surfaced in the verify report line.** When `--next` is invoked on a task already at `done` or `cancelled`, the transition cannot fire - but the no-op previously lived only in the CLI print, not in the verify report. The skill's Step 13 now requires the report line itself to state `--next: no-op - task already terminal (<status>)`, so a terminal-task re-audit cannot be misread as a successful `testing -> done` transition. Closes task 0299 (R2).

- **Gitignored `.spur/run/**`fix-pass writes now disclosed in Testing.** A`--fix all`verify pass can mutate deliverables under`.spur/run/\*\*`that are invisible to`git status` and to drift guards. The skill's Step 12 now requires the Testing write-back to name the exact artifact path and line range the fix pass touched, so the mutation is discoverable from the tracked task file alone without diffing untracked directories. Closes task 0299 (R3).

### Documentation

- **Verify-fidelity lesson added to the project constitution.** `docs/99_PROJECT_CONSTITUTION.md` §8 records the 0282 stale-anchor incident and the line-anchor verification rule it produced, so the gap is not re-closed as a new finding in a future audit.

## [0.3.15] — 2026-07-19

### Added

- **Dogfood workspace-drift guard.** The dogfood driver now records a workspace fingerprint
  (git HEAD + `git status --porcelain` hash) in Phase 1 and checks for external drift before
  each fix application and at finalize (Phase 4). A `drift:external` ledger row and mandatory
  P2 finding name the drifted paths and state the run's evidence is degraded, not voided.
  Mutating dogfoods are advised to run in an isolated `git worktree`. The new `workspace_fingerprint`
  frontmatter block is additive — existing reports remain valid.

- **`--chain-follow` flag for dogfood chained-leg observability.** The informal "operator may
  direct" prose override is replaced with an explicit `--chain-follow` argument (default off)
  that permits the driver to read named chained-leg artifacts and attribute normally instead
  of stopping at the testing boundary. The Platform Notes for Claude Code now document that
  `Skill()` runs inline, so `--next` chain legs are same-session-unobservable by default;
  the standalone-invocation workaround is named for completing the chain.

- **Feature O anti-inflation acceptance criteria.** The `@edge` scenario "Cache evidence cannot
  silently inflate fresh input" is added to feature O's AC gherkin block, codifying the locked
  metric rule (fresh input per verified PASS never folds in cache-read tokens).

### Fixed

- **Workflow `agent.run` hardened against non-TTY slash-command stalls.** The agent service
  now detects non-TTY environments and adapts slash-command invocation so a workflow step
  does not hang when the agent's output is piped or redirected.

- **Review L3 done-gate no longer accepts dash-filled placeholder P-tables.** A `| P1 | — | — | — |`
  row previously passed the populated-findings check because `—` was a non-empty cell.
  `isPlaceholderCell` now treats dash/em-dash runs and bare `n/a` cells as empty, closing the
  false-pass that let task 0296 reach `done` with an unauthored Review table.

## [0.3.14] — 2026-07-18

### Added

- **Verify verdict now gates every `* → done` task transition.** A two-layer done gate at the CLI layer (`apps/cli/src/commands/task.ts` `update` action) consults `.spur/run/<wbs>-verdict.json` on every done transition — including `--no-lifecycle` updates — and denies non-PASS verdicts with an actionable message naming the wbs, file path, verdict value, and remediation. Operators can still override with `--force-done --reason`, which records an audit trail via new `done_forced` and `done_reason` frontmatter fields. R10 hardening: `computeAggregate` recomputes the verdict from requirement/AC rows and takes the harsher of stored-vs-computed, so self-inconsistent artifacts are denied with the inconsistency named. Closes task 0292 (R1–R10).

- **Dogfood refuse-gate extended to mutating `--fix` modes.** `detect-pipeline-driving.ts` now refuses testees carrying `--fix all` or `--fix blockers-first` without `--max-retry`, closing a second tree-mutation source that the original pipeline-driving token matcher did not cover. The same modes are flagged as implement-heavy on verify/review legs (task 0280 P2), while `--fix none` stays observational and a boundary guard prevents `--focus all` from ever matching. `dev-dogfood.md` and the `dogfood-testing` skill document both refuse sources in the `--max-retry` row, the detection section, and a new "Mutating `--fix` mode contract" section.

### Fixed

- **Status-case canonicalization before the done gate.** `apps/cli/src/commands/task.ts` now normalizes the target and stored status via `normalizeTaskStatus` before any verdict-gate match, so `Done`, `DONE`, and legacy aliases can no longer slip past the `=== 'done'` checks (0292 fix-pass, R1/R8 closure). Backed by a CLI integration regression test and an R10 cross-check pin comparing `computeAggregate` vs `deriveVerdict` across every row-status shape in the guard vocabulary.

### Documentation

- **"A Day with the `/sp:dev-*` Slash Commands" walkthrough.** The CLI guide (`docs/help/how_to_use_spur_for_daily_software_development.md`) gains a §7 that walks a full workday driven by slash commands — morning orientation, planning (`dev-idea` / `dev-brainstorm` / `dev-plan`), execution (`dev-refine` / `dev-run` / `dev-runall`), wrap-up (`dev-wrap` / `dev-wrapall`), and blocked-work handover — complementing the CLI-only daily loop in §6.

- **Universal-router coverage for `/sp:dev-next`.** The slash-command guide now documents the status-aware router end to end: a command-map row, a mental-model diagram entry, a dedicated "universal router" section (TABLE A/B lookup, `--dry-run` / `--once` / `--full` / `--auto` / `--agent`, smart target detection for WBS / task path / feature id), and the command-vs-flag distinction between `/sp:dev-next` and the `--next` chain flag.

## [0.3.12] — 2026-07-17

### Added

- **`spur task run-link` — link a task to its pipeline run.** New CLI verb records a run link (`--source`, `--run-id`, `--json`) against a task WBS, so chained `/sp:dev-next` executions leave an auditable run trail on the task.

- **`/sp:dev-next` command and `sp:next-router` skill.** Next-step routing tables tell the agent exactly what to run after each pipeline verdict: batch-preflight STOP rows (A2/A7/A8/A9) with recovery hints, plus one-shot recovery after a FAIL. Wired into super-coder at batch boundaries — `task-pipeline.yaml` remains the happy path; deep-merge via looping dev-next is forbidden.

- **Dogfood-testing protocol @1.2.** Reports are now footer-mandatory with a 7-check finalize-or-abort gate (structure scrub, ledger cardinality vs `Steps:N`, footer mirrored at report end, refusal rule on any fail). Ships a `validate-report` CLI — pure `validateReport(md)` with stable error codes — plus golden/mutation fixtures.

- **Machine-checked pipeline-driving detection.** A word-boundary detector replaces the leading-space prose matcher for pipeline-driving testees, leading-space invariant without letting `run` leak into `runaway`. Adds a meta-run cost policy for implement-heavy chained steps (driver-vs-chained cost source table) and a stop-at-testing discipline: when chained-leg provenance is missing, the report says so instead of fabricating an outcome.

- **Review L3 done-gate.** The lifecycle adapter now refuses `testing → done` without a populated P1–P4 Review priority table — prose-only reviews can no longer slip through strict-core verification. Dogfood Phase 4 self-validates via the new `validate-report` CLI.

- **Teams board refinements.** Controls centralized in the Terminal tab; the server exposes team and message metadata for the board; the recent message feed is enriched; and the supervisor stamps process event identity onto runs.

### Fixed

- **System event actors derived from process agent ids**, so process-originated rows attribute to the right agent instead of a generic source.
- **Tighter automated workflow guards** across `/sp:dev-*` commands, closing gaps where automated runs could skip required gates.
- **Dogfood Phase 1.0 gate is shell-executable, not prose-only.** `evaluateDogfoodGate` ships as a bun CLI required before planning and after step derivation; W8 advisory documented; DD-09 acceptance-criteria gaps cleared.

### Changed

- **ADR-031 plugin layout for executable helpers.** Inside `plugins/sp`, executable TS helpers now live at `scripts/<skill>/` with their suites at `tests/<skill>/`; skill directories hold `SKILL.md` and prompt-side companions only. The daily-summary scripts/tests were relocated accordingly, and a structure test (R53) enforces the rule.

## [0.3.10] — 2026-07-13

### Added

- **Tool Using observability tab.** New web tab surfaces real-time agent tool-use telemetry: every `PreToolUse` / `PostToolUse` event with tool name, arguments, response, duration, and token cost. Backed by `TokenLedgerService` (reverse-tail cursor pagination over `token-ledger.jsonl`) and `TokenLedgerWatcher` (`fs.watch` fan-out with offset tracking), exposed via `GET /api/observability/tool-use` and an SSE stream route. The web tab polls the tail API live with a `lastEventId` cursor for efficient resumption.

- **CLI-driven task and feature status changes now surface in System Events (task 0249).** When `spur task create`, `spur task update --status`, `spur feature create`, or `spur feature update --status` runs, a row is written to the shared `system_events` SQLite ledger via a new `SystemEventEmitter` — so CLI-originated `task.created`, `task.transitioned`, `feature.created`, and `feature.transitioned` events appear alongside Board-originated rows in the System Events tabview. Sink failures are swallowed (never break the mutation); read-only CLI verbs never open the DB.

- **Hook matchers expanded to bash, grep, and glob.** The context-post-tool hook now pattern-matches `Bash`, `Grep`, and `Glob` tool calls (previously `Read`/`Write`/`Edit` only), with redaction of sensitive argument fields. A token cascade propagates the estimated token cost of each matched tool call into the token ledger, and session-start hints seed the indexed-context skill on first launch.

### Fixed

- **`sp-runtime-path` rule no longer flags `.pi-lens` cache snapshots.** The boundary rule's exclude list now includes `**/.pi-lens/**`, so autogenerated snapshot data in `.pi-lens/cache/` is not misclassified as a source-code path violation.

- **Exported `safeStringify` now carries TSDoc.** The shared JSON serialization helper in `system-event-tap.ts` was promoted to an export for reuse by the CLI emitter but lacked a doc comment; the `every-export-has-tsdoc` post-check rule now passes.

### Changed

- **System Events producer audit doc reflects narrowed CLI gap.** `docs/inventory/system-events-producer-audit.md` now shows planning events as Board+CLI reachable, with the Gap 1 path table updated to mark the CLI path as wired through `makePlanningEmitter(context)`.

## [0.3.11] — 2026-07-16

### Added

- **Teams board — a full module for managing agent teams from the web.** `spur team up` / `spur team down` / `spur team status` CLI verbs drive a persistent agent loop that the supervisor self-drains. A new web module (board) hosts four tabs: **Terminal** (team → member cascading dropdowns with live status badges, localStorage-persisted selection, start/stop with confirmation modal, stdin POST, local echo, and message enqueue for loop agents), **Processes** (live watch list with team / source / running-only filters and a per-row Attach button that jumps to the member's terminal), **Messages** (per-member inbox with `EventSource` live-tail that refetches on `message.sent` / `message.replied`), and **Activity** (timeline of team / message / agent / supervisor …

- **Cross-process registry exposes every harness-launched run.** A new `ProcessRegistry` records supervisor-tracked processes **and** one-shot agent executions. `apps/server` now injects the registry into the team module so `GET /api/team/processes` returns the full inventory — supervisor-tracked rows, ad-hoc `spur agent` runs, and descendants — with a `teamId` tag derived from `spec.tags.team:<id>` for grouping.

- **`spur agent loop` — a persistent agent loop the supervisor self-drains.** Long-running members stay alive between requests without per-call spawn overhead. `SupervisorService.defaultWrapperArgv` switches to `agent loop` and boot-time autostart resolves via `resolveAutostartSet` across `agent.team.*` config and `SPUR_TEAM_AUTOSTART`.

- **`spur init` substitutes AGENTS.md placeholders at scaffold time.** New projects no longer ship `{project-name}` / `{project-description}` placeholder tokens — `init` resolves them at write time. The bundled template is split into a **portable** `config/templates/AGENTS.md` (seeded by `spur init`) and a **monorepo-instance** root `AGENTS.md`, with a new alignment test that enforces the portable contract.

- **Declarative team config schema.** New `parseTeamConfig()` validates `.spur/config.yaml` `agent.team.*` blocks (collision rejection across composed ids), and a sample team ships in the bundled config so the Teams board has data to render on a fresh init.

- **`/sp:dev-verifyall` slash command.** Batch verification across a feature's task set — runs `/sp:dev-verify` over each member and emits a per-task PASS / PARTIAL / FAIL summary.

- **Tooltips in observability tabs surface more diagnostic fields.** Each renderer in `buildTooltipSummary` now shows 2–4 high-value fields instead of 1, with a shared `formatDuration` / `pickNumber` helper pair. The `workflow` renderer collapses `phase / transition / action` into one labeled pair (not three redundant ones).

- **Server error envelopes use status-specific messages in production.** Non-500 errors (404 / 409 / 422 / 503) now carry a client-safe message that corresponds to the status code instead of the generic "Internal server error". 500 errors still return the generic message with no stack leak.

### Changed

- **HITL default behavior is now deny, opt-in to approve.** The server-side default HITL responder never auto-approves unless the operator opts in via `SPUR_HITL_AUTO_APPROVE=1` (or the equivalent config key). The CLI desktop-notifier responder's non-macOS / osascript-error fallback also defaults to `no`. Eliminates the foot-gun where a missing interactive operator would silently approve work.

- **Model-status doctor column renders the full enum.** `spur agent doctor` shows the full status string (`available | quota_exhausted | rate_limited | unavailable | unknown`) instead of 3-char abbreviations.

- **Tool selection tab now lists `omp`, `Hermes`, and `Grok`** alongside the prior agents. Codex is removed from the supported list.

- **Tailwind 4.3.2** — bumped `tailwindcss` and `@tailwindcss/vite` to 4.3.2.

### Fixed

- **`spur serve` board 404 after global install.** The published `@gobing-ai/spur` package did not ship the Astro board static assets, so `http://localhost:<port>/board` returned `{"error":"Not Found"}` from any non-monorepo cwd (e.g. after `bun i -g @gobing-ai/spur`). `build:bundle` now runs `bundle-web` (copies `dist/web` → `apps/cli/web`), `package.json` `files` includes `web/`, and `resolveWebDistPath` looks next to the bundled `spur.js` / binary. Missing assets log a warning and browser-open falls back to `/api/health` instead of a JSON 404.

- **Restore package-root `config/` in the npm release (ADR-015).** After the bin moved to package-root `spur.js`, default config assets were nested under the leftover `spur-cli/config/` path and docs still said `dist/config`. Releases now ship top-level `config/` (via `bundle-config config` + `files: ["config", …]`); `bundledConfigRoot()` still accepts legacy `spur-cli/config`. **`spur init` full-tree seeds** every bundled asset into project `.spur/` (rules/**, workflows/**, tasks/**, templates/**, plugins/\*\*), then applies the scaffold manifest for remaps and root-scoped docs/AGENTS — matching the monorepo symlink intent with real copies for end-user projects.

- **`POST /:team/up` now starts only `autoStart=true` members.** Prior implementation started every materialized member regardless of the spec's autoStart flag — contradicting the docs, the CLI, and the team definition. Routes now filter via `listAgentSpecs` so an `autoStart=false` member is created but not started.

- **Cross-team composed-id collisions are rejected.** Two teams that would compose to the same `<team>:<member>` id now fail config parse instead of silently shadowing each other.

- **ProcessesTab source filter aligns to production sources.** Dropdown now offers `supervisor` / `one-shot` / `other` (the labels actually produced) instead of `supervisor` / `registry` (the latter never matched production rows).

- **ProcessesTab filters use utility-only tokens.** Replaced DaisyUI `select` / `btn` classes with `bg-base-200` / `border-spur-border` / `text-spur-text` to satisfy the no-daisyui-class-leak rule.

- **Nested `<button>` removed from Roster member rows.** Restructured row to a styled `<div>` so Start / Stop are sibling buttons (no more invalid HTML or happy-dom hydration warning leak). MessagesTab uses the shared `<Button>` wrapper.

- **Terminal input no longer silently swallows stdin for loop agents.** Lines submitted while the active member is a loop agent now produce a local echo frame and a fire-and-forget POST to `/api/messages`, in parallel with stdin (for agents that do consume stdin).

## [0.3.7] — 2026-07-12

### Added

- **Runtime process-tree observability (task 0243).** New `spur observability processes` entry point and web **ProcessListTab** that render the OS process tree rooted at the server's own pid, with depth-based visual indent and per-row metadata (PID, parent PID, RSS, elapsed, source badge: `serve` / `supervisor` / `descendant`). Backed by a new `ProcessInspector` port in `@gobing-ai/spur-app` (port-and-adapter — tests inject fixtures, production shells out to `ps`) and a typed `ProcessInventoryService` that overlays supervisor-tracked processes onto the OS tree. The server exposes it at `GET /api/observability/processes` and returns `501 UNSUPPORTED_PLATFORM` on hosts without a parseable process table.

- **`bridgeEventBus<T>()` — single shared EventBus bridge helper.** Replaced three hand-rolled `on/off/emit` bridge implementations in `AgentService`, `RuleService`, and `WorkflowService` with one typed utility. Also picked up by the server's context to replace seven `eventsBus as unknown as never` casts in the bootstrap, so the event-bus wiring is now type-safe end-to-end.

- **`spur init` substitutes AGENTS.md placeholders at scaffold time (task 0242).** New projects no longer ship `{project-name}` / `{project-description}` placeholder tokens — `init` resolves them at write time. The bundled template is split into a **portable** `config/templates/AGENTS.md` (seeded by `spur init`) and a **monorepo-instance** root `AGENTS.md`, with a new alignment test that enforces the portable contract.

- **Tooltips in observability tabs surface more diagnostic fields (task 0234).** Each renderer in `buildTooltipSummary` now shows 2–4 high-value fields instead of 1, with a shared `formatDuration` / `pickNumber` helper pair. The `workflow` renderer collapses `phase / transition / action` into one labeled pair (not three redundant ones).

### Changed

- **Server error envelopes use status-specific messages in production (task 0241 R2).** Non-500 errors (404 / 409 / 422 / 503) now carry a client-safe message that corresponds to the status code instead of the generic "Internal server error". 500 errors still return the generic message with no stack leak.

- **HITL default behavior is now deny, opt-in to approve (task 0241 R1).** The server-side default HITL responder never auto-approves unless the operator opts in via `SPUR_HITL_AUTO_APPROVE=1` (or the equivalent config key). The CLI desktop-notifier responder's non-macOS / osascript-error fallback also defaults to `no`. This eliminates the foot-gun where a missing interactive operator would silently approve work.

- **Server SSE stream helpers consolidated (task 0241 R8).** The team live-tail and events planning streams now share a single `sendSseKeepalive` / `enqueueSseFrame` helper module (`apps/server/src/modules/sse/stream-helpers.ts`) so the two streams cannot drift on heartbeat framing.

- **App-layer domain errors are now typed and reach the server error-handler via `instanceof` (task 0241 R9).** `GuardDeniedError` (→ 409), `LockTimeoutError` (→ 503), and the `hitlAutoApproveEnabled` / `hitlConfirmDefault` helpers live in `@gobing-ai/spur-app` so throw sites in `PlanningWriteService` raise the same types the server matches.

- **Model-status doctor column renders the full enum (task 0239 R4/AC1).** The `Model` column in `spur agent doctor` shows the full status string (`available | quota_exhausted | rate_limited | unavailable | unknown`) instead of 3-char abbreviations — self-documenting on the doctor table.

- **`spur task refresh` is now `re-scan corpus` (task 0235 / 0192 follow-up).** `kanban.md` is retired; the **web Task Kanban board** is the single source of truth. `--strict` is now an option on `spur task resolve`. New verbs `migrate` (one-time A17 corpus normalization), `refresh-roster <wbs>` (regenerate a parent's sub-task roster), `verdict <wbs>` (derive a verdict JSON from verify-answer text), and `path <wbs>` (inverse of `resolve`).

- **Spur-supported agent list expanded.** Codex is dropped; `omp`, `Hermes`, and `Grok` are added to the supported-agent list in `AGENTS.md` and the `AgentDetector` catalog. (The catalog update was an internal-side artifact; the user-facing consequence is that `spur agent doctor` recognizes the new detectors.)

- **`PatchFrontmatterField` matches only inside the frontmatter block.** A body line shaped like `priority: ...` can no longer be rewritten when `priority` is absent from frontmatter; the matching is constrained to between the opening and closing `---` fences.

- **Config loader cache is mtime-based.** Long-running servers now pick up `.spur/config.yaml` edits without restart; an exported `invalidateSpurConfig(path?)` provides explicit cache clearing.

### Fixed

- **`spur agent --timeout` rejects non-numeric values (task 0240 R4).** A `--timeout abc` no longer propagates `NaN` to the runner; the CLI now returns exit 2 with a clear validation error before any spawn.

- **InboxTab poll + focus-refetch race (task 0241 R5).** The 15-second poll interval and focus-refetch callback now track an `AbortController` that is aborted on cleanup AND whenever a new request starts — no more in-flight requests writing to `setMessages` after unmount.

- **`Bun.spawn([editor, path])` now respects multi-word `$EDITOR` (task 0241 R6).** Editors like `code -w` or `cursor -n` no longer break when launched from `spur agent --editor`; the spawn now uses `shell: true` so the editor command splits correctly.

- **`spur serve --json` reports the spawned server pid, not the CLI's own (task 0241 R7).** The PID field in `--json` mode is now forwarded from the server startup log.

- **Migration 0005 (`ALTER TABLE runs ADD COLUMN pid`) is idempotent on retry (task 0240 R8).** The migration now declares `addColumnIfMissing: { table: 'runs', column: 'pid' }`; the dead `builtInAddColumnGuard` fallback was removed (0007 already has its own explicit guard).

- **Web InboxTab abort controller (task 0241 R5).** Same fix as above; documented separately for changelog visibility.

- **`patchFrontmatterField` no longer rewrites body lines (task 0240 R2).** See Changed section.

- **Config cache invalidation (task 0240 R9).** See Changed section.

- **Plugin `sp-dev-run` task-corpus stabilities (task 0240 R12 / R14).** `TaskService.create` and `createBatchItem` now share one `renderCreatedTaskContent()` helper (was ~80-line near-duplicate). `TaskService.findTaskFileName` searches all registered task folders, so `spur task show <wbs>` resolves any task that `spur task resolve` finds.

- **`Config` and `Task` task-corpus stability fixes (task 0240 R1, R3, R5, R6, R7, R10).** Removed the dead private-host gate in `http-request.ts` (allowlist already enforces the same security property). Consolidated `yamlSafeValue` / `formatYamlValue` into one `escapeYamlValue` export with proper `"` and `\` escaping. Fixed `SchemaLifecyclePort` docstring to match code (same-status guard only). Replaced `stat()` with `lstat()` in `scanWorkflowFiles` so symlink detection works. Added a `.catch` to the supervisor `pipeStream` reader chain so stream errors no longer surface as unhandled rejections. Markdown table cells in `renderTesting` / `renderReview` now escape `|` in evidence text.

- **Server tests/quality:** removed `_CoverageAnchor` class from `apps/server/src/context.ts` (task 0241 R3) — the `void new _CoverageAnchor()` invocation that was keeping the class alive purely for the coverage gate is gone, and the accessors it was keeping alive now have real tests.
