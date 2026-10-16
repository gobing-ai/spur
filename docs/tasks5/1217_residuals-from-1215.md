---
schema_version: 1
name: Residuals from 1215
status: cancelled
template: standard
created_at: 2026-10-16T04:04:32.313Z
updated_at: "2026-10-16T05:22:23.520Z"

---

## 1217. Residuals from 1215

### Background

Source task: 1215 (feature A91) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:24c7218f — apps/cli/tests/commands/builder/pr.test.ts:128, packages/app/tests/services/pr-review/pr-review.test.ts:1298: The AC scenario names "preflight **and representative mutation-capable operations**" under the caller context, but both delivered two-repository suites exercise only `preflight` (read-only): no test runs `push`/`ensure`/`request`/`collect`/`status` with an explicit cwd+env, so the mutation-capable half of the scenario is proven by structure rather than by a test. The behaviour itself holds and was verified in this review: a fake `gh` that logs `$PWD` and the env marker shows all 7 `gh` calls of `request` running with cwd = the context repo and the context env marker, `REQUESTED` landing in the context cwd's `req.status`, and the process cwd/env untouched; a context-less spine cannot bypass the seam because every runner call site takes `rt` (`packages/app/src/services/pr-review/index.ts:177`, 26 call sites) and nothing else in the module can reach the runner. Test hardening only — the fix is one extra case in the existing suite.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Contained — no deferral remains

Contained in commit `0b15e74ba` (test(builder-pr): cover a mutation-capable operation under the caller context).

- **Both** two-repository suites now exercise a mutation-capable operation (`push`), not only the read-only `preflight`. Each fixture repo owns a real bare remote created in `makeRepo` (`apps/cli/tests/commands/builder/pr.test.ts`, `packages/app/tests/services/pr-review/pr-review.test.ts`); the push is real and only `gh` is faked.
- **Assertions.** The mutation lands in the context repository's remote (`refs/heads/feat/b` on the fixture remote equals the reported pushed head), the sibling repository's remote stays empty, the `PUSHED` status file is written beneath the context cwd, and nothing is written into the sibling repo.
- **Failure sensitivity verified.** Driving the same operation through the spine with no caller context leaves the context repo's remote empty, writes the status file into the process cwd instead of the context repo, and resolves the process checkout's own repository — so the added cases fail without the context seam rather than passing vacuously.
- **Verification.** Focused suites green (`packages/app` 73 pass, `apps/cli` 7 pass); full `bun run spur-check`: 11223 pass / 0 fail.

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-16T05:22:23.520Z backlog → cancelled (system)

