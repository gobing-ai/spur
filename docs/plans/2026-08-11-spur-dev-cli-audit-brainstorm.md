---
topic: spur-dev + spur-cli audit and refinement
run_id: b01acde5-3038-4f2b-8535-4c258fc00a50
needs_design: true
date: 2026-08-11
---

# Brainstorm: Comprehensive audit and refinement of `sp:spur-dev` + `sp:spur-cli` and integration surfaces

## Overview

`sp:spur-dev` (spine: 1 SKILL + 16 references) and `sp:spur-cli` (facade: 1 SKILL + 7 noun
references + 4 per-noun subdirs, ~21 files) are the daily-development surfaces of the Spur
harness. They are consumed by 37 `/sp:dev-*`/`spur-*` commands, 10 workflow YAMLs, `sp:expert-spur`,
the README command index, and 13 structural/parity test files. The risk is gradual contract drift:
the monorepo CLI gains verbs (e.g. `task run-link` — documented in the facade, missing from
published npm `spur`), published-version skew, cross-referenced docs (`docs/04_DESIGN.md`,
AGENTS.md noun table) that must stay in parity with skill prose, and duplicated verb lists across
facade layers. The harness's core promise is disciplined routing — stale or duplicated skill content
actively misroutes agents (AGENTS.md: `--help` is last resort, never invent flags). Evidence for
this assessment was gathered by direct inspection of `plugins/sp/` today (2026-08-11): facade noun
routing table + Tier C exclusions, `references/tasks/verbs.md` verb inventory, `idea-pipeline.yaml`
discovery contract, and the existing parity-test suite (`command-flag-parity`, `flag-contract-parity`,
`routing-table-parity`, `skill-structure` R35/R36/R39).

## Approaches

### Approach 1: Parity-test-first drift audit ⭐ Recommended

**Description:** Extend the existing parity harness (`plugins/sp/tests/command-flag-parity.test.ts`,
`flag-contract-parity.test.ts`, `routing-table-parity.test.ts`, `skill-structure.test.ts`) to pin the
contract between the runtime CLI surface and the skill docs, then fix every drift the tests expose.
Verb/flag inventories are regenerated from the monorepo CLI (`bun run apps/cli/src/index.ts … --help`
/ `--json`) and diffed against `sp:spur-cli` reference files and `sp:spur-dev` step-routing table.
Content refinement (discoverability, duplication, maintainability) follows only after the parity
layer is green. The spine/facade boundary is untouched by design — tests assert it.

**Trade-offs:**
- **Pros:** Regression protection — drift is caught automatically on every future CLI change;
  fixes are evidence-driven (test failures name the exact stale line); reuses the existing test
  harness instead of inventing a new mechanism; bounded, auditable scope.
- **Cons:** Parity tests only catch *mechanical* drift (verbs, flags, routing rows, cross-links) —
  prose staleness and discoverability gaps still need a manual/content pass; test suite grows.

**Implementation Notes:**
- No new runtime or dependency — `bun:test` + the monorepo CLI only.
- CLI inventory scripts live under `plugins/sp/tests/` fixtures or `scripts/`; run via `bun run test`.
- Phase 2 content pass (duplication consolidation, README index, cross-links) is task-decomposed
  per surface.

**Confidence:** HIGH — existing parity tests already enforce adjacent contracts; the pattern is
proven in-repo (verified 2026-08-11, `plugins/sp/tests/`).
**Sources:** `plugins/sp/tests/command-flag-parity.test.ts`, `flag-contract-parity.test.ts`,
`routing-table-parity.test.ts`, `skill-structure.test.ts` (R35/R36/R39); `sp:spur-cli`
`references/tasks/verbs.md`; `config/workflows/idea-pipeline.yaml` discovery contract.

### Approach 2: Manual full re-read + rewrite pass

**Description:** Agent(s) re-read every file in the two skills and their integration surfaces and
rewrite stale content by hand, cross-checking against `docs/04_DESIGN.md` and the CLI.

**Trade-offs:**
- **Pros:** Catches prose staleness and nuance that mechanical parity cannot; no test-harness work.
- **Cons:** One-shot — drift returns silently; large human/agent-hours over ~60 files with no
  automated guard; higher regression risk on files that are currently correct; no lasting contract.

**Confidence:** MEDIUM — thorough but unverifiable over time; relies on the next audit.
**Sources:** direct inspection of `plugins/sp/skills/spur-dev/`, `plugins/sp/skills/spur-cli/`,
`plugins/sp/commands/` (2026-08-11).

### Approach 3: Consolidate to a single SSOT — skills become thin pointers

**Description:** Make `docs/04_DESIGN.md` the sole surface authority; strip `sp:spur-cli`/`sp:spur-dev`
references down to pointers, eliminating duplicated verb lists and step tables.

**Trade-offs:**
- **Pros:** Eliminates duplication by construction; one file to keep current.
- **Cons:** Violates the established convention — the facade exists precisely because the CLI
  surface has "a single, scalable home" as a *skill* (facade SKILL.md "Convention — extending the
  facade"); moves agent-facing reference material out of the skill's progressive-disclosure
  structure; high churn, high regression risk; contradicts the boundary the operator asked to preserve.

**Confidence:** MEDIUM — architecturally clean on paper, but it rewrites a deliberately chosen
structure rather than refining it.
**Sources:** `sp:spur-cli` SKILL.md "Convention — extending the facade"; AGENTS.md doc map
(`docs/04_DESIGN.md` owns non-UI surface).

## Recommendations

**Adopt Approach 1 (parity-test-first), with Approach 2's content pass as phase 2 of the same
effort.** It is the only option that both fixes today's drift and prevents tomorrow's, and it
reuses the in-repo pattern the harness already trusts. Approach 3 is rejected — it breaks the
facade convention the operator explicitly wants preserved.

## Next Steps

- Extend the parity harness to diff facade verb/flag inventories and the spine step-routing table
  against the monorepo CLI surface; land red tests first.
- Fix all exposed drift (verbs, flags, routing rows, Tier C reasons, noun table vs AGENTS.md).
- Content pass: README command index, cross-links, duplicated lists, discoverability guidance.
- Decompose into tasks via `sp:spur-dev` (batch-create gate) once the operator approves this
  direction at the idea-eval gate.

## Design Summary

This work is a **boundary-preserving content-and-contract audit**, not an architecture change. The
`spine (sp:spur-dev) / facade (sp:spur-cli) / CLI` ownership boundary stays exactly as documented;
the audit asserts it with parity tests rather than redesigning it. The runtime surface SSOT is the
monorepo CLI (enumerable via `--help`/`--json`); `docs/04_DESIGN.md` remains the surface doc
authority; skill reference files must not diverge from either. No new runtime, dependency, schema,
or transport. Design decisions: (1) parity harness extends the existing `plugins/sp/tests/` suite —
no new test framework; (2) fixes are evidence-driven from test failures; (3) content refinement is
phased after the parity layer is green; (4) published-npm-`spur` skew is documented as a known
drift source and the parity harness runs against the monorepo CLI. `needs_design: true` — multiple
subsystems touched (two skills, commands, workflows, tests, docs) and a cross-cutting convention
(spine/facade contract) is at stake; ties lean design.
