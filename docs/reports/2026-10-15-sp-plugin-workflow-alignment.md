---
kind: report
title: SP plugin and workflow alignment after CLI absorption
status: verified
created_at: 2026-10-15
updated_at: 2026-10-15
related: [A91, '1211', '1212', '1213', ADR-130]
tags: [review, harness, cli, workflows]
---

# SP plugin and workflow alignment

Operator-authorized direct refinement, with no new tasks. Scope: all 41 canonical skills,
43 slash commands, four subagent definitions, their references/callers, and nine shared workflows.
Implementation authority: current CLI registrations/application services, not installed older skills.
Three read-only source reviews covered the CLI facade, orchestration/workflows, and remaining
skill/command/agent routing. The parent applied fixes as the sole writer. Existing unrelated doc
edits were preserved.

| Finding | Disposition | Verification |
| --- | --- | --- |
| Gate skill claimed all failures exit 0 and only run writes full receipts | RESOLVED: mode-specific exits and run/recheck receipt ownership match qualityGateMain | CLI gate tests and source review |
| Task/feature facade advertised unsupported global JSON/folder flags | RESOLVED: verb-specific flags and workflow-internal outputs documented | Live registrations, facade parity |
| Builder facade still said two verbs and required a version for read-only check | RESOLVED: four verbs, check-only invocation, write-flag rejection and publisher restoration documented | Builder source and existing parity tests |
| Workflow cost lacked operational guidance | RESOLVED: cohort/filter/null/report/budget/exit semantics documented without replacing repository promotion query | Cost source and parity tests |
| Workers still resolved retired quality-gate scripts/twins | RESOLVED: skill/driver invoke spur task gate directly | Updated worker iteration contract |
| PR review instructions still selected staged Node twins | RESOLVED: native builder pr invocation throughout | Command/skill validation and forbidden-invocation scan |
| Dogfood references pointed at deleted detector tests | RESOLVED: current app-owned detector test path | Skill link checks |
| Inline record snippet omitted no-lifecycle | RESOLVED: match pipeline invocation and prevent orphaned lifecycle runs | New driver/YAML parity assertion |
| History rescue quoted a multi-part CLI invocation as one executable | RESOLVED: expand the existing launch contract consistently | New behavioral regression failed before fix, passes after |
| Shippability instructions checked active-state structure instead of strict completion | RESOLVED: projected done/strict check includes receipts and dogfood evidence; command/spine references agree | New shipping instruction contract test |
| Doctor read-only invariant forbade naming proposal write routes | RESOLVED: proposals may name an approved apply route; doctor executes no mutations | Capability validation and source review |
| Planning spine diagram implied subprocess AC authoring by default | RESOLVED: host-inline competency routing matches current default | Source review and skill contracts |

## Verification scope

- Capability structure: Superskill validates all 88 skills/commands/agents (one intentional
  placeholder-link warning in wayfinder); wrapper/flag contracts
  cover all 43 commands and 87 contract surfaces. No wrappers needed semantic rewrites.
- All nine workflows pass schema and semantic validation. Composition findings are existing
  advisory warnings, not schema failures. Bare dry runs in empty scratch projects intentionally
  fail closed (missing producer/corpus artifacts) or hit iteration bounds on externally-driven
  lifecycle graphs. These are not completed pipeline proofs and no guards were weakened.
- Behavioral fixtures exercise history rescue, inline task pipeline, iteration ordering and CLI
  gate exits. Runtime/workflow full gate: 11,111 tests, zero failures, all typechecks and 53 rules;
  measured files meet both 90% thresholds. Final documentation-only shipping/doctor corrections
  additionally pass 205 contract/structure tests, capability validation and wrapper/flag gates.
  The feature-scoped receipt is refreshed after all edits.
- One fleet test timed out at 20 seconds in the first complete-suite attempt; its exact retry
  passed in 53 ms and the unchanged full-gate retry passed. The interrupted attempts are
  preserved and are not counted as successful gates. No thresholds/assertions were weakened.
- Receipts and raw validation output: `.spur/run/plugin-alignment/`.

## Existing launch restriction

The legacy workflow spurBin string and splitLaunchCommand consumers require launch paths without
spaces and reject shell syntax. This pre-existing, explicitly documented transport ceiling is
preserved and now taught in the CLI facade. Native argv callers keep their existing lossless
behavior. Supporting spaced paths throughout shell/native workflow transports requires a separate
runtime contract change; this alignment does not claim that capability.

## Delivery

Task 1211 residual scan initially found zero items; its final review/record and residual sweep are
rechecked after refinement. No new task, public CLI noun/verb or compatibility script is introduced. This driver made no
commit or push. Earlier alignment changes appeared in commits 21d89c1aa and 06e5b7047 during
the session; the final shippability/doctor refinements remain uncommitted for the next step.
