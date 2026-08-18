---
name: verdict-schema
description: "The VerifyVerdict artifact shape and per-requirement aggregation rule"
see_also:
  - sp:code-verification
---

# Verdict Schema

The verify mode emits `.spur/run/<wbs>-verdict.json` — the machine contract between
`sp:code-verification` and the `task-pipeline.yaml` completion gate.

```typescript
interface VerifyVerdict {
  /** The task this verdict certifies. */
  wbs: string;
  /** Aggregate verdict. Only PASS clears the pipeline gate. */
  verdict: 'PASS' | 'PARTIAL' | 'FAIL';
  /** Per-requirement traceability result. */
  requirements: Array<{
    id: string;                                // e.g. "R1"
    status: 'MET' | 'PARTIAL' | 'UNMET';
    evidence: string;                          // file:line, test name, or "no evidence found"
  }>;
  /** Per-Acceptance Criteria result. Present when the task has non-empty AC. */
  acceptanceCriteria?: Array<{
    id: string;                                // checklist label or "Scenario: <title>"
    status: 'MET' | 'PARTIAL' | 'UNMET' | 'N/A';
    evidenceType: 'test' | 'command' | 'static-ref' | 'manual-review' | 'llm-judge' | 'n/a';
    evidence: string;                          // evidence or explicit N/A justification
  }>;
  /** Discrete gate checks (sections populated, tests pass, lint clean, …). */
  checks: Array<{
    name: string;                              // e.g. "tests-pass", "lint-clean"
    status: 'pass' | 'fail' | 'warn';
    evidence: string;
  }>;
}
```

## Compatibility alias: `scenario` row key

Task 0410 hardened the verdict reader. Producers SHOULD use the canonical `id` field for every
requirement and AC row. Consumers (the feature-check L4 traceability layer) ALSO accept `scenario`
as a compatibility alias for the row identifier, with these rules:

- Row with `id` only → canonical; accepted as-is.
- Row with `scenario` only → accepted; normalized to `{ id: scenario, … }`.
- Row with both `id` and `scenario` where they are EQUAL → `id` is authoritative; accepted.
- Row with both `id` and `scenario` where they DIFFER or either value is not a string → **rejected**
  (conflict); the rejected row
  count and invalid fields surface as a bounded `L4.malformed-verdict-artifact` warning naming the
  task WBS and artifact path.
- Row missing both `id` and `scenario`, or missing `status`, or not an object → rejected and warned.

Empty `requirements` / `acceptanceCriteria` arrays are valid and produce no warning. The required
`requirements` array being absent, either coverage field being a non-array value, a missing artifact,
malformed JSON, and a non-object JSON root are distinct diagnostic outcomes. Each emits one bounded
`L4.malformed-verdict-artifact` warning per task/artifact whose message names the failure mode;
optional `acceptanceCriteria` may remain absent.

Canonical producers and docs continue to use `id`. The `scenario` alias exists so older or
third-party verdict emitters keyed on scenario titles are not silently dropped.

## Aggregation rule

The aggregate `verdict` is derived from the per-requirement, per-AC, and blocking review statuses:

```
any core requirement UNMET                         → FAIL
any core Acceptance Criteria UNMET                 → FAIL
any blocker correctness/security check             → FAIL
any core requirement or AC PARTIAL (no FAIL)       → PARTIAL
any unresolved major quality check (no FAIL)       → PARTIAL
all core requirements and AC MET or justified N/A  → PASS
```

There is no "good enough" — `PARTIAL` blocks the gate exactly like `FAIL`. The distinction exists
only to tell the operator *how far off* delivery is (UNMET = nothing there; PARTIAL = half there).

## Acceptance Criteria evidence

When a task has non-empty Acceptance Criteria, `acceptanceCriteria` must be populated. Evidence type
is part of the contract so weak proof is visible to the pipeline and to reviewers:

- `test` / `command`: deterministic evidence.
- `static-ref`: source, configuration, or documentation reference evidence.
- `manual-review`: reviewer reasoning with cited files.
- `llm-judge`: qualitative judgment only; it cannot alone certify objective AC.
- `n/a`: explicitly justified non-applicability.

Every CORE behavior-bearing AC requires executable evidence: at least one `test` or `command` row.
`spur task verdict` treats AC rows as core and behavior-bearing by default; add `[advisory]`,
`[non-core]`, `[non-behavior]`, or `[docs-only]` in the AC id only when that weaker rule is
intentional. A MET behavior AC with only `static-ref`, `manual-review`, or `llm-judge` evidence is
downgraded to `PARTIAL` and emits an `evidence-rule-failed` check. CLI-surface changes should also
emit a `cli-golden-path-present` check backed by a golden-path `--json` command invocation.

For answer files, emit a matching parseable table:

```markdown
### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: CLI emits JSON | MET | test | `apps/cli/tests/foo.test.ts:42` |
```

## Checks evidence

Wave C verification can emit the following additive `checks[]` rows:

| Check | Meaning |
| ----- | ------- |
| `design-conformance` | Task `### Design` claims were classified DONE / PARTIAL / NOT DONE / CHANGED against the diff. |
| `scope-creep` | Diff hunks did not map to Requirements / AC / Design / Plan items. Informational unless SECUA raises it. |
| `evidence-rule-pass` | All behavior-bearing AC rows had executable evidence or were explicitly non-behavioral. |
| `evidence-rule-failed` | One or more MET behavior-bearing AC rows lacked `test` / `command` evidence and were downgraded to PARTIAL. |
| `cli-golden-path-present` | CLI-surface tasks supplied, or failed to supply, one golden-path command evidence row. |

## How the gate reads it

`.spur/workflows/task-pipeline.yaml`, transition `verify → record`:

```yaml
guard:
  kind: shell
  options:
    command: 'test "$(jq -r .verdict .spur/run/${vars.wbs}-verdict.json)" = PASS'
```

with a sibling `verify → failed` guarded on the negation. So a missing file, malformed JSON, or any
non-`PASS` verdict routes the run to `failed` rather than `done` — the pipeline cannot certify
completion without an explicit PASS artifact.

## Lifecycle

- **Written:** Step 9 of verify mode, *after* the verdict is final (never partially).
- **Read:** by the workflow gate on the `verify → record` transition.
- **Location:** `.spur/run/` (the run-scratch dir the pipeline's `record` step also uses).
- **Lifetime:** per execution attempt; overwritten on the next verify of the same WBS.

## Optional check severity (task 0592, feature F92)

`checks[]` rows may carry an optional `severity` field so the aggregation policy can distinguish a
blocking review finding from a non-blocking one:

```typescript
checks: Array<{
  name: string;                                // aliases accepted on read: `check`, `id`
  status: 'pass' | 'fail' | 'warn';
  evidence: string;
  severity?: 'blocker' | 'major' | 'minor' | 'advisory';
}>;
```

### Compatibility aliases: check label key

Producers SHOULD write the check label as `name`. Consumers ALSO accept `check` and `id` as
aliases, normalized to `name` in the same single place the `scenario`→`id` coverage alias is
normalized (`checkSchema` in `verify-verdict.ts`). A row carrying none of the three is
**structurally invalid** — an unnamed check cannot be matched by the aggregation policy's
`task-check` detection, so it would silently exempt a failed task-check from the completion rule.

The alias resolves for raw rows as well as parsed ones (`checkRowName`), because
`aggregateVerifyVerdict` and the done guard's task-check lookup both run over unparsed artifacts.
Precedence is `name` → `check` → `id`, first non-empty string wins.

## Canonical runtime contract + one aggregation policy (task 0592)

The prose shape above is executed by a single runtime-validated contract:
`packages/app/src/services/verify-verdict.ts`. It owns:

- **`verifyVerdictSchema`** (Zod) — validates the persisted artifact and distinguishes
  **missing** (file absent / empty), **malformed** (bad JSON), **structurally invalid**
  (`invalid` outcome), and **valid** (with case-normalized `verdict`). The `scenario`→`id` coverage
  alias and the `check`/`id`→`name` check-label alias are both normalized here, in exactly one place.
- **`aggregateVerifyVerdict`** — the ONE aggregation policy every verdict consumer uses (answer
  derivation, persisted-artifact consistency checks, task/feature validation, record rendering,
  and the done-transition gate). Requirements/AC use `MET`/`PARTIAL`/`UNMET`/`N/A`. Checks:
  non-pass **blocker** → FAIL, non-pass **major** → PARTIAL, **minor**/**advisory** do not block;
  legacy rows without a severity map `fail` → FAIL and `warn` → PARTIAL. An independent task-check
  failure can never yield PASS.
- A row-less artifact aggregates to UNKNOWN — a stored PASS that does not recompute to PASS
  (including a row-less PASS) is treated as non-PASS at the done gate. The done-transition choke
  point (`done-transition-guard.ts` `evaluateDoneTransition`) is the final authority; workflow JSON
  routing may select `verify → record/failed` but cannot weaken the final transition.
- `--force-done --reason` on `spur task update <wbs> done` remains the sole auditable override.
