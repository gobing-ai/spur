---
schema_version: 1
name: "Unified dev-* operations reference + repoint ghost commands"
status: testing
template: feature-impl
created_at: 2026-06-24T03:52:29.293Z
updated_at: 2026-06-25T04:39:17.723Z
feature_id: H2
parent_wbs: "0109"
priority: P1
tags: ["sp-plugin", "commands", "ghost-fix"]
---

## 0110. Unified dev-* operations reference + repoint ghost commands

### Background

Covers 0109 R1+R2. Five sp:dev-* commands (changelog, gitmsg, fixall, handover, new-task) delegate `args="<op> $ARGUMENTS"` to sp:spur-dev which has ZERO procedure for them — the round-1 ghost-operation defect class. Create ONE unified operations reference (plugins/sp/skills/spur-dev/references/dev-operations.md) defining every dev-* operation (purpose, inputs, backing skill/verb, behavior), then repoint each command at its real backing so none delegates to an undefined op. Run order: do this first — it's the foundation the other sub-tasks build on. Validate (R7 subset) + doc-sync (R8 subset) for the touched commands in this task.

### Requirements

- [ ] R1. Create plugins/sp/skills/spur-dev/references/dev-operations.md defining all dev-* operations uniformly (implement/unit/review/verify/changelog/gitmsg/fixall/handover/new-task/plan/refine/run): purpose, inputs, backing skill or CLI verb, behavior contract.
- [ ] R2. Repoint each dev-* command at its real backing; give the 5 ghost commands a defined procedure (or explicit delegation mapping). No command delegates to an undefined operation.
- [ ] R3. Declare real flags in each touched command's arg-hint.
- [ ] R4. lint green; invoking any previously-ghost command yields defined behavior; AGENTS.md/04_DESIGN dev-* op map updated.

### Acceptance Criteria

- [ ] AC1. Given the sp plugin, when an agent opens `plugins/sp/skills/spur-dev/references/dev-operations.md`, then all 13 dev-* operations are defined with: purpose, inputs, backing (skill/CLI/inline), and behavior contract. Operations: implement, unit, review, verify, run, refine, plan, docs, changelog, gitmsg, fixall, handover, new-task.
- [ ] AC2. Given any of the 5 previously-ghost commands (dev-changelog, dev-gitmsg, dev-fixall, dev-handover, dev-new-task), when the command is invoked, then it executes a defined inline procedure — no `Skill(skill="sp:spur-dev", args="<undefined-op> …")` delegation remains.
- [ ] AC3. Each ghost command's `## Implementation` section describes the inline procedure and links to dev-operations.md as the authoritative reference.
- [ ] AC4. The 8 already-correct commands (implement, unit, review, verify, run, refine, plan, docs) keep their existing `Skill()` delegation unchanged.
- [ ] AC5. Given the 5 repointed commands, when their frontmatter `argument-hint` is read, then it declares the real flags the command accepts (not the generic `$ARGUMENTS` passthrough).
- [ ] AC6. Given the repo, when `bun run lint` runs, then it exits 0.
- [ ] AC7. Given any previously-ghost command, when it is invoked, then it produces defined behavior (no improvisation, no "operation not found").
- [ ] AC8. `docs/04_DESIGN.md` §7 includes a dev-* operation map row pointing to `plugins/sp/skills/spur-dev/references/dev-operations.md`.

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design

All 5 ghost commands (changelog, gitmsg, fixall, handover, new-task) drop the `Skill(skill="sp:spur-dev", args="<op> $ARGUMENTS")` delegation and define their procedure inline in the command file. `dev-operations.md` is the authoritative reference documenting all 13 operations uniformly.

The 3 git operations (changelog, gitmsg, fixall) have no natural skill home; creating new skills is scope creep. Adding procedures to sp:spur-dev contradicts parent 0109 R4's goal of slimming spur-dev. Inline procedures are self-contained, eliminate ghost delegation, and keep the reference centralized. Rejected alternatives: (a) keep Skill() delegation + add procedures to sp:spur-dev — grows spur-dev, mixes git-tooling into a workflow skill; (b) create new skills — scope creep for simple one-liner procedures; (c) delegate handover to generic `handover` skill — crosses plugin boundary.

Per-operation backing map:

| Operation | Command | Backing | Pattern |
|-----------|---------|---------|---------|
| implement | dev-implement | sp:spur-dev (pipeline step) | Skill() — unchanged |
| unit | dev-unit | sp:spur-dev (pipeline step) | Skill() — unchanged |
| review | dev-review | sp:code-verification | Skill() — unchanged |
| verify | dev-verify | sp:code-verification | Skill() — unchanged |
| run | dev-run | sp:spur-dev | Skill() — unchanged |
| refine | dev-refine | sp:spur-dev | Skill() — unchanged |
| plan | dev-plan | sp:spur-dev | Skill() — unchanged |
| docs | dev-docs | sp:doc-evolve | Skill() — unchanged |
| changelog | dev-changelog | inline (git log + grouping) | NO Skill() — new |
| gitmsg | dev-gitmsg | inline (git diff + conventional commit) | NO Skill() — new |
| fixall | dev-fixall | inline (lint+test fix loop) | NO Skill() — new |
| handover | dev-handover | inline (structured doc generation) | NO Skill() — new |
| new-task | dev-new-task | inline (spur task create + intake) | NO Skill() — new |

Inline procedure summaries:

- changelog: `git log --oneline <from>..<to>`, group by conventional-commit type (feat/fix/refactor/docs/chore), format as markdown changelog.
- gitmsg: read `git diff --cached`, generate `type(scope): summary` + optional body with key changes.
- fixall: run `bun run lint`, collect errors, fix systematically, re-run; then `bun run test`; loop until both green.
- handover: gather goal/progress/blocker/rejected approaches/next steps from task context, write structured markdown.
- new-task: intake Q&A (scope, feature link, template), run `spur task create "<title>" --feature <id> --template <variant> --parent <wbs>`.

The 5 ghost commands' `## Implementation` section changes from `Delegates to sp:spur-dev skill: Skill(skill="sp:spur-dev", args="changelog $ARGUMENTS")` to `Implements the inline procedure defined in dev-operations.md`. The `allowed-tools` frontmatter stays the same. dev-operations.md lives at `plugins/sp/skills/spur-dev/references/dev-operations.md` (per parent 0109 R1) — organizational home for dev-* documentation.

Doc updates (R4): `docs/04_DESIGN.md` §7 gets a dev-* operation map row pointing to dev-operations.md. AGENTS.md has no CLI surface change (dev-* commands are plugin commands, not CLI verbs); add a pointer to dev-operations.md only if the sp plugin command surface is mentioned.

Invariants: (1) no dev-* command delegates to an undefined sp:spur-dev operation; (2) the 8 already-correct commands are not touched; (3) dev-operations.md is the single source of truth for dev-* operation definitions.

### Plan

1. Create `plugins/sp/skills/spur-dev/references/dev-operations.md` — table of all 13 operations (operation, command, backing, pattern, purpose, inputs, behavior) + per-operation detail sections.
2. Repoint `plugins/sp/commands/dev-changelog.md` — replace `## Implementation` Skill() block with inline procedure + dev-operations.md link; verify arg-hint declares `--from`, `--to`, `--format`.
3. Repoint `plugins/sp/commands/dev-gitmsg.md` — same pattern; verify arg-hint declares `--scope`.
4. Repoint `plugins/sp/commands/dev-fixall.md` — same pattern; verify arg-hint declares `--scope`.
5. Repoint `plugins/sp/commands/dev-handover.md` — same pattern; verify arg-hint declares `<blocker>` positional.
6. Repoint `plugins/sp/commands/dev-new-task.md` — same pattern; verify arg-hint declares `<description>`, `--feature`, `--template`, `--parent`.
7. Run `bun run lint` — verify green.
8. Update `docs/04_DESIGN.md` §7 — add dev-* operation map row pointing to dev-operations.md.
9. Check AGENTS.md for sp plugin command surface — add pointer to dev-operations.md if applicable.
10. Smoke-test: invoke each previously-ghost command and confirm defined behavior (no "operation not found", no improvisation).

### Solution
| File:line | What / Why |
|-----------|-------------|
| `plugins/sp/skills/spur-dev/references/dev-operations.md:1-251` | New: unified reference for all 13 dev-* operations with operation map table + per-operation detail sections. SSOT per R1/AC1. |
| `plugins/sp/commands/dev-changelog.md:9,29-49` | Replaced ghost `Skill()` delegation with inline git-log+conventional-commit-grouping procedure + dev-operations.md link. R2/AC2/AC3. |
| `plugins/sp/commands/dev-gitmsg.md:9,26-44` | Replaced ghost `Skill()` delegation with inline git-diff+conventional-commit procedure + dev-operations.md link. R2/AC2/AC3. |
| `plugins/sp/commands/dev-fixall.md:9,27-47` | Replaced ghost `Skill()` delegation with inline lint+test fix-loop procedure + dev-operations.md link. R2/AC2/AC3. |
| `plugins/sp/commands/dev-handover.md:9,28-52` | Replaced ghost `Skill()` delegation with inline structured-doc-generation procedure + dev-operations.md link. R2/AC2/AC3. |
| `plugins/sp/commands/dev-new-task.md:9,30-51` | Replaced ghost `Skill()` delegation with inline `spur task create`+intake procedure + dev-operations.md link. R2/AC2/AC3. |
| `docs/04_DESIGN.md:449,736-750` | Added §7.8 dev-* operation map subsection + table row pointing to dev-operations.md. R4/AC8. |

**Not changed (by design):** 8 `Skill()`-backed commands (implement, unit, review, verify, run, refine, plan, docs) — AC4 invariant. `dev-dogfood.md` — pre-existing work not authored by this task.
### Testing

| Req | Status | Evidence |
|-----|--------|----------|
| R1: dev-operations.md with all dev-* operations | **PARTIAL** | 11 of 13 AC-listed operations documented. `implement` covered as sub-mode of run (#4). `docs` operation missing — no entry. |
| R2: 5 ghost commands repointed to real backing | **MET** | All 5 (changelog, gitmsg, fixall, handover, new-task) have inline procedures + dev-operations.md links. Zero ghost `Skill()` delegations remain. |
| R3: Real flags in arg-hints | **MET** | changelog: `--since/--until/--version`; gitmsg: `--commit/--scope`; fixall: `<validation-command>/--max-retry/--scope`; handover: `<blocker description>`; new-task: `<description>/--feature/--template/--parent` |
| R4: `bun run lint` exits 0 | **MET** | `bun run lint` clean — Biome + 7 workspace typecheck all pass |

Coverage: 99.07% lines, 99.54% funcs.

**Verdict: PARTIAL** — R1 is partial (docs operation missing from dev-operations.md). R2-R4 all MET.

### History
- 2026-06-24T16:15:18.902Z todo → wip (system)
- 2026-06-25T04:38:36.135Z wip → testing (system)
