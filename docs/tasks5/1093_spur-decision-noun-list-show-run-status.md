---
schema_version: 1
name: "spur decision noun: list, show, run, status"
status: done
template: feature-impl
created_at: 2026-10-06T17:55:55.425Z
updated_at: "2026-10-06T21:36:16.084Z"
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
- [x] AC6 — R6 — Repository decision catalogs live in config/decisions and ship in the package

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/index.ts:212` |
| `apps/cli/src/index.ts:23` |
| `apps/cli/tests/json-envelope-inventory.test.ts:288` |
| `docs/design/cli-contracts.md:253` |
| `docs/help/spur-cli-matrix.md:18` |
| `docs/help/spur-cli-matrix.md:92` |
| `docs/help/spur-cli-matrix.md:96` |
| `docs/help/spur-cli-matrix.md:99` |
| `packages/app/src/index.ts:12` |
| `plugins/sp/skills/spur-cli/SKILL.md:52` |
| `plugins/sp/tests/cli-surface-parity.test.ts:181` |
| `apps/cli/src/commands/decision.ts:1` |
| `apps/cli/tests/commands/decision.test.ts:1` |
| `docs/help/cmd_decision.md:1` |
| `docs/help2/decision.md:1` |
| `plugins/sp/skills/spur-cli/references/decision.md:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/src/commands/decision.ts:36-62 list verb + --layer filter; decision.test.ts:94-133 |
| R2 | MET | apps/cli/src/commands/decision.ts:65-99 show contract; never constructs maker (decision-service.ts:112-131); unknown id exit 1 test :158-162 |
| R3 | MET | apps/cli/src/commands/decision.ts:105-152 run via hub, exits 0 all backend outcomes; redactAndBound reuse; no resultFile (test :201) |
| R4 | MET | caller mistakes rejected pre-backend: decision.ts:128,142,225-252; 7 test cases :236-271 |
| R5 | MET | apps/cli/src/commands/decision.ts:164-198 status report; !status.ok exit 1 (:197); tests :274-324 |
| R6 | MET | plugins/sp/skills/spur-cli/references/decision.md + SKILL.md:52 routing row; cli-surface-parity 22/22 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 | MET | test | decision.test.ts:93-133 list fixture+shared, --layer filter, human output, broken catalog exit 0 |
| AC-2 | MET | test | decision.test.ts:135-163 show json + human, unknown id |
| AC-3 | MET | test | decision.test.ts:165-223 run serves, closed vocabulary, no resultFile |
| AC-4 | MET | test | decision.test.ts:225-271 caller mistakes incl. invalid JSON, unreadable evidence |
| AC-5 | MET | test | decision.test.ts:273-324 status clean/broken json + human |
| AC-6 | MET | test | packages/app/tests/decision/decision-catalog-resolver.test.ts (precedence cases); decision.test.ts threads config via tempProject fixture; decision.ts:44/78/114/168 |
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

