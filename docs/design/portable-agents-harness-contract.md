# Design — Portable `AGENTS.md` harness contract

Owning task: [`0312`](../tasks2/0312_review-and-enhance-portable-agents-md-harness-template.md).
Surface index row: [`04_DESIGN.md §0`](../04_DESIGN.md).

## Scope

`config/templates/AGENTS.md` is the root `AGENTS.md` seed materialized by `spur init`. It is the
portable first-session contract for any Spur-managed project; project-specific stack, command, and
boundary slots remain explicit customization stubs.

## Harness ownership

The seed presents two complementary first-class tools:

| Plane | Owner | Portable entry surface |
|-------|-------|------------------------|
| Project lifecycle, task/feature corpus, rules, workflows, gates, review, docs hygiene | Spur + plugin `sp` | `spur`; `/sp:dev-*`; `sp:*` skills/subagents |
| Cross-agent plugin installation and capability authoring/quality lifecycle | Superskill | `superskill install`; `superskill <noun> --help` for `agent`, `skill`, `command`, `hook`, `magent` |

The routing table includes both planes. The seed does not duplicate either CLI's complete verb or
flag catalog; agents must use the owning CLI's `--help` or the routed `sp:spur-cli` skill.

Per-platform capability adapters are install-time output owned by Superskill. Projects do not commit
hand-maintained copies.

## Conditional root `DESIGN.md`

If repository-root `DESIGN.md` exists, an agent must read it before planning or implementing a
change to UI, styling, interaction, accessibility, or responsive behavior. It is authoritative for
the project's visual and interaction system: tokens, components, patterns, and UX constraints.

Absence is non-blocking; agents continue with established project UI conventions. The scope is
explicitly disjoint from `docs/04_DESIGN.md`, which owns command, config, schema, and DTO surfaces.

## Drift controls

- Root `AGENTS.md` and the bundled seed share the H2 set, harness-routing Need keys, and stable prose
  anchors in `apps/cli/tests/fixtures/agents-md-portable-contract.ts`.
- `apps/cli/tests/agents-md-portable-alignment.test.ts` rejects root/seed drift.
- `apps/cli/tests/init-templates.test.ts` verifies a fresh scaffold contains the Superskill and
  conditional-design contracts after token substitution.
- `spur init --force` preserves an existing root `AGENTS.md`; the enhanced contract applies when a
  fresh file is scaffolded and does not overwrite project customization.

## References

- `docs/00_ADR.md` ADR-032 — per-platform adapters are Superskill-owned install-time output.
- `plugins/sp/README.md` — current command/skill architecture and installation boundary.
- `docs/99_PROJECT_CONSTITUTION.md` §4.4 / §6.7 — portable entry-doc synchronization and factual
  regeneration rules.
