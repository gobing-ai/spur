---
name: "W3: sp:doc-evolve — constitution-driven rewrite of code-docs"
description: "W3: sp:doc-evolve — constitution-driven rewrite of code-docs"
status: done
created_at: 2026-06-13T01:08:18.986Z
updated_at: 2026-06-15T04:46:40.675Z
folder: docs/tasks
type: task
feature-id: H3
priority: P2
tags: ["rd3-migration","wave-3"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0070. "W3: sp:doc-evolve — constitution-driven rewrite of code-docs"

### Background

Delivery doc §7.2: full rewrite, not a port. Self-evolution driver for docs/00–05 + AGENTS.md per docs/99_PROJECT_CONSTITUTION.md (edit rules, sync triggers, drift audits). Own mini-spec at build time.


### Requirements

R1. Mini-spec: operations (drift audit, sync check, lesson append) mapped to constitution §§.
R2. Skill drives deterministic checks via CLI/rg where possible.
R3. Replaces rd3:code-docs (archival noted for cc-agents cleanup).


### Q&A



### Design

Authority: delivery doc §7.2 — `sp:doc-evolve` is a **constitution-native rewrite** of rd3:code-docs,
not a port: a self-evolution driver for the project key files (docs/00–05, AGENTS.md) operating per
`docs/99_PROJECT_CONSTITUTION.md` (edit rules, same-commit sync triggers, drift audits, machine-
appendable lessons §8). Its own mini-spec is the first deliverable (per this task's R1).


### Solution

Built `sp:doc-evolve` as a **constitution-native rewrite** (R3 — not a port of rd3:code-docs):
`plugins/sp/skills/doc-evolve/SKILL.md` + `references/operations.md` (the mini-spec, R1).

**R1 — mini-spec.** Four operations, each mapped to the section of `docs/99_PROJECT_CONSTITUTION.md`
it enforces:
- **drift-audit → §7** (the 8-item checklist: real CLI surface vs `04`/`AGENTS.md`/`00`; `05` status
  spot-check; `01` scope coverage; `02` dead-name check; `03` modules vs tree; `04` completeness;
  doc-map vs §4.1; frontmatter recency).
- **sync-check → §5 (T1–T8)** — same-commit obligations; T3 (surface change without `04`+`AGENTS.md`)
  is the canonical miss, checked first.
- **contract-verify → §4.3 (+§4.1)** — frontmatter `owns`/`authority` match the §4.1 row; `updated_at`
  plausible.
- **lesson-append → §8** — dated format, dedup, promotion-is-the-only-deletion.

**R2 — deterministic detection.** Every operation is split: a detection half (`rg`/`git`/`spur` CLI/
frontmatter parse — the part that must not hallucinate) and an LLM judgment half. The skill explicitly
forbids asserting "in sync" from reading alone — a zero-finding audit must show the commands that
produced zero (the anti-hallucination posture). `references/operations.md` carries the exact commands.

**R3 — replaces rd3:code-docs.** Built from the constitution, not copied; behaviors of the old generic
tool with no constitution backing are intentionally absent. Archival noted for the cc-agents 0405/0406
cleanup flow (cross-repo — recorded here, not written to the foreign repo).

**Gate (Solution #4) — real drift report.** Ran the §7 detection against this repo: the real CLI has
`spur task` + `spur feature` command groups (apps/cli/src/commands/task.ts, feature.ts), but
`AGENTS.md` (line 175-180) still says they are "accepted but not yet built — do not invoke them" and
`04_DESIGN` has no command sections for them. That is genuine **T3 drift** — a correct first finding,
zero false positives. The surface-sync repair (W1/W2's `04`/`AGENTS.md` surface) is a separate task,
not 0070's scope; the skill's job is to *detect* it, which it did.


### Plan

- [x] R1: mini-spec in `references/operations.md` — 4 operations (drift-audit, sync-check, contract-verify, lesson-append) each mapped to its constitution § (§7, §5/T1–T8, §4.3, §8) + a "done" definition
- [x] R2: each operation split into deterministic detection (rg/git/spur CLI/frontmatter parse) + LLM judgment; the skill forbids asserting "in sync" from reading alone — a zero-finding audit must show the commands that produced zero
- [x] `plugins/sp/skills/doc-evolve/SKILL.md` — constitution-native fat skill (reads 99 first; every operation cites the § it enforces; explicit "NOT a generator / NOT the authority / NOT a port of rd3:code-docs")
- [x] R3: rewrite not port — built from the constitution, not copied from rd3:code-docs; archival noted for the cc-agents 0405/0406 cleanup flow
- [x] Gate (Solution #4): ran the §7 detection against this repo's docs → produced a REAL drift report with a genuine finding (task/feature surface drift, T3) and zero false positives
- [x] Resolves the 0065 forward-dep: `sp:dev-docs` command now has its `sp:doc-evolve` skill
- [x] Same-commit: delivery §7.2 `sp:doc-evolve` row proposed → shipped; H3 feature AC4 checked (feature now fully covered)


### Review

**SECU verdict: FAIL (unbuilt) → PASS** (verified + built 2026-06-14 via `/rd3:dev-verify 0070 --auto --fix all --force`)

`plugins/sp/skills/doc-evolve/` did not exist — the forward-dependency from 0065's `sp:dev-docs`
command. All of R1/R2/R3 unmet. Built as a constitution-native rewrite; the verification run produced
a real, correct drift finding.

**S — Security:** Markdown skill only; the detection commands it instructs are read-only (`rg`/`git
log`/frontmatter parse). No mutation without an explicit, authority-ordered repair. No injection.

**C — Correctness / architecture:**
- R1 ✓ mini-spec maps all 4 operations to real constitution §§ (§7/§5/§4.3/§8) — cross-checked
  against the actual file, not invented.
- R2 ✓ deterministic detection + LLM judgment split; "never assert in-sync from reading alone" is the
  anti-hallucination rule; commands ran for real and produced a true finding.
- R3 ✓ rewrite not port — constitution-derived; no rd3:code-docs behavior without a § backing.

**U — Usability:** clear operation table, the §-authority for each, "what this skill is NOT", and the
drift-report shape; `sp:dev-docs` routing documented.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | `sp:doc-evolve` skill did not exist — dev-run produced nothing; 0065's `dev-docs` command was a dangling forward-dep. | Correctness | `plugins/sp/skills/doc-evolve/` | P1 | **FIXED** — SKILL.md + operations mini-spec, constitution-grounded. |
| 2 | First real drift-audit found genuine T3 drift: `spur task`/`spur feature` shipped in code but `AGENTS.md`/`04` still call them unbuilt. | Process | `AGENTS.md:175`, `04_DESIGN` | P2 | **FLAGGED** — correct finding; the surface-sync repair is W1/W2's (0052-0061) deliverable, a separate task, not 0070 (whose job is to *detect*). Recorded in this task's drift report + a §8-style lesson candidate. |

No remaining P1/P2.

**Gate:** lint clean · test 1266 pass / 0 fail · test-cf 1 pass · build OK · skill grounded in the real
constitution; detection commands verified to run and produce a true (zero-false-positive) report.

**Cross-repo follow-up:** rd3:code-docs archival → cc-agents 0405/0406 (outside this workspace; recorded
here as the unblock signal).


### Testing

Verified 2026-06-14. Constitution-native Fat-Skill (ADR-023) — verified by grounding every operation
against `docs/99_PROJECT_CONSTITUTION.md` + running the drift detection for real (Solution #4 gate).

- **R1 §-mapping:** every operation cites a real constitution section — drift-audit→§7 (8-item
  checklist), sync-check→§5 (T1–T8 verified present in the constitution), contract-verify→§4.3,
  lesson-append→§8 (format + promotion rule verbatim from §8). Cross-checked against the actual file.
- **R2 deterministic detection:** ran the §7 commands against this repo (no hallucination):
  - real top-level command groups: `grep program.command(...) apps/cli/src/commands/*.ts` →
    agent, feature, history, message, rule, task, team, workflow.
  - `04_DESIGN` documented command headings: 13.
  - `05` status rows: 68; `03` modules match the real `apps/`+`packages/` tree (7 dirs).
- **Drift report (the gate):** the detection surfaced a REAL T3 finding — `spur task` / `spur feature`
  exist in code but `AGENTS.md` (line 175-180) calls them "not yet built" and `04` has no sections for
  them. Zero false positives. (Repair = the W1/W2 surface-sync, a separate task — flagged, not 0070.)

**Drift report — 2026-06-14**

| # | Doc | Reality says | Doc says | Authority | Trigger | Repair |
|---|-----|--------------|----------|-----------|---------|--------|
| 1 | AGENTS.md / 04_DESIGN | `spur task` + `spur feature` command groups exist (apps/cli/src/commands/task.ts, feature.ts) with full verb sets | "accepted but not yet built — do not invoke them"; no `04` command sections | 01/04 (T3) | T3 | document the task/feature surface in `04` + flip the AGENTS.md "Planned expansion" note — **out of 0070 scope** (W1/W2 surface-sync task) |

Zero-finding checks: 03 modules vs tree (match); 05 status markers present (68); key-doc frontmatter present.

**Status before verify:** UNBUILT — `plugins/sp/skills/doc-evolve/` did not exist (the forward-dep from
0065's `dev-docs`). R1/R2/R3 unmet; built from the constitution here.

Gate: `bun run lint` clean · `bun run test` 1266 pass / 0 fail (markdown-only — unchanged) ·
`bun run test-cf` 1 pass · `bun run build` OK.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


