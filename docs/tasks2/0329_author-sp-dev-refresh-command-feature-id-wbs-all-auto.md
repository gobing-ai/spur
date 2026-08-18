---
template: feature-impl
schema_version: 1
name: "Author /sp:dev-refresh command (feature-id | wbs | --all | --auto)"
description: ""
status: done
type: task
profile: standard
feature_id: F821
parent_wbs: null
priority: P2
tags: []
dependencies: ["0327"]
created_at: "2026-07-25T00:27:51.163Z"
updated_at: "2026-08-18T04:42:47.875Z"
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
**Verdict: PASS** — re-audit of commit `50f9a1ee` via `/sp:dev-verify 0329 --force --focus all --fix all` (2026-07-25). `--fix all`: no-op — no UNMET/PARTIAL requirements, no major findings (one P4 advisory).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 `plugins/sp/commands/dev-refresh.md` per dev-* conventions | MET | `plugins/sp/commands/dev-refresh.md:1-5` — frontmatter `description` / `argument-hint` / `allowed-tools` matches the dev-wrap shape; command-contract validator passes (`validate() → zero violations`, 309/309 plugin tests) |
| R2 modes: feature-id / WBS (link-helper + persisted skip) / `--all` combined sweep / `--auto` unattended | MET | `plugins/sp/commands/dev-refresh.md:17-20` — feature-id: dry-run proposal + confirm + apply; WBS: resolve linked feature, link-helper propose or persist skip (`feature_link_declined: true`); `--all`: orphan sweep + `spur feature sync --all --json` with summary; `--auto`: forward-only auto-apply, orphan proposals queued to `.spur/run/dev-refresh-report.txt` |
| R3 thin wrapper — orchestrates CLI verb + link-helper, no duplicated derivation logic | MET | `plugins/sp/commands/dev-refresh.md:9` wraps `sp:spur-dev`; every mode delegates to `spur feature sync` (0327 engine) or feature-link-helper — zero derivation logic in the command |
| R4 idempotence + sensible exit semantics | MET | idempotent by delegation: `syncFeature` no-ops when `from === to` (`packages/app/src/services/feature-service.ts:450-452`) and CLI prints NOOP; CLI error path exits non-zero (`apps/cli/src/commands/feature.ts` sync action, `context.setExitCode(1/2)`); command usage line documents the arg modes |
| R5 register in `plugins/sp/README.md` + `docs/04_DESIGN.md` same commit (T3) | MET | commit 50f9a1ee: README index row for `dev-refresh`; `docs/04_DESIGN.md` surface count 28→31 in §1.3; command-contract counts updated (31) |

**Acceptance Criteria Verification**

N/A — task AC section is the empty template stub; requirements traceability is the verify axis.

**Design Conformance**

Verified against the locked command-surface decision (docs/tasks2/0324 Solution): single `/sp:dev-refresh [feature-id | wbs | --all] [--auto]` — DONE; `--all` = combined link + refresh sweep — DONE; per-item confirm with derivation reason + summary — DONE (interactive confirm per mode; `--auto` queues orphans to the report); thin wrapper, zero duplicated logic — DONE. 4/4 claims DONE.

**SECUA Review (focus: all)**

| Severity | File | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `plugins/sp/commands/dev-refresh.md:17-20` | The four mode bullets delegate to `sp:spur-dev` with `refresh …` args — the spine's routing for `refresh` is new surface; correctness rests on spur-dev handling those args (skill SSOT, contract tests validate command shape only) | Advisory — first live `/sp:dev-refresh` run dogfoods the routing (planned with the 0330 backfill) |

Residual risk: command-to-spine routing gets its first live exercise at the 0330 backfill run; command-shape contract + delegation evidence stands in.

**Evidence (run this audit)**

- `bun test plugins/sp/tests/` — 309 pass / 0 fail / 1537 expects (command-contract validator: zero violations, 31 files)
- `bun run lint` — clean (biome + all 5 workspace typechecks exit 0)
- `bun run test` — 3 fail = the pre-existing sandbox denials (2× EADDRINUSE port-bind `rpc-client.test.ts`, 1× `ps` EPERM `packages/app/src/services/process-inventory-service.ts:92`); no plugin/CLI failures
- Coverage: N/A (documentation-only change — markdown command + README/design index; no runtime code path added; contract covered by plugin test suite)
- Line-anchor rule: `plugins/sp/commands/dev-refresh.md:1-20`, README row, `docs/04_DESIGN.md:320` re-read this run; cited lines name the requirement subjects
- Verdict artifact: `.spur/run/0329-verdict.json` (written last, standalone path)
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
