---
template: standard
schema_version: 1
name: "Fix consolidated open findings from 2026-07-18 dogfood runs (0280/0292/0293)"
description: ""
status: done
type: task
profile: standard
feature_id: H4
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-18T22:51:48.132Z"
updated_at: "2026-08-18T04:42:47.595Z"
---

## 0294. Fix consolidated open findings from 2026-07-18 dogfood runs (0280/0292/0293)

### Background
On 2026-07-18, tasks 0280, 0292, and 0293 were driven through the harness with dogfood monitoring, producing six reports under `docs/dogfood/`:

1. `2026-07-18-0280-sp-dev-run-dogfood.md` (`/skill:sp-dev-run 0280 --auto --next`)
2. `2026-07-18-sp-dev-verify-0280-dogfood.md` (`/sp:dev-verify 0280 … --fix all`)
3. `2026-07-18-omp-capacity-dogfood.md` (`spur agent doctor omp`)
4. `2026-07-18-sp-dev-verify-0292-dogfood.md` (`/sp:dev-verify 0292 … --fix all`)
5. `2026-07-18-skill-sp-dev-run-0293-dogfood.md` (`/skill:sp-dev-run 0293 --auto --next`)
6. `2026-07-18-sp-dev-verify-0293-dogfood.md` (`/sp:dev-verify 0293 … --fix all`)

Across the six reports, 32 findings/issues were raised (including positive observations). This task consolidates the **still-open** ones after a triage against HEAD (`c63edca4`, clean tree, 2026-07-18). Every item below was re-verified against the current tree before inclusion — findings already fixed or invalid are excluded from scope and recorded here so no effort is re-spent on them.

**Verified FIXED at HEAD (excluded from scope):**

| Finding (report) | Fixed by | Evidence at HEAD |
| --- | --- | --- |
| P2: `* → done` not verdict-gated (0280 dev-run) | Task 0292, commits `80aa1aa6` + `8a9d9931` | `packages/app/src/services/done-transition-guard.ts` reads `.spur/run/<wbs>-verdict.json`, recomputes aggregate from rows, harsher-wins |
| P2: verdict aggregation prose-applied / FAIL→PARTIAL softening (verify-0280) | Same guard: `computeAggregate` cross-checked against `deriveVerdict` (R10 tests, `8a9d9931`) | `done-transition-guard.ts:126-141,238,255-257` — stored vs computed aggregate, harsher wins; softened verdicts cannot pass the done gate |
| P2: implement-heavy gate misses `--fix all` (verify-0280) | Task 0293, commits `ca0c6eb8` + `c63edca4` | `detect-pipeline-driving.ts:186,219,235` — `mutatingFix` detection + refuse gate without `--max-retry` |
| P3: `undefined → undefined` no-op message (verify-0280) | 0292 R9 | Live-confirmed in verify-0292 run: `0292: already done — no transition` |
| Case-variant `Done` bypassed verdict gate + missing R10 pin (verify-0292, fixed in-run) | Commit `8a9d9931` | `apps/cli/src/commands/task.ts:68,245,293` — `canonicalStatusOrRaw` |
| wayfinder-resolution.yaml verdict-blind auto-record + `--no-lifecycle` (verify-0280, fixed in-run) | Commit `783227f2` | `config/workflows/wayfinder-resolution.yaml:82,159` — verdict file + `grep -qx PASS` auto-guard, lifecycle-enforced record |
| collect.ts symlink-glob + bold-`Result:` parser (verify-0280, fixed in-run) | Committed with baseline | `.spur/run/wayfinder-O/baseline/collect.ts` |
| P-pre/P3: 0280 AC scenario missing from feature O AC (DD-09 L4) (0280 dev-run + verify-0280) | AC aligned during wrap | `docs/features/O_*.md:47` — "Scenario: Baseline remains usable when provider telemetry is absent" now present; no DD-09 rule relaxation needed |
| P3/P4: `--save` no-op + `--full` indistinguishable (0280 dev-run, 0293 dev-run) | dev-dogfood.md updated | `plugins/sp/commands/dev-dogfood.md:36,38` — `--save` documented as back-compat no-op; `--full` documented as P1–P4 filter toggle |
| 0293 `testing→done` provenance + Review-L3 denials (verify-0293, resolved in-run) | Guards working as designed; recorded override + authored Review table | Not defects — the **documentation gap** they exposed is R1 below |

**Invalid / no-action (excluded from scope):**

| Finding | Reason |
| --- | --- |
| Low cache hit rate (verify-0280 ~38%, verify-0292 ~41%, verify-0293 ~47%) | Marked `[unverifiable]` in-report; chars/4 heuristic trend, driver-discipline signal with no code target |
| Bun.Glob does not follow directory symlinks (verify-0280 P4) | Knowledge item; already recorded in `collect.ts` + `inventory.json` (`workflowAlias`) |
| Historical report `status: completed` vocabulary (verify-0280 P4) | Protocol @1.2 already rejects it for new runs; aggregator-awareness only |
| DD-07 `feature_id: null` on 0293 (0293 dev-run, unresolved list) | Valid deferral; L4 advisory by design |
| Positive findings (honest evidence ×2, recursive hazard handled) | Observations confirming intended behavior; no action |

Everything remaining is in Requirements below, deduplicated across reports with per-item source, current-state evidence, and required change.
### Requirements
Seven deduplicated open items. Priority = highest severity among the merged source findings.

- [x] R1. **Core, P2 — `dev-verify.md` §`--next` documentation refresh.**
  Merges: verify-0292 P2 (stale already-terminal note), verify-0293 P2 ×2 (undocumented gate layers; Review contract tension), verify-0280 P3 (already-terminal edge).
  Current state: `plugins/sp/commands/dev-verify.md:34,87-89` document only the `--strict-core` guard on `testing → done`; `dev-verify.md:96-99` still says the CLI prints "an unhelpful `undefined → undefined`" and that "honest no-op messaging is tracked in task 0292" — R9 shipped, the CLI now prints `<wbs>: already done — no transition`.
  Required:
  - (a) Rewrite the already-terminal note to describe the honest no-op and drop the "tracked in task 0292" clause.
  - (b) Document **all three** gate layers the live `testing → done` transition runs, each with its remediation: (1) strict-core + verdict-artifact gate (0292; verdict must be PASS, artifact recomputed from rows), (2) provenance guard (no recorded pipeline run → denial; recorded bypass `SPUR_PROVENANCE_OVERRIDE=1`), (3) Review L3 gate (populated P1–P4 `### Review` table required; remediation `/sp:dev-review <wbs>`). The verify-0293 run was denied by (2) then (3) in sequence — the doc predicted neither.
  - (c) Document the contract tension explicitly: verify mode is forbidden from writing `## Review` (code-verification SKILL.md Step 10), yet the done-gate requires a populated Review table — so a standalone `/sp:dev-verify --next` on a task that skipped `/sp:dev-review` can never reach `done` unaided. State "run `/sp:dev-review` first" as a `--next` precondition (or make the review-pending stop message point at it). Keep the Step 10 write prohibition intact.

- [x] R2. **Core, P2, HIGH confidence — `/sp:dev-run --next` on a `backlog`-seeded task.**
  Source: 0293 dev-run P1. Current state: `plugins/sp/commands/dev-run.md` contains zero mentions of `backlog`; the FSM correctly refuses `backlog → wip` (`GuardDeniedError: No transition from "backlog" to "wip"`), and the chain has no documented pre-step, so an operator running `/sp:dev-run <wbs> --auto --next` on a backlog task hits a raw guard denial with no in-skill remediation. The 0293 run worked around it by hand (`backlog → todo` then `todo → wip`).
  Required: pick and implement one of — (a) chain auto-promotes `backlog → todo` as a documented step 0 of mode resolution (recommended; see Design), or (b) emit a clear operator-facing error naming `spur task update <wbs> todo` as the fix. Either way, `dev-run.md` §Mode resolution / `--next` chain must state the status precondition.

- [x] R3. **Core, P2 — `spur task verdict` answer-file contract: undocumented shape + unhelpful UNKNOWN path.**
  Merges: 0293 dev-run P2 (parser shape undocumented) + verify-0293 P3 (stale UNKNOWN artifact yields confusing done-denials).
  Current state: `packages/app/src/services/task-verdict.ts:40-49,80,137` — parser extracts structured Requirements/AcceptanceCriteria rows; zero parsed requirements → `verdict: "UNKNOWN"`. `plugins/sp/skills/spur-cli/references/tasks/verbs.md:194` documents only the `--from-answer <path>` flag, not the expected file shape; `dev-verify.md` does not mention it at all. Free-form prose — exactly what a chained dev-verify leg naturally writes — parses to UNKNOWN; the resulting `.spur/run/<wbs>-verdict.json` (source `spur-task-verdict`) then triggers a done-gate denial that does not tell the operator what to do (observed live in verify-0293: the stale UNKNOWN artifact would have denied the 0292 gate with no remediation hint).
  Required:
  - (a) Document the expected answer-file shape (requirement rows + AC table format the extractors parse) in `sp:spur-cli` (`tasks/verbs.md`, and `tasks.md` if it summarizes verdict) and add a pointer from `dev-verify.md`.
  - (b) When the done-gate denies on an UNKNOWN artifact whose `source` is `spur-task-verdict` (or the artifact parses to zero rows), the denial message must name the remediation: `run /sp:dev-verify <wbs>`.
  - (c) Decision point (see Design): do NOT add a lenient marker-line fallback to the parser unless the operator overrides — UNKNOWN is the honest answer for unparseable input; the fix is documentation + actionable denial, not loosening.

- [x] R4. **Non-core, P3 — empty `### Design` placeholder passes `task check` silently.**
  Merges: verify-0292 P3 + verify-0293 P4. Current state: `packages/app/src/services/task-check.ts:588,644` check section *presence* only (Background/Requirements/Design/Acceptance Criteria/Plan); both 0292 and 0293 reached `done` with an empty `### Design` while `--strict-core` passed, forcing verify's design-conformance step to fall back to `### Solution` as the design authority.
  Required: add a warning-level content check — `### Design` present but empty (or placeholder-only) on standard-profile tasks → L4 WARN naming the section (severity choice justified in Design; must not fail existing corpus). Include tests in `packages/app/tests/services/task-check.test.ts`.

- [x] R5. **Core, P1, investigation — task-pipeline `agent.run` implement-step stalls while direct `spur agent run` succeeds.**
  Source: omp-capacity P1 (the only P1 across all six reports). Current state: direct capacity probes pass (Codex `CAPACITY_OK`; omp `usable`, `omp/17.0.4`), but the task-pipeline `/sp:dev-run --mode implement` step stalled under **both** OMP and Codex; stale run `423a2d9a-…` had to be cancelled. Recorded evidence: `.spur/run/423a2d9a-5714-40ae-819b-6fcd658576b7`, `.spur/run/b4c3b395-bffa-4989-a3fa-d2202fb928ef`, `.spur/run/ceecda6f-547e-438a-8bbf-1efc21a5f338`.
  Required: root-cause the divergence between direct `spur agent run` and the pipeline `agent.run` step — inspect the command construction, prompt/answer contract, and timeout handling in `config/workflows/task-pipeline.yaml` and the dev-run `--mode implement` integration. Deliverable is a written root-cause hypothesis with evidence (in this task's Solution); if the fix is non-trivial, spawn a follow-up implementation task rather than expanding this one. Timeboxed (see Plan).

- [x] R6. **Non-core, P4 — dogfood protocol micro-gaps.**
  - (a) Live-ledger write mode (0280 dev-run P1, LOW confidence): `monitor-ledger.md:13,32` mandates per-step live writes ("never reconstructed", "Do not batch rows until Phase 4"), yet the 0280 run batch-wrote all rows at finalize and still validated `complete`. Decide and codify: either add an explicit fast-run exemption (batch-finalize permitted for sub-3-minute runs, noted in the report) or keep the strict mandate and state that finalize-only writes are a protocol violation the driver must self-report as a finding. No enforcement tooling required — this is a protocol-text decision.
  - (b) Single-dash lenient parsing (verify-0293 P4): operator typed `-max-retry 3`; the driver silently parsed it as `--max-retry 3`. Since the mutation-acknowledgment refuse-gate keys on this exact flag, note the lenient parsing in `dev-dogfood.md`'s argument table and require the driver to echo the normalized flag.

- [x] R7. **Non-core, P4 — corpus/artifact hygiene sweep.**
  All via CLI-gated writes (`spur task update … --section … --from-file`); never raw edits.
  - (a) 0292 `### Solution` stale counts (verify-0292 P4): `docs/tasks2/0292_….md:152` says "20 unit tests" (post-fix: 23); `:157` says "7 integration tests" (post-fix: 9 guard tests / 8 scenarios).
  - (b) 0293 `### Solution` mislabel (verify-0293 P3): `docs/tasks2/0293_….md:100` says "All 49 pre-existing tests" — pre-change bun count was 41; 49 is the post-change total (already acknowledged in 0293's own Review table at `:147`).
  - (c) `.spur/run/0231-verdict.json` contains markdown, not JSON (verify-0280 P4; confirmed still true at HEAD: file starts `## Verify Verdict — 0231`). Since the 0292 done-gate now treats unparseable artifacts as deny, stale malformed artifacts have teeth. Rewrite it as schema-shaped JSON preserving the recorded verdict (or delete it if 0231 is terminally closed and the history lives in the task file). Local-only state; no commit needed for (c).
### Acceptance Criteria
```gherkin
Scenario: dev-verify --next documents all three done-gate layers honestly (R1)
  Given plugins/sp/commands/dev-verify.md at the fix commit
  When an operator reads the §--next chain section
  Then it lists the strict-core + verdict-artifact gate, the provenance guard, and the Review L3 gate
  And each gate names its remediation (verdict PASS via verify; SPUR_PROVENANCE_OVERRIDE=1 recorded bypass; /sp:dev-review)
  And the already-terminal note describes the honest no-op "<wbs>: already done — no transition"
  And no text claims the no-op messaging is still tracked in task 0292
  And a stated precondition (or the review-pending stop message) directs a standalone --next user to run /sp:dev-review first

Scenario: dev-run --next on a backlog-seeded task has a defined outcome (R2)
  Given a task whose frontmatter status is "backlog"
  When the operator invokes /sp:dev-run <wbs> --auto --next
  Then the chain either promotes backlog → todo as a documented step 0 and proceeds
  Or stops with an operator-facing message naming "spur task update <wbs> todo" as the remediation
  And no path surfaces a raw GuardDeniedError with no in-skill guidance
  And dev-run.md states the status precondition in its mode-resolution/--next section

Scenario: UNKNOWN verdict artifacts carry an actionable remediation (R3)
  Given .spur/run/<wbs>-verdict.json with verdict "UNKNOWN" produced by spur task verdict from a prose answer file
  When a testing → done transition is attempted
  Then the denial message names the artifact source and directs the operator to run /sp:dev-verify <wbs>
  And the expected answer-file shape is documented in sp:spur-cli tasks/verbs.md with a pointer from dev-verify.md

Scenario: empty Design placeholder surfaces a warning (R4)
  Given a standard-profile task whose "### Design" section exists but is empty or placeholder-only
  When spur task check <wbs> runs
  Then a warning-level finding names the empty Design section
  And previously-passing tasks with populated Design sections produce no new findings

Scenario: pipeline agent.run stall has a written root cause (R5)
  Given the recorded stall runs 423a2d9a, b4c3b395, and ceecda6f under .spur/run/
  When the timeboxed investigation completes
  Then this task's Solution contains a root-cause hypothesis with file:line evidence covering the pipeline agent.run command construction, answer contract, and timeout handling
  And if a code fix exceeds this task's scope a follow-up task exists with the fix requirements

Scenario: protocol and corpus hygiene items are closed (R6, R7)
  Given the dogfood protocol references and the 0292/0293 task files
  When the fixes land
  Then monitor-ledger.md states an explicit decision on batch-finalize for fast runs
  And dev-dogfood.md's argument table notes single-dash lenient parsing with the driver echoing the normalized flag
  And 0292/0293 Solution test counts are corrected via CLI-gated section updates
  And .spur/run/0231-verdict.json either parses as schema-shaped JSON or has been removed
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Scope is mostly documentation-truthing plus two small code changes and one timeboxed investigation. Per-requirement approach and the open decision points:

**R1 — doc-only.** Restructure `dev-verify.md` §`--next` around the actual transition machinery: one subsection per gate layer (strict-core + verdict artifact / provenance / Review L3), each with trigger, denial shape, and remediation, in the order the live transition evaluates them (verify-0293 empirically hit provenance first, then Review L3). Replace the stale already-terminal blockquote with the honest no-op text. Add the `/sp:dev-review` precondition sentence to the chain intro rather than burying it — the contract tension (verify cannot write `## Review`, Step 10) stays as an explicit note so nobody "fixes" it by letting verify write Review.

**R2 — recommended option (a): auto-promote `backlog → todo` as documented chain step 0.** Rationale: the FSM already permits `backlog → todo` unguarded; `--auto --next` expresses the operator's intent to drive the task, so a mechanical two-hop is pure ceremony; the lifecycle guard stays authoritative (no new bypass — the chain just issues the promotion transition first). Option (b) (error + remediation text) is the fallback if the operator prefers `--next` to never mutate status before implement succeeds. This is a skill/command prose change only — the chain instructions live in `dev-run.md`; no CLI change. Surface the choice to the operator at implementation time only if (a) feels too eager; otherwise proceed with (a).

**R3 — docs + denial enrichment; no parser loosening.** (a) Author the answer-file shape from the extractors themselves (`task-verdict.ts:80 extractRequirements`, `:137 extractAcceptanceCriteria`) so the doc matches what the code parses, with one worked example block. (b) Denial enrichment lives where the message is composed (done-transition-guard denial path / CLI presentation in `apps/cli/src/commands/task.ts`): when the artifact's verdict is UNKNOWN — and specifically when `source` is `spur-task-verdict` or zero rows parsed — append `run /sp:dev-verify <wbs>` to the message. Guard behavior (UNKNOWN = deny) is already correct and must not change. (c) Recommendation against a `PASS|PARTIAL|FAIL` marker-line fallback: it would let a one-word file flip a gate that 0292 just hardened; honest UNKNOWN + actionable message preserves the contract. Record operator override in Q&A if they want the fallback anyway.

**R4 — L4 WARN, not L3.** Detection: section body under `### Design` is empty after trimming, or consists only of a template placeholder line. Severity L4 keeps the existing corpus green (0292/0293 and any older fast-tracked tasks would otherwise start failing checks retroactively) while making the gap visible at every `task check`, including `--strict-core` output. Escalating to L3 later is a one-line change once the corpus is clean. Implementation sits next to the existing section-presence loop (`task-check.ts:588,644`); reuse whatever placeholder convention the template emits.

**R5 — investigation protocol (timeboxed, independent of R1–R4).** Steps: (1) read the three recorded run dirs for the stall signature (last emitted event, pending step, any timeout config in effect); (2) diff the invocation paths — what `spur agent run` sends versus what the `task-pipeline.yaml` `agent.run` step constructs (prompt source, answer-file contract, timeout, env); (3) reproduce once with a throwaway task if the diff alone is not conclusive; (4) write the hypothesis with evidence into Solution. Likely suspects to check first: the answer/completion contract (pipeline step waiting on an answer file or marker the agent never writes) and missing/absent timeout on the pipeline step. Fix lands here only if it is a one-liner (e.g., a timeout value); anything structural becomes a follow-up task.

**R6 — protocol text decisions.** (a) Recommend the explicit fast-run exemption: batch-finalize permitted only when total wall-clock < 3 min AND the report notes it — this matches how the 0280 run actually behaved and keeps the per-step mandate meaningful for long runs where mid-run crash loss is the real risk. (b) One row-note in `dev-dogfood.md`'s argument table + a sentence requiring the driver to echo the normalized flag (the verify-0293 driver already did this; codify it).

**R7 — mechanical sweep.** Solution-count corrections go through `spur task update <wbs> --section Solution --from-file` with the full corrected section body (CLI replaces the whole section — never a partial patch). For `0231-verdict.json`: prefer rewrite-in-place to schema-shaped JSON carrying the original verdict and a `note` field naming the migration; deletion is acceptable only if 0231's verdict is recorded in its task file. Local `.spur/run/` state — not committed.

**Blast radius.** R3(b) and R4 are the only production-code touches; both are additive (message text, new L4 warning) with unit tests. Everything else is docs/corpus/protocol text. No schema, no CLI surface changes, no new dependencies.
### Plan
Ordered for dependency and blast radius: doc-truthing first (cheap, immediately reduces operator confusion), then the two code changes, then hygiene, with the R5 investigation timeboxed at the end (it is independent and can also run in parallel).

1. **R1 — dev-verify.md §--next rewrite** (~30 min). Rewrite the gate-layer documentation + already-terminal note + /sp:dev-review precondition. Cross-check every claim against the live behavior recorded in the verify-0293 report (denial order: provenance → Review L3).
2. **R2 — dev-run.md backlog handling** (~30 min). Implement recommended option (a) auto-promote as documented chain step 0 (fall back to option (b) error-with-remediation if (a) is rejected at review). Verify the FSM transition table still owns the authority.
3. **R3 — verdict answer-file contract** (~2 h). (a) Document the answer-file shape in `sp:spur-cli` tasks/verbs.md derived from the extractors; pointer from dev-verify.md. (b) Denial-message enrichment for UNKNOWN/`spur-task-verdict` artifacts + unit test (guard or CLI layer per Design). (c) No parser change.
4. **R4 — task-check empty-Design L4 warning** (~1.5 h). Detection next to the section-presence loop; tests in `packages/app/tests/services/task-check.test.ts` covering empty body, placeholder-only body, populated body (no finding), and non-standard templates (excluded).
5. **R6 — dogfood protocol text** (~20 min). monitor-ledger.md fast-run exemption clause; dev-dogfood.md single-dash note + normalized-flag echo requirement.
6. **R7 — hygiene sweep** (~20 min). CLI-gated Solution rewrites for 0292 (counts 20→23, 7→9) and 0293 (49→41 pre-change); rewrite `.spur/run/0231-verdict.json` to schema-shaped JSON.
7. **R5 — pipeline agent.run stall investigation** (timebox: half a day). Follow the Design protocol; write the root-cause hypothesis into Solution; spawn a follow-up task if the fix is structural. If the timebox expires without a conclusive root cause, record what was ruled out and stop — do not let this item block R1–R7 closure.
8. **Gates** — `bun run lint`, `bun run test` (workspaces + plugins/sp), `bun run test-cf`, `bun run build`, `spur task check 0294 --strict-core`; then `/sp:dev-verify 0294` for the verdict. Doc-only edits (R1/R2/R6) still ride the full gate because plugins/sp tests assert command-doc contracts.

Suggested checkpoint after step 4: R1–R4 are the operator-facing value; steps 5–7 are cleanup that can land in the same branch but must not hold the earlier fixes hostage if R5 drags.
### Solution
Implemented all seven consolidated dogfood-remediation requirements and closed the verification fix-pass findings.

**R1 — honest `dev-verify --next` contract**

- `plugins/sp/commands/dev-verify.md:80-137` documents the standalone review precondition, the exact verdict → provenance → Review → strict-core execution order, all remediation paths, the honest terminal no-op, and the verdict answer-file pointer.

**R2 — backlog-seeded chained runs**

- `plugins/sp/commands/dev-run.md:114-151` adds lifecycle-governed `backlog → todo` chain step 0, distinguishes `--next` from `--auto`, and requires actionable remediation if promotion fails.

**R3 — verdict-answer contract and UNKNOWN remediation**

- `plugins/sp/skills/spur-cli/references/tasks/verbs.md:218-280` specifies the exact requirement and AC tables parsed by `spur task verdict`; `plugins/sp/skills/spur-cli/references/tasks.md:34` links to that contract.
- `packages/app/src/services/done-transition-guard.ts:189-216` enriches UNKNOWN/zero-row denials with source, row counts, expected headers, and `/sp:dev-verify <wbs>`. The parser remains strict.
- `packages/app/tests/services/done-transition-guard.test.ts` covers source, zero-row, nonzero-row, exclusion, pluralization, and remediation cases.

**R4 — empty standard-task Design warning**

- `packages/app/src/services/task-check.ts:387-405` emits L4 when a standard task has a present empty/placeholder-only Design body, including at testing/done where Design is optional.
- `packages/app/tests/services/task-check.test.ts` covers empty, placeholder, populated, testing, non-standard, and missing-heading cases.

**R5 — pipeline-stall investigation**

- The leading hypothesis is an interactive `/sp:dev-run --mode implement` wait inside the non-TTY workflow execution context. Evidence spans `config/workflows/task-pipeline.yaml:43-92`, `packages/app/src/workflow/actions/agent-run.ts:69-115`, and `packages/app/src/services/agent-service.ts:314-348`.
- The 30-minute timeout is a bound, not the cause. Structural tracing/reproduction/cancellation hardening is scoped in follow-up task 0295.

**R6 — protocol decisions**

- `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:41-62` permits batch-finalize only below three minutes with an explicit report note; longer batching is a self-reported protocol violation.
- `plugins/sp/commands/dev-dogfood.md:40-50` documents single-dash normalization and requires the normalized flag in Phase-1 output.

**R7 — hygiene**

- Task 0292 now reports 23 unit and 9 integration tests; task 0293 correctly labels 41 tests as pre-existing. Both used CLI-gated Solution replacement.
- `.spur/run/0231-verdict.json` is schema-shaped PASS JSON.

**Verification-gate repair and design sync**

- Isolated the Cloudflare SIGSEGV to broad Node-oriented package barrels. Server error handling now uses structural ts-utils AppError detection, Hono 404 exceptions, and the narrow Worker-safe `@gobing-ai/spur-app/errors` export.
- `apps/server/src/modules/observability/index.ts` defers the Node-only ledger watcher until a local SSE request and emits `connected` only after subscription, eliminating both the Worker import crash and the initialization race.
- `docs/design/server-side-adjustment-design.md` was updated before its `docs/04_DESIGN.md` index row per T3/T9.
- Task 0294 is linked to owning feature N; N's AC now covers all six task scenarios, and `spur feature refresh` repaired the generated F4/N/O rosters plus the missing O index entry.
### Testing
**Verdict: PASS** — all requirements, Acceptance Criteria, review dimensions, and mandatory repository gates pass.

**Per-requirement traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `plugins/sp/commands/dev-verify.md:80-137`; static review confirmed precondition, exact execution order, three contract layers, remediation, and honest no-op. |
| R2 | MET | `plugins/sp/commands/dev-run.md:114-151`; backlog step 0 and failure remediation are explicit. |
| R3 | MET | `tasks/verbs.md:218-280`, `plugins/sp/skills/spur-cli/references/tasks.md:34`, `packages/app/src/services/done-transition-guard.ts:189-216`; full suite includes UNKNOWN/zero-row remediation cases. |
| R4 | MET | `packages/app/src/services/task-check.ts:387-405` and six focused cases in `task-check.test.ts`; full suite passes. |
| R5 | MET | Solution cites workflow command, answer/capture, continuation, and timeout paths; `spur task show 0295 --json` confirms the bounded follow-up. |
| R6 | MET | `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:41-62` and `plugins/sp/commands/dev-dogfood.md:40-50`. |
| R7 | MET | 0292/0293 counts corrected through CLI; `.spur/run/0231-verdict.json` parses as PASS JSON. |

**Acceptance Criteria verification**

| AC | Status | Evidence Type | Evidence |
|---|---|---|---|
| AC-1 dev-verify gate contract | MET | command | Static source review of `plugins/sp/commands/dev-verify.md:80-137`; `git diff --check HEAD` exit 0. |
| AC-2 backlog-seeded dev-run | MET | command | Static source review of `plugins/sp/commands/dev-run.md:114-151`; full plugin tests pass. |
| AC-3 UNKNOWN remediation | MET | test | `bun run spur-check` exit 0; done-transition guard tests cover source and zero-row artifacts. |
| AC-4 empty Design warning | MET | test | `bun run spur-check` exit 0; six R4 cases pass and `task-check.ts` is 98.80% lines. |
| AC-5 pipeline stall root cause | MET | command | Solution contains required evidence and `spur task show 0295 --json` confirms R1–R4 follow-up scope. |
| AC-6 protocol and hygiene | MET | command | Protocol/corpus source review plus schema validation of 0231 artifact; exit 0. |

**Mandatory gate evidence**

| Check | Status | Evidence |
|---|---|---|
| autofix | MET | `bun run autofix` exit 0; Biome checked 498 files, no fixes; all workspace typechecks pass. |
| spur-check | MET | Exit 0; 33 pre-check rules, 3,037 tests, 0 failures, 8,700 assertions, 99.07% lines, 2 post-check rules. |
| lint | MET | `bun run lint` exit 0; Biome clean and all workspace typechecks pass. |
| test-cf | MET | `bun run test-cf` exit 0; 1 Cloudflare Worker test passed and executed. |
| build | MET | `bun run build` exit 0; CLI, server, and Astro web builds completed. Vite chunk-size notice is non-blocking and pre-existing. |
| task-check | MET | `spur task check 0294 --strict-core --json` exit 0 at `done` with `findings: []`. |
| diff-check | MET | `git diff --check HEAD` exit 0. |
| doc-sync | MET | T3/T9 detection found both `docs/design/server-side-adjustment-design.md` and its `docs/04_DESIGN.md` index/frontmatter update in the same diff. |
| feature-sync | MET | Task 0294 linked to feature N; N AC includes every task scenario; generated F4/N/O rosters and feature index refreshed through the CLI. |

**Coverage:** 99.07% aggregate lines. Changed runtime files: `done-transition-guard.ts` 96.55%, `task-check.ts` 98.80%, `observability/index.ts` 98.43%; all above the 90% gate.
### Review
**Functional traceability**

| Req | Status | Evidence |
|---|---|---|
| R1 | MET | `plugins/sp/commands/dev-verify.md:80-137` — precondition, gate order/remediations, no-op, and answer-shape pointer. |
| R2 | MET | `plugins/sp/commands/dev-run.md:114-151` — backlog promotion and actionable failure path. |
| R3 | MET | `tasks/verbs.md:218-280`; `done-transition-guard.ts:189-216`; full tests pass. |
| R4 | MET | `task-check.ts:387-405`; six focused cases in `task-check.test.ts`; full tests pass. |
| R5 | MET | Solution records command construction, answer/capture, continuation, timeout evidence; task 0295 owns the structural fix. |
| R6 | MET | `monitor-ledger.md:41-62`; `dev-dogfood.md:40-50`. |
| R7 | MET | CLI-gated 0292/0293 corrections; schema-valid `.spur/run/0231-verdict.json`. |

**SECUA and architecture findings**

| Priority | Finding | Disposition | Evidence |
|---|---|---|---|
| P1 | None | Clear | Full rules, tests, Worker runtime, and build gates pass. |
| P2 | None | Clear after fix | Removed Node-oriented runtime barrels from the Worker module graph; exact lifecycle error identity uses `@gobing-ai/spur-app/errors`. |
| P3 | None | Clear after fix | Shared watcher-load promise plus subscribe-before-connected ordering closes the local SSE startup race. |
| P4 | None | Clear after fix | Corrected gate-order prose, slash-command spelling, task-summary pointer, Markdown quoting, and optional-Design wording. |

**Dimension disposition**

| Dimension | Result | Evidence |
|---|---|---|
| Functional | PASS | All R1–R7 rows MET with file/command evidence. |
| Security | PASS | No new secret, auth, SQL, shell, or external-input surface; 33 pre-check rules pass. |
| Efficiency | PASS | Checks are bounded scalar work; watcher initialization is lazy and shared. |
| Correctness | PASS | 3,037 tests pass; Worker test executes; SSE race regression passes. |
| Usability | PASS | Every denial/precondition names an executable remediation. |
| Architecture | PASS | Worker-safe narrow entry, existing HTTP boundary, and existing observability seam; T3/T9 docs synchronized. |

**Final disposition:** PASS — no unresolved P1–P4 finding outside follow-up task 0295.
### References
**Source dogfood reports (2026-07-18):**
- `docs/dogfood/2026-07-18-0280-sp-dev-run-dogfood.md` — findings P1 (ledger lag → R6a), P2 (done gate → fixed by 0292), P-pre (DD-09 → fixed via feature O AC), P3/P4 (`--save`/`--full` → fixed in dev-dogfood.md)
- `docs/dogfood/2026-07-18-sp-dev-verify-0280-dogfood.md` — 9 findings; open remainders: already-terminal doc edge (→ R1), `0231-verdict.json` (→ R7c)
- `docs/dogfood/2026-07-18-omp-capacity-dogfood.md` — P1 pipeline stall (→ R5)
- `docs/dogfood/2026-07-18-sp-dev-verify-0292-dogfood.md` — stale `--next` note (→ R1), empty Design (→ R4), Solution counts (→ R7a)
- `docs/dogfood/2026-07-18-skill-sp-dev-run-0293-dogfood.md` — backlog chain gap (→ R2), verdict parser contract (→ R3)
- `docs/dogfood/2026-07-18-sp-dev-verify-0293-dogfood.md` — gate-layer docs + Review tension (→ R1), UNKNOWN artifact UX (→ R3b), Design placeholder (→ R4), single-dash parsing (→ R6b), 0293 Solution mislabel (→ R7b)

**Related commits (triage baseline HEAD `c63edca4`):**
- `80aa1aa6` feat(planning): enforce verify verdict on * → done transition (0292)
- `8a9d9931` fix(planning): canonicalize status case before done gate; pin R10 cross-check
- `ca0c6eb8` feat(sp): flag mutating --fix modes as implement-heavy in dogfood detection
- `c63edca4` feat(sp): refuse-gate mutating --fix modes without --max-retry
- `783227f2` docs(f4): resolve feature O research tasks and harden wayfinder-resolution workflow
- `2827166f` docs(f4): close task 0292 with Solution/Testing/Review

**Key code/doc locations:**
- `plugins/sp/commands/dev-verify.md:34,87-99` (R1)
- `plugins/sp/commands/dev-run.md` §Mode resolution / `--next` chain (R2)
- `packages/app/src/services/task-verdict.ts:40-49,80,137` + `plugins/sp/skills/spur-cli/references/tasks/verbs.md:194` (R3)
- `packages/app/src/services/done-transition-guard.ts:57-59,126-141` (R3b denial path)
- `packages/app/src/services/task-check.ts:588,644` (R4)
- `config/workflows/task-pipeline.yaml` + `.spur/run/{423a2d9a-5714-40ae-819b-6fcd658576b7,b4c3b395-bffa-4989-a3fa-d2202fb928ef,ceecda6f-547e-438a-8bbf-1efc21a5f338}` (R5)
- `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:13,32` + `plugins/sp/commands/dev-dogfood.md:36-38` (R6)
- `docs/tasks2/0292_….md:152,157`, `docs/tasks2/0293_….md:100`, `.spur/run/0231-verdict.json` (R7)

**Related tasks:** 0280 (baseline dataset), 0292 (done-transition verdict gate), 0293 (mutating-fix refuse gate) — all `done`; this task is the consolidated fix batch for their dogfood residue.
### History
- 2026-07-18T22:55:44.545Z backlog → todo (system)
- 2026-07-18T23:13:30.973Z todo → wip (system)
- 2026-07-18T23:34:52.717Z wip → testing (system)
- 2026-07-19T00:10:17.422Z testing → done (system)
