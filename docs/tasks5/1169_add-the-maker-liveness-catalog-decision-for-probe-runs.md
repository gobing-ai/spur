---
schema_version: 1
name: Add the maker-liveness catalog decision for probe runs
status: done
template: feature-impl
created_at: 2026-10-11T23:23:16.306Z
updated_at: "2026-10-12T01:57:45.164Z"
feature_id: P11

done_forced: "false"
done_reason: unforced close; PASS artifact at tracked Testing section (scratch verdict not retained)
---

## 1169. Add the maker-liveness catalog decision for probe runs

### Background

Slice of feature P11 (docs/design/decision-observability-and-adoption.md §3.4). The `--probe` marker
needs one decision id whose only purpose is to be asked of a maker: the probe must exercise catalog
resolution, input validation, the maker call and the fallback route without pretending to classify
anything real. No shipped decision id fits — `gate-evidence` and the pipeline ids declare required
parameters and carry operational meaning a probe run would misrepresent.

Served from the shared catalog layer, next to `gates.yaml` and the pipeline catalogs (feature P).

### Requirements

- [x] R1. Add `config/decisions/maker-liveness.yaml` (schema `version: 1`) declaring one decision:
  - id `maker-liveness`, `type: choice`, criteria `ok` (`The maker answered the question it was asked.`)
    and `unclear` (`The maker could not answer.`), `fallback: unclear`.
  - `defaults.minConfidence: 0`, with the WHY in a file comment: probe semantics are "did the maker
    answer", not "was the answer good". Under the catalog floor of 0.8 a working maker reporting
    0.6 would fall back and the probe would read as not working; the floor is the probe's contract.
  - A file comment stating that only `spur decision status --probe` serves this id and that no
    workflow may reference it.
- [x] R2. Declare **no** parameters. The catalog loader injects the implicit `instructions` parameter
  (`@gobing-ai/ts-ai-decision` `implicitInstructionsParam`), so the probe question rides the
  documented instructions channel and the id needs no declared input.
- [x] R3. Document the new id in `docs/design/decision-catalog.md` (the satellite that owns the served
  id list) in the same commit (T3).
- [x] R4. `spur decision list --layer shared` lists `maker-liveness` and the shared layer file count
  becomes 5 for this repository.

### Acceptance Criteria

- [x] AC1 — An opt-in probe proves a maker answers right now
- [x] AC2 — A missing liveness catalog entry fails loudly before any probe

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:24:38.761Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:20:00.000Z

- Operator request (this session): make `spur decision status` show whether a maker is *actually
  working*, and accepted the recommended probe target — a new bundled `maker-liveness` catalog entry
  — over reusing a served decision or calling the registry directly.
- Floor 0 is the probe's contract, not a relaxation of the catalog's confidence policy: the probe asks
  whether the maker answered, and a working maker's low-confidence answer must not read as a failure.
- Deferred: persisting probe runs as evidence. Server-side, on the condition that recorded evidence
  from real decisions (task 1170) is shown next to the probe result in every report.

#### Q&A entry — 2026-10-12T00:40:07.860Z

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-11T23:20:00.000Z

- Operator request (this session): make `spur decision status` show whether a maker is *actually
  working*, and accepted the recommended probe target — a new bundled `maker-liveness` catalog entry
  — over reusing a served decision or calling the registry directly.
- Floor 0 is the probe's contract, not a relaxation of the catalog's confidence policy: the probe asks
  whether the maker answered, and a working maker's low-confidence answer must not read as a failure.
- Deferred: persisting probe runs as evidence. Server-side, on the condition that recorded evidence
  from real decisions (task 1170) is shown next to the probe result in every report.

#### Q&A entry — 2026-10-11T23:30:00.000Z

- Operator instruction during implementation: do not use `laya-local` as a decision maker until the
  `spur decision` hardening work lands. Consequence for this task: none in the catalog entry itself
  (it names no maker and resolves through config like every other id), but the probe it serves must
  never be exercised against `laya-local` in this repo. The implementation therefore bounds every
  driver (task 1171/1172 R2) and verification runs use `typesafe` in a throwaway project.
- Observed hazard behind that instruction, reproduced while implementing: a `laya-local` decision
  call blocked for ~1 h instead of returning `no-backend`. Recorded in the design satellite §6 as
  the probe-deadline tradeoff; the hardening work owns the root cause.

### Design

**Chosen: a dedicated bundled catalog entry, floor 0, no declared parameters.**

- Dedicated id: probe rows, if ever recorded, stay in their own `decisionId` group and cannot dilute
  another decision's accepted rate. It also keeps the probe question out of ids with operational
  meaning.
- Floor 0 rather than the catalog default 0.7/0.8: `minConfidence` gates whether the *answer* is
  accepted, while the probe asks whether the *maker* answered. A low-confidence answer from a live
  maker is a pass; a `no-backend`, `timeout` or `error` reason is a fail, and those reasons fall back
  regardless of the floor.
- No declared parameters: the loader's implicit `instructions` parameter already renders the
  question (`renderQuestion` prefers the rendered `instructions` and falls back to
  `decision.description`).

**Rejected:** reusing `idea-recommendation` (parameterless but semantically a classification of a
report that a probe does not have); passing no input and letting the description stand as the
question (works, but the maker only sees `description`, so the report would read as a vague
non-question and the probe would be indistinguishable from a real classification attempt).

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

- **R1 — the entry** (`config/decisions/maker-liveness.yaml`, new): one `choice` decision `maker-liveness`,
  criteria `ok`/`unclear`, fallback `unclear`, `defaults.minConfidence: 0`. The file comment carries the
  WHY for the floor (probe semantics ask whether the maker answered, not whether the answer was good;
  under the catalog's 0.8 floor a live maker reporting 0.6 would read as a dead one) and states that only
  `spur decision status --probe` serves the id and no workflow may reference it.
- **R2 — no declared parameters**: verified against the loader — `decision show maker-liveness --json`
  reports exactly the injected `instructions` parameter, so the probe question rides the documented
  implicit channel (`implicitInstructionsParam`), not a new declared input.
- **R3 — satellite** (`docs/design/decision-catalog.md` §3.1): the catalog file inventory now names
  `maker-liveness.yaml` with its one caller and its floor rationale; `docs/design/decision-observability-and-adoption.md`
  §3.4.1 owns the probe contract.
- **R4 — layer count**: `spur decision status` reports `layers … shared 5` in a throwaway project
  (`config/decisions/` went from four files to five), and `decision list --layer shared` returns the new id.
- **Verification**: `spur decision show`/`list`/`status` as recorded in Testing; the CLI suite covers the
  shared catalog (31 pass) so a malformed entry fails the gate rather than passing silently.
- **Deviation from the plan**: none in behaviour. Two symbol names in task 1170/1172 changed against the
  first draft of their Requirements (the overlay lives in `decision-status-readiness.ts` because
  `workflow/decision-readiness.ts` already owns `DecisionReadiness`); both task specs were updated to
  match what shipped rather than the reverse.

- **Citations**: `config/decisions/maker-liveness.yaml:14` (the WHY comment block for the floor), `config/decisions/maker-liveness.yaml:25` (`minConfidence: 0`), `config/decisions/maker-liveness.yaml:28` (the `maker-liveness` entry), `docs/design/decision-catalog.md:87` (catalog file inventory).

### Testing

Verified with the source-local CLI (`bun run apps/cli/src/index.ts …`, source tree, no install):

- `decision list --layer shared --json` → 8 entries, including `maker-liveness` with
  `layer: shared` and `source: config/decisions/maker-liveness.yaml` (R4).
- `decision show maker-liveness --json` → `minConfidence: 0`, criteria `ok`/`unclear`,
  `fallback: unclear`, and exactly one parameter, the loader-injected `instructions` (R2).
- `decision status` in a throwaway project → `layers project 1 · registered 0 · shared 5`: the shared
  layer now counts five catalog files (R4).
- `spur decision status --probe` in a throwaway project ran the entry end to end and reported a
  probe outcome for the effective maker, proving the entry serves through the real seam.
- Regression: `apps/cli/tests/commands/decision.test.ts` (31 pass) covers the shared catalog listing
  and the readiness rows, so a broken or unreadable entry fails the suite.

### Review

## Review — self-review against the verification lens, 2026-10-11 (inline; `sp-code-verification` dimensions)

**Verdict: PASS-WITH-FINDINGS.** Read-only review of the slice's diff (`config/decisions/maker-liveness.yaml`,
`docs/design/decision-catalog.md`, `docs/design/decision-observability-and-adoption.md`). No P1 findings;
no code paths, no schema, no migration.

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | verification honesty | The floor-0 rationale is argued from the hub's fallback taxonomy, not from a live low-confidence sample: `--probe` was exercised against `typesafe` only, and `laya-local` is off-limits in this repo by operator instruction, so the claim "a working maker reporting 0.6 still passes" rests on `effectiveMinConfidence` reading, not on a recorded outcome. | `config/decisions/maker-liveness.yaml:14` | ACCEPTED — the taxonomy is pinned by upstream tests and the rationale is recorded in design §6; live validation belongs to the `spur decision` hardening work. |
| 2 | P4 (nit) | config surface | The entry is shadowable by basename like every catalog file, so a project override omitting the id breaks `--probe`. | `packages/app/src/decision/decision-catalog-resolver.ts:77` | ACCEPTED — the failure is loud (exit 1, id named) and is now covered end to end by `apps/cli/tests/commands/decision.test.ts` (`R7`). |
| 3 | P4 (nit) | docs | The id is documented in two satellites (§3.4.1 and §3.1); a future rename must touch both. | `docs/design/decision-catalog.md:87` | ACCEPTED — both are same-file-family docs owned by the same reviewer, and the parity test on catalog listing catches a stale inventory only partially. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-11T23:25:03.585Z backlog → todo (system)
- 2026-10-11T23:25:08.492Z todo → wip (system)
- 2026-10-12T01:39:32.704Z wip → testing (system)
- 2026-10-12T01:44:12.301Z testing → done (system)
- 2026-10-12T01:56:43.527Z done → wip (system)
- 2026-10-12T01:56:59.667Z wip → testing (system)
- 2026-10-12T01:57:00.313Z testing → done (system)

