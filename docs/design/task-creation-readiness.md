---
status: approved-design
feature: F21
adr: ADR-109
updated_at: 2026-09-06
---

# Task creation and implementation readiness

Approved for implementation; the flags and outcomes below are planned, not shipped.
The existing command registrations remain the authority for currently available flags.

## Planned command changes

| Surface | Addition | Contract |
| --- | --- | --- |
| `spur task create <title>` | `--skip-ready`, `--agent <selector>` | Default prepares the saved task to ready depth; skip captures a title-only backlog task without model execution |
| `spur task batch-create --file <path>` | `--skip-ready`, `--agent <selector>` | Default assesses/prepares the whole batch before commit; skip persists caller-prepared content after deterministic validation |
| `spur task check [wbs]` | No new flag | Accurate matrix metadata and status-aware content findings; existing `--as`, `--strict` and JSON options retain their meaning |

Agent selection follows ADR-047. A standalone CLI resolves a real installed executor; a calling
host session performs synthesis inline and invokes `batch-create --skip-ready` for its prepared
array, including a one-item array. Omission on the standalone CLI uses the configured default.
Skip bypasses synthesis only. It never bypasses input validation, invents readiness evidence,
erases supplied sections, or downgrades a complete supplied specification to a bare capture.

## Persistence and check outcomes

| Input | Persisted outcome |
| --- | --- |
| Bare capture | Substantive capture Background, backlog; optional blank planning bodies produce no scaffold-only findings |
| Valid complete supplied specification | Eligible for todo under the shared candidate policy; semantic ready evidence is a separate outcome |
| Malformed authored content | Reject before persistence, with actionable findings |
| Default single ready preparation succeeds | Same WBS, ready planning sections, successful post-check, lifecycle promotion to todo |
| Single preparation fails after capture | Preserve WBS/path and authored work; nonzero failure with recovery command |
| Batch preparation/schema/content validation fails | No task files or parent mutations commit |

All variants use the selected project/bundled section matrix. `requiredSections` lists the full
resolved matrix requirements; `missingSections` lists only missing headings. Target-state checks
use the target entry. Required planning bodies at todo cannot remain placeholders. Authored
invalid content, traceability failures, dependency findings and completion evidence remain checked.
Missing feature association retains its real advisory; it is never silently repaired by guessing.

Task names and tag strings must round-trip exactly through YAML and `show`, including quotes,
backslashes, Unicode, colons and schema-permitted line breaks. Invalid input must not leave files.

## Output and failure contract

Existing `ref`, `wbs`, `filePath`, `created`, ordered `wbs[]`, `parentsWired`, and raw/envelope
output conventions remain intact. Creation adds:

```typescript
readiness: {
    status: 'ready' | 'skipped' | 'failed';
    depth: 'ready';
}
```

Preparation failure exits 1. Existing usage, dedupe and collision exit mappings remain unchanged.
Error details identify the failed stage and `recoveryCommand`; after a single capture commits,
the result also carries its existing WBS/path. The recovery action is
`/sp:dev-refine <wbs> --auto --depth ready`. JSON stdout is exactly one parseable result;
captured agent output cannot corrupt it. No automatic second create, implementation dispatch,
or fabricated Solution/Testing/Review evidence is part of creation.

## Planning evidence and handoff

The planning owner applies the existing ready-refinement checklist and writes the private artifact
`.spur/run/<runId>-idea-ready.json` after WBS mapping and dependency wiring:

```typescript
{
    runId: string;
    depth: 'ready';
    tasks: Array<{
        wbs: string;
        status: 'ready' | 'failed' | 'skipped';
        planningDigest: string;
        checks: Array<{ id: string; pass: boolean; evidence: string }>;
    }>;
}
```

Checklist IDs: `requirements`, `design`, `plan`, `ac`, `decisions`, `dependencies`, `premises`.
`planningDigest` is SHA-256 over allowed planning sections plus feature, template and dependency
metadata, excluding timestamps and execution-owned sections. Handoff requires the current run,
matching WBS set and digests, seven successful checks with nonempty evidence, and valid task checks.
The artifact records the planning owner's semantic assessment; its structure is not itself proof
that the design is correct.

Missing, stale, failed or unprepared-skip evidence yields the existing ready-refinement handoff.
Ready specifications retain dependency ordering; prerequisites are enforced by existing execution
gates. The monorepo handoff and seeded workflow fallback have the same outcome contract.

## Delivery

Two sequential tasks under F21: deterministic creation/check correctness (including serialization
and errors), then the complete ready-by-default CLI/batch/planning flow. Both own their tests and
documentation. No new dependency, agent runtime, queue, public noun/verb, or HTTP model execution.
Checker-policy implementation includes the explicit unsuppressed corpus audit; ordinary planning
edits use affected-input checks. Feature task IDs and status are maintained by `spur feature`.
