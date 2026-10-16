---
schema_version: 1
name: Retire the remaining HIGH/MEDIUM/LOW confidence labels (ADR-138 completion)
status: wip
template: standard
created_at: 2026-10-16T22:01:08.349Z
updated_at: "2026-10-16T22:22:24.047Z"

---

## 1221. Retire the remaining HIGH/MEDIUM/LOW confidence labels (ADR-138 completion)

### Background

Operator decision (2026-10-16): confidence-level grading imported from `cc:anti-hallucination` adds ceremony without evidence. ADR-138 retired the asserted family but kept a "derived" one that re-imported the same labels. Retire every HIGH/MEDIUM/LOW label; keep the decision engine's numeric routing threshold (out of scope).

### Requirements

- [x] R1. The docs rule `sourced-api-claims.yaml` is citation-only (level rules deleted).
- [x] R2. Feature-verification receipts carry no derived confidence; `--confidence`/`--ack-low-confidence` and the workflow vars are removed; legacy receipts parse.
- [x] R3. The dead `response.validate` workflow action is removed.
- [x] R4. Skill/agent/command prose no longer requires HIGH/MEDIUM/LOW tokens.
- [x] R5. History-anatomy findings drop the `confidence` field and its check.
- [x] R6. Stale tests/fixtures/notes are updated; historical drift guards kept.
- [x] R7. `docs/00_ADR.md` binds the invariant (ADR-138 amendment; ADR-024, ADR-119/1196 marked).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Focused suites green: packages/app 299, server transition-gate 8, cli feature verify 3, PR-5 parity 44, PR-6 parity 34, history-anatomy 100, proof-chain 33, plugins/sp 107.
- `tsc --noEmit` clean in packages/app, apps/cli, apps/server, plugins/sp; Biome clean; `build:bundle` exit 0.
- `bun run spur-check`: 11126 pass / 6 fail. Failures not caused by this task: 2× sandbox `git init` hooks copy (EPERM), 2× Chromium DevTools port (sandbox), 2× help-docs parity for `projects add --host` (pre-existing from a3da77807).
- `bun run corpus-check`: exit 1 with pre-existing corpus-wide findings only (scenario-unverified, dogfood-missing, F821 BDD); none reference confidence or `cited-*` rules.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-16T22:22:23.815Z backlog → todo (system)
- 2026-10-16T22:22:24.047Z todo → wip (system)

