---
schema_version: 1
name: "fix configuration confusing"
status: backlog
template: standard
created_at: 2026-07-06T18:19:13.523Z
updated_at: "2026-07-06T19:04:25.345Z"
---

## 0217. fix configuration confusing

### Background

As the source code of `spur`, we use folder `config` to store configuration files as the default configuration files. That's also the folder we used to publish to the npm registry.

Meanwhile, this project is also a place to apply `spur` as the harness tool to help to ensure the quality of the codebase. That's why we need its runtime configuration in folder `.spur`.

To avoid duplication and avoid conflicts, we already added symbolic links to `.spur/plugins`, `.spur/rules`, `.spur/tasks`, `.spur/templates`, and `.spur/workflows` to make them point to the relevant subfolder under `config`. You can check with command `ls -l` to see the symbolic links.

But as we can see, with the source code in `apps`, `packages` or `plugins/sp`, we mixed them together and used come inconsistently. For example, I just checked with `plugins/sp` via the following command:

```bash
rg -l 'config/plugins' plugins/sp
rg -l 'config/rules' plugins/sp
rg -l 'config/tasks' plugins/sp
rg -l 'config/templates' plugins/sp
rg -l 'config/workflows' plugins/sp
```

Then I got the following results:

```
plugins/sp/commands/spur-init.md
plugins/sp/skills/spur-dev/references/planning-workflow.md
plugins/sp/skills/spec-decomposition/references/decomposition.md
plugins/sp/skills/spur-cli/references/tasks/verbs.md
plugins/sp/skills/spur-dev/SKILL.md
plugins/sp/skills/spur-dev/references/planning-workflow.md
plugins/sp/skills/spur-dev/references/ac-style-guide.md
plugins/sp/skills/spec-decomposition/references/decomposition.md
plugins/sp/commands/dev-brainstorm.md
plugins/sp/skills/spur-dev/SKILL.md
plugins/sp/skills/spur-dev/references/execution-workflow.md
plugins/sp/skills/spur-dev/references/execution-batch.md
plugins/sp/skills/spur-dev/references/dev-operations.md
plugins/sp/skills/code-verification/SKILL.md
plugins/sp/README.md
plugins/sp/skills/code-verification/references/verdict-schema.md
plugins/sp/agents/super-coder.md
plugins/sp/commands/workflow-add.md
plugins/sp/commands/dev-run.md
plugins/sp/skills/spur-cli/references/workflows/operations.md
plugins/sp/commands/dev-runall.md
plugins/sp/skills/spur-cli/references/workflows.md
```

I did not check with `apps` and `packages` right now, I guess they are also having configuration files in `config` folder. That gets all the configuration files incorrectly for all plugin `sp` or `spur` CLI commands. Especially, we have issues with `plugins/sp/commands/spur-init.md`, that means all new project try to use `spur` via `/sp:spur-init` to bring the issues into the new project. We must fix this issue to avoid confusion.

### Requirements
- [ ] R1. All `plugins/sp/` files that reference `config/plugins`, `config/rules`, `config/tasks`, `config/templates`, or `config/workflows` are updated to reference their `.spur/` equivalents — so agent instructions teach the correct runtime convention.
- [ ] R2. `apps/` and `packages/` source files are audited for `config/` path references. Runtime path references are updated to `.spur/`; build-time bundling references (per ADR-015) are left unchanged.
- [ ] R3. A new ADR entry clarifies the separation: `config/` = build-time default assets shipped in the CLI bundle; `.spur/` = runtime configuration directory. Agent-facing instructions and runtime code MUST reference `.spur/` paths.
- [ ] R4. `plugins/sp/commands/spur-init.md` no longer propagates `config/` paths — `/sp:spur-init` must instruct agents to reference `.spur/` for rules, workflows, tasks, templates, and plugins.
- [ ] R5. No functional regressions: `bun run check` and `bun run test` pass; `spur init` creates a correct `.spur/` structure referencing `.spur/` paths.
### Acceptance Criteria
- [ ] R1. After fix, zero files in `plugins/sp/` contain `config/plugins`, `config/rules`, `config/tasks`, `config/templates`, or `config/workflows` as path references.
- [ ] R2. `apps/` and `packages/` source files contain only build-time `config/` references (bundling, JSDoc describing asset layout). No runtime path uses `config/`.
- [ ] R3. `docs/00_ADR.md` contains a dated entry documenting the `config/` (build-time) vs `.spur/` (runtime) separation, with a one-line rationale.
- [ ] R4. `plugins/sp/commands/spur-init.md` references only `.spur/` paths — `rg 'config/(plugins|rules|tasks|templates|workflows)' plugins/sp/commands/spur-init.md` returns zero matches.
- [ ] R5. `bun run check` exits 0; `bun run test` exits 0; a manual `spur init --minimal --force` smoke test creates a project with correct `.spur/` conventions.
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Chosen approach:** Keep `config/` as build-time SSOT (per ADR-015), update all runtime and agent-instruction references to use `.spur/` paths. Rationale: surgical fix with zero structural change to the build pipeline.

**Rejected alternative:** Move everything from `config/` to `.spur/`. Rejected because: (a) contradicts ADR-015 which makes `config/` the single source of truth for bundled defaults; (b) requires build pipeline and release process changes; (c) `.spur/` in user projects is typically gitignored, but the Spur repo's config assets must be committed.

**Path replacement map** (22 files in `plugins/sp/`, TBD count in `apps/` + `packages/`):
- `config/plugins` → `.spur/plugins`
- `config/rules` → `.spur/rules`
- `config/tasks` → `.spur/tasks`
- `config/templates` → `.spur/templates`
- `config/workflows` → `.spur/workflows`

**Invariants:**
- No symlink changes — `.spur/` → `config/` symlinks remain for the Spur project's own `spur` CLI use.
- No build pipeline changes — `apps/cli` still bundles from `config/`.
- `config/config.example.yaml` is NOT moved — it's a build-time asset, not a runtime path.

**ADR entry:** Appended to ADR-015, dated 2026-07-06, clarifying the build-time vs runtime path convention.
### Plan
1. Add ADR entry to `docs/00_ADR.md` clarifying `config/` (build-time) vs `.spur/` (runtime) separation.
2. Audit `apps/` and `packages/` `config/` references: classify each as build-time (keep) or runtime (fix).
3. Update all `plugins/sp/` files: replace `config/plugins`, `config/rules`, `config/tasks`, `config/templates`, `config/workflows` with `.spur/` equivalents.
4. Update runtime `config/` references in `apps/` and `packages/` (skip build-time bundling references).
5. Run `bun run check` → fix any failures.
6. Run `bun run test` → fix any failures.
7. Smoke test: `spur init --minimal --force /tmp/spur-test-0217` and verify `.spur/` structure.
### Solution

<!-- Change map — HOW/WHERE. A `file:line` table of every touched site, one sentence each; ≤8-line snippets only for non-obvious logic. NO full-function dumps. (Filled at `wip`/`testing`.) -->

### Testing

<!-- Test results + a numeric coverage claim, or explicit `N/A`. (Filled at `testing`.) -->

### Review

<!-- P1–P4 findings table (Severity / File / Finding / Recommendation). (Filled at `done`.) -->

### History
