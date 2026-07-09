---
name: Architecture Decision Records
doc: 00_ADR
owns: WHY — which cross-cutting decision was made, and the one-line reason
authority: authoritative
version: 1.0.0
created_at: 1970-01-01T00:00:00.000Z
updated_at: 1970-01-01T00:00:00.000Z
---

# Architecture Decision Records

> Authoritative on **decisions**. Lower number wins — this doc overrides all others on decisions.
> Each entry is append-only; supersession is by a new dated entry, never by editing an old one.
> Only real cross-cutting decisions belong here — not implementation notes, not feature status, not
> how-to guidance. Entries that grow past decision + reason are carrying mechanism that belongs in
> `03`/`04`; link it instead of inlining it.

## ADR-001 — (example) Adopt this doc structure

- **Date:** 1970-01-01
- **Status:** accepted
- **Context:** Project needs a single source of truth for decisions and scope.
- **Decision:** Adopt the Spur doc structure (`00`–`05` + `99` constitution).
- **Reason:** Separates WHY (`00`) from WHAT (`01`) from HOW (`03`/`04`) — one fact, one home.

<!--
Add new ADRs here. Copy the entry shape above (Date, Status, Context, Decision, Reason).
A decision that reverses a prior ADR adds a new entry that says "supersedes ADR-NNN".
An Amendment records the decision delta + one-line reason — not the mechanism. Implementation
paths, detailed semantics, and multi-paragraph rationale belong in 03/04, not in the amendment.
-->
