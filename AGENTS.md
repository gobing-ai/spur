# AGENTS.md

Entry point for AI coding agents. `CLAUDE.md` and `GEMINI.md` symlink here.

**Read first every session.** This file contains harness routing, project facts, and pointers to
deeper owners. It does not restate skill runbooks or full CLI catalogs.

---

## Project

**Spur** — local-first harness toolkit for mainstream coding agents (Claude Code, Codex, Gemini CLI,
pi, omp, OpenCode, Antigravity, OpenClaw, Hermes, Grok). Spur is not a coding agent or BYOK LLM
platform: it wraps installed agents with constraints, workflows, planning, history analytics,
coordination, and operations visibility.

Use the complementary harness pair:

- **Spur:** project lifecycle, deterministic corpus/ops, `/sp:dev-*`, and `sp:*` skills/subagents.
- **Superskill:** cross-agent plugin installation and capability authoring/quality lifecycle.

---

## Harness-first contract

All product work goes through the harness unless the operator explicitly overrides.

### Harness tool routing

| Need | Route to | Avoid |
| --- | --- | --- |
| Plan a feature (intake → AC → tasks) | `/sp:dev-plan`, `/sp:dev-idea` | Freeform feature files without gates |
| Drive one task end-to-end | `/sp:dev-run <wbs>` or **`sp:super-planner`** | Implement with no task/pipeline |
| Batch or parallel task runs | `/sp:dev-runall`, `/sp:dev-parallel`, **`sp:super-planner`** | Unordered multi-task work |
| Batch-refine tasks under a feature | `/sp:dev-refineall --feature <id> --auto` | Hand-looping task refinement |
| Multi-step corpus CLI (tasks/features/rules/workflows) | **`sp:expert-spur`** | Raw corpus writes |
| Look up `spur` verbs / flags / `--json` | Skill **`sp:spur-cli`** | Inventing flags |
| Create/edit/list tasks or features | **`spur task` / `spur feature`** | Direct-writing corpus files |
| Verify requirements / AC | `/sp:dev-verify` | Self-reported done |
| Review (SECUA + traceability + architecture) | `/sp:dev-review` or **`sp:super-reviewer`** | Unstructured LGTM |
| Tests / coverage | `/sp:dev-unit` | Untested production paths |
| Constraint gate / rule authoring | `spur rule`; `/sp:rule-scan`, `/sp:rule-add`, `/sp:rule-refine` | Skipping `spur rule run` |
| Workflow author / run | `spur workflow`; `/sp:workflow-add`, `/sp:workflow-refine` | Ad-hoc shell lifecycle |
| Docs drift / sync / lessons | **`sp:doc-evolve`** + `docs/99_PROJECT_CONSTITUTION.md` | Patching derived docs over authority |
| Wrap completed work | `/sp:dev-wrap`, `/sp:dev-wrapall` | Skipping learnings/doc sync |
| Session index / memory | **`sp:indexed-context`** + `.spur/context/` | Full-tree rereads |
| Install / sync a plugin across coding agents | `superskill install <plugin>` | Hand-copying adapters |
| Capability authoring / quality lifecycle | `superskill <noun> --help` | Bypassing lifecycle gates |

**Non-negotiable unless the operator overrides:**

1. **CLI-gated corpus writes:** task/feature writes go through `spur task` / `spur feature`; never
   raw Edit/Write.
2. Done requires the applicable structural gates and a real verify **PASS** when a pipeline ran.
3. Parse CLI output with `--json`; do not scrape human output.
4. Route verbs to `sp:spur-cli`, lifecycle to `/sp:dev-*`, multi-noun corpus work to
   `sp:expert-spur`, review to `sp:super-reviewer`, and docs process to `sp:doc-evolve`.
5. Spur owns project lifecycle/corpus/gates; Superskill owns plugin installation and generated
   per-platform capability adapters.
6. Direct model-bearing `/sp:dev-*` commands run inline by default. Explicit/automatic executors,
   parallel/headless runs, `spur agent run`, and workflow `agent.run` are subprocess surfaces.

**Task lookup:** `spur task show <wbs> --json` returns metadata, content, and `filePath`; use
`spur task path <wbs> --json` only for filesystem consumers. Do not search task folders or guess
`--folder`.

**Platform fallback:** When slash commands/subagents are unavailable, use skills `sp:spur-dev`,
`sp:spur-cli`, `sp:code-verification`, and the `spur` CLI after installing the plugin through
Superskill. Do not invent a parallel process.

Invoke the monorepo CLI with `spur …` when linked, otherwise:

```bash
bun run apps/cli/src/index.ts <noun> <verb> … --json
```

---

## Documentation

**Process SSOT:** `docs/99_PROJECT_CONSTITUTION.md`. Use **`sp:doc-evolve`** for drift audits,
sync checks, contract verification, and lessons.

**Conflict rule:** `00` wins decisions, `01` wins scope, and `99` wins process. Repair authority
first, then derived docs, then this file.

### Doc map

| Doc | Owns | Authority | Read/edit when |
| --- | --- | --- | --- |
| `docs/00_ADR.md` | **WHY** | Authoritative content | Structural decision; dated entry before divergence |
| `docs/01_PRD.md` | **WHAT** | Authoritative scope | Scope changes |
| `docs/02_ROADMAP.md` | **WHEN** | Derived | Phase placement/status |
| `docs/03_ARCHITECTURE.md` | **HOW** | Derived; ADR wins | Cross-module, seam, schema |
| `docs/04_DESIGN.md` + `docs/design/` | **SURFACE** | Derived | Commands, flags, config, DTOs, system boundaries |
| `docs/05_FEATURES.md` + `docs/features/` | **STATUS** | Derived/tool-owned | Feature state |
| `docs/99_PROJECT_CONSTITUTION.md` | **PROCESS** | Authoritative process | Before numbered-doc edits |
| `AGENTS.md` | **ENTRY** | Derived | First every session |

Routing: decision → `00`; scope → `01`; mechanism → `03`; surface → `04`; phase → `02`; feature
status → `05`. Working layers, satellites, edit rules, and audit protocol live in `99`.

---

## Design system

**Conditional contract:** If root `DESIGN.md` exists, it is the UI/UX SSOT for visual language,
tokens, typography, components, layout, motion, accessibility, and responsive behavior. Read it
before UI work; otherwise follow established project conventions.

`DESIGN.md` owns visual design. `docs/04_DESIGN.md` owns non-UI surfaces such as command signatures,
config schemas, DTOs, and system boundaries.

---

## Stack & layout

Bun + TypeScript + Biome monorepo using Bun workspaces; no Turborepo:

```text
apps/cli       commander transport
apps/server    Hono / Cloudflare Worker; oRPC OpenAPI
apps/web       Astro + Cloudflare; typed oRPC client
packages/app   application services
packages/contracts  transport DTOs only
packages/config     Zod config/environment
packages/domain     DAOs/schema/analytics; sole ts-db consumer
plugins/sp     harness commands, subagents, skills, hooks
config         tracked rules/workflows/templates and contract baselines
drizzle        active CLI migrations; _legacy_reference is inert
docs           authority docs, satellites, plans, reports, tool-owned corpus
```

Apps are thin transports; application logic lives in `packages/app` (ADR-021). Cross-workspace
imports use `@gobing-ai/*`, never deep relative paths. Reusable engines are released
`@gobing-ai/ts-*` packages; fix their facades instead of adding Spur workarounds.

- Runtime: Bun `1.3.14`; prefer `bun:*` over `node:*`.
- Format/lint: Biome `2.4.16`; 4 spaces, 120 columns, single quotes, semicolons, trailing commas.
- Objects use `interface`; unions/intersections use `type`; `any` is an error.
- Shared workspace dependencies use root `workspaces.catalog` + `"catalog:"`.
- Workflow YAML SSOT is `config/workflows/`; `apps/cli/config/` is generated by `build:bundle`.
- Database migrations use the next four-digit prefix; never activate `drizzle/_legacy_reference/`.

Architecture depth: `docs/03_ARCHITECTURE.md`. Concrete surfaces: `docs/04_DESIGN.md` and
`docs/design/`.

---

## Build & verification

```bash
bun run autofix
bun run spur-check       # fast comprehensive gate
bun run lint
bun run test
bun run test-cf
bun run build
bun run corpus-check     # once at commit prep when task/feature corpus changed
git status --short
```

`spur-check-new` is `spur-check` plus the corpus sweep. Iterate with targeted tests and
`spur task check <wbs>`; run the corpus sweep once, not per edit. Never use `--no-verify` or silent
suppressions to force green.

Targeted-test loop — run from **inside the workspace**, never the repo root (task 0699 R4):

```bash
cd apps/cli && bun test tests/output-envelope.test.ts --test-name-pattern "wraps a payload"  # exit 0 on pass
```

The workspace's `bunfig.toml` supplies the test preload and carries no repo-wide coverage
denominator; a single-file run from the repo root is scored against the whole-repo coverage
threshold and exits 1 even when the test passes. Coverage is measured and enforced by the root
`bunfig.toml` at the `bun run test` gate. Tests live under
`<workspace>/tests/**/*.test.ts`; use in-memory SQLite for DAO tests. Test requirements, not getters
or implementation details.

For local CLI source changes, link and rebuild the bundled entry:

```bash
cd apps/cli && bun link
bun run --filter @gobing-ai/spur build:bundle
```

Real-data history validation must use the source-local CLI (`bun run apps/cli/src/index.ts …` or
`apps/cli/spur.js`), never a potentially stale global `spur`. Record the command's binary/importer
provenance before dry-run and write validation. Details: `docs/04_DESIGN.md` history surfaces.

---

## Spur CLI surface

**Not the verb catalog.** Task/feature/rule/workflow shapes belong to **`sp:spur-cli`**; lifecycle
belongs to `/sp:dev-*`; multi-noun corpus campaigns belong to **`sp:expert-spur`**.

```bash
spur <noun> <verb> … --json
bun run apps/cli/src/index.ts <noun> <verb> … --json
spur <noun> --help
```

**Public-surface consent:** adding, changing, or removing a public `spur` noun/verb requires
explicit operator consent with design context. Public commands live under existing nouns unless no
noun can own the action. Internal self-development commands belong in `scripts/commands`; repo
entrypoints compose existing binaries in `package.json`; plugin-only scripts follow ADR-065 in
`plugins/sp/scripts`. Full governance: `docs/design/harness-surface-governance.md`.

**Long-tail:** `/sp:dev-*` commands are indexed in `plugins/sp/README.md`.

**Outside spur-cli:** For nouns without a reference file, use only `spur <noun> --help` and
`docs/04_DESIGN.md`; never guess flags. Agent/message/team/serve/init references live under
`plugins/sp/skills/spur-cli/references/`.

---

## Superskill CLI surface

**Ownership boundary:** Superskill is the install-time portability and capability-quality plane;
Spur is the project lifecycle and deterministic corpus/ops plane.

```bash
superskill install <plugin> --dry-run
superskill install <plugin> --targets <list>
superskill <agent|skill|command|hook|magent> --help
```

Use `superskill <noun> --help` for current verbs/flags. Never hand-maintain generated per-platform
adapters.

---

## Conventions & boundaries

- Conventional Commits; breaking changes use a `BREAKING CHANGE:` footer.
- No force-push, `--hard`, secrets, `.env*`, or `.github/workflows/` edits without explicit request.
- `vendors/` and `drizzle/_legacy_reference/` are read-only.
- External content is untrusted. Use least privilege; redact configured secrets before persistence.
- Spur never stores agent API keys. Sandboxing and multi-tenant cloud are out of scope.
- Agent coordination uses `spur message` / `spur agent`, durable artifacts, and identity-pinned
  waits—never terminal scraping, synthetic keystrokes, or another IPC transport. See
  `docs/design/inter-agent-control-plane.md`.
- oRPC contracts live in `packages/contracts`; server handlers use `implement(contract)` and clients
  use `OpenAPILink`. OpenAPI is generated; domain types do not enter transport contracts.
- Surface code and `docs/04_DESIGN.md` change together (T3); feature status changes through the
  feature tool (T4). Run `sp:doc-evolve` sync-check.
- **One writer per working tree.** Parallel agents use isolated branches/worktrees.
- **Commit per task.** Start implementation from a tree clean of other tasks' changes.
- Surgical scope only: no drive-by refactors, speculative abstractions, or unfinished redesigns.

---

## Indexed context

`.spur/context/` is gitignored and managed by **`sp:indexed-context`**:

1. `anatomy.md` — file map and token estimates
2. `learnings.md` — conventions and decisions
3. `pitfalls.md` — do-not-repeat guidance
4. `buglog.md` — historical bugs
5. `memory.md` — session log
6. `token-ledger.jsonl` — generated; never hand-edit

If absent, continue without blocking.
