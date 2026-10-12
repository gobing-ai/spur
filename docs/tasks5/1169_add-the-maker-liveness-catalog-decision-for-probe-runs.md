---
schema_version: 1
name: Add the maker-liveness catalog decision for probe runs
status: done
template: feature-impl
created_at: 2026-10-11T23:23:16.306Z
updated_at: "2026-10-12T02:30:07.336Z"
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

Closed decisions from the original 2026-10-11 refinement and implementation session (deduplicated during this audit):

- Operator request (this session): make `spur decision status` show whether a maker is *actually
  working*, and accepted the recommended probe target — a new bundled `maker-liveness` catalog entry
  — over reusing a served decision or calling the registry directly.

- Floor 0 is the probe's contract, not a relaxation of the catalog's confidence policy: the probe asks
  whether the maker answered, and a working maker's low-confidence answer must not read as a failure.

- Deferred: persisting probe runs as evidence. Server-side, on the condition that recorded evidence
  from real decisions (task 1170) is shown next to the probe result in every report.

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

- [x] Ship the dedicated maker-liveness choice catalog with floor zero and implicit instructions.
- [x] Document the catalog entry and verify list/show plus missing-entry behavior.

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

- **Citations**: `config/decisions/maker-liveness.yaml:25` (floor), `config/decisions/maker-liveness.yaml:28` (entry), `docs/design/decision-catalog.md:88` (inventory).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Golden path decision show maker-liveness --json exited 0: choice, ok/unclear, fallback unclear and floor zero; real-hub self-check exited 0 and accepted an injected valid confidence-0.6 answer (P11-floor-proof.json); `config/decisions/maker-liveness.yaml:25`. |
| R2 | MET | Golden path decision show maker-liveness --json exited 0 with only the implicit instructions parameter; `config/decisions/maker-liveness.yaml:28` declares no parameters. |
| R3 | MET | Catalog inventory inspected at `docs/design/decision-catalog.md:88` and linked readiness contract inspected at `docs/design/decision-observability-and-adoption.md:182`. |
| R4 | MET | Golden path shared list and status commands exited 0: maker-liveness listed and shared layer count five; receipts in .spur/run/P11-golden-path.json. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R5 — An opt-in probe proves a maker answers right now | MET | test | App service and CLI suites: real catalog probe, deduplication, fallback data, bounds and unchanged recorded ledger. Fresh commands: bun test tests/decision (cwd packages/app) exited 0, 80 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail; .spur/run/P11-golden-path.json records source-local CLI commands. |
| Scenario: R7 — A missing liveness catalog entry fails loudly before any probe | MET | test | App/CLI suites: missing catalog id rejects before a call, including an empty effective set. Fresh commands: bun test tests/decision (cwd packages/app) exited 0, 80 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail; .spur/run/P11-golden-path.json records source-local CLI commands. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Current audit: the dedicated catalog has the declared vocabulary, fallback, zero confidence floor and no declared parameters. The prior low-confidence finding conflated live-provider testing with deterministic catalog semantics: the served descriptor was checked and a real-hub self-check accepted an injected valid answer at confidence 0.6 through the shipped floor-zero catalog, without a live model. Basename shadowing is intentional catalog behavior; missing entries are reported before probes. Two owner documents describe different contracts (catalog inventory and readiness behavior), so their existence is not a defect.

No unresolved implementation finding in this slice. Live provider quality is outside the liveness catalog contract.


| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | all | config/decisions/maker-liveness.yaml | No unresolved findings. | RESOLVED — catalog descriptor and CLI error-path checks pass. |

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

