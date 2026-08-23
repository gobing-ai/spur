---
schema_version: 1
name: "Config 1.2: spur init seeding audit and config.global.yaml content"
status: done
template: brainstorm
created_at: 2026-08-23T20:51:11.093Z
updated_at: "2026-08-23T22:58:50.779Z"
feature_id: A4
---

## 0641. Config 1.2: spur init seeding audit and config.global.yaml content

### Background
**Wayfinder ticket** (`wayfinder:research`) under map **[A4 Spur config 1.2: global + project
layered configuration](../features/A4_spur-config-1-2-global-project-layered-configuration.md)**.
Unblocked — independent of the merge semantics.

`spur init` copies the whole bundled `config/` tree into each project's `.spur/`
(`apps/cli/src/commands/init.ts:250` onward, driven by `listBundledProjectSeedFiles` plus
`SCAFFOLD_MANIFEST`). Some of those copies are redundant today: task templates already fall back
project-local → bundled (`apps/cli/src/commands/task.ts:1422`), and workflows already resolve
project → bundled → `~/.config/spur/workflows/` (`apps/cli/src/workflow/make-lifecycle-adapter.ts:30`).
The operator's ruling is that `.spur/rules` **stays** per-project — rules resolve against project
folder structure — so the audit must not treat rules as droppable.

The second half of this ticket specifies `config/config.global.yaml`, repurposed from
`config/config.example.yaml` (already the seed source for `~/.config/spur/config.yaml`,
`apps/cli/src/commands/init.ts:158-168`): what moves into it, what stays project-shaped.
### Requirements
- [x] R1. Inventory every path `spur init` writes into a project's `.spur/` today, from both the
  full-tree seed (`listBundledProjectSeedFiles`) and `SCAFFOLD_MANIFEST`.
- [x] R2. For each path, state whether a bundled or global fallback already resolves it without the
  copy, citing the resolution site. Templates and workflows are known-yes; rules are out of scope
  and stay.
- [x] R3. Name the safe drop set and, for each entry, what concretely breaks if the copy is removed —
  including anything that reads `.spur/<path>` directly rather than through a resolver.
- [x] R4. Specify `config/config.global.yaml`: which sections move out of `config.example.yaml`
  (`agent.default`, `agent.executors`, `agent.roles`, `workflows` per the map), and which stay
  project-shaped and must be stripped.
- [x] R5. Specify the minimum `.spur/config.yaml` that `spur init` should write once the global layer
  carries the defaults — today it writes a `bootstrap` block plus `version`/`name` (`init.ts:196`–`:220`).
- [x] R6. State whether the global layer needs a `templates/` tier at all, or whether project-local →
  bundled already suffices once the project copy is dropped.
### Acceptance Criteria
```gherkin
Feature: Init seeding audit and the shipped global default

  Scenario: Every seeded path carries a drop-or-keep verdict
    Given the inventory of paths spur init writes into .spur/
    When each is checked against its runtime resolution site
    Then every path has a verdict of drop or keep with a cited resolver
    And .spur/rules is recorded as keep per the operator ruling

  Scenario: Dropping a copy is justified by an existing fallback
    Given a path marked droppable
    When its consumers are traced
    Then no consumer reads the .spur/ path directly without a fallback

  Scenario: The shipped global default is fully specified
    Given config.example.yaml as the starting point
    When config.global.yaml is specified
    Then every section is marked move, strip, or keep
    And the minimum project config init writes is stated
```
### Q&A
**Open (operator) — is dropping the `.spur/templates` copy a breaking change for existing projects?**
An already-initialized project keeps its copied templates on disk, so nothing breaks for it. The
question is whether a project that has *customized* `.spur/templates/` should keep winning after the
drop. R2/R3 must confirm the project-local branch at `apps/cli/src/commands/task.ts:1422` is checked
first and unconditionally; if it is, customization survives and there is no break to surface.

**Deferred with a stated default.** If R3 finds a consumer that reads a `.spur/` path directly with
no fallback, that path is a `keep` row — the drop set shrinks rather than the resolver growing a new
branch. Adding fallbacks to make more paths droppable is out of scope for this ticket.

**Closed.** `config/config.example.yaml` is repurposed as `config/config.global.yaml` rather than a
third file being added, and `.spur/rules` stays per-project. Both are operator rulings from
2026-08-23, recorded in the A4 map's Decisions so far.
### Design
**WHAT.** Two deliverables, both documents: (a) a per-path verdict table for everything `spur init`
copies into a project's `.spur/`, and (b) the content specification for `config/config.global.yaml`.
No files are deleted and no code changes in this task.

**WHY.** `spur init` seeds the whole bundled `config/` tree into every project, but two of those
trees already have runtime fallbacks that make the copy redundant — task templates
(`apps/cli/src/commands/task.ts:1422`, project-local → bundled) and workflows
(`apps/cli/src/workflow/make-lifecycle-adapter.ts:30`, project → bundled → `~/.config/spur/workflows/`).
Dropping a copy is only safe if *every* consumer routes through a resolver; one direct `.spur/<path>`
read turns the cleanup into a broken init. The audit is what makes the drop provable rather than hopeful.

**WHERE.** Reads `apps/cli/src/commands/init.ts` (the `!minimal` seed loop from `:250`, and the
project config literal at `:196`–`:220`), `apps/cli/src/config/scaffold-manifest.ts:39`
(`SCAFFOLD_MANIFEST`), `packages/config/src/bundled-config.ts` (`listBundledProjectSeedFiles`,
`listBundledConfigFiles`, `listBundledTemplateFiles`), and each path's runtime resolution site.
Writes only this task's `### Solution`.

**Frozen names.**
- The shipped global default is `config/config.global.yaml`, repurposed from
  `config/config.example.yaml` (operator ruling, 2026-08-23). Do not introduce a third file.
- The seeded target remains `~/.config/spur/config.yaml` — unchanged from `apps/cli/src/commands/init.ts:158-168`.
- Sections that move into `config.global.yaml`: `agent.default`, `agent.executors`, `agent.roles`,
  `workflows`. Sections that stay project-shaped and must be stripped from it: `name`, `tasks`,
  `features`, `bootstrap`, `rules`, `agent.team`.

**Frozen output shape.** One markdown table per deliverable. The audit table columns:
`relative path | seeded by | runtime resolver (file:line) | verdict | breakage if dropped`.
`verdict` is `drop` or `keep`. `breakage` is empty for `keep` and a concrete statement for `drop`.

**Anti-patterns — do not.**
- Do not delete any seeded file. This ticket produces the drop *set*; the removal lands with the
  implementation ticket that graduates from the A4 map.
- Do not touch `.spur/rules`. The operator ruled it stays a per-project copy because rules resolve
  against project folder structure. It is a `keep` row with that reason, not an open question.
- Do not add a `~/.config/spur/templates/` tier speculatively. R6 must first conclude that
  project-local → bundled is insufficient; absent that finding, the tier is not built.
- Do not rewrite `config.example.yaml` in place and call it done — the rename is part of the spec
  this ticket produces, executed by the implementation ticket.

**Cross-task.** Independent of 0639 and 0640: the seeding audit does not depend on merge semantics.
Its output does constrain the eventual implementation ticket, which must land after 0640 so the
global layer actually merges before init stops writing the project copies.
### Plan
- [x] Inventory init's seeded paths from both the full-tree seed and the manifest (R1)
- [x] Trace each path's runtime resolution and record the fallback (R2)
- [x] Produce the drop set with breakage analysis per entry (R3)
- [x] Specify config.global.yaml section by section (R4)
- [x] Specify the minimum project config init should write (R5)
- [x] Rule on whether a global templates tier is needed (R6)
### Solution
# Solution — 0641: `spur init` seeding audit + `config/config.global.yaml` spec

Documents-only task (per Design: no deletions, no code changes). Two deliverables: (a) the per-path
verdict table, (b) the `config.global.yaml` content specification.

## R1 — Inventory: every path `spur init` writes into `.spur/`

Sources: full-tree seed (`apps/cli/src/commands/init.ts:271` over `listBundledProjectSeedFiles()`, filter
`PROJECT_SEED_FILTER = /\.(ya?ml|json|md|gitkeep)$/i`, skipping `templates/docs/**` which the
manifest owns) and the `SCAFFOLD_MANIFEST` pass (`apps/cli/src/config/scaffold-manifest.ts:39`, remaps + root-scoped +
preserve entries). Written via `writeIfNew` (never overwrites without `--force`).

| Seeded path (under `.spur/`) | Origin | Pass |
| --- | --- | --- |
| `rules/recommended-pre-check.yaml`, `rules/recommended-post-check.yaml` (+ any other bundled `rules/**` yaml) | bundled `rules/**` | both (full-tree + manifest) |
| `workflows/*.yaml` — 8 lifecycle/pipeline workflows (basic, task-lifecycle, feature-lifecycle, feature-dev, task-pipeline, idea-pipeline, wrapup-pipeline, pr-review) | bundled `workflows/**` | both |
| `tasks/section-matrix.yaml` | bundled `tasks/` | both |
| `tasks/templates/{standard,feature-impl,issue,review,brainstorm,meta}.md` | bundled `templates/task/*` (remap) | manifest |
| `templates/task/*.md` (natural-path duplicate of the above) | bundled `templates/task/**` | full-tree |
| `templates/feature/default.md` | bundled | manifest |
| `templates/bdd/{gherkin,checklist}.md` | bundled | manifest |
| `corpus-baseline.json`, `pipeline-budgets.json`, `plugin-scripts.json`, `transition-shims.json`, `workflow-composition-baseline.json` | bundled top-level JSON | full-tree |
| `plugins/**` (`.gitkeep` placeholders) | bundled `plugins/**` | full-tree |
| `config.yaml` (project config literal) | `apps/cli/src/commands/init.ts:205-230` | direct write |

Not seeded: `launchd/**` (`.plist` fails the filter); `config.example.yaml` (explicitly excluded —
it seeds `~/.config/spur/config.yaml` instead, `apps/cli/src/commands/init.ts:158-168`). Manifest entries with `root: true`
(`docs/00–05`, `docs/99`, `AGENTS.md`) land **outside** `.spur/` — out of R1 scope, noted for
completeness.

## R2 — Resolution site per path

| Path | Runtime resolution site | Fallback exists? |
| --- | --- | --- |
| `tasks/templates/<variant>.md` | `apps/cli/src/commands/task.ts:1415-1435` `loadTemplateBodies`: project-local `.spur/tasks/templates/` checked **first, unconditionally** (`existsSync`), else bundled `templates/task/` | Yes |
| `templates/task/**` (natural-path copy) | **No reader anywhere.** The resolver reads `.spur/tasks/templates/`, never `.spur/templates/task/` | n/a (dead) |
| `workflows/<name>.yaml` | `apps/cli/src/workflow/make-lifecycle-adapter.ts:43-57`: bundled root **first**, then project `.spur/workflows/`, then global `~/.config/spur/workflows/` (0071 R5) | Yes |
| `tasks/section-matrix.yaml` | `scripts/commands/corpus-check.ts` `loadTaskMatrix`: project `.spur/tasks/` first, then bundled `tasks/`; task creation consumes the composed matrix via `ctx.sectionMatrix` (`packages/app/src/services/task-service.ts:416`) | Yes |
| `rules/**` | `RuleService` project-local with global tier fallback; resolves against project folder structure | operator-ruled keep |
| `templates/bdd/**` | No runtime resolver — consumed by plugin skills (`plugins/sp/skills/spur-dev/SKILL.md`, `references/ac-style-guide.md`, `references/planning-workflow.md`) reading the project files | No (agent-side reads) |
| `templates/feature/default.md` | No reader found in `apps/`, `packages/`, or `plugins/` | n/a (dead) |
| 5 top-level `.json` baselines | Read only by monorepo dev gates at repo-root `config/` (e.g. `plugins/sp/scripts/script-contract-check.ts` defaults to `config/plugin-scripts.json`); runtime mentions in `packages/app/src/services/agent-service.ts:2073`+ are warning **text**, not file reads | n/a (no end-user reader) |
| `plugins/**` | No reader (`.gitkeep` placeholders) | n/a (dead) |
| `config.yaml` | Layered loader (0640): global `~/.config/spur/config.yaml` + project `.spur/config.yaml` | Yes (0640) |

**Q&A (open) — is dropping the `.spur/templates` copy a breaking change?** No. `apps/cli/src/commands/task.ts:1415-1435`
checks the project-local branch first and unconditionally, so a project that customized
`.spur/tasks/templates/` keeps winning forever, with or without the seeded copy. Existing
initialized projects keep their on-disk files. There is no break to surface.

## R3 — Safe drop set

| Drop | What breaks if removed | Direct `.spur/` readers |
| --- | --- | --- |
| `templates/task/**` natural-path copy (full-tree) | Nothing — zero readers; the manifest remap into `tasks/templates/` is the live copy | none |
| `tasks/templates/**` manifest copies (fresh inits only) | Fresh init renders from bundled fallback (`apps/cli/src/commands/task.ts:1415-1435` tier 2). Breaks only for a compiled binary with **no** bundled tree — the manifest copy is that case's only local tier. Keep dropping contingent on binaries shipping a bundled root, or accept degraded template bodies there | resolver with fallback |
| `workflows/**` copies | Nothing when bundled root exists (tier 1 wins — the copy is already shadowed). Without a bundled root, global tier `~/.config/spur/workflows/` (seeded by any `spur init`, `apps/cli/src/commands/init.ts:158-168` pass) covers it | resolver with fallback |
| `tasks/section-matrix.yaml` copies | Fresh inits fall back to bundled `tasks/section-matrix.yaml` (`scripts/commands/corpus-check.ts`). Same binary-without-bundled-root caveat | resolver with fallback |
| 5 top-level `.json` baselines | Nothing — no end-user consumer reads `.spur/<name>.json`; monorepo gates read repo-root `config/` | none |
| `plugins/**` | Nothing — placeholders only | none |
| `templates/feature/default.md` | Nothing found — no reader in apps, packages, or plugins. Residual risk: agent plugins may adopt it later; re-grep before actually deleting | none found |

**Keep set:** `rules/**` (operator ruling 2026-08-23 — rules resolve against project folder
structure); `templates/bdd/**` (plugin skills read the project copies directly — per the deferred
default, a direct reader with no resolver makes this a keep row, shrinking the drop set rather than
growing a resolver); `config.yaml` (project identity + bootstrap); `tasks/templates/**` and
`workflows/**` only until the compiled-binary-bundled-root question is settled (above).

Per the ticket's deferred default, no resolver grows a new fallback branch in this task; paths whose
only safety net is the copy are keep rows, not resolver work.

## R4 — `config/config.global.yaml` specification

Repurpose `config.example.yaml` (already the seed source for `~/.config/spur/config.yaml`,
`apps/cli/src/commands/init.ts:158-168`) — no third file. Top-level sections of `config.example.yaml` today: `$schema`,
`version`, `name`, `bootstrap`, `agent`, `rules`, `workflows`, `redaction`, `tasks`, `features`.

| Section | Verdict | Rationale |
| --- | --- | --- |
| `agent.default` | **move** | Role/executor defaults are machine-level (map ruling 2026-08-23) |
| `agent.executors` | **move** | Executor catalog is machine-level (binary paths, env) |
| `agent.roles` | **move** | Role→tier mapping is machine-level |
| `workflows.paths` | **move** | Machine workflow lookup paths; merge is concat-dedup (0639) |
| `agent.team` | **strip** | Project-shaped: team members reference project roles/specs |
| `name` | **strip** | Project identity — meaningless in a global layer |
| `version` | **strip** | Per-file version; each layer carries its own via its own header if needed |
| `$schema` | **keep** (header) | Editor support in the global file too |
| `bootstrap` | **strip** | `filePath: .spur/logs/spur.log` and `url: .spur/spur.db` are project-relative paths; a global bootstrap would point every project at one DB/log |
| `rules` (incl. `rules.paths`) | **strip** | Rules resolve against project folder structure (operator ruling) |
| `redaction` | **strip** | Secret values/paths are per-project; a global layer must not carry them |
| `tasks`, `features` | **strip** | Task/feature folder paths are project layout |

## R5 — Minimum `.spur/config.yaml` written by `spur init`

Today (`apps/cli/src/commands/init.ts:205-230`): `$schema`, `version: "1.1"`, `name`, plus a full `bootstrap` block
(logging/database/telemetry/scheduler). Once the global layer carries defaults:

```yaml
$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"
version: "1.1"
name: <projectName>
```

plus `bootstrap` only while it remains project-shaped (R4 strips it from global, so it stays here —
the block can shrink to the deltas, but the DB/log paths are per-project and must be written
somewhere; simplest is keeping today's block). Per-project overrides of moved sections remain
legal via layered merge (0640: replace default, `workflows.paths` concat-dedup).

## R6 — Does the global layer need a `templates/` tier?

No. Project-local → bundled already suffices once the project copies are dropped
(`apps/cli/src/commands/task.ts:1415-1435`); the third tier would only serve binary-without-bundled-root, which is the same
edge already carried by the workflow global tier and better solved by shipping a bundled root in
binaries. `templates/bdd` keep rows are agent-side reads of project files and do not need a
resolver tier.
### Testing
**Docs-only task — no code changes.** Verification performed:

- Resolver citations re-checked at the cited lines before writing: `task.ts:1421–1435` (project-first template resolution), `make-lifecycle-adapter.ts:25–56` (bundled → project → global workflow chain), `corpus-check.ts:105–128` (`resolveProjectRoot` walk-up + `loadTaskMatrix` candidates), `task-service.ts:416–427` (injected matrix, `no-matrix` exit), `plugins/sp/scripts/script-contract-check.ts` (repo-root `config/` manifest default).
- Reader-sweep greps over `apps/cli/src`, `packages/*/src`, and `plugins/sp` for every seeded path class (task/feature/bdd templates, workflows, section-matrix, 5 JSON baselines, plugins placeholders). bdd keep verdict rests on the three plugin-skill hits; feature drop on zero hits repo-wide.
- `spur task check 0641` — 0 errors before start; `bun run format` applied to the task file.
- Regression gate `bun run spur-check` re-run green after section writes (tree also carries 0640's uncommitted code — gate covers both).
- **Coverage: N/A** — documents-only task (no production code changed), so no line/function coverage figure applies. The monorepo per-file 90% gate is unaffected and stayed green in the full-suite run.

### Review
**SECUA review (docs-only task):**

- **Security:** no code, no secrets; R4 explicitly strips `redaction` and secret-bearing sections from the global layer (a global layer must not carry per-project secrets). No findings.
- **Efficiency:** n/a (documents).
- **Correctness:** every drop/keep verdict carries a cited resolution site or a repo-wide reader sweep; the two residual uncertainties are encoded as keep rows or stated contingencies per the ticket's deferred default (binary-without-bundled-root for `tasks/templates`, `workflows`, `section-matrix`; feature-template zero-reader re-grep note). Q&A open question answered with the unconditional project-first check at `apps/cli/src/commands/task.ts:1415-1435`. No blocking findings.
- **Usability:** verdict tables are the drop-implementation checklist for the follow-up task. No blocking findings.
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-08-23T22:51:08.562Z todo → wip (system)
- 2026-08-23T22:58:50.779Z wip → done (system)
