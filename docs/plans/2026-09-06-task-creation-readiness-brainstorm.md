---
status: proposed
needs_design: true
---

# Task creation consistency and default implementation readiness

## Approved revision — 2026-09-06

Robin approved the proposal and remaining design gate, with the correction to avoid small tasks.
The five-task decomposition below is superseded by **two** cohesive deliverables: deterministic
creation/check correctness (including serialization and JSON errors), then the complete
ready-by-default CLI/batch/planning flow. Tests, docs and recovery remain in those tasks.
Feature F21 owns delivery. The approved surface is
[task-creation-readiness.md](../design/task-creation-readiness.md), under ADR-109.
The two tasks retain all proposed outcomes; this change reduces per-task ceremony, not scope.
For prepared batches, `--skip-ready` skips synthesis and preserves complete supplied content;
only a bare capture remains backlog. This replaces the original blanket capture-status wording.
The historical approval-pending and five-task sections below record the initial proposal only.

Prepared for the next implementation batch on 2026-09-06. This is a discovery proposal,
not an approved feature or an implementation claim. No production task IDs are allocated.

## Recommendation

Proceed with default ready preparation for `spur task create`, with `--skip-ready` for quick
capture. Reuse the existing ready-refinement competency and agent execution facilities. First
repair the shared creation/check contract, then apply the same readiness outcome to batches and
planning handoff. Do not make an empty scaffold appear ready by weakening execution gates.

Terminal `spur task create` will necessarily take longer when it invokes an installed agent.
An invocation inside a planning skill should prepare the content in the host session and use
the deterministic writer once, avoiding a nested agent call. This preserves the requested single
user action while respecting the existing execution boundary.

## Evidence and verified premises

The source-local CLI is `bun run apps/cli/src/index.ts`. The working tree was initially clean.
Reproductions used separate ignored folders beneath
`.spur/run/task-idea-77282076-c932-4599-945d-6eb4150db1c3/`; their task files are disposable
diagnostic fixtures, not members of the configured implementation corpus.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Bare create succeeds but its immediate check fails | `bare-create.json` and `bare-check.json` in the run folder: create exit 0, check exit 1; `L3.requirements-empty`, `L3.ac-empty`, plus Design and feature-link warnings | The problem also affects backlog capture |
| Feature-linked create assumes `todo` from the link alone | `packages/app/src/services/task-service.ts:529`; linked CLI fixture returns `todo` with empty Requirements and AC | A feature association is being treated as specification completeness |
| Partial batch content also assumes `todo` | `packages/app/src/services/task-service.ts:1390`; background-only batch succeeds then check exits 1 | Fixing only the single-create command leaves the planning pipeline inconsistent |
| Creator and checker already share the section matrix | `config/tasks/section-matrix.yaml:1`; `task-service.ts:420`; `apps/cli/src/commands/task.ts:1526` | Do not add a second template/matrix authority; fix content and status policy |
| Optional scaffold content is rejected regardless of status | `packages/app/src/services/task-check.ts:591` checks any present empty Requirements/AC section | Merely moving every task to backlog does not fix the defect |
| Required-section metadata is incomplete | `packages/app/src/services/planning-check-base.ts:344` derives `requiredSections` from missing-section findings; probes return an empty list although the matrix has requirements | Machine callers cannot reliably use that field as the advertised matrix snapshot |
| Titles are interpolated into quoted YAML without escaping | `packages/app/src/services/task-service.ts:565` and `:1421`; quoted title exits 1; input containing literal `C:\temp` is stored with a tab | Creation can reject ordinary text or silently change it |
| Some create failures violate machine-output expectations | `quoted-create.json`: `--json` produces empty stdout and a generic frontmatter failure on stderr | Automation can mistake an operational failure for missing task identity |
| Handoff treats checker exit 0 as execution readiness | `packages/app/src/workflow/idea-handoff.ts:209`; existing refine action is standard-depth at `task-service.ts:259` | Fixing scaffold errors alone could route underspecified tasks straight to execution |

The linked custom-folder probe also reports feature-not-found because checking resolves features
beside that custom task directory (`task-check.ts:555`). That fixture-specific finding is not
counted as evidence that the real feature F is missing. No claim is made that every possible
template or every newly created task fails. The observed failing paths are enough to justify
the shared fix.

The checker requires Design/Plan headings according to the matrix, but does not establish the
semantic completeness of their bodies. Structural PASS and the seven-item ready-refinement
checklist remain distinct. The installed `sp-dev-refine` contract explicitly requires premise
verification, frozen interfaces, file targets, dependency handoffs, and executable AC at ready depth.

## Approaches

| Approach | Benefit | Cost / limit | Confidence |
| --- | --- | --- | --- |
| Only repair templates and current-status checks | Smallest first patch; eliminates avoidable scaffold failures | Still requires the separate refine action; does not satisfy the full request | HIGH: creator/checker code directly identifies this seam |
| Default ready preparation using existing competencies, plus explicit capture opt-out | Satisfies the requested one-action experience; shares content policy across creation paths | Needs failure recovery and a clear terminal-versus-host execution contract | HIGH on reuse direction; final transport details belong to system design |
| Launch a full task pipeline after every create | Reuses a broad pipeline | Adds execution outside the request and unnecessary latency, cost, and side effects | HIGH: idea pipeline explicitly stops at planning handoff; reject this option |

Use the second approach. Keep readiness preparation bounded; do not build a new agent runtime,
readiness scoring framework, persistent queue, or general workflow engine.

## Design Summary

### Shared deterministic contract

Creation, batch creation, and checking use the same variant/status section policy and validation
capability. The write service remains the only persistence owner. Fix input serialization at
the common task content producer, using existing YAML serialization rather than manual escaping.
Preserve names and tags exactly, including quotes, backslashes, colons, Unicode, and multiline
strings where the input schema permits them. Reject disallowed input before any file is written.

Current-status capture validation must accept deliberately absent/unfilled optional planning
sections in backlog without emitting scaffold-only noise. Required fields and authored invalid
content still fail. `todo` and target-state checks must not admit missing implementation contracts.
Expose the complete required-section list from the resolved matrix; report missing sections
separately. Keep diagnostic severity and `--strict` behavior explicit and compatible.

`--skip-ready` means capture, not validation bypass. It leaves a backlog task with a truthful
background and no claim of readiness. Missing feature association remains an explicit advisory
under the existing policy; never auto-link a speculative feature to make warnings disappear.
Clean, sufficiently specified, correctly linked inputs should produce no creation-induced errors
or warnings. Real traceability, dependency, or malformed-content findings must still be reported.

### Ready preparation

Default creation completes the allowed Background, Requirements, AC, Design, and Plan sections
to the existing `--depth ready` checklist and performs a deterministic post-check before returning
ready success. Preserve supplied intent and scenario titles. Do not fabricate external facts or
fill implementation-owned Solution, Testing, or Review evidence.

Reuse the existing planner-role/agent selection and timeout facilities for a standalone CLI;
document its invocation and cost. In a host planning session, synthesis stays inline and uses
the same competency. Keep model execution outside file locks and out of low-level write methods,
which are also called by server handlers. Do not silently introduce agent execution into HTTP
task creation; that transport change is outside this batch's requested default CLI behavior.

Success output retains existing WBS/path fields and adds a small readiness outcome. If creation
has committed before preparation fails, return a nonzero exit, the existing WBS/path, the failed
stage and an actionable resume command for that WBS. Preserve user-authored content. Never return
ready success on a failed/aborted/missing-agent run, retry by blindly creating another task, or
execute implementation as part of preparation. Exact additive field names and exit mapping are
to be frozen in the approved surface design using existing error conventions.

### Batch and handoff

Prepare and validate the whole batch before its commit boundary. Already prepared input uses
the deterministic path without another synthesis pass. Incomplete input is completed once by
the planning owner or rejected with structured per-item gaps when no model executor is selected;
an opt-out capture batch uses the same explicit semantics as single capture. Preserve the existing
batch return shape and atomicity; no long-running synthesis under allocation locks.

Planning handoff consumes actual ready-preparation evidence as well as task checks. A clean
structural check alone cannot trigger a run recommendation. A failed or explicitly skipped ready
pass produces one precise refinement/recovery command. Specification readiness does not mean
upstream dependencies are already done: keep dependency ordering and execution prerequisites
visible and enforce them at their existing gates.

## Proposed next implementation batch

Schedule this after the current workflow enhancement batch. Owning capability is F2 (Task
management CLI); choose a delivery child beneath F2 through the feature CLI after approval,
and reconcile any required parent lifecycle state through the CLI. Do not add a new root.
F92 owns related historical completion work, but this slice is task creation and preparation.

| Order | Task | Scope and acceptance evidence | Dependencies |
| --- | --- | --- | --- |
| 1 | Align task creation and status-aware validation | Shared matrix/content policy; accurate `requiredSections`; backlog capture avoids scaffold errors; complete todo passes; missing/invalid required content still fails; exercise all supported variants and project/bundled matrix resolution | None |
| 2 | Preserve task inputs and structured creation errors | Shared single/batch YAML rendering; exact text round trips; invalid input causes no writes; `--json` and envelope mode return parseable errors with nonzero exits | None |
| 3 | Make single task creation ready by default | Reuse ready refinement and existing execution facilities; `--skip-ready`; post-check; no hidden HTTP synthesis; existing-task recovery after preparation failure; preserve WBS/path output | 1, 2 |
| 4 | Apply readiness consistently to batch creation | Prepare-before-commit; complete batch avoids duplicate synthesis; capture opt-out; item diagnostics; no partial batch or unintended parent transitions on rejected input | 1, 2, 3 |
| 5 | Integrate ready creation with planning and handoff | Update canonical skill/command owners and relevant workflow call sites; consume ready evidence; retain dependency ordering; document CLI surface and migration; source and seeded-runtime behavior agree | 3, 4 |

Tasks 1 and 2 have disjoint responsibilities but share task-service code; execute sequentially
in this worktree. Each task gets full Design, R-numbered Requirements, Plan, and mapped feature
scenarios during decomposition. Do not create a second cleanup-only batch or defer ready depth
to another manual refine invocation for the new implementation tasks.

## Draft acceptance contract

1. **R1 — Ready task creation passes the creation contract.** Given sufficient verified context
   and valid traceability, when default creation completes, then its allowed planning sections
   satisfy the ready checklist and a fresh task check has no creation-induced findings.
2. **R2 — Capture is explicitly unready.** Given `--skip-ready`, when creation runs, then no model
   is invoked, the task remains backlog, and optional scaffold gaps do not become hard failures.
3. **R3 — Required and authored content remains validated.** Given a missing required section
   or malformed authored AC, when checking the applicable target status, then the finding remains
   actionable and the gate cannot be bypassed by capture mode.
4. **R4 — Matrix metadata is complete.** Given a task with all required headings present, when
   checking it, then requiredSections still enumerates the resolved variant/status requirements.
5. **R5 — Task text round-trips unchanged.** Given quoted/backslash/Unicode names and allowed
   tag strings, when single or batch creation succeeds, then show returns the exact original text.
6. **R6 — Preparation failure is recoverable.** Given a saved task and a failed ready pass, when
   the command exits, then it exits nonzero, identifies the same task and recovery action, and
   leaves neither a fabricated readiness result nor duplicate task.
7. **R7 — Machine errors are usable.** Given invalid input or readiness failure under raw JSON
   or envelope mode, when creation exits, then stdout is one parseable result with the appropriate
   existing identity and error details, and diagnostics do not corrupt it.
8. **R8 — Batch readiness preserves atomic creation.** Given an input batch containing an
   invalid/unprepared item, when the readiness/validation boundary rejects it, then no task or
   parent mutation commits; a fully prepared batch takes no redundant model pass.
9. **R9 — Handoff uses specification readiness.** Given structural PASS but no successful ready
   preparation, when planning finalizes, then it recommends preparation rather than execution;
   ready results retain the existing dependency ordering and execution prerequisites.
10. **R10 — Shared writers do not unexpectedly launch agents.** Given HTTP or internal direct
    writes, when creating a task, then the shared deterministic policy applies without invoking
    model execution; standalone CLI preparation follows the documented agent selection contract.

## Verification plan and limits

The five CLI probes above have run; their stdout/stderr/exit codes and a summary are retained.
Source inspection also covered the server create caller, task check policy, matrix metadata,
batch write/rollback flow, and deterministic handoff. No production fix has been applied, no
implementation readiness verdict has been recorded, and full lint/test/build gates have not run
for this discovery-only change.

Implementation adds focused create→check integration checks against the real matrix, exact-string
round-trip regressions, and fake-executor failure/cost checks. Run the required project gate on
each completed implementation task. Task 1 changes checker policy, so it additionally requires
the explicit unsuppressed corpus audit (T10), classifying pre-existing findings separately and
never introducing accepted-debt suppressions. Ordinary planning corpus writes use affected-input
checks. Source-local and bundled/seeded call paths must be validated before handoff integration
is considered complete.

## Approval and resumption

The inline idea run is `task-idea-77282076-c932-4599-945d-6eb4150db1c3`. Discovery is complete;
the next state is the idea-evaluation taste gate. Invocation had `--auto` but no taste pre-clear.
Approve this direction to create the feature and decompose the implementation batch through
the harness. Design approval remains a separate gate unless the operator clears both.

Spec self-review: no fabricated completion evidence, no new dependency or runtime, no execution
of the planned tasks, no blanket suppression of warnings, and no unverified claim that every
template is broken. The main design decision needing approval is the default CLI model-bearing
preparation contract and its opt-out, which is the behavior the operator proposed.
