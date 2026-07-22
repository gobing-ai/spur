---
template: standard
schema_version: 1
name: "Review and enhance portable AGENTS.md harness template"
description: ""
status: done
type: task
profile: standard
feature_id: A1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-22T19:26:09.959Z"
updated_at: "2026-07-22T19:40:49.329Z"
---

## 0312. Review and enhance portable AGENTS.md harness template

### Background
The bundled `config/templates/AGENTS.md` is the portable entry contract produced by `spur init` for
new projects. Review it against the current Spur CLI, plugin `sp`, Superskill integration, and the
portable-alignment contract; then make the smallest coherent update. The operator additionally
requires root `DESIGN.md`, when present, to govern UI-facing work.
### Requirements
R1. Describe Spur and Superskill as complementary first-class harness tools using their current
ownership boundaries: Spur owns project lifecycle/corpus/gates; Superskill owns plugin install and
agent capability authoring/validation/evaluation/refinement/evolution.

R2. Route capability work to real `superskill` command families without duplicating their full verb
catalogs or guessing flags.

R3. Add a conditional root `DESIGN.md` contract for UI, styling, interaction, accessibility, and
responsive-behavior changes; absence of the file must not block work.

R4. Keep the root dogfood `AGENTS.md`, bundled seed, alignment fixture/tests, and `spur init` surface
documentation consistent where the portable contract changes.

R5. Preserve project-specific customization slots and the constitution's authority chain.

R6. Focused tests and repository quality gates pass; unrelated user changes remain untouched.
### Acceptance Criteria
- [x] AC1 — A fresh scaffold names both `spur` and `superskill` as first-class, complementary
  harness tools and assigns each only responsibilities supported by current `--help`/plugin docs.
- [x] AC2 — The harness routing table includes plugin installation and capability lifecycle routes
  for skills, commands, agents, hooks, and main-agent configs.
- [x] AC3 — The seed says to read root `DESIGN.md` before UI-facing design or implementation only
  when the file exists, and treats it as authoritative for the project's design system and UX rules.
- [x] AC4 — Portable alignment tests lock the new routing/design anchors in both root and seed.
- [x] AC5 — `docs/04_DESIGN.md` documents the changed `spur init` scaffold surface in the same
  change, with frontmatter metadata refreshed.
- [x] AC6 — Focused tests plus lint/test/test-cf/build gates pass and git status is intentional.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Keep one portable `Harness-first contract` rather than creating competing Spur and Superskill
sections. Add two routing rows and one non-negotiable ownership rule. Add a short standalone
`Design system` H2 because it is a first-session read contract, not project-specific stack prose.
Update the root dogfood instance and portable contract fixture so drift is mechanical. Document
the scaffold behavior under the existing `spur init` ownership surface; no ADR is required because
the ownership boundary is being made explicit, not changed.
### Plan
1. Inventory current template, root instance, CLI registrations/help, plugin command/skill surfaces,
   Superskill help, constitution, and alignment tests.
2. Patch the bundled seed, root instance, portable fixture/tests, and `docs/04_DESIGN.md`.
3. Run formatting/focused tests, inspect the diff, and perform a SECUA/traceability self-review.
4. Run repository gates and record evidence before transitioning the task to done.
### Solution
- `config/templates/AGENTS.md:16` — makes Spur and Superskill complementary first-class harnesses.
- `config/templates/AGENTS.md:51` — routes plugin install and capability lifecycle to Superskill;
  `config/templates/AGENTS.md:63` locks the ownership boundary and platform fallback.
- `config/templates/AGENTS.md:101` — adds the conditional root `DESIGN.md` UI/UX contract and
  disambiguates it from `docs/04_DESIGN.md`.
- `config/templates/AGENTS.md:153` — adds a lean Superskill CLI surface without copying its catalog.
- `AGENTS.md:20` — keeps the Spur dogfood instance aligned with the portable seed.
- `apps/cli/tests/fixtures/agents-md-portable-contract.ts:10` — locks the new H2, routing, and prose
  anchors; `apps/cli/tests/init-templates.test.ts:182` proves fresh-scaffold output.
- `docs/design/portable-agents-harness-contract.md:1` — records the detailed portable surface;
  `docs/04_DESIGN.md:35` indexes it and `docs/04_DESIGN.md:99` syncs the `spur init` contract.
### Testing
| Check | Result | Evidence |
|---|---|---|
| Focused portable alignment | PASS | `bun test apps/cli/tests/agents-md-portable-alignment.test.ts` — 4/4 |
| Focused scaffold behavior | PASS | `bun test apps/cli/tests/init-templates.test.ts` — 19/19 |
| Autofix + typecheck | PASS | `bun run autofix` — 525 files clean; all workspace typechecks exit 0 |
| Comprehensive Spur gate | PASS | `bun run spur-check` — 33 pre-rules + 3,485 tests + 2 post-rules; 99.15% lines |
| Standalone lint | PASS | `bun run lint` — Biome clean; all workspace typechecks exit 0 |
| Standalone tests | PASS | `bun run test` — 3,485/3,485; 99.15% lines |
| Cloudflare tests | PASS | `bun run test-cf` — 1/1 |
| Production build | PASS | `bun run build` — CLI, server, and web built successfully |
| Diff hygiene | PASS | `git diff --check` clean; unrelated pre-existing `package.json` edit preserved |

The first sandboxed full-test/Cloudflare attempts failed only on denied `ps`, localhost bind, and
Wrangler log access. Required reruns outside the sandbox passed without code changes.
### Review
| Severity | Finding | Disposition |
|---|---|---|
| P1 | None | No security, data-loss, or authority-chain risk found. |
| P2 | None | CLI ownership claims match live `spur` and `superskill` help plus ADR-032/plugin docs. |
| P3 | None | Root/seed drift and fresh-scaffold behavior are mechanically covered. |
| P4 | None | Wording remains portable and avoids verb-catalog duplication. |

SECUA disposition: PASS. Security/runtime behavior is unchanged; efficiency impact is negligible;
correctness is covered by scaffold/alignment tests; usability improves through explicit routing;
architecture preserves Spur/Superskill ownership and the constitution's `docs/04_DESIGN.md` scope.
### References
- `docs/design/portable-agents-harness-contract.md`
- `docs/00_ADR.md` ADR-032
- `docs/99_PROJECT_CONSTITUTION.md` §4.4, §5 T3/T9, §6.7
- `plugins/sp/README.md` command/skill architecture and Superskill install-time emission
- Live help inspected: `spur --help`, `spur task --help`, `superskill --help`, and Superskill noun help
### History
- 2026-07-22T19:27:06.318Z backlog → todo (system)
- 2026-07-22T19:27:10.031Z todo → wip (system)
- 2026-07-22T19:36:40.490Z wip → testing (system)
- 2026-07-22T19:38:08.286Z testing → done (system)
