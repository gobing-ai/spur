---
template: standard
schema_version: 1
name: "0176 Wave E: comprehensive sweep cleanup"
description: ""
status: done
type: task
profile: standard
parent_wbs: "0176"
priority: P2
tags: []
dependencies: []
created_at: 2026-07-02T06:29:12.250Z
updated_at: 2026-07-02T22:39:32.693Z
---

## 0181. 0176 Wave E: comprehensive sweep cleanup

### Background

Child task for 0176 Wave E. Fix comprehensive sweep items N1-N10 after the higher-risk workflow, decomposition, verifier, and prompt tasks land.

### Requirements
- R1. Complete spur-cli task facade coverage for `task verdict`, `task refresh-roster`, and `task path`.
- R2. Regenerate or correct AGENTS.md CLI surface drift for shipped task/rule flags.
- R3. Inline or otherwise version-control task-write-guard logic so the repo gate covers real guard decisions.
- R4. Add pinned-agent doctor prechecks to relevant pipelines.
- R5. Raise idea-pipeline iterationBound above the documented retry path or reduce the advertised retry caps.
- R6. Add or document a `design_approved` wrapper path for dev-idea/dev-plan.
- R7. Fix stale task path examples and broken roster template links.
- R8. Align dev-fixall and dev-unit coverage-threshold documentation with the owning skills and repo scripts.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan
1. Verify the Wave E partial diff against the live CLI surface and task requirements.
2. Recover the hook-guard work without reintroducing the known non-portable hook command.
3. Complete the remaining N4-N10 cleanup items across workflow YAML and plugin command/skill docs.
4. Run targeted checks for the hook guard and bundled workflows.
5. Run the full local gate and record the dogfood result.
### Solution
- `AGENTS.md:155`, `AGENTS.md:170`, `AGENTS.md:175`, and `AGENTS.md:177` now include shipped `rule run --fix-mode/--dry-run`, `task update --feature/--priority/--no-lifecycle`, `task resolve --strict`, and `task check --strict-core`.
- `plugins/sp/skills/spur-cli/references/tasks/verbs.md:170`, `plugins/sp/skills/spur-cli/references/tasks/verbs.md:203`, `plugins/sp/skills/spur-cli/references/tasks/verbs.md:218`, and `plugins/sp/skills/spur-cli/references/tasks/verbs.md:167` document `task verdict`, `task refresh-roster`, `task path`, and `resolve --strict`. The verdict JSON shape includes requirement, AC, and check evidence, and documents executable-evidence gating.
- `plugins/sp/hooks/task-write-guard.ts:18` now keeps the versioned guard decision logic local; `plugins/sp/hooks/task-write-guard.test.ts:64` and `plugins/sp/hooks/task-write-guard.test.ts:113` exercise fail-open and decision behavior. `plugins/sp/hooks/hooks.json:10` stays on the portable `superskill hook run sp task-write-guard` entrypoint to avoid regressing task 0151's portability fix.
- `config/workflows/task-pipeline.yaml:51` and `config/workflows/idea-pipeline.yaml:62` run `spur agent doctor ${vars.agent}` before agent-run work. `config/workflows/idea-pipeline.yaml:34` raises `iterationBound` to 25 and `config/workflows/idea-pipeline.yaml:31` documents the retry-path math.
- `plugins/sp/commands/dev-idea.md:3`, `plugins/sp/commands/dev-idea.md:32`, `plugins/sp/commands/dev-plan.md:3`, and `plugins/sp/commands/dev-plan.md:33` expose `--design-approved` as the wrapper path for `design_approved=true`.
- `plugins/sp/commands/dev-brainstorm.md:42`, `plugins/sp/commands/dev-refine.md:38`, and `plugins/sp/skills/spec-decomposition/references/decomposition.md:169` replace stale task-path and roster-template examples.
- `plugins/sp/commands/dev-fixall.md:34`, `plugins/sp/commands/dev-unit.md:31`, and `plugins/sp/skills/code-testing/references/unit-testing.md:117` align fixall detection and the coverage-threshold knob with the owning skill/reference.
### Testing
Coverage: 99.45% functions / 99.06% lines.

Commands run:

- `bun test plugins/sp/hooks/task-write-guard.test.ts` — 10 pass, 0 fail.
- `bun run apps/cli/src/index.ts workflow validate config/workflows/task-pipeline.yaml --json` — valid.
- `bun run apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json` — valid.
- `bun run apps/cli/src/index.ts workflow validate config/workflows/planning-pipeline.yaml --json` — valid.
- `bun run apps/cli/src/index.ts workflow validate config/workflows/wrapup-pipeline.yaml --json` — valid.
- `bun run format` — passed; Biome fixed one file mechanically.
- `bun run lint` — passed across all workspaces.
- `bun run test` — 2075 pass, 0 fail, 5364 assertions.
- `bun run test-cf` — 1 test file passed, 1 test passed.
- `bun run build` — CLI, server, and web builds passed. Web build emitted existing CSS/chunk-size warnings only.
### Review
| Severity | File | Finding | Disposition |
| -------- | ---- | ------- | ----------- |
| P2 | config/workflows/task-pipeline.yaml, config/workflows/idea-pipeline.yaml | Pinned `agent: omp` was not checked before agent-run steps, so missing auth/binary failures surfaced mid-pipeline. | Fixed with `spur agent doctor ${vars.agent}` prechecks. |
| P2 | config/workflows/idea-pipeline.yaml | `iterationBound: 15` was below the documented retry path. | Fixed by raising to 25 with retry-path math. |
| P2 | plugins/sp/hooks/task-write-guard.ts | The in-repo hook test previously covered only a shim path, not local guard decisions. | Fixed by inlining/versioning decision logic and covering it directly. |
| P3 | plugins/sp/hooks/hooks.json | The failed dogfood partial changed the command back to `${CLAUDE_PLUGIN_ROOT}`, which conflicts with prior portability work. | Corrected back to `superskill hook run sp task-write-guard`; retained local script coverage as the versioned decision source. |
| P3 | plugins/sp/commands/dev-idea.md, plugins/sp/commands/dev-plan.md | `design_approved=true` existed only as a hidden workflow var. | Fixed with `--design-approved` wrapper docs. |
| P3 | plugins/sp/** docs | Several examples still referenced stale task paths, broken roster links, or non-owning coverage/fixall knobs. | Fixed in command and skill references. |

Residual risk: the portable `superskill hook run sp task-write-guard` runtime must continue to dispatch equivalent logic in installed environments. This repo now keeps the source decision matrix versioned and tested, but the cross-repo runtime remains a release/deployment seam.
### References
- Dogfood run: `10ab1085-a744-4e10-aee2-6682b062f550` (`task-pipeline.yaml`, failed in implement after 600942ms; local-only dogfood report retained under `docs/dogfood/`, gitignored — not committed; referenced here by run ID per ADR/Q1 decision).
- Parent task: `0176`.
- Related bugs/learnings: bug-748, bug-749.
### History
- 2026-07-02T22:26:30.253Z todo → wip (system)
- 2026-07-02T22:39:29.038Z wip → testing (system)
- 2026-07-02T22:39:32.693Z testing → done (system)
