---
template: standard
schema_version: 1
name: "Migrate rd3 engineering operations pack to sp"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-29T23:34:46.101Z"
updated_at: 2026-06-29T23:55:13.117Z
---

## 0157. Migrate rd3 engineering operations pack to sp

### Background
This task plans the next migration batch from legacy plugin `rd3`
(`/Users/robin/projects/cc-agents/plugins/rd3/`) into current plugin `sp` (`plugins/sp/`).

The batch should be the Engineering Operations Pack, not a bulk mirror of deferred rd3 assets.
`plugins/README.md` defines `sp` as the Spur software-development surface: Fat Skills own
agent-facing behavior, slash commands/subagents stay thin, and deterministic corpus writes go
through `spur` CLI verbs. The next batch should therefore strengthen the existing `sp:spur-dev`
execution loop with missing implementation, debugging, testing, and improvement knowledge while
avoiding new CLI wrappers unless ADR-016's value test is clearly passed.

Recommended source scope:

- `rd3:sys-debugging`
- `rd3:code-implement-common`
- selective parts of `rd3:sys-developing`
- remaining useful breadth from `rd3:sys-testing`
- `rd3:advanced-testing`
- `rd3:code-improvement`

Explicitly out of scope for this batch:

- `cc-*`, `skill-*`, `command-*`, `agent-*`, `hook-*`, `magent-*` authoring surfaces; those belong to
  the `cc` plugin.
- `feature-tree`, `tasks`, `orchestration-v2`, `verification-chain`, and `run-acp`; these are already
  absorbed by Spur CLI, workflow, and agent surfaces.
- `product-management` / `prd-*`; useful later, but should wait until the feature/task/board loop is
  stable.
- `deep-research`, `knowledge-extraction`, `indexed-context`, and `reverse-engineering`; heavier
  research/context work needs a clearer agent-agnostic design.
- `token-saver`; it is hook/proxy behavior, not a Spur dev-workflow primitive.
- `cli-for-ai`; keep as reference material unless a new CLI verb design task needs it.
### Acceptance Criteria
```gherkin
Feature: Migrate the rd3 Engineering Operations Pack to sp

  Scenario: Preserve the sp plugin architecture
    Given the current sp plugin follows Fat Skills, thin wrappers, and CLI-gated writes
    When rd3 engineering-operation content is migrated
    Then the migrated content lands as skill knowledge or references first
    And no deterministic validation or corpus-write logic is copied into plugin prose

  Scenario: Improve the execution loop without bloating the command surface
    Given sp already has `spur-dev`, `code-verification`, `spur-tdd`, and task/feature/workflow companion skills
    When the Engineering Operations Pack is integrated
    Then debugging, implementation, test-gap, advanced-test, and improvement guidance is reachable from the existing execution loop
    And no new slash command is added unless it passes ADR-016's non-deterministic-intent value test

  Scenario: Avoid reintroducing obsolete rd3 surfaces
    Given several rd3 skills are already absorbed or belong to the cc plugin
    When the migration plan is implemented
    Then absorbed execution surfaces such as tasks, feature-tree, orchestration, verification-chain, and run-acp are not copied
    And meta-agent authoring surfaces remain assigned to the cc plugin

  Scenario: Keep documentation and plugin inventory truthful
    Given plugins/README.md is the local plugin map
    When the batch updates sp plugin entities
    Then plugins/README.md reflects the current hook runtime and migrated skill set
    And stale references to the old CLAUDE_PLUGIN_ROOT/source-tree CLI hook behavior are removed or corrected
```

- [ ] `plugins/README.md` drift is fixed first, especially the hook section that still describes the old source-tree CLI lookup.
- [ ] `rd3:sys-debugging` is migrated or folded into `sp:spur-dev` as root-cause/debugging workflow guidance.
- [ ] `rd3:code-implement-common` is selectively folded into `sp:spur-dev` execution references.
- [ ] `rd3:sys-developing` contributes only concrete production patterns that belong in `sp:spur-dev/references/stacks/*` or adjacent execution docs.
- [ ] Remaining useful `rd3:sys-testing` content extends `sp:spur-dev/references/unit-testing.md` without duplicating `sp:spur-tdd`.
- [ ] `rd3:advanced-testing` is either added as a small standalone `sp:advanced-testing` skill or deferred with an explicit reason.
- [ ] `rd3:code-improvement` is added as a focused improvement/refactoring skill or folded into `sp:code-verification` with clear routing.
- [ ] No `cc` meta-authoring assets are migrated into `sp`.
- [ ] No new slash command is added by default; any exception documents the ADR-016 reason.
- [ ] `bun test plugins/sp` and `biome check plugins/sp` pass after migration.
### Design

Use a content-first migration, not a directory copy.

Target shape:

- Existing `sp:spur-dev` remains the primary execution workflow owner.
- Debugging, implementation, and test-gap guidance should be integrated as references under
  `sp:spur-dev` unless a standalone skill gives materially better routing.
- `sp:code-verification` remains the review/verification owner; `rd3:code-improvement` can either
  become a focused improvement skill or a clearly separated improvement mode/reference under that
  skill.
- `sp:spur-tdd` remains the test-design owner; migrated testing content must avoid duplicating its
  red-green-refactor guidance.
- Slash commands and agents remain unchanged unless a concrete workflow needs a new entry point.

Migration rule:

For each rd3 source section, decide whether it provides reusable engineering judgment, obsolete rd3
routing, deterministic behavior that belongs in Spur CLI, or meta-agent behavior that belongs in
`cc`. Only the reusable engineering judgment should move into `sp`.

### Plan
1. Audit and patch `plugins/README.md` so it matches the current `sp` plugin implementation.
   In particular, correct the hook description to the current `superskill hook run sp task-write-guard`
   runtime path and remove stale CLAUDE_PLUGIN_ROOT/source-tree CLI language.

2. Read the selected rd3 source skills and classify each section as one of:
   keep as-is, adapt into an existing `sp` skill, adapt into a new `sp` skill, defer, or reject.
   Do not copy whole rd3 files blindly; rd3 contains old routing assumptions and references to retired surfaces.

3. Integrate `rd3:sys-debugging` as the root-cause workflow for failed gates, failing tests,
   runtime defects, and unexpected behavior during the `sp:spur-dev` execution half.

4. Fold `rd3:code-implement-common` and selected `rd3:sys-developing` content into
   `sp:spur-dev` execution references, keeping the content stack-aware and avoiding generic boilerplate.

5. Extend the testing knowledge layer by merging non-duplicative `rd3:sys-testing` guidance into
   `sp:spur-dev/references/unit-testing.md` and deciding whether `rd3:advanced-testing` earns a
   small standalone `sp:advanced-testing` skill.

6. Add or fold `rd3:code-improvement` so `sp` has a clear path for architecture/refactoring
   improvement passes after review findings are handled.

7. Update plugin inventory, cross-links, and platform metadata for any added or changed skill.
   Keep commands and agents thin; add none unless the need is explicitly justified.

8. Verify with focused plugin checks:
   - `bun test plugins/sp`
   - `biome check plugins/sp`
   - targeted grep for stale `rd3:` routing, retired command names, and obsolete hook/runtime claims

9. Record follow-up deferrals for PM, research/context, token-saver, and cc/meta-tooling surfaces
   instead of leaving them as ambiguous migration leftovers.
### Solution
Implemented the Engineering Operations Pack migration as a content-first enhancement of existing `sp`
skills.

Changed plugin docs and skill routing:

- Updated `plugins/README.md:113` so the hook section describes the current
  `superskill hook run sp task-write-guard` runtime instead of the retired
  `CLAUDE_PLUGIN_ROOT` / source-tree CLI lookup path.
- Updated the migration inventory at `plugins/README.md:331` and `plugins/README.md:334` to mark
  the engineering operations assets as partially absorbed
  where they now live, and to explicitly reject `sp:super-pm` plus `/sp:prd-*` for now.
- Added `plugins/sp/skills/spur-dev/references/debugging.md:1` for root-cause-first debugging during
  failed gates, runtime defects, intermittent behavior, and unclear test failures.
- Added `plugins/sp/skills/spur-dev/references/implementation-patterns.md:1` for task-driven
  implementation discipline, stack-pattern selection, progress persistence, and handoff.
- Extended `plugins/sp/skills/spur-dev/references/unit-testing.md:191` with advanced testing
  escalation triggers for mutation testing, property-based testing, accessibility testing, and
  implementation comparison.
- Added `plugins/sp/skills/code-verification/references/code-improvement.md:1` and linked it from
  `sp:code-verification` at `plugins/sp/skills/code-verification/SKILL.md:125` so
  architecture/refactoring candidates are framed as follow-up work instead of expanding the current
  fix.
- Updated `sp:spur-tdd` at `plugins/sp/skills/spur-tdd/SKILL.md:77` to point
  algorithm/data-transform escalation at the `sp:spur-dev`
  unit-testing advanced techniques instead of legacy `rd3:advanced-testing`.

No new slash commands, agents, or deterministic validation surfaces were added. The migrated material
lands as reusable engineering judgment under the existing `sp:spur-dev`, `sp:spur-tdd`, and
`sp:code-verification` routing model.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| AC-1 | MET | Migrated content lands as skill references under existing owners: plugins/sp/skills/spur-dev/SKILL.md:158, plugins/sp/skills/code-verification/SKILL.md:125 |
| AC-2 | MET | Debugging, implementation, advanced testing, and improvement guidance are reachable from existing loop refs: plugins/sp/skills/spur-dev/references/debugging.md:1, plugins/sp/skills/spur-dev/references/implementation-patterns.md:1, plugins/sp/skills/spur-dev/references/unit-testing.md:191, plugins/sp/skills/code-verification/references/code-improvement.md:1 |
| AC-3 | MET | No new slash command or agent was added; README records no sp:super-pm or /sp:prd-* surface: plugins/README.md:331 |
| AC-4 | MET | Hook runtime documentation now uses superskill hook runtime and removes source-tree CLI behavior: plugins/README.md:113, plugins/README.md:127 |
| AC-5 | MET | Focused checks passed: biome check plugins/sp plugins/README.md; bun test plugins/sp |
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | biome | — | biome check plugins/sp plugins/README.md -> Checked 7 files. No fixes applied. |
| P4 | plugin-tests | — | bun test plugins/sp -> 65 pass, 0 fail. |
| P4 | stale-reference-search | — | No active rd3:advanced-testing/sys-debugging/code-improvement/product-management refs found; CLAUDE_PLUGIN_ROOT remains only in regression-test assertions. |
| P4 | secua | — | Docs/skill-reference migration only; no runtime security, API, or persistence behavior changed. |
### References
- `plugins/README.md` — current `sp` plugin architecture, migration map, and remaining workstreams.
- `/Users/robin/projects/cc-agents/plugins/rd3/` — legacy rd3 plugin source.
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/sys-debugging/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/code-implement-common/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/sys-developing/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/sys-testing/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/advanced-testing/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/code-improvement/SKILL.md`
- `plugins/sp/skills/spur-dev/SKILL.md`
- `plugins/sp/skills/spur-dev/references/unit-testing.md`
- `plugins/sp/skills/spur-tdd/SKILL.md`
- `plugins/sp/skills/code-verification/SKILL.md`
- `docs/plans/2026-06-10-rd3-migration-feature-list.md`
- `docs/00_ADR.md` — ADR-016 and ADR-023 decision constraints.
### History
- 2026-06-29T23:36:04.121Z backlog → todo (system)
- 2026-06-29T23:53:51.405Z todo → wip (system)
- 2026-06-29T23:54:35.128Z wip → testing (system)
- 2026-06-29T23:55:13.117Z testing → done (system)
