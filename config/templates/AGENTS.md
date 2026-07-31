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
| Batch or parallel task runs | `/sp:dev-runall`, `/sp:dev-parallel` → **`sp:super-planner`** | Unordered multi-task thrash |
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

**Platform fallback:** Platforms without slash commands and/or subagents still use the harness.
Install the plugin through Superskill for the target platform, then use skills `sp:spur-dev`,
`sp:spur-cli`, `sp:code-verification` (and related) plus the `spur` CLI. Do not invent a parallel
process because `/sp:dev-*` is unavailable.

Invoke CLI: `spur <noun> <verb> … --json` (or the project’s documented dev entry).

---

## Documentation

**Process SSOT:** `docs/99_PROJECT_CONSTITUTION.md`. Operate with **`sp:doc-evolve`**
(`drift-audit`, `sync-check`, `contract-verify`, `lesson-append`).

**Conflict rule:** lower number wins on content (`00` decisions, `01` scope, `99` process). Fix
authority first, then derived docs, then this file.

### Doc map

| Doc | Owns | Authority | When |
| ------ | ------ | ----------- | ------ |
| `docs/00_ADR.md` | **WHY** | Authoritative (content) | Structural change; dated entry before diverging |
| `docs/01_PRD.md` | **WHAT** | Authoritative on scope | New feature/command |
| `docs/02_ROADMAP.md` | **WHEN** | Derived | Phase placement |
| `docs/03_ARCHITECTURE.md` | **HOW** | Derived (ADR wins) | Cross-module / seam / schema |
| `docs/04_DESIGN.md` | **SURFACE** (+ `docs/design/`) | Derived | Same commit as surface code (T3) |
| `docs/05_FEATURES.md` | **STATUS** (+ `docs/features/`) | Derived | Feature status (T4) |
| `docs/99_PROJECT_CONSTITUTION.md` | **PROCESS** | Authoritative on process | Before editing numbered docs |
| `AGENTS.md` (this file) | **ENTRY** | Derived | First every session |

**Routing:** decision → `00`; scope → `01`; mechanism → `03`; surface → `04`; phase → `02`;
feature status → `05`. Working-layer, audit, and satellite rules live in the project constitution.

---

## Design system

**Conditional contract:** If repository-root `DESIGN.md` exists, read it before planning or
implementing any change to UI, styling, interaction, accessibility, or responsive behavior. Treat
it as the project source of truth for visual and interaction design — tokens, components, patterns,
and UX constraints — and keep affected work consistent with it. If it is absent, continue with the
project's established UI conventions.

Root `DESIGN.md` owns UI/UX guidance; `docs/04_DESIGN.md` still owns command, config, schema, and DTO
surface shapes under the doc map above.

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

**Long-tail:** Additional `/sp:dev-*` commands (handover, gitmsg, fixall, dogfood, reverse, arch,
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
- Surface changes keep `docs/04_DESIGN.md` in the **same commit** (T3); run `sp:doc-evolve`
  sync-check when unsure.
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
