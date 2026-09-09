# AGENTS.md

Entry point for AI coding agents in this repository. Symlink `CLAUDE.md` / `GEMINI.md` (and
equivalents) here when the platform expects those names.

**Read this first every session.** Lean: harness routing + project facts + where depth lives.
Does **not** restate skill runbooks or the full `spur` / `superskill` verb catalogs.

---

## Project

<!-- PROJECT-SPECIFIC: filled by `spur init` (`{project-name}` / `{project-description}`). -->
**{project-name}** — {project-description}.

This project uses two complementary first-class harness tools:

- **Spur** — `spur` provides deterministic project corpus/ops; the `sp` agent surface
  (`/sp:dev-*` commands + `sp:*` subagents/skills) drives planning, execution, review, and docs
  hygiene.
- **Superskill** — `superskill` installs plugin capabilities across supported coding agents and
  manages the authoring and quality lifecycle for skills, commands, agents, hooks, and main-agent
  configs.

Prefer these entry surfaces over ad-hoc process unless the operator overrides for a one-off.

---

## Harness-first contract

All product development work goes through the harness by default.

### Harness tool routing

| Need | Route to | Avoid |
| ------ | ---------- | -------- |
| Plan a feature (intake → AC → tasks) | `/sp:dev-plan`, `/sp:dev-idea` | Freeform feature files without gates |
| Drive one task end-to-end | `/sp:dev-run <wbs>` or **`sp:super-planner`** | Implement with no task / no pipeline |
| Batch or parallel task runs | `/sp:dev-runall` (host sequential; **`sp:super-planner`** explicit/parallel), `/sp:dev-parallel` | Unordered multi-task thrash |
| Batch-refine tasks under a feature | `/sp:dev-refineall --feature <id> --auto` | Hand-looping `/sp:dev-refine` per WBS |
| Multi-step corpus CLI (tasks/features/rules/workflows) | **`sp:expert-spur`** | Raw Write/Edit on corpus files |
| Look up `spur` verbs / flags / `--json` | Skill **`sp:spur-cli`** | Inventing flags from memory |
| Create/edit/list tasks or features | **`spur task` / `spur feature`** (`--section --from-file`) | Direct-writing task/feature corpus files |
| Verify requirements / AC | `/sp:dev-verify` | Self-reported “done” |
| Review (SECUA + traceability + architecture) | `/sp:dev-review` or **`sp:super-reviewer`** | Unstructured “LGTM” |
| Tests / coverage | `/sp:dev-unit` | Untested production paths as done |
| Constraint gate / rule authoring | **`spur rule`**; `/sp:rule-scan`, `/sp:rule-add`, `/sp:rule-refine` | Skipping `spur rule run` |
| Workflow author / run | **`spur workflow`**; `/sp:workflow-add`, `/sp:workflow-refine` | Ad-hoc shell as the lifecycle |
| Docs drift / sync / lessons | Skill **`sp:doc-evolve`** + `docs/99_PROJECT_CONSTITUTION.md` | Patching derived docs over authority |
| Wrap completed work | `/sp:dev-wrap`, `/sp:dev-wrapall` | Skipping learnings / doc sync |
| Session index / memory | Skill **`sp:indexed-context`** + `.spur/context/` | Full-tree re-reads every turn |
| Install / sync a plugin across coding agents | **`superskill install <plugin>`** | Hand-copying per-platform adapters |
| Capability authoring / quality lifecycle | **`superskill <noun> --help`** (`agent`, `skill`, `command`, `hook`, `magent`) | Bypassing the noun's validation / evaluation gates |

**Non-negotiable (unless operator overrides):**

1. **CLI-gated corpus writes** — `spur task update` / `spur feature update` (etc.). Never direct-write
   task/feature corpus files.
2. **Gates before done** — `spur task check` / `spur feature check` / `spur rule run`; pipeline done
   needs a real verify **PASS**.
3. **`--json` for machines** — parse CLI with `--json`.
4. **Route, don’t invent** — verbs → `sp:spur-cli`; lifecycle → `/sp:dev-*` / `sp:super-planner`;
   multi-noun corpus → `sp:expert-spur`; review → `sp:super-reviewer`; docs process → `sp:doc-evolve`.
5. **Keep tool ownership explicit** — project lifecycle/corpus/gates → Spur; plugin installation and
   capability lifecycle → Superskill. Do not hand-maintain per-platform adapters Superskill generates.
6. **Run dev skills inline by default** — direct model-bearing `/sp:dev-*` commands execute in the
   current coding-agent session. Interactive `/sp:dev-run --mode full` and sequential
   `/sp:dev-runall` with omit/`--agent inline` interpret `task-pipeline.yaml` in-session; `--agent
   auto`, a name, parallel/headless execution, direct `spur agent run`, and engine-driven workflow
   `agent.run` remain subprocess surfaces.

**Task lookup fast path:** Given a WBS, do not search `docs/tasks*` or guess `--folder`. Use
`spur task show <wbs> --json` for task metadata and content; its response also includes `filePath`.
Use `spur task path <wbs> --json` only when a filesystem consumer needs the absolute path. Both
commands resolve across configured task folders. Reuse the first `show` response within the run.

**Corpus checks (constitution T10/T11):** checker-policy changes require one explicit unsuppressed
audit, recording/reconciling essential failures without waivers. Ordinary commit prep checks changed
task/feature documents and their required linked evidence, not the whole corpus. Do not regenerate
an acceptance baseline or insert audits into routine batch/wrapup loops.

**Platform fallback:** Platforms without slash commands and/or subagents still use the harness.
Install the plugin through Superskill for the target platform, then use skills `sp:spur-dev`,
`sp:spur-cli`, `sp:code-verification` (and related) plus the `spur` CLI. Do not invent a parallel
process because `/sp:dev-*` is unavailable.

Invoke CLI: `spur <noun> <verb> … --json` (or the project’s documented dev entry).

---

## Documentation

Read [the constitution](docs/99_PROJECT_CONSTITUTION.md) before key-document edits.
It owns document responsibilities and maintenance; `00` owns architectural choices,
`01` product scope, and root `DESIGN.md` UI/UX. Use **`sp:doc-evolve`** for drift,
sync and contract checks. Follow host/operator precedence.

### Doc map

| File | Owns | Update when |
| --- | --- | --- |
| `AGENTS.md` | ENTRY: orientation, commands, constraints, owner links | Essential repo facts or routing change |
| `DESIGN.md` | UI/UX: tokens, components, layout, interaction, accessibility | Shared UI design changes |
| `docs/00_ADR.md` | WHY: lasting architectural choices and tradeoffs | A meaningful cross-module boundary or invariant changes |
| `docs/01_PRD.md` | WHAT: vision, users, capability scope | Scope changes |
| `docs/02_ROADMAP.md` | WHEN: phases, dependencies, exits | Phase commitments or sequencing change |
| `docs/03_ARCHITECTURE.md` | HOW: current topology, data flow, runtime, invariants | Mechanisms or boundaries change |
| `docs/04_DESIGN.md` + `docs/design/` | SURFACE: index and non-UI contracts | CLI/API/config/schema or boundary behavior changes |
| `docs/05_FEATURES.md` + `docs/features/` | STATUS: entry to tool-owned feature records | Feature tool updates lifecycle/acceptance |
| `docs/99_PROJECT_CONSTITUTION.md` | PROCESS: stable document-governance metadata | Authorized responsibility, authority or maintenance correction |

**Placement guard:** feature approvals, task progress and test receipts do not belong in ADRs.
Preserve ADR numbers and decision history when condensing. Tasks own execution evidence;
existing context/learning storage owns lessons. Do not append either to the constitution.
A constitution edit needs a specific governance defect and operator-authorized scope (§6.8).
Update only owners whose facts changed; portable changes also update init templates.
Keep `04` an index and `05` a pointer to the generated feature index, without duplicate ledgers.

---

## Design system

**Conditional contract:** Read root `DESIGN.md` before UI work when present; otherwise use
established UI conventions. It owns visual and interaction design. Non-UI contracts belong in
`docs/04_DESIGN.md` and its satellites; system mechanisms belong in `docs/03_ARCHITECTURE.md`.

---

## Stack & layout

<!-- PROJECT-SPECIFIC: monorepo layout, package manager, key frameworks. -->
_(Fill from package manifests / README — or during `sp:doc-evolve` customize.)_

---

## Build & verification

<!-- PROJECT-SPECIFIC: lint / test / build commands. -->
```bash
# Fill with this project's lint, test, and build commands.
```

**Done gate (minimum):** lint + tests clean; only intentional `git status` changes; no
`--no-verify` / silent suppressions. Harness task done ⇒ real verify **PASS** when the pipeline ran.

---

## Spur CLI surface

**Not the verb catalog.** For `task` / `feature` / `rule` / `workflow` flags, exit codes, and
`--json` shapes → skill **`sp:spur-cli`**. Lifecycle → `/sp:dev-*` / **`sp:super-planner`**.
Multi-noun corpus campaigns → **`sp:expert-spur`**.

```bash
spur <noun> <verb> … --json
spur <noun> --help
```

**Long-tail:** Additional `/sp:dev-*` commands (handover, gitmsg, fixall, findconflict, dogfood, reverse, arch,
…) are indexed in the project plugin README (`plugins/sp/README.md` when present).

**Outside spur-cli:** Nouns not fully documented in `sp:spur-cli` (`agent`, `history`, `message`,
`team`, `status`, `migrate`, `serve`, `init`, …) — use only `spur <noun> --help` and
`docs/04_DESIGN.md`. Never guess flags.

---

## Superskill CLI surface

**Ownership boundary:** Superskill is the install-time portability and capability-quality plane;
Spur remains the project lifecycle and deterministic corpus/ops plane.

```bash
superskill install <plugin> --dry-run
superskill install <plugin> --targets <list>
superskill <agent|skill|command|hook|magent> --help
```

Use `superskill <noun> --help` for the current lifecycle verbs and flags. Do not duplicate its full
catalog here or maintain generated per-platform capability copies in the project.

---

## Conventions & boundaries

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, …); breaking changes in a
  `BREAKING CHANGE:` footer.
- Never commit secrets or `.env*`.
- Surgical changes only — no drive-by refactors or speculative abstractions.
- Surface changes update their owning design satellite (T3); feature changes use the feature tool (T4).
- **One writer per working tree.** Two agent sessions in one checkout overwrite each other silently
  — the symptom reads as a model regression. Parallel agent work uses git worktree isolation (one
  branch + one tree per agent).
- **Commit per task.** Start a task on a tree clean of other tasks' implementations; a dirty tree
  mixes two tasks' evidence into one diff. The pipeline precheck warns (never blocks) with the file
  list.
<!-- PROJECT-SPECIFIC: import aliases, forbidden paths, CI rules. -->

---

## Indexed context

Project context under `.spur/context/` (gitignored), via **`sp:indexed-context`**:

1. `anatomy.md` — file one-liners + token estimates  
2. `learnings.md` — conventions / decisions  
3. `pitfalls.md` — do-not-repeat  
4. `buglog.md` — historical bugs  
5. `memory.md` — session log  
6. `token-ledger.jsonl` — auto; never hand-edit  

If `.spur/context/` is absent, continue; do not block.
