---
title: "Retro skill harvest: environment lens for dogfood-testing and session forensics"
date: 2026-08-26
topic: retro-skills
run_id: idea-retro-skills-20260826-r2
needs_design: true
design_status: pending_operator_review
---

# Brainstorm: Harvest `vendors/misc/retro` into Spur skills

**Date:** 2026-08-26

## Overview

The idea is to improve Spur's existing `sp:dogfood-testing` and `sp:issue-finding` skills by
harvesting useful parts of the vendor skill `vendors/misc/retro/SKILL.md`. Retro is not a test
runner and not a performance forensic: it is an operator-invoked **session retrospective** whose
output is candidate improvements to the **agent environment** (steering files, checks, navigation,
tooling). Both named Spur skills already produce findings, but they grade different objects
(testee contract vs session waste). Copying retro wholesale would collide with live contracts:
`/sp:dev-find-issue` now wraps `sp:history-anatomy`, both named `SKILL.md` bodies are
BODY_BUDGET-baselined and must not grow, and history-anatomy's finding categories are frozen.

This artifact records the vendor-skill review, three approaches, and a design summary for the
idea-eval taste gate. It does not create a feature or edit the target skills.

No external research or subprocess research escalation was needed. All claims below were verified
against repository primary sources on 2026-08-26.

## External skill review

`vendors/misc/retro/` contains a single file, `SKILL.md` (3,388 bytes). There is no reference tree,
no command wrapper, and no tests.

### Job

Conduct a retrospective on a coding session and **suggest environment changes** that would improve
future runs. The skill is user-invoked (`disable-model-invocation: true`). It does not implement,
does not review a diff, and does not drive a testee.

### Protocol (four steps)

1. Invoke `writing-for-agents` for style. **That skill is not present in this monorepo** (search of
   `**/SKILL.md` under the workspace and `~/xprojects` returned no match).
2. Read primary sources for a named session, or the current session if unspecified.
3. Scan seven improvement categories (below).
4. Present candidates to the operator, ordered by severity. Presentation only — no apply step.

### Seven categories (the harvestable taxonomy)

| Category | Use-when | Proposed artifact |
| --- | --- | --- |
| Navigation | Session spent a long time finding information; hidden file dependencies | Navigation pointer in a lean always-loaded file |
| Automated checks | Agent mistake a linter, typechecker, test, or filesystem linter could have caught | New/ tighter check |
| Coding standards | Reviewer missed a mistake, or an existing review rule is wrong | Rule on the **reviewer**, not the implementer |
| Global AGENTS.md | Always-loaded steering is large; instruction belongs in a check or a review-time file | Move out of AGENTS.md |
| Tool economy | Expensive or token-inefficient tool/CLI/MCP calls | Streamline or replace the tool |
| No-ops | Steering that does not change behavior; files are large | Delete or rewrite the dead instruction |
| Information access | Crucial information was unavailable (logs, third-party readonly access) | Tee or grant access |

### Implementation vs Review (the harvestable placement rule)

Retro splits work into two stages with different context pressure:

- **Implementation agent** — explores, writes, debugs; highest context pressure. Do not load
  review-time coding standards here.
- **Review agent** — receives a diff; lowest context pressure. Owns imposing coding standards.

File model the skill assumes:

- `CLAUDE.md` / `AGENTS.md` — always loaded; use **sparingly**, usually as **navigation pointers**.
- `CODING_STANDARDS.md` — read during review, not implementation.
- Docs — reference files, pointed at, not dumped into always-loaded context.
- Skills — for docs whose description must be discoverable, or for user-invoked commands.

### What retro is not

- Not a live driver of a skill/command/CLI (that is dogfood-testing).
- Not a quantitative session-waste forensic over imported history (that is history-anatomy, formerly
  issue-finding's command path).
- Not a wrap-up learning capture (that is `wrapup-pipeline.yaml` → `.spur/memory/learnings.md`).
- Not an indexed file map (that is `sp:indexed-context` anatomy).

## Existing Spur surfaces (what already covers the job)

| Spur surface | Job | Overlap with retro | Gap vs retro |
| --- | --- | --- | --- |
| `sp:dogfood-testing` `@1.2` | Live drive of a **testee**; bounded fix; dual artifacts; P1–P4 findings with `file:line` + action | Findings already recommend testee changes; cache-health P3 is a tool-economy cousin | No environment-vs-testee split; fix-mode may mutate the tree (retro never applies); SKILL.md is BODY_BUDGET-baselined at 37,452 bytes (live 37,435 — **cannot grow**) |
| `sp:issue-finding` | Session JSONL forensics + optional `--create-task`; categories `test-loop`, `guard`, `compaction`, `section-write`, `git-red-herring`, `verbose-output` | Session post-mortem; proposes skill/pipeline/doc fixes | Command default is no longer this skill; SKILL.md baselined at 27,060 bytes (live 27,052 — **cannot grow**); raw-JSONL fallback and task mutation are the complexity history-anatomy removed |
| `sp:history-anatomy` | Interpretation over **already-imported** history; closed categories `reliability \| repetition \| workflow \| performance \| coverage \| telemetry \| positive`; section 9 is workflow/process improvements; remediations are proposals only | Closest forensic home for retro-style environment candidates | Frozen category list — must not add retro's seven names as new categories; no raw JSONL; never mutates |
| `/sp:dev-find-issue` | Thin wrapper | Operator trigger for post-session diagnosis | Invokes `sp:history-anatomy`, **not** `sp:issue-finding` (`plugins/sp/commands/dev-find-issue.md:10-16`) |
| `sp:indexed-context` | Anatomy / learnings / pitfalls | Navigation pointers and do-not-repeat | Local gitignored memory, not a harness-file change proposal |
| `wrapup-pipeline.yaml` | Task wrap learnings | End-of-work capture | Task-lifecycle, not session-environment |
| Layer-1 roles + review pipeline | Reviewer vs coder | Placement rule already exists as roles (`scribe/coder/reviewer/planner`) and `/sp:dev-review` | Not used as a findings-placement rule inside dogfood or forensics |
| `AGENTS.md` + `docs/99` + skills | Lean entry + depth in skills | Retro's "AGENTS.md is pointers" is already the harness-first contract | No `CODING_STANDARDS.md`; constitution numbered docs own process/surface, not a review-only standards file |
| `plugins/sp/tests/skill-structure.test.ts` BODY_BUDGET | Caps SKILL.md growth | Automated check for the "no-ops / sprawl" category | The two named target skills are the **listed exceptions** and must split, not grow |

`plugins/sp/skills/spur-dev/references/dev-operations.md:35-42` still describes `/sp:dev-find-issue`
as wrapping `sp:issue-finding`. That is a live **no-op / stale-steering** example of the retro
taxonomy. It is evidence the lens is useful; fixing that file is out of this idea's scope unless
the operator expands it.

## Keep / drop / adapt

### Keep (harvest)

1. **Environment-improvement lens** — a finding that the *agent environment* should change, distinct
   from a testee-contract bug and from quantitative session waste.
2. **Seven-category checklist** — as a mapping onto existing closed vocabularies, not as a new
   frozen category enum.
3. **Placement rule** — automatable → check; review-time standard → reviewer path; always-loaded
   file → navigation pointer only.
4. **Operator-invoked, present-don't-apply** for environment remediations. Dogfood fix-mode must
   not treat environment candidates as tree mutations.
5. **Severity ordering** of environment candidates (already P1–P4 / P1–P3 on the Spur side).

### Drop (do not import)

1. Hard dependency on `writing-for-agents` (absent).
2. A new `CODING_STANDARDS.md` file type (conflicts with `docs/00`–`05` + `99` authority map).
3. Claude-only `disable-model-invocation` frontmatter as the invocation control (Spur uses command
   wrappers + skill triggers).
4. Raw "search session logs on this machine" as the primary evidence plane (history-anatomy forbids
   raw JSONL; issue-finding's fallback is coexistence-only).
5. A new public CLI noun or `/sp:dev-retro` thin forwarder (ADR-016: commands exist only where the
   model converts non-deterministic intent into a reliable sequence; a fourth analysis command that
   forwards to a 45-line checklist fails that test unless it grows a real protocol).
6. Growing `dogfood-testing` or `issue-finding` `SKILL.md` bodies (two-sided BODY_BUDGET baseline).
7. Unfreezing history-anatomy's closed category vocabulary.
8. Shipping `vendors/misc/retro` as a plugin skill as-is.

### Adapt (project, don't copy)

| Retro category | Spur projection |
| --- | --- |
| Navigation | Dogfood environment finding targeting AGENTS.md / skill `see_also` / indexed-context anatomy; history-anatomy `workflow:<surface>:navigation` |
| Automated checks | Prefer a gate (`spur-check`, biome, tests, script-contract) over a new prose rule; history-anatomy `reliability` when a check would have caught it |
| Coding standards | Owner surface is the **review** skill/command (`sp:code-verification`, `sp:code-review`), not the implementer skill |
| Global AGENTS.md | Pointer-only; depth stays in skills/references (already AGENTS.md harness-first) |
| Tool economy | Dogfood cache-health P3 + Cost honesty; history-anatomy `performance` + section 10 report-only advisories |
| No-ops | BODY_BUDGET / skill-design-principles; environment finding names the dead instruction at `file:line` |
| Information access | History-anatomy `telemetry` gaps; dogfood chained-step `~unknown` P3 |

## Approaches

### Approach 1: Mapped environment lens into live owners ⭐ Recommended

**Description:** Do not ship a third skill. Extract a plugin-level mapping SSOT and project it into
the two **live** output contracts: dogfood `references/report-template.md` §6 (optional
environment-vs-testee tag + seven-category checklist when the testee is a skill/command), and
history-anatomy `references/report-contract.md` section 9 (owner-surface / signal grammar under
existing closed categories). Leave `sp:issue-finding` unmodified except as a documented
coexistence non-target. Do not grow either baselined `SKILL.md`.

**Trade-offs:**

- **Pros:**
  - Lands the useful parts where operators already look (dogfood reports, daily/ad-hoc anatomy).
  - Respects frozen taxonomy, BODY_BUDGET, and the history-anatomy non-mutation boundary.
  - No new command, no new CLI noun, no `CODING_STANDARDS.md`, no vendor-skill install.
- **Cons:**
  - Two projections of one mapping (dogfood P-findings vs anatomy stable keys) — the mapping table
    must live in one plugin-level file so the projections cannot drift.
  - Does not give operators a `/sp:dev-retro` name; they use dogfood or find-issue as today.

**Implementation notes:**

- Plugin-level SSOT candidate: `plugins/sp/references/environment-lens.md` (alongside `roles.md`).
- Dogfood protocol stays `sp:dogfood-testing@1.2`; environment tags are additive like
  `workspace_fingerprint` (optional fields; existing reports remain valid).
- Dogfood fix-mode: environment-lens findings are **findings only** — never auto-applied as
  `Edit`/`Write` of AGENTS.md / skills / rules.
- History-anatomy: map signals onto `workflow` / `performance` / `telemetry` / `reliability`; do
  not add `navigation` as a category.
- `sp:issue-finding`: no body growth, no new categories, no new flags.

**Confidence:** HIGH

**Sources:**

- `vendors/misc/retro/SKILL.md` — full vendor protocol and seven categories | **Verified:** 2026-08-26
- `plugins/sp/skills/dogfood-testing/SKILL.md` + `references/report-template.md` — live driver and
  §6 findings contract | **Verified:** 2026-08-26
- `plugins/sp/commands/dev-find-issue.md:10-16` — command wraps history-anatomy | **Verified:** 2026-08-26
- `plugins/sp/skills/history-anatomy/references/report-contract.md` — frozen categories and section 9 | **Verified:** 2026-08-26
- `plugins/sp/tests/skill-structure.test.ts:775-783` — BODY_BUDGET baseline | **Verified:** 2026-08-26

### Approach 2: New `sp:retro` skill, leave dogfood and issue-finding untouched

**Description:** Author a new `plugins/sp/skills/retro/` under BODY_BUDGET that restates the seven
categories and placement rule in Spur vocabulary (no `writing-for-agents`, no
`CODING_STANDARDS.md`). Optionally add `/sp:dev-retro` only if it passes the ADR-016 test. Dogfood
and issue-finding gain at most a `see_also` — which they cannot absorb in SKILL.md without a split.

**Trade-offs:**

- **Pros:**
  - Clean job split; vendor shape preserved; new skill can stay a dispatcher under 20 KB.
  - Operator can invoke an environment retrospective without a dogfood run or a history report.
- **Cons:**
  - Third overlapping analysis skill next to dogfood, issue-finding (legacy), and history-anatomy.
  - `/sp:dev-retro` is likely an ADR-016 thin forwarder unless it grows a real protocol (report
    contract, evidence rules, non-apply gate) — at which point it duplicates history-anatomy
    section 9.
  - Does not "improve" the two named skills except by pointer.

**Implementation notes:** Acceptable only if the operator wants a named retrospective command more
than they want the lens inside existing reports. Still retarget forensics away from issue-finding.

**Confidence:** HIGH

**Sources:**

- `vendors/misc/retro/SKILL.md:7-26` — standalone operator-invoked retrospective | **Verified:** 2026-08-26
- `docs/plans/2026-06-10-rd3-migration-feature-list.md` ADR-016 command test | **Verified:** 2026-08-26
- `plugins/sp/skills/history-anatomy/SKILL.md` — BODY_BUDGET dispatcher shape for a new skill | **Verified:** 2026-08-26

### Approach 3: Fold the retrospective into wrap-up

**Description:** Add the seven-category scan to `wrapup-pipeline.yaml` learning-capture so every
wrapped task also emits environment candidates.

**Trade-offs:**

- **Pros:** Reuses an existing HITL-adjacent pipeline; no new skill name.
- **Cons:** Wrap is **task** lifecycle and already writes `.spur/memory/learnings.md` (local,
  gitignored). Retro is **session-environment** and proposes harness-file changes. Mixing them
  either pollutes learnings with environment diffs or auto-proposes AGENTS.md edits at wrap time.
  Does not improve dogfood-testing or issue-finding at all.

**Implementation notes:** Rejected as the primary path. Wrap may later *link* to the environment
lens; it must not own it.

**Confidence:** HIGH

**Sources:**

- `config/workflows/wrapup-pipeline.yaml:89-116` — learning-capture → `.spur/memory/learnings.md` | **Verified:** 2026-08-26
- `plugins/sp/skills/indexed-context/SKILL.md:25-44` — gitignored local intelligence | **Verified:** 2026-08-26

## Recommendations

Take **Approach 1**. The vendor skill's value is a compact environment taxonomy plus a placement
rule, not its four-step protocol or its missing dependencies. The live owners are dogfood-testing
(in-session testee drive) and history-anatomy (imported-history forensics). Naming `issue-finding`
as a primary edit target would spend BODY_BUDGET-constrained budget on a skill whose command
entry has already moved.

Consider Approach 2 only if the operator wants a named retrospective invocation that is independent
of dogfood and of daily/ad-hoc anatomy. Even then, do not also deepen issue-finding.

Do not take Approach 3 as the home of the lens.

## Design Summary

### Decision and `needs_design`

`needs_design: true`. The idea touches more than one skill contract (dogfood findings, history-anatomy
report, and the named-but-legacy issue-finding path), introduces a cross-cutting convention
(environment lens + implementer-vs-reviewer placement), and has to freeze a mapping onto a **frozen**
category vocabulary without growing two baselined `SKILL.md` files. Mixed criteria lean design. The
cost of an extra system-design step is low; skipping it risks editing the wrong skill or unfreezing
taxonomy.

The design is deliberately small: no new package, dependency, database schema, transport DTO, public
CLI noun, slash command, or `CODING_STANDARDS.md`. Vendor `retro` stays under `vendors/` as
inspiration.

### Operator surface

No new command. Existing entries:

```text
/sp:dev-dogfood <testee> [...]     # live testee drive; environment-lens findings are additive in §6
/sp:dev-find-issue [...]           # history-anatomy; environment candidates project into section 9
```

Direct `Skill(skill="sp:issue-finding")` remains the legacy coexistence path and is **out of
edit scope** for this idea.

### Ownership

| Surface | Owns |
| --- | --- |
| `plugins/sp/references/environment-lens.md` (new) | Mapping SSOT: retro category → Spur projection, placement rule, present-don't-apply, keep/drop list |
| `sp:dogfood-testing` `references/report-template.md` §6 | Live projection: optional `environment` tag on findings; checklist when the testee is a skill/command; protocol stays `@1.2` |
| `sp:history-anatomy` `references/report-contract.md` §9 | Forensic projection: signal grammar under existing closed categories; remediations stay proposals |
| `sp:issue-finding` | Unchanged (legacy coexistence) |
| `vendors/misc/retro/SKILL.md` | Inspiration only; not installed, not invoked |

### Mapping (frozen for design)

| Retro category | History-anatomy category (closed) | Dogfood finding class |
| --- | --- | --- |
| Navigation | `workflow` | environment / P3–P2 |
| Automated checks | `reliability` | environment; prefer proposing a gate over prose |
| Coding standards | `workflow` | environment; owner surface = review skill, never implementer skill |
| Global AGENTS.md | `workflow` | environment; action = move to skill/reference/check |
| Tool economy | `performance` | existing cache-health P3 plus environment when the tool itself is the waste |
| No-ops | `workflow` | environment; `file:line` of the dead instruction |
| Information access | `telemetry` | existing chained-step `~unknown` P3 plus environment when access is missing |

Do **not** add retro names to history-anatomy's closed vocabulary. Encode them in the
`<signal>` segment of the stable key (`workflow:agents-md:pointer-only`, etc.).

### Placement rule (non-negotiable)

1. If an automated check can catch it, propose the check — not a new always-loaded sentence.
2. If it is a coding standard, the owner surface is the **review** path
   (`sp:code-verification` / `sp:code-review` / pipeline review), not the implementer skill.
3. `AGENTS.md` / `CLAUDE.md` stay navigation pointers; depth lives in skills and numbered docs.
4. Environment remediations are **proposals**. Dogfood `--max-retry N` must not apply them as
   tree mutations. History-anatomy already forbids applied changes.

### BODY_BUDGET constraint

- `dogfood-testing` SKILL.md: 37,435 / 37,452 baseline — **no net growth**. Changes go in
  `references/` (already the findings SSOT).
- `issue-finding` SKILL.md: 27,052 / 27,060 baseline — **do not edit the body**.
- `history-anatomy` SKILL.md: 3,434 / 20,000 — dispatcher; procedure stays in `references/`.
- New plugin-level reference is not a SKILL.md and is not gated by BODY_BUDGET.

### Explicit non-goals

- Do not install or invoke `vendors/misc/retro` as a plugin skill.
- Do not add `writing-for-agents`.
- Do not add `CODING_STANDARDS.md`.
- Do not add `/sp:dev-retro` or a `spur` CLI noun (ADR-016 / ADR-051 consent would be required
  separately if Approach 2 is later chosen).
- Do not unfreeze history-anatomy categories or restore raw-JSONL as a primary path.
- Do not auto-create tasks from environment findings (`--task` / `--create-task` remain existing
  opt-in sinks on their current skills).
- Do not fold the lens into wrap-up learnings as the owning home.

### Verification contract (for later implementation)

- Mapping file exists and is the only category table; dogfood and history-anatomy projections
  point at it rather than restating the seven names with different wording.
- A dogfood report of a skill testee can emit an `environment` tagged finding without failing
  `validate-report.mjs` or changing protocol `@1.2`.
- A history-anatomy fixture still passes the structure gate with only closed categories.
- `skill-structure` BODY_BUDGET test stays green without raising baselines.
- `sp:issue-finding` file bytes do not increase.

### Spec self-review

PASS — no placeholders, no TBD/TODO/???, no unbounded new command, no hidden import of the vendor
skill, no automatic environment mutation, no unfreeze of history-anatomy taxonomy, no SKILL.md
growth plan. Scope is a mapping SSOT plus two projections into existing reference files.

## Next Steps

1. Operator approves or rejects the idea-evaluation report (reshape → Approach 1).
2. On approve, `idea-pipeline` system-design freezes the mapping file path, the two projections,
   and the non-goals above.
3. Decompose into tasks that (a) add the plugin-level mapping SSOT, (b) project into dogfood
   `report-template.md`, (c) project into history-anatomy `report-contract.md`, (d) add fixtures /
   validator-compatible examples. Do not implement from this brainstorm artifact.

---

**Generated by:** `sp:brainstorm`
**Research execution:** inline targeted repository verification; no external research and no
subprocess escalation trigger.
**Prior run:** `idea-retro-skills-20260826` failed at discovery (OMP usage limit); this is r2.
