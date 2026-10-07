---
schema_version: 1
name: "spur decision noun: list, show, run, status"
status: done
template: feature-impl
created_at: 2026-10-06T17:55:55.425Z
updated_at: "2026-10-07T00:42:14.353Z"
feature_id: P
priority: P1
tags:
  - decision
  - cli

dependencies: ["1092"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1093-verdict.json
---

## 1093. spur decision noun: list, show, run, status

### Background

Feature P (docs/design/decision-catalog.md §3.4). Thin commander transport over DecisionService, mirroring apps/cli/src/commands/agent.ts. Covers scenarios R1–R5.

### Requirements

- [x] R1. `spur decision list [--layer] --json` lists id, type, description, catalog file and layer for every resolvable decision.
- [x] R2. `spur decision show <id> --json` prints the full entry plus the effective maker and its selecting source without constructing a maker; unknown id exits 1.
- [x] R3. `spur decision run <id> [--param k=v]... [--evidence <file>]... [--maker <name>] --json` uses the effective maker, exits 0 for every backend outcome and always returns a value from the closed vocabulary; evidence is redacted and bounded; it never writes a workflow result file.
- [x] R4. `run` rejects unknown id, missing/invalid params, unknown or unregistered maker (flag or config) and unreadable evidence with exit 1 before any backend call.
- [x] R5. `spur decision status --json` reports the configured default maker, per-decision effective makers with source, registered makers, per-layer catalog counts, load errors and duplicate ids; exits 1 on any catalog or maker-config error.
- [x] R6. `plugins/sp/skills/spur-cli/references/decision.md` lands in the same change (CLI parity rule), including the `decisions` config keys.

### Acceptance Criteria

- [x] AC1 — R1 — Decision list shows every resolvable decision with its layer and catalog
- [x] AC2 — R2 — Decision show describes one decision without calling a model
- [x] AC3 — R3 — Decision run always returns a concrete answer from the closed vocabulary
- [x] AC4 — R4 — Decision run rejects caller mistakes before any backend call
- [x] AC5 — R5 — Decision status reports readiness and catalog problems per layer
- [x] AC6 — R8 — Global config selects the default DecisionMaker for each decision point

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-06T17:56:36.341Z

- Exit codes: backend outcomes (accepted, low-confidence, no-backend, timeout, error) exit 0; caller mistakes exit 1 before any backend call (design §3.4).
- `status` is readiness only (switch, makers, catalog errors); history deferred.
- No server/oRPC/Board surface in this feature.

### Design

Command file is transport only; all logic stays in DecisionService (ADR-021). Reuse the standard output envelope and redactAndBound from the decide path rather than a second redaction helper. Backend outcomes are data, not errors, so exit 0 keeps scripts able to branch on `reason`; caller mistakes are exit 1.

### Plan

1. E2E CLI tests against a temp project with a fixture catalog (no backend).
2. Implement decision.ts and register the noun.
3. spur-cli reference.
4. `bun link`, `build:bundle`, `bun run spur-check`.

### Solution

Change-map (authored by the 2026-10-06 `--force --fix all` re-verify; the implement step left this section empty).

| Change (`file:line`) | What / why |
|----------------------|------------|
| `apps/cli/src/commands/decision.ts:21` | `registerDecisionCommand`: the four verbs `list`/`show`/`run`/`status` as a thin transport over `DecisionService` (ADR-021) |
| `apps/cli/src/commands/decision.ts:151` | `run`: evidence read + `redactAndBound` before `parseParams`, so unreadable evidence and bad params exit 1 before any backend call |
| `apps/cli/src/commands/decision.ts:199` | `status` exits 1 when `status.ok` is false (catalog or maker-config error) |
| `apps/cli/src/index.ts:212` | noun registration |
| `packages/app/src/index.ts:26` | re-exports the decision service surface for the CLI |
| `apps/cli/tests/commands/decision.test.ts:93` | E2E CLI suite: list/show/run/caller-mistakes/status against temp projects, offline `typesafe` maker |
| `plugins/sp/skills/spur-cli/references/decision.md:1` | spur-cli noun reference incl. `decisions` config keys (CLI parity, R6) |
| `docs/design/cli-contracts.md:266` | CLI contract rows for the noun |

**Re-verify fix (2026-10-06):** `show` dropped the closed answer vocabulary and the catalog model that task R2 ("full entry") and feature scenario R2 require. `DecisionDescription` now carries `criteria` and `model` (`packages/app/src/decision/decision-service.ts:43`), the human `show` prints both (`apps/cli/src/commands/decision.ts:93`), the JSON and human `show` tests assert them (`apps/cli/tests/commands/decision.test.ts:156`), and `docs/design/decision-catalog.md:125` lists `model`.

**Re-verify fix 2 (2026-10-06):** caller-mistake JSON errors no longer report `INTERNAL_ERROR`: unknown id → `NOT_FOUND`, every other caller mistake → `VALIDATION_FAILED` (`apps/cli/src/commands/decision.ts:285`). `list --layer` rejects values outside `project|registered|shared` with exit 1 instead of silently listing nothing (`apps/cli/src/commands/decision.ts:50`). Regression checks: `apps/cli/tests/commands/decision.test.ts:124` (invalid layer), `:174` (`NOT_FOUND`), `:263` (caller mistakes never `INTERNAL_ERROR`). Contract docs: `plugins/sp/skills/spur-cli/references/decision.md:50`, `docs/design/decision-catalog.md:124`, `docs/design/cli-contracts.md:265`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/commands/decision.ts:37-69` list verb + validated `--layer` filter; `apps/cli/tests/commands/decision.test.ts:94` lists fixture plus shipped shared decisions; `:124` invalid `--layer` exits 1 (21/21 pass this run) |
| R2 | MET | `apps/cli/src/commands/decision.ts:71-111` show (re-verify fix: now emits `criteria` + `model`); `apps/cli/tests/commands/decision.test.ts:144` contract + criteria assertion, :169 unknown id exit 1 `NOT_FOUND` |
| R3 | MET | `apps/cli/src/commands/decision.ts:113-170` run; evidence via redactAndBound; `apps/cli/tests/commands/decision.test.ts:197` closed vocabulary, exit 0, no resultFile; live `spur decision run task-triage --param wbs=1093` → standard/default/no-backend exit 0 |
| R4 | MET | `apps/cli/src/commands/decision.ts:157` parseParams before `decide`; `apps/cli/tests/commands/decision.test.ts:251-264` unknown id/param, missing/type-invalid param, unregistered maker exit 1, never `INTERNAL_ERROR`; :266 invalid JSON; :272 unreadable evidence |
| R5 | MET | `apps/cli/src/commands/decision.ts:172-209` status, `!status.ok` sets exit 1; `apps/cli/tests/commands/decision.test.ts:293` clean exit 0, :315 catalog error exit 1 |
| R6 | MET | `plugins/sp/skills/spur-cli/references/decision.md:15` four frozen verbs, :32 `decisions` config keys, :42 show contract |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Decision list shows every resolvable decision with its layer and catalog | MET | test | `apps/cli/tests/commands/decision.test.ts:94` json + `--layer`; :116 human; :124 invalid layer exit 1; :132 broken catalog still lists at exit 0 |
| R2 — Decision show describes one decision without calling a model | MET | test | `apps/cli/tests/commands/decision.test.ts:144` served contract incl. criteria + effective maker/source; :177 human renders criteria/model; :169 unknown id exit 1 `NOT_FOUND` |
| R3 — Decision run always returns a concrete answer from the closed vocabulary | MET | test | `apps/cli/tests/commands/decision.test.ts:197` value in closed vocabulary, exit 0, no resultFile; :219 redacted bounded evidence + type coercion |
| R4 — Decision run rejects caller mistakes before any backend call | MET | test | `apps/cli/tests/commands/decision.test.ts:251-264` five caller mistakes exit 1; :266 invalid JSON; :272 unreadable evidence |
| R5 — Decision status reports readiness and catalog problems per layer | MET | test | `apps/cli/tests/commands/decision.test.ts:293` layer counts + makers exit 0; :315 catalog error exit 1; :324/:333 human |
| R8 — Global config selects the default DecisionMaker for each decision point | MET | command | scratch project with `decisions.maker: typesafe`, `makers.task-triage: laya-local`: `spur decision show task-triage --json` → laya-local/config-decision; `show failure-class` → typesafe/config-default (run this session) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T21:33:21.415Z todo → testing (system)
- 2026-10-06T21:36:16.074Z testing → done (system)

