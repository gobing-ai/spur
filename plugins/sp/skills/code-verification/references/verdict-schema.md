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

For answer files, emit a matching parseable table:

```markdown
### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: CLI emits JSON | MET | test | `apps/cli/tests/foo.test.ts:42` |
```

## How the gate reads it

`config/workflows/task-pipeline.yaml`, transition `verify → record`:

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
