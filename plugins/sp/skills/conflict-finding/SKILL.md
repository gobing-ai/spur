---
name: conflict-finding
description: "Authority-aware semantic audit across source, task files, feature files, and project authority files — detect conflicts, resolve claim-specific authority, collect reproducible evidence, and route confirmed repairs through owner surfaces. Triggers: find conflict, conflict audit, semantic conflict, authority mismatch, stale projection."
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: analysis-core
  interactions:
    - audit
    - remediation
  pipeline_steps:
    - discover
    - compare
    - resolve
    - report
    - remediate
  openclaw:
    emoji: "🧭"
see_also:
  - sp:doc-evolve
  - sp:spur-cli
  - sp:code-verification
  - sp:spur-dev
---

# sp:conflict-finding — Authority-Aware Indexed Conflict Audit

A prompt-first, authority-aware audit across the four pillars — **source code**, **task files**,
**feature files**, and **project authority files** — that discovers conflicts, resolves claim-specific
authority, collects reproducible evidence, and routes confirmed repairs through each artifact owner's
existing harness surface.

**Honesty contract:** v1 is prompt-first. The model performs subject clustering, claim-specific
authority reasoning, and semantic comparison; existing deterministic tools (`git`, `rg`,
`spur task/feature --json`, `spur … check`, `sp:doc-evolve` audit surfaces) gather facts. V1 adds no
TypeScript analyzer, database, vector index, embedding pipeline, persistent cache, new runtime
dependency, or dedicated subagent.

## When to Use

**Trigger phrases:** "find conflict", "conflict audit", "semantic conflict", "authority mismatch",
"stale projection", "do the docs and code agree", "audit the corpus"

**Use PROACTIVELY when:**

- A claim in one pillar appears to contradict another pillar (source↔task, source↔feature,
  source↔authority, task↔feature, task↔authority, feature↔authority).
- A task or feature's status, AC, or requirements may have drifted from the implemented surface.
- A derived projection (architecture/design/docs) may have diverged from its authority (ADR/PRD).
- The operator wants a reproducible evidence envelope before authorizing any repair.

**Do NOT use for:**

- Debugging a specific runtime failure — use `sp:sys-debugging`.
- Code review — use `sp:code-review` / `sp:code-verification`.
- General documentation drift maintenance — use `sp:doc-evolve`.
- Performing repairs automatically — this skill only audits and (with `--resolve`) proposes
  confirmed, owner-routed repairs; it never mutates without explicit confirmation.

## Arguments

| Argument                                             | Description                                                                                                                                          | Default         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `[scope]`                                            | Optional path, WBS, feature ID, symbol, command, config key, or free-form subject to scope the audit.                                                | current project |
| `--pillar <source\|tasks\|features\|authority\|all>` | Limit the internal audit to one pillar; the minimum authorities needed to judge it still load.                                                       | `all`           |
| `--mode <adaptive\|full>`                            | Scan protocol — `adaptive` reuses fresh, provenance-verifiable indexed context and discloses skipped areas; `full` forces a cold comprehensive scan. | `adaptive`      |
| `--resolve`                                          | Enable the proposal, confirmation, and owner-routed remediation workflow. Its absence guarantees no source/corpus/numbered-doc mutation.             | off             |
| `--agent <inline\|auto\|name>`                       | Who runs the model-bearing analysis. `inline` is the default; `--agent auto`/a named executor isolates the analysis. Not a dedicated subagent.       | `inline`        |
| `--json`                                             | Emit the same result envelope as Markdown as JSON. Never implies deterministic semantic reasoning.                                                   | off             |

## The 10-Step Audit Protocol

```
scope + flags
  → PARSE & GUARD     resolve scope/flags; confirm repository root; set audit-only vs resolve mode
  → DISCOVER AUTHORITY  read entry/process rules; build the claim-specific authority matrix
  → PREFLIGHT         git, rg, spur task/feature --json, relevant spur … check, doc-evolve audit
  → INVENTORY         four-pillar inventory: pillar, identity, path, anchor, freshness, scan status
  → CANDIDATE GRAPH   join claims via explicit links, WBS/feature IDs, AC titles, symbols, commands,
                      flags, schemas, config keys, normalized domain terms
  → WITHIN-PILLAR     contradictions, stale projections, duplicates, omissions, orphans, ambiguity
  → CROSS-PILLAR      all six applicable boundaries
  → CLASSIFY          lifecycle, supersession, abstraction-level, intentional-deprecation challenges
  → REPORT            order by severity then confidence; coverage, unresolved authority, scan cost
  → REMEDIATE         only with --resolve and explicit confirmation + freshness recheck
```

### Step 1 — Parse and guard

Resolve `<scope>` and `--pillar`; confirm the repository root; establish **audit-only** versus
`--resolve` mode. Without `--resolve`, the run is strictly read-only: no source, corpus, or
numbered-document mutation of any kind. With `--resolve`, no write happens until a repair set is
presented, explicitly confirmed, and freshness-revalidated.

### Step 2 — Discover local authority

Read entry/process rules (`AGENTS.md`, `docs/99_PROJECT_CONSTITUTION.md`) before interpreting any
difference. Build the claim-specific authority matrix — authority is resolved for a **subject +
claim type**, never for a whole file. The default authority set is `AGENTS.md`, `docs/00_ADR.md`,
`docs/01_PRD.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/05_FEATURES.md`,
`docs/99_PROJECT_CONSTITUTION.md` when present; absent optional files are reported without blocking
the audit. Full matrix and fallback rules: [references/authority-resolution.md](references/authority-resolution.md).

### Step 3 — Run deterministic preflight

Use `git`, `rg`, `spur task/feature … --json`, relevant `spur … check`, and `sp:doc-evolve` audit
surfaces when available. Tool failures become **coverage evidence**, never silent omission; record
them in `errors` and degrade `coverage.complete` accordingly.

### Step 4 — Build inventories

For each pillar record: identity, path, anchor, provenance/freshness, and scan status. Optional
files may be absent; a selected pillar may **not** be silently omitted. Unavailable line numbers
must be replaced with a stable structural anchor (heading, symbol, WBS, feature ID, command), never
fabricated.

### Step 5 — Build the candidate graph

Join claims using explicit links, WBS/feature IDs, dependencies, AC titles, paths, symbols,
command/flag names, DTO/schema/config keys, and normalized domain terms. **Do not compare every
artifact with every other artifact** — an unbounded all-pairs comparison is prohibited. See
[references/comparison-protocol.md](references/comparison-protocol.md).

### Step 6 — Audit within each pillar

- **Source**: contracts/implementations/tests/config/registrations.
- **Tasks**: requirements/AC/dependencies/status/solution.
- **Features**: hierarchy/AC/status/index projections.
- **Authority**: ownership/decision/scope/process projections.

### Step 7 — Audit all applicable cross-pillar boundaries

source↔task, source↔feature, source↔authority, task↔feature, task↔authority, feature↔authority —
every boundary applicable to the selected scope.

### Step 8 — Classify and challenge

Before asserting a conflict, test each candidate against lifecycle, supersession,
abstraction-level, and intentional-deprecation explanations. Mere wording or abstraction-level
difference is **not** a conflict. Low confidence never disappears — it is reported as a candidate or
unresolved item, not promoted to a definitive conflict.

### Step 9 — Report

Order findings by severity then confidence. Show clean boundaries, unresolved authority, coverage
gaps, reused context, scan cost, and the recommended owner. Markdown and `--json` carry the same
findings, evidence, authority provenance, coverage, unresolved decisions, and remediation state. See
[references/finding-contract.md](references/finding-contract.md).

### Step 10 — Remediate only when requested

With `--resolve`: present the proposed repair set, obtain explicit confirmation, revalidate evidence
freshness, then route each approved repair through its verified owner surface. Report the completed,
failed, and untouched sets; never silently roll forward past a partial failure. See
[references/remediation-routing.md](references/remediation-routing.md).

## Output

**Default:** a Markdown audit report with ordered findings, coverage accounting, and unresolved
items; no mutation.

**With `--json`:** the same envelope as machine-readable JSON.

```json
{
  "schema_version": 1,
  "command": "dev-find-conflict",
  "scope": "docs/00_ADR.md",
  "mode": "adaptive",
  "pillars": ["authority"],
  "authority_map": {},
  "inventory": [],
  "findings": [],
  "unresolved": [],
  "coverage": { "complete": true },
  "cost": {},
  "remediation": {},
  "errors": []
}
```

Top-level JSON keys: `schema_version, command, scope, mode, pillars, authority_map, inventory,
findings, unresolved, coverage, cost, remediation, errors`.

## Integration

- **Authority matrix + fallback** — [references/authority-resolution.md](references/authority-resolution.md)
- **Comparison protocol + token controls** — [references/comparison-protocol.md](references/comparison-protocol.md)
- **Finding/result contracts + false-positive rules** — [references/finding-contract.md](references/finding-contract.md)
- **Confirmed remediation routing** — [references/remediation-routing.md](references/remediation-routing.md)

## Required Permissions

| Capability      | Purpose                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `Read`          | Authority files, task/feature files, source, numbered docs                               |
| `Grep` / `Glob` | Pattern search and scope discovery                                                       |
| `Bash`          | `git`, `rg`, `spur task/feature ... --json`, `spur ... check`, `sp:doc-evolve` audit     |
| `Write`         | Only for temp files / owner-routed repair payloads after confirmation (with `--resolve`) |

## Platform Notes

### Claude Code

- Invoke via `/sp:dev-find-conflict …` or `Skill(skill="sp:conflict-finding", args="…")`.
- Prefer structured tools for discovery; read full artifacts only for candidate subjects.

### Codex / OpenClaw / OpenCode / Antigravity / Pi

- Read this skill and follow the 10-step protocol (slash commands adapted at install time).
- Prefer `rg` for scanning; expand globs carefully; treat `.spur/context/` as optional, freshness-gated evidence.

## Shipped command

### `/sp:dev-find-conflict`

Thin wrapper: `Skill(skill="sp:conflict-finding", args="$ARGUMENTS")`.

```
/sp:dev-find-conflict
/sp:dev-find-conflict docs/00_ADR.md
/sp:dev-find-conflict --pillar tasks --mode full
/sp:dev-find-conflict 0486 --resolve
/sp:dev-find-conflict "command surface" --json
```

## Common rationalizations

| Rationalization                            | Reality                                                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "A textual difference is a conflict."      | Only contradiction, stale, duplicate, omission, orphan, or ambiguous-authority supported by evidence counts; wording/abstraction differences are not conflicts. |
| "Lower-numbered docs always win."          | Authority is claim-specific; the constitution's precedence applies only within its stated boundary.                                                             |
| "Code is always right."                    | Code is authoritative for what currently happens, not automatically for what should happen.                                                                     |
| "`--resolve` authorizes automatic repair." | It opens the proposal/confirmation workflow; every repair still needs explicit confirmation and a freshness check, then the owner surface.                      |
| "Adaptive can reuse any context."          | Reuse requires freshness + verifiable provenance; absent/stale/unverifiable context degrades to a cold scan or an explicit incomplete-coverage result.          |

## Red flags

- Asserting a conflict from wording alone or an unbounded all-pairs comparison.
- Forcing an ambiguous/missing authority through a global ranking instead of an unresolved HITL item.
- Silently omitting a selected pillar or a tool failure (no coverage accounting).
- Claiming "comprehensive" when `coverage.complete` is false.
- Any mutation in audit mode, or automatic mutation merely because `--resolve` is present.
- Editing a derived projection before its authority.
- Adding a production analyzer, index/cache/database, dependency, or dedicated subagent in v1.

## Reference files

- **[references/authority-resolution.md](references/authority-resolution.md)** — authority discovery, claim taxonomy, fallback matrix, ambiguity protocol
- **[references/comparison-protocol.md](references/comparison-protocol.md)** — inventories, subject clustering, internal/cross-pillar comparisons, token controls
- **[references/finding-contract.md](references/finding-contract.md)** — classifications, evidence rules, Markdown/JSON schemas, severity/confidence/coverage
- **[references/remediation-routing.md](references/remediation-routing.md)** — HITL, freshness recheck, owner routing, partial-failure/idempotency behavior
