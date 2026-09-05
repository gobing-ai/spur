# D61 implementation handoff

Depth: `ready`. Selector: `feature:D61`. Eight tasks frozen; none excluded.
Refinement only: implementation and its verification remain outstanding.

Approved scope: [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits),
[design](../design/essential-workflow-checks.md),
[feature](../features/D61_essential-workflow-checks-and-observable-execution.md).
Source inspected: `4801db1bd37422614040eeefcb1afb72d59eede1` plus the D61 planning changes in this tree.

| Order | Task | Dependency inputs | Implementation output |
| --- | --- | --- | --- |
| 1 | 0765 | Existing check/proof services | Explicit essential-error policy; normal target-state checks |
| 2 | 0766 | 0765 | Explicit unsuppressed corpus audit; no routine sweeps/acceptance |
| 3 | 0767 | 0766 | Live composition consumers; retired mirror/regeneration gate |
| 4 | 0768 | 0765 | Shared plan/version/digest identity and truthful progress |
| 5 | 0769 | 0766, 0767, 0768 | idea-pipeline, docs-pipeline, wayfinder-resolution |
| 6 | 0770 | 0766, 0767, 0768 | task-lifecycle, feature-lifecycle, feature-dev, wrapup-pipeline |
| 7 | 0771 | 0767, 0768 | basic, history-anatomy, pr-review |
| 8 | 0772 | 0769, 0770, 0771 | task-pipeline last; eleven-file bundle and measured rollout |

Use `spur task show <wbs> --json` for each self-contained contract. Each task names its source seams,
frozen behavior and identifiers, anti-patterns, ordered R-mapped Plan, positive/negative tests,
dependency inputs and downstream outputs. Feature scenario titles remain unchanged.

## Execution instructions

```text
/sp:dev-runall --feature D61 --auto

Implement D61 using tasks 0765–0772 in dependency order. Their Design/Plan sections
are implementation-ready; use the frozen contracts rather than re-plan the feature.
Run each task through implementation, review and real verification, then commit it.
Keep one writer per worktree. Do not activate D9 fast mode or publish/merge/release.
Capture matched pre-change measurements before editing each owned workflow/checker;
0772 combines those into the rollout report. Missing usage data stays unknown.
```

The receiving agent needs this tree's D61 planning files, including task/feature documents;
a different checkout needs the planning changes transferred before execution. Local `.spur/run`
files are audit aids, not required to understand the task contracts. Keep unrelated work intact
and satisfy the repository's clean-per-task branch/commit discipline before implementation.

The batch is designed for sequential execution. Although the dependency graph permits some
independent work, tasks touch shared docs and helpers; parallel execution requires isolated
worktrees and deliberate integration, not multiple writers here.

## Closed decisions and corrected premises

- `bun run corpus-check` remains an explicit audit. Warnings alone pass; essential errors fail;
  no finding is suppressed. Remove routine sweep callers and both acceptance/mirror regenerators.
- Keep the JSON response fixture, history comparison data, proof digest algorithm and meaningful
  report/parser validation. Delete `composition-entrypoint-check` after its only two subjects retire.
- Workflow version validation and `show --format todo` already exist; complete their shared identity
  and execution integration. Each of the eleven upgraded definitions receives quoted version `"1"`.
- Task 0723 is done; its precheck is already doctor-free. `basic` has a valid root `check` script.
  `### Testing` is the canonical task heading; length-based evidence is the wayfinder defect.
- Feature `asStatus` currently has incomplete coverage. The first task freezes target-state policy
  before downstream callers drop blanket strictness. Review-request success is not collected CLEAN.
- D9 Option B stays in force. Simulated branch fixtures do not satisfy real-run fast-route coverage.

## Refinement verification

Per-task normal checks and the seven-item ready checklist are recorded after CLI-gated updates.
No implementation PASS is claimed here.

`/sp:dev-refineall --feature D61 --auto --depth ready`, 2026-09-04. Verdict `clean`; eight of eight
attempted, none excluded, none blocked. Every Design premise was re-checked against this tree —
named source files, helper symbols, test paths, baseline counts (299 corpus keys, 11 composition
workflows, zero dispositions), the wayfinder length proxies, the shared wrapup learnings path,
0723's done status, and the absence of any `version:` tag on the eleven definitions all hold as
written.

| WBS | Outcome | Note |
| --- | --- | --- |
| 0765 | SKIP | Checklist met; feature/task `asStatus` asymmetry confirmed in source |
| 0766 | SKIP | Checklist met; `loadAcceptedFindings` consumers and regenerator confirmed present |
| 0767 | SKIP | Checklist met; five-consumer replacement table maps to existing exports |
| 0768 | refined | Design/Plan/Q&A — froze identity-persistence failure semantics (see below) |
| 0769 | SKIP | Checklist met; idea/docs/wayfinder defects confirmed at named lines |
| 0770 | SKIP | Checklist met; lifecycle, feature-dev and wrapup defects confirmed |
| 0771 | SKIP | Checklist met; `basic` default valid, `sh -c` precedent confirmed in task-pipeline |
| 0772 | SKIP | Checklist met; precheck, bundle and D9 dormancy premises confirmed |

0768's frozen contract reused `withDefinitionDigestRecording`, whose `mergeMetadata` failure is
swallowed, while `continueRun` skips drift comparison on a null persisted digest — so R1 could pass
vacuously and a silently unstamped run would resume unguarded. The refinement makes identity
stamping fail run creation and denies resume for a post-change run with no digest, keeping the
null-skip path only for pre-change rows. That converts a previously silent best-effort write into a
hard creation failure for every workflow run; the blast radius is deliberate and carries its own
negative test in Plan step 2.

Post-refine `spur task check` passes on all eight. Remaining L4 advisories are
`prerequisite-not-done` (dependencies are still `todo` before execution) and two `gate-language`
notes on 0765; none blocks handoff.
