# Functional Review Verdict Schema

The machine-readable artifact shape for `sp:functional-review`. This is the **requirements
traceability** contract; for the SECUA quality contract, see
[`sp:code-verification`'s `verdict-schema.md`](../../code-verification/references/verdict-schema.md)
(`VerifyVerdict`). The two are complementary — a full `/sp:dev-review` may emit both.

## TypeScript Interface

```typescript
/**
 * Requirements-traceability artifact produced by sp:functional-review.
 * Maps every R{n} requirement to implementation evidence and a per-requirement status.
 */
interface FunctionalVerdict {
    /** Task WBS number, e.g. "0227". */
    wbs: string;
    /** Overall aggregation of per-requirement statuses. */
    verdict: 'PASS' | 'PARTIAL' | 'FAIL';
    /** One row per numbered requirement in the task's ## Requirements section. */
    requirements: RequirementVerdict[];
    /** Free-form summary: counts, notes, zero-requirements case. */
    summary: string;
    /**
     * BDD execution report path, if Track A was used. null for LLM-only (Track B).
     */
    bddReportPath: string | null;
    /**
     * Explicit source scope (if --source-paths given) or derived diff scope
     * (the changed *.ts/*.tsx/*.js/*.jsx files for the task's last commit).
     */
    sourcePaths: string[];
}

interface RequirementVerdict {
    /** Requirement id from the task, e.g. "R1". */
    id: string;
    /** Requirement text (verbatim from ## Requirements). */
    text: string;
    /** Per-requirement status. */
    status: 'MET' | 'PARTIAL' | 'UNMET';
    /**
     * Specific evidence: file:line, named test, or command+exit status.
     * MUST be specific — vague evidence ("implemented correctly") downgrades to UNMET/PARTIAL.
     */
    evidence: string[];
    /** For PARTIAL/UNMET: what's missing. Empty array for MET. */
    gaps: string[];
    /**
     * Assessment track used.
     * - 'bdd' if a BDD report covered this requirement (deterministic)
     * - 'llm' if Track B LLM assessment was used
     */
    track: 'bdd' | 'llm';
}
```

## Aggregation Rule

```
any core requirement UNMET                                  → FAIL
any core requirement PARTIAL (no UNMET)                      → PARTIAL
all core requirements MET                                    → PASS
```

- **Zero-requirements case:** if the task has 0 numbered requirements, return `verdict = PASS`
  with `summary: "No requirements to verify"`.
- **PARTIAL blocks the gate** exactly like FAIL — the distinction only tells the operator *how
  far off* delivery is. Never round PARTIAL up to PASS.
- The verdict is computed from `requirements[].status`; the `summary` field is descriptive, not
  load-bearing.

## JSON Example

```json
{
    "wbs": "0227",
    "verdict": "PARTIAL",
    "requirements": [
        {
            "id": "R1",
            "text": "Add functional-review skill to plugins/sp/skills/",
            "status": "MET",
            "evidence": [
                "plugins/sp/skills/functional-review/SKILL.md:1 — skill file created",
                "plugins/sp/skills/functional-review/references/verdict-schema.md:1 — verdict schema ref"
            ],
            "gaps": [],
            "track": "llm"
        },
        {
            "id": "R2",
            "text": "Add code-improvement skill",
            "status": "PARTIAL",
            "evidence": [
                "plugins/sp/skills/code-improvement/SKILL.md:1 — skill body created"
            ],
            "gaps": [
                "plugins/sp/skills/code-improvement/references/deepening-signals.md — referenced but not yet written"
            ],
            "track": "llm"
        },
        {
            "id": "R5",
            "text": "Add receiving-code-review + verification-before-completion guardrails",
            "status": "UNMET",
            "evidence": [],
            "gaps": [
                "No guardrail reference files found in plugins/sp/skills/code-review/references/"
            ],
            "track": "llm"
        }
    ],
    "summary": "4 MET, 1 PARTIAL, 1 UNMET — R5 guardrails missing, R2 deepening-signals ref pending",
    "bddReportPath": null,
    "sourcePaths": [
        "plugins/sp/skills/functional-review/SKILL.md",
        "plugins/sp/skills/code-improvement/SKILL.md",
        "plugins/sp/commands/dev-review.md",
        "plugins/sp/agents/super-reviewer.md"
    ]
}
```

## Relationship to `VerifyVerdict`

| Artifact | Owning skill | Question | Aggregation |
|----------|-------------|----------|-------------|
| `FunctionalVerdict` | `sp:functional-review` | Did we build what was asked? (requirements completeness) | any UNMET → FAIL; any PARTIAL → PARTIAL; else PASS |
| `VerifyVerdict` | `sp:code-verification` | Is the code SECUA-correct and AC-complete? | any core req/AC UNMET → FAIL; any blocker correctness/security → FAIL; any PARTIAL → PARTIAL; else PASS |

A complete `/sp:dev-review --focus all` pipeline may produce both artifacts; they are consumed by
the pipeline's `record` step and written to the task's `## Testing` section.