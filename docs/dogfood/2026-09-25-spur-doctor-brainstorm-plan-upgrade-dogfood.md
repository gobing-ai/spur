---
run_id: F618A4EE-81DE-49CD-82CE-FE9C1DD401AA
status: complete
testee: "sp:spur-doctor legacy review of the docs/plans/*-brainstorm.md group"
classification: agent-skill
mode: observe-only
max_retry: 0
testee_agent: omitted
started_at: 2026-09-25T18:40:13Z
finished_at: 2026-09-25T18:42:14Z
live_path: .spur/run/dogfood/F618A4EE-81DE-49CD-82CE-FE9C1DD401AA.md
report_path: docs/dogfood/2026-09-25-spur-doctor-brainstorm-plan-upgrade-dogfood.md
protocol: sp:dogfood-testing@1.2
---

# Dogfood Report — `sp:spur-doctor` brainstorm-group legacy review

### 1. Testee

- **Repro:** `sp:spur-doctor` legacy plan/design review of the frozen `docs/plans/*-brainstorm.md` group (31 paths), observe-only (`--max-retry 0`).
- **Scope:** first named batch group under the new record-type grouping rule; the other plans and designs are not covered.
- **Same-session edits:** the testee's rules (`spur-doctor/SKILL.md`, `spur-dev/references/document-authoring.md`, brainstorm output contract) were edited earlier in this session and are uncommitted; the skill body was read from disk, not a session snapshot.

### 2. Execution Summary

- **Result:** PASS (0 fixed, 0 unresolved, 3 findings).
- **Steps:** 4 derived, 4 executed.
- **Fix attempts:** 0 (observe-only).

#### Cost

- **Ledger estimate:** ~n/a total | ~n/a cached (~n/a% hit rate) [~estimate]
- **Method:** per-step token usage is not observable from this Claude Code session; confidence: LOW
- **Meter:** n/a

### 3. Monitor Ledger

| Step | Outcome | Evidence | Fix Applied | Finding | Fresh | Cached |
| --- | --- | --- | --- | --- | --- | --- |
| Freeze group | PASS | `rg --files docs/plans` sorted → 31 `*-brainstorm.md` paths (group under the new ~40-file bound) | none | no issue | ~unknown | ~unknown |
| Gather evidence | PASS | frontmatter keys, H1 line, inline Date/Status lines, first-commit date, inbound links per file; `spur feature show` G3/G6/J/E3 exist, S1/R2/T3 do not | none | body-regex feature ids are noisy (R2, P1 = requirement/priority labels); only explicit `feature`/`feature_id`/`task*` keys are safe evidence | ~unknown | ~unknown |
| Derive proposals | PASS | `docs/reports/2026-09-25-brainstorm-plans-doc-upgrade-review.md`: 31/31 rows, 0 no-ops, 0 body rewrites; 26 rows carry an operator question (16 no recorded status, 2 unmappable status, 1 body-only status, 26 no explicit owner key) | none | P2 owner evidence too narrow; P3 `topic`→`title` conflicts with the H1 rule | ~unknown | ~unknown |
| Read-only check | PASS | `git status --short docs/plans` empty after the review; only the report and dogfood files were written | none | no issue | ~unknown | ~unknown |

### 4. What We Did

The doctor produced one metadata proposal per file and saved the table to `docs/reports/2026-09-25-brainstorm-plans-doc-upgrade-review.md`, per the new
batch rule. Every row follows the same choices: add `kind: plan`; `title` from the H1; `created_at`
from `date` or the filename prefix; `updated_at` from the last commit; drop `date`/`topic`; map
`feature`/`feature_id`/`task*` keys into `related`; tags ordered `brainstorm` → feature ids → up to
two areas; keep `needs_design`, `run_id`, `design_status` and other workflow keys. No heading,
body or anchor change was proposed. Status mapping was applied only to `approved`, `proposed`,
`draft` and `approved-with-feedback`; `awaiting-operator-review` and `discovery` stay flagged.

The rules produced a consistent table, which the pre-change skill could not. The weak spot is how
often the rows fall back to the operator: 26 of 31.

### 5. Issues

#### Fixed

(none)

#### Unresolved

(none)

### 6. Findings

- **P2 — owner evidence is limited to frontmatter keys.** 26/31 rows ask the operator for `related`, yet an inbound-link scan finds feature or task records citing most of these files (e.g. F822, F83, D61, B5, G6 features; tasks 0188–0191, 0243–0248, 0412, 0601, 0665, 0686, 0787, 0883). The guide should accept "a feature/task record links this file" as `related` evidence before flagging.
- **P3 — `topic` → `title` mapping conflicts with "one H1 matching the title".** Several `topic` values are slugs (`observability-tool-using-tab`). The review used the H1; the guide should say `title` is the H1 text and `topic` maps only when no H1 exists.
- **P3 — most brainstorms record no status (16/31).** Not guessable under current rules; needs one operator decision for the group (for example: brainstorms cited by created tasks → `approved`, otherwise leave unset).

── Dogfood Summary ──
Result: PASS   (0 fixed, 0 unresolved, 3 findings)
Tokens: ~n/a total  |  ~n/a cached (~n/a% hit rate)  [~estimate]

Fixed issues:
  • (none)

Unresolved issues:
  • (none)

Findings (P1+P2):
  • P2 — owner evidence limited to frontmatter keys; inbound feature/task links unused

[Live: .spur/run/dogfood/F618A4EE-81DE-49CD-82CE-FE9C1DD401AA.md]
[Report: docs/dogfood/2026-09-25-spur-doctor-brainstorm-plan-upgrade-dogfood.md]
