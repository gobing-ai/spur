---
kind: design
title: "Task creation and implementation readiness"
status: implemented
created_at: 2026-09-06
updated_at: 2026-10-08
related: [F21]
tags: [contract, F21, planning]
adr: ADR-109
---

# Task creation and implementation readiness

Shipped by F21 task 0788. The flags and outcomes below are live; the existing
command registrations remain the authority for currently available flags.

## Command changes

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
`/sp:dev-refine <wbs> --auto --depth ready`; on a passing checklist it runs the same `todo`
post-check and promotes `backlog → todo` itself, so no separate status step follows. Creation's own
promotion is skipped when the refine has already promoted. JSON stdout is exactly one parseable result;
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
`planningDigest` is SHA-256 over allowed planning sections plus feature and template,
excluding timestamps and execution-owned sections. Dependency frontmatter is deliberately **not**
bound: `handoff-finalize` applies `spur task deps` after `ready-prepare` binds the digest and
before it verifies it, so binding dependencies would make the pipeline invalidate its own
preparation evidence (task 0875). Dependency drift stays checked by the ready-checklist
`dependencies` row and `spur task check`. Handoff requires the current run,
matching WBS set and digests, seven successful checks with nonempty evidence, and valid task checks.
The artifact records the planning owner's semantic assessment; its structure is not itself proof
that the design is correct.

Missing, stale, failed or unprepared-skip evidence yields the existing ready-refinement handoff.
Ready specifications retain dependency ordering; prerequisites are enforced by existing execution
gates. The monorepo handoff and seeded workflow fallback have the same outcome contract.

## Write-time normalization and the parent-status link guard (1132)

Three write-path behaviors close the write→check→rewrite loop and the terminal-parent link hole.
Normalization is **lossless**: it rewrites markers and numbering punctuation, never the author's
words.

| Surface | Behavior | Report field |
| --- | --- | --- |
| `spur task update <wbs> --section Requirements --from-file` | Loose R-item shapes (`R1:`, `R1 -`, `**R1**`, `**R1.**`, missing checkbox) become `- [ ] R1. …`, R-number and text unchanged | `normalized: [{section, kind, count}]` |
| `spur task update <wbs> --section "Acceptance Criteria" --from-file` | Bare `- AC1 …` bullets become `- [ ] AC1 — …`; when **every** item is a gherkin `Scenario:` carrying `(req: Rn)`, frontmatter `ac_altitude: task-local` + `ac_numbering: task-local` are set | `normalized` (kind `ac-altitude` for the implied frontmatter) |
| `spur task batch-create` | Requirements and AC bodies normalize through the same predicate before the files commit | per-item `normalized` |

The normalizer is one pure function, `normalizeTaskSection` (`packages/app/src/services/
task-section-normalizer.ts`), and it shares one "is this an R-item" answer with the checker: it
consumes the R-item regular expression exported from `structural-repair.ts` (the same predicate
`task check --fix` uses) as its detection fallback, and it applies that module's
"already checkboxed → byte-untouched" skip. Its own grammar is deliberately a **superset** of what
the checker flags — the checker does not flag `R2: text` or a bare `**R3**`, and normalizing those
loose authoring shapes is exactly the point of R1 — so write-time normalization repairs more than
`task check --fix` would, never less.

**Parent-status link guard.** `task create --feature` / `task update --feature` resolve the parent
feature and act on its status **before** any write (service layer, `TaskService`, so HTTP writers
get the same guard):

| Parent status | Outcome |
| --- | --- |
| `done` / `cancelled` | Rejected — structured error naming the status and up to three `active` siblings in the same ID group; no task file is written |
| `verifying` | Reopened to `active` through the existing guarded feature transition (never a raw frontmatter write); result carries `featureReopened: {id, from: "verifying", to: "active"}` |
| anything else | Link proceeds unchanged |

**Flag decision — `--no-reopen` (operator-consented, 2026-10-08).** R2's authoring left the flag to
explicit consent under the public-surface rule (`AGENTS.md` § Spur CLI surface). Consent was granted,
so `--no-reopen` ships on `task create` / `task update`: it restores the pre-1132 behavior by
accepting a `verifying` parent **without** reopening it, and never bypasses the `done`/`cancelled`
rejection. Without the flag the reopen is automatic.

**`feature check --fix` reopen.** A `verifying` or `done` feature that still has linked live tasks
(`backlog|todo|wip|testing|blocked`) is reopened to `active` and reported as repair kind
`feature-reopen`; with no live tasks it is a no-op. Feature-check severities are untouched —
`L4.verifying-incomplete-tasks` stays a warning before `done`.

## Delivery

Two sequential tasks under F21: deterministic creation/check correctness (including serialization
and errors), then the complete ready-by-default CLI/batch/planning flow. Both own their tests and
documentation. No new dependency, agent runtime, queue, public noun/verb, or HTTP model execution.
Checker-policy implementation includes the explicit unsuppressed corpus audit; ordinary planning
edits use affected-input checks. Feature task IDs and status are maintained by `spur feature`.
