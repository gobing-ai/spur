---
template: feature-impl
schema_version: 1
name: "Author /sp:dev-refresh command (feature-id | wbs | --all | --auto)"
description: ""
status: done
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0327"]
created_at: "2026-07-25T00:27:51.163Z"
updated_at: "2026-07-25T17:03:56.321Z"
---

## 0329. Author /sp:dev-refresh command (feature-id | wbs | --all | --auto)

### Background
Implements the map's command-surface decision (see `docs/tasks2/0324_decide-refresh-command-surface-single-dev-refresh-with-modes.md` — Solution section). Depends on the derivation engine + `spur feature sync` verb (sibling task). Thin wrapper: orchestrates the CLI verb + `feature-link-helper`; zero duplicated derivation logic.

Conventions: existing dev-* command shape at `plugins/sp/commands/dev-wrap.md`; link helper at `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
### Requirements
- R1. New `plugins/sp/commands/dev-refresh.md` following dev-* conventions (frontmatter `description` / `argument-hint` / `allowed-tools`).
- R2. Modes: feature id ⇒ derivation preview + confirm + apply; task WBS ⇒ resolve linked feature (link-helper propose/confirm/skip when missing; persisted skip honored) then the same; `--all` ⇒ combined pass: orphan link sweep + stale-status refresh; `--auto` ⇒ unattended policy (forward-only auto-apply; link proposals queued to report).
- R3. Idempotent: no-op with a clear "already in sync" message when derivation yields no proposal; sensible exit codes.
- R4. Register in `plugins/sp/README.md` command index; `docs/04_DESIGN.md` in the same commit (T3).
- R5. Tests: `validate-commands.ts` thin-wrapper contract validator + `command-contract.test.ts` pass.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
| File:line | Change |
| --- | --- |
| [`plugins/sp/commands/dev-refresh.md:1`](file:///Users/robin/xprojects/spur-new/plugins/sp/commands/dev-refresh.md#L1) | Created new `/sp:dev-refresh` command wrapper specifying `<feature-id>`, `<wbs>`, `--all`, and `--auto` mode behaviors. |
| [`plugins/sp/README.md:109`](file:///Users/robin/xprojects/spur-new/plugins/sp/README.md#L109) | Registered `/sp:dev-refresh` command in the plugins/sp README slash command index. |
| [`docs/04_DESIGN.md:320`](file:///Users/robin/xprojects/spur-new/docs/04_DESIGN.md#L320) | Updated command wrapper count in Section 1.3 to reflect 31 hand-authored slash wrappers (T3). |
| [`plugins/sp/tests/command-contract.test.ts:304`](file:///Users/robin/xprojects/spur-new/plugins/sp/tests/command-contract.test.ts#L304) | Updated contract test assertion to 31 command files. |
### Testing
- Validated thin-wrapper contract via `bun plugins/sp/scripts/validate-commands.ts`: 31 commands pass all 4 gates.
- Executed contract test via `bun test plugins/sp/tests/command-contract.test.ts`: 49 passing tests.
- Executed full monorepo quality gate `bun run autofix && bun run spur-check`: 3,559 passing unit tests across 220 files, 100% coverage gate pass, 0 rule violations.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`plugins/sp/commands/dev-refresh.md:15`](file:///Users/robin/xprojects/spur-new/plugins/sp/commands/dev-refresh.md#L15) | Thin wrapper structure | None — strict adherence to ## Usage and ## Implementation headings enforced by validator |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T17:03:52.829Z todo → wip (system)
- 2026-07-25T17:03:54.443Z wip → testing (system)
- 2026-07-25T17:03:56.321Z testing → done (system)
