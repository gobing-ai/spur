---
name: Architecture Decision Records
doc: 00_ADR
owns: WHY — which cross-cutting decision was made, and the one-line reason
authority: authoritative
version: 1.0.0
owner: _(project owner)_
updated_at: {{init-date}}
read_before: any structural change
edit_rules: 99 §6.1
sync: [T1, T2]
---

# Architecture Decision Records

## ADR-001 — Adopt this doc structure

**Status:** Accepted · **Date:** {{init-date}}

**Decision.** Adopt the Spur doc structure (`00`–`05` + `99` constitution).

**Why.** Separates WHY (`00`) from WHAT (`01`) from HOW (`03`/`04`) — one fact, one home.

**Detail:** `docs/99_PROJECT_CONSTITUTION.md` §4.1.

<!--
Add new ADRs here. Entry shape (per 99 §6.1):

## ADR-NNN: <Decision title, outcome-shaped>

**Status:** Accepted | Accepted (design) | Superseded by ADR-MMM | Skipped · **Date:** YYYY-MM-DD

**Decision.** <What was decided — the smallest complete statement of the choice.>

**Why.** <One line. The single strongest reason.>

**Detail:** <pointer into 03/04/plans — depth never lives here.>

A decision that reverses a prior ADR adds a new entry that says "supersedes ADR-NNN".
An Amendment records the decision delta + one-line reason — not the mechanism. Implementation
paths, detailed semantics, and multi-paragraph rationale belong in 03/04, not in the amendment.
-->