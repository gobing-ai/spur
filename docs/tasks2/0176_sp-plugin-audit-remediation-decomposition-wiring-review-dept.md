---
template: review
schema_version: 1
name: "sp-plugin audit remediation: decomposition wiring, review depth, workflow-config hardening"
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P2
tags: [review]
dependencies: []
created_at: 2026-07-02T05:34:33.113Z
updated_at: 2026-07-03T06:25:42.084Z
---

## 0176. sp-plugin audit remediation: decomposition wiring, review depth, workflow-config hardening

### Background
Audit of `plugins/sp` (v0.2.12, held for 0.3.0) conducted 2026-07-01 from operator feedback plus a full-plugin sweep. Each finding below was verified against the actual code — none is speculative. Uncommitted working-tree fixes from the prior session (mkdir -p hardening, `tasks`-as-JSON-string encoding, `--continue` docs, ac-generate check moved to guards) are already applied and NOT re-listed here.

Comparative research for F3/F4 drew on three sources: `~/projects/cc-agents/plugins/rd3` (sp's ancestor), `~/projects/cc-agents/vendors/superpowers`, and `~/projects/cc-agents/vendors/gstack` — see the "Research inputs" subsection at the end.

#### Review Findings

**F1 — Decomposition: roster automation shipped but unwired (P2)**
`spur task refresh-roster` (task 0123; `apps/cli/src/commands/task.ts:299`, `packages/app/src/services/task-service.ts:791`) writes an idempotent, marker-delimited sub-task roster into the parent's `## Plan`. The L4 roll-up gate (task 0121; `packages/app/src/services/task-check.ts:426` `runL4Rollup`) already warns on parent/child status drift and missing roster. Yet `refresh-roster` is referenced NOWHERE in `plugins/sp/**`, `config/workflows/**`, or `config/templates/**`. The skills still mandate a hand-written roster (`plugins/sp/skills/spur-dev/references/planning-workflow.md:148`), and `plugins/sp/skills/spec-decomposition/references/decomposition.md:179` claims the automation is "planned" and (`:188`) the roll-up gate is "deferred" — both stale; both shipped.
*Fix direction:* make `spur task batch-create` auto-invoke `refreshRoster` for each distinct `parent_wbs` in the batch (service-level, after the atomic create); add `refresh-roster` to planning-workflow Step 5 and to the child-status-change path; correct the stale prose in decomposition.md.

**F2 — Decomposition: parent never transitions to `wip`; batch resolver executes umbrellas (P2)**
Nothing in skills or pipelines moves a decomposed parent task out of `todo`. Consequence: `execution-batch.md`'s `ready` set resolution (todo + backlog with deps done) has zero parent-awareness, so `/sp:dev-runall --tasks ready` picks up an umbrella parent and "implements" a task that by definition implements nothing (decomposition.md: a parent "implements nothing itself").
*Fix direction:* in the same batch-create service path as F1, transition each referenced parent `todo → wip` through the lifecycle verb (guards apply); belt-and-braces, exclude tasks with open children from `ready` resolution in `execution-batch.md`.

**F3 — Verification: no design-conformance check (P2)**
`sp:code-verification` checks requirements traceability (Step 4), AC (Step 5), and SECUA (Step 6, `references/secu-review.md`) — but no step ever reads the task's `### Design` section (the artifact the `todo` HITL gate exists to approve) or the feature's design satellite `docs/design/<slug>.md`. An implementation can diverge completely from the approved approach and still PASS. The only design-referencing check is the narrow "type-fit" rule.
*Root cause:* verification was designed around requirements/AC; the Design artifact arrived later (refine step) and the verifier never grew a matching lens. rd3 had this split explicitly (`code-review-common`: "code review validates implementation quality — not design correctness", with a separate Layer-2 solution review); the sp migration folded both into SECUA-A and lost the design pass.
*Fix direction:* add a Design-conformance step between the AC guard and SECUA — parse `### Design` (chosen approach, invariants, signatures, rejected alternatives) and audit the diff against it, gstack-style plan-completion classification per design claim: DONE / PARTIAL / NOT DONE / CHANGED (changed-but-goal-met is fine when documented in Solution; silent deviation = major finding → PARTIAL). Calibrate SECUA-A findings against the design satellite when one exists (gstack: "patterns blessed in DESIGN.md are not flagged"). Also add scope-creep detection: diff hunks matching no Design/Plan/requirement item are flagged (gstack Step 1.5).

**F4 — Verification: functional validation not enforced (P2)**
The pipeline labels the verify step "Functional verification" (`config/workflows/task-pipeline.yaml:127`), but the skill lets `static-ref` evidence clear an objective AC — nothing requires ever EXECUTING the changed behavior. sp's `--bdd` is a static scenario→test-name mapping; rd3's Phase 8a (`bdd-workflow`) actually executed scenarios and produced an ExecutionReport (with per-scenario status and a deterministic ratio) that Phase 8b (`functional-review`) consumed. gstack goes further: `/qa` drives the running app (diff-aware / full / quick / regression modes).
*Fix direction:* (a) each CORE requirement/AC needs at least one executable evidence row (`test` or `command`); pure `static-ref` on behavior-bearing AC caps at PARTIAL; (b) for CLI-surface tasks, mandate one golden-path invocation of the changed command with output captured as `command` evidence; (c) adopt superpowers' "verification-before-completion" iron law into the verify step prose: no PASS claim without fresh command output in the same session (agent-reported success is never evidence — the deterministic `spur task verdict` derivation already half-implements this; extend the principle to the evidence rows).

**F5 — Workflows: side-effectful guards can duplicate the corpus (P1)**
`config/workflows/idea-pipeline.yaml:322-373` runs `spur task batch-create` INSIDE transition guards. First-passing-transition semantics re-runs the command once per guard (up to 3x per hop), and a transient fail-then-succeed across guards 1→2→3 lands DUPLICATE task sets (each success allocates fresh WBS numbers; batch atomicity does not protect across invocations). Retry counters are also mutated inside guard shells (`echo $((n+1)) > file`).
*Fix direction:* guards must be read-only. Run batch-create in an `onEnter` shell action that drops a sentinel file; guards test the sentinel (the ac-generate step already models this with `idea-ac-done.txt`). Move retry-counter increments into onEnter actions. Longer-term: an engine-level `retry: {max: N}` transition primitive in ts-dual-workflow-engine would delete all four retry-counter shell blocks.

**F6 — Workflows: HITL answers are decorative (P1)**
`hitl.confirm` stores the response via `setVars` (`packages/app/src/workflow/actions/hitl-confirm.ts:54`, default var `__hitlAnswer`), but NO bundled pipeline transition guards on it. Approval edges are `always` and declared first, so answering "No" at `design-approval` still proceeds (idea-pipeline → decompose; planning-pipeline → handoff). `planning-pipeline.yaml`'s rework edge (design-approval → design-gen), both `cancelled` edges, and `phasing → cancelled` are unreachable dead transitions.
*Fix direction:* guard outbound edges on the answer var (`test "${vars.__hitlAnswer}" = yes` / `= no`), declared before the fallbacks; or add a `var-equals` guard kind to the engine and use it. Delete truly-dead edges that remain.

**F7 — Workflows: literal `$(cat …)` in note/hitl strings (P3)**
The engine's `note` action is `String(options.message)` — no shell evaluation (verified in ts-dual-workflow-engine 0.4.2 dist). `$(cat .spur/run/idea-feature-id.txt)` inside `note` messages (idea-pipeline handoff) and `hitl.confirm` prompts (feature-check, design-approval, batch-create states) renders literally to the operator.
*Fix direction:* materialize dynamic values into vars via a shell step, or drop them from prompts (state ids carry enough context).

**F8 — Workflows: fat/contradictory agent.run prompts (P2)**
(a) The `needs_design` decision criteria live in BOTH `sp:brainstorm` SKILL.md ("The needs_design signal") and verbatim in the discovery prompt (`idea-pipeline.yaml:70`) — two copies that will drift. (b) The decompose prompt (`idea-pipeline.yaml:160`) demands "each entry must have filled Requirements, AC, Design, and Plan sections" — the strict batch schema HAS NO SUCH FIELDS (`task-batch.schema.json`; only `background`/`requirements`), contradicting planning-workflow Step 6's refine-later model and steering the agent toward schema-rejected JSON. (c) `planning-pipeline.yaml:70` asks the agent to re-implement `spur feature create`'s ID-allocation rule by prose. (d) planning-pipeline's `agent.run` steps omit `agent:`/`timeoutMs` and the file declares no `spurBin`/`agent`/`stepTimeoutMs` vars, unlike every other pipeline.
*Fix direction:* every `agent.run` prompt shrinks to "Run sp:<skill> for <args>" plus the artifact-path contract; the skill owns criteria and formats (the plugin's own R3: skill = how-to-think). Fix the decompose prompt to match the real schema; replace the feature-id prose with `spur feature create`; align planning-pipeline vars with the other pipelines.

**F9 — Workflows: overlap + embedded shell ladder (P3)**
planning-pipeline and idea-pipeline both own design-gen → design-approval → handoff; idea-pipeline is the newer unified entry, planning-pipeline looks superseded — retire or fold it (decision needed; if kept, F6/F8d apply to it). Separately, wrapup-pipeline's `feature-transition` state embeds a ~20-line shell status ladder (`wrapup-pipeline.yaml:127-149`); precedent 0108 (`spur task record` replaced ~50 lines of shell) says promote it to a CLI verb, e.g. `spur feature advance <id> [--to <status>]` walking legal edges idempotently.

**F10 — Doc drift in review skills (P3)**
`sp:code-verification/SKILL.md`: review-mode step list "Steps 3 + 5 + 8" is stale numbering (should be scope / SECUA / write-Review); "Step 8b" is wedged after Step 10 and splits Step 10's sentence mid-flow; Gotcha 2 cites "(Step 9)" for the Step-10 artifact; `references/secu-review.md:10` says "verify mode (Step 5)" for what is now Step 6. `sp:code-review/SKILL.md` lists `sp:code-verification` twice in See-also. One renumber/restructure pass — or switch to named step anchors that survive insertions.

#### Research inputs (for F3/F4 — what the sources do that sp does not)

- **rd3 `functional-review`**: two-track assessment (BDD execution report first, LLM evidence fallback); evidence-quality standard with an explicit REJECTED-vague-evidence table ("implemented correctly" / "meets requirements" are non-evidence). sp's typed-evidence table already improves on this — keep it — but rd3's Track A consumed an actual execution report, which sp dropped.
- **rd3 `code-review-common`**: two-layer framework — Layer 1 code review (implementation quality) vs Layer 2 solution review (design correctness) as distinct passes. The missing Layer 2 is exactly finding F3.
- **superpowers `requesting-code-review`**: reviewer runs as a FRESH-context subagent with a structured brief (WHAT_WAS_IMPLEMENTED / PLAN_OR_REQUIREMENTS / BASE_SHA..HEAD_SHA) — never the implementer's session history. sp's pipeline gets this for free via `agent.run` subprocess isolation, but standalone `/sp:dev-review` runs in-session; the skill should say to prefer a fresh subagent and to pass the structured brief.
- **superpowers `verification-before-completion`**: "no completion claims without fresh verification evidence"; red-green regression proof (revert fix → test MUST fail → restore → pass); "agent said success → verify independently". Feeds F4c.
- **superpowers `receiving-code-review`**: verify findings against codebase reality before implementing; fixed implementation order (blocking → simple → complex), test each fix individually; reasoned pushback allowed. sp's `code-review` Workflow C is a thin triage table — fold these rules in.
- **gstack `review`**: Scope Drift Detection + Plan Completion Audit — extract actionable items from the plan, classify each DONE / PARTIAL / NOT DONE / CHANGED against the diff ("conservative with DONE, generous with CHANGED"); unmatched diff hunks = scope creep. Two-pass review (CRITICAL then INFORMATIONAL); the read-outside-the-diff rule (new enum/status/constant values require grepping sibling-value call sites beyond the diff); search-before-recommending (verify a recommended fix pattern against current framework docs); Fix-First flow (classify findings AUTO-FIX vs ASK, auto-fix mechanical ones, batch-ask the rest — cf. sp's `--fix blockers-first|all`, which fixes but never asks).
- **gstack `qa`**: functional QA that DRIVES the running app in modes (diff-aware / full / quick / regression). The CLI analogue for sp is the F4b golden-path invocation.

#### Review Findings — comprehensive sweep (wave 2, 2026-07-01)

Second pass over the full plugin surface (23 commands, 16 skills, 2 agents, hooks, tests, manifest). Verified clean: no `rd3:` leftovers or legacy `tasks` CLI refs (guarded by tests R16d/R20), no `--var` flag mistakes, all command frontmatter complete, all 6 task templates + bdd templates present, `Notes` is a legal universal section (`planning-check-base.ts:169`), cross-skill references valid or intentionally negative, `omp` is a real upstream shim (ts-ai-runner 0.4.x `AGENT_SHIMS`), all 88 plugin tests pass and the root gate runs them.

**N1 — spur-cli facade missing verbs (P2).** `skills/spur-cli/references/tasks/verbs.md` documents create/show/list/update/batch-create/record/check/refresh/resolve + Reserved — but has NO section for `task verdict` (a verb the pipeline itself calls: `spur task verdict <wbs> --from-answer`), `task refresh-roster`, or `task path`. The facade's contract is per-noun completeness; agents relying on it cannot discover these verbs. (Overlaps F1 for refresh-roster; the facade gap is a distinct fix site.)

**N2 — AGENTS.md CLI-surface drift (P2, repo doc).** The root AGENTS.md CLI listing omits real, shipped flags: `task update --feature/--priority/--no-lifecycle`, `task check --strict-core`, `rule run --fix-mode/--dry-run`. AGENTS.md's own contract says factual blocks are regenerated from code, never memory. Plugin agents read this listing — stale omissions propagate into generated content.

**N3 — hook guard logic lives outside the repo (P2).** `hooks/hooks.json` invokes `superskill hook run sp task-write-guard`; the in-repo `task-write-guard.ts` is a fail-open forwarding shim (documented, task 0151). Consequences: on any machine without `superskill`, the corpus write-guard silently no-ops; and the actual guard logic is unversioned here and untestable by this repo's gate (the in-repo test exercises the shim only). Improvement: inline the guard logic as a self-contained `${CLAUDE_PLUGIN_ROOT}/hooks/task-write-guard.ts`, keep fail-open only for runtime errors.

**N4 — precheck does not validate the pinned agent (P2).** Every pipeline pins `agent: omp` but `precheck` only runs `spur task check`. A missing/unauthenticated agent fails at the first `agent.run` mid-pipeline with a generic step failure. `spur agent doctor <name>` exists — add it to precheck (and to idea-pipeline's start state) so agent problems fail at the gate with a clear message.

**N5 — idea-pipeline iterationBound 15 is below the worst legitimate path (P2).** Interactive mode retry loops cost 2 hops per retry (ac-generate↔feature-check, decompose↔batch-create). With the design route, ~2 AC retries + 1 decompose retry already reaches the bound; the advertised 3+3 retry caps are unreachable — the engine's iterationBound kills the run first with a confusing error. Compute the worst legal path (~22 hops) and set the bound above it (e.g. 25), or lower the advertised caps.

**N6 — wrappers cannot set design_approved (P3).** idea/planning pipelines support `design_approved=true` to auto-route the taste gate, and `dev-idea.md:72` mentions the concept — but neither `dev-idea` nor `dev-plan` offers a flag, and the `--vars` invocation templates omit the var. Add `--design-approved` to both wrappers (or document the manual `--vars` form).

**N7 — stale corpus-path examples (P3).** `commands/dev-brainstorm.md` uses `docs/tasks/0042.md` and `commands/dev-refine.md` uses `docs/tasks/0274_my-task.md` — the active folder is `docs/tasks2/` and task filenames must match `NNNN_slug.md` (a bare `0042.md` doesn't match the list regex). Agents copy examples; fix both to the real shape (or use `<tasks-dir>/` placeholders).

**N8 — broken example link in decomposition.md (P4).** The roster row template renders `[0110](0110_<slug>.md)` as a live (broken) markdown link; the structure test's link check skips `<`-placeholders so it never fires. Present the template row as inline code.

**N9 — dev-fixall auto-detection row (P4).** The table maps `tsconfig.json → bun run typecheck`; this repo has no `typecheck` script (tsc runs inside `bun run lint`). The final line correctly defaults to `bun run check` — mark the table rows as generic examples or align them with this repo's scripts.

**N10 — dev-unit/--coverage parameterization home (P4).** `dev-unit.md` documents `--coverage <n>` (default 90) but the backing `code-testing` skill never names the flag; the threshold knob should be owned by the skill/reference the same way decomposition owns its granularity knobs, so wrapper and skill cannot drift.
### Requirements

<!-- R-numbered fix requirements derived from the findings. Fill after triage/refinement. -->

### Acceptance Criteria

<!-- Checks that prove the findings were addressed. Keep empty until the review task becomes executable work. -->

### Q&A

<!-- Clarifications, false positives, accepted risk, and triage decisions. -->

### Design

<!-- Fix approach and tradeoffs if the findings require design judgment. -->

### Plan
Rubric (recorded per decomposition standard): E~20h D4 L3 C1 R1 = high → this capture task is a decomposition CANDIDATE, not an executor. When work starts, decompose by the wave boundaries below (each wave = one deliverable, own review gate); do not decompose further than the four waves without re-scoring. Sequencing is riskiest-first: infra (workflows) → code (CLI/service) → skill prose → docs.

**Wave A — workflow correctness (F5, F6, F7) — do first, blocks dogfooding**
- [x] F5: move `spur task batch-create` out of idea-pipeline transition guards into an `onEnter` action + sentinel file; guards test the sentinel only. Move retry-counter increments into onEnter actions.
- [x] F5: add a duplicate-run regression proof — a workflow test (or scripted dry-run) asserting a fail-then-succeed guard sequence cannot invoke batch-create twice.
- [x] F6: route HITL answers — guard design-approval/feature-check/batch-create/phasing outbound edges on `${vars.__hitlAnswer}`; make "No" reach the rework edge and "cancel" reach cancelled; delete edges that remain dead. Consider an engine `var-equals` guard kind upstream (ts-libs) if shell `test` reads prove awkward.
- [x] F7: replace `$(cat …)` in note/hitl strings with var-materialized values or drop them.
- [x] Validate every touched YAML with `spur workflow validate` and keep the bundled-workflow validation test green.

**Wave B — decomposition wiring (F1, F2)**
- [x] F1: `TaskService.createBatch` (or the batch-create command path) auto-invokes `refreshRoster` per distinct `parent_wbs` after the atomic create; add a service test (batch with parent → roster block present, idempotent on re-run).
- [x] F2: same path transitions each referenced parent `todo → wip` via the lifecycle verb (skip silently if already wip+; surface guard denials loudly).
- [x] F2: exclude tasks with open children from `ready` resolution in `spur-dev/references/execution-batch.md` (skill-prose rule + report line for each excluded parent).
- [x] F1: update `spec-decomposition/references/decomposition.md` — roster note ("maintained by hand today" → refresh-roster verb) and gate note ("deferred" → 0121 shipped); add `spur task refresh-roster` to `planning-workflow.md` Step 5 and to child-status-change guidance.

**Wave C — verification depth (F3, F4) — changes verdict semantics; own review + a probe task after**
- [x] F3: add Design-conformance step to `sp:code-verification` verify mode (between AC guard and SECUA): parse `### Design`, classify each design claim DONE/PARTIAL/NOT DONE/CHANGED against the diff; silent deviation = major finding → PARTIAL; documented deviation (Solution notes it) = CHANGED, acceptable. Calibrate SECUA-A against the feature design satellite when present.
- [x] F3: add scope-creep line — diff hunks matching no Design/Plan/requirement item are reported (informational, not blocking).
- [x] F4a: evidence rule — every CORE requirement/AC needs ≥1 `test` or `command` evidence row; `static-ref`-only on behavior-bearing AC caps at PARTIAL. Update `verdict-schema.md` aggregation notes accordingly.
- [x] F4b: CLI-surface tasks require one golden-path invocation of the changed command captured as `command` evidence.
- [x] F4c: fold verification-before-completion language into the skill (no PASS without fresh command output; agent-reported success is never evidence).
- [x] Enrich `code-review` Workflow C with receiving-review rules (verify finding against codebase before fixing; blocking → simple → complex order; test each fix individually) and Workflow B with the fresh-subagent structured brief (what-was-implemented / requirements / SHA range).
- [x] After landing: run one boring probe task through the full pipeline to prove the tightened verdict semantics don't false-FAIL (per the established verifier-hardening-then-probe pattern).

**Wave D — prompt slimming + consolidation + doc drift (F8, F9, F10)**
- [x] F8a: discovery prompt → "Run sp:brainstorm for ${vars.idea}" + artifact path; `needs_design` criteria live only in the skill.
- [x] F8b: fix decompose prompt to the real batch schema (background/requirements only; refine fills AC/Design/Plan later).
- [x] F8c/d: planning-pipeline — replace feature-id prose with `spur feature create`; add `spurBin`/`agent`/`stepTimeoutMs` vars + `agent:`/`timeoutMs` on agent.run steps (or resolve F9 first and skip).
- [x] F9: decide planning-pipeline's fate (retire into idea-pipeline vs keep both) — needs operator call; record as ADR entry either way.
- [x] F9: promote wrapup feature-transition shell ladder to `spur feature advance <id> [--to <status>]` (0108 precedent); wrapup YAML calls the verb.
- [x] F10: renumber/restructure `code-verification/SKILL.md` steps (or move to named anchors); fix secu-review.md step ref; dedupe code-review See-also.
- [x] Same-commit doc sync per constitution: 04_DESIGN for any CLI-surface change (feature advance, batch-create side effects), CHANGELOG entries.

**Wave E — comprehensive-sweep items (N1–N10)**
- [x] N1: add `verdict`, `refresh-roster`, `path` sections to `spur-cli/references/tasks/verbs.md` (flags + JSON shapes, mirroring existing sections).
- [x] N2: regenerate the AGENTS.md CLI-surface block from `apps/cli/src/commands/*` option definitions (add missing flags; same-commit rule).
- [x] N3: inline task-write-guard logic into the plugin hook (self-contained bun script via `${CLAUDE_PLUGIN_ROOT}`); port/extend the hook test to cover the real guard decisions; keep fail-open only for runtime errors. Decide with operator: keep superskill delegation as an optional fast path or drop it.
- [x] N4: add `spur agent doctor ${vars.agent}` to task-pipeline precheck and idea-pipeline start; failure routes to `failed` with the doctor report.
- [x] N5: recompute idea-pipeline worst legal hop count; raise `iterationBound` above it (~25) with a comment showing the math.
- [x] N6: add `--design-approved` flag to dev-idea and dev-plan wrappers mapping to `design_approved=true` in `--vars`.
- [x] N7: fix corpus-path examples in dev-brainstorm.md and dev-refine.md to `docs/tasks2/NNNN_slug.md` shape (or neutral placeholders).
- [x] N8: change the roster row template link to inline code in decomposition.md.
- [x] N9: mark dev-fixall auto-detection rows as generic examples or align with repo scripts.
- [x] N10: move the coverage-threshold knob into code-testing's reference frontmatter (granularity-knob pattern); dev-unit cites it.

<!-- AUTO-GENERATED by spur task refresh-roster -->
| WBS | Sub-task | Status |
| --- | -------- | ------ |
| 0177 | 0176 Wave A: workflow correctness hardening | done |
| 0178 | 0176 Wave B: decomposition wiring and parent readiness | done |
| 0179 | 0176 Wave C: verification depth and functional evidence | done |
| 0180 | 0176 Wave D: prompt slimming and pipeline consolidation | done |
| 0181 | 0176 Wave E: comprehensive sweep cleanup | done |
<!-- END AUTO-GENERATED -->
### Solution
- Decomposed umbrella task `0176` into five wave tasks and completed all children: `0177`, `0178`, `0179`, `0180`, and `0181`.
- Wave A fixed workflow correctness issues around side-effectful guards, HITL answer routing, literal shell substitutions, and workflow variable materialization; see `config/workflows/idea-pipeline.yaml:34`, `config/workflows/idea-pipeline.yaml:62`, and `packages/app/src/workflow/actions/hitl-confirm.ts:1`.
- Wave B wired decomposition parents after batch-create, including parent roster refresh and parent lifecycle transition; see `packages/app/src/services/task-service.ts:1` and `apps/cli/src/commands/task.ts:1`.
- Wave C tightened verification with design-conformance and executable-evidence enforcement; see `plugins/sp/skills/code-verification/SKILL.md:1`, `packages/app/src/services/task-verdict.ts:1`, and `packages/app/src/services/task-record.ts:1`.
- Wave D slimmed prompts, recorded planning-pipeline fate, and promoted wrap-up feature transition logic to `spur feature advance`; see `apps/cli/src/commands/feature.ts:1`, `config/workflows/wrapup-pipeline.yaml:1`, and `docs/00_ADR.md:1`.
- Wave E completed the comprehensive sweep for `spur-cli` task facade coverage, AGENTS drift, hook-guard testability, pinned-agent doctor prechecks, `design_approved` wrappers, stale examples, and coverage/fixall documentation; see `AGENTS.md:155`, `plugins/sp/hooks/task-write-guard.ts:18`, `plugins/sp/skills/spur-cli/references/tasks/verbs.md:170`, and `plugins/sp/commands/dev-idea.md:3`.
### Testing
Coverage: 99.45% functions / 99.06% lines.

Final gates after all five waves:

- `bun test plugins/sp/hooks/task-write-guard.test.ts` — 10 pass, 0 fail.
- `workflow validate` for task, idea, planning, and wrapup pipelines — pass.
- `bun run format` — pass.
- `bun run lint` — pass across all workspaces.
- `bun run test` — 2075 pass, 0 fail, 5364 assertions.
- `bun run test-cf` — 1 test file passed, 1 test passed.
- `bun run build` — CLI, server, and web builds passed. Web build emitted existing CSS/chunk-size warnings only.
- `spur task check 0176 --json` — pass with `feature_id` advisory and close-parent advisory before final transition.
- `spur task check 0181 --json` — pass with `feature_id` advisory.
### Review
Post-decomposition and execution dogfood review for the 0176 umbrella task.

| Severity | File | Finding | Recommendation |
| -------- | ---- | ------- | -------------- |
| P1 | docs/tasks2/0176_sp-plugin-audit-remediation-decomposition-wiring-review-dept.md | Parent was manually moved to `wip` after decomposition; this exposed that review-template parents need a populated Review table once `wip`. | Completed here by keeping 0176 as an umbrella tracker, refreshing the roster, and closing it only after all five children reached `done`. |
| P2 | packages/app/src/services/task-service.ts | `batch-create` accepted `tags` and `requirements` but the template-rendering path dropped them. | Fixed directly during decomposition recovery with service regression coverage. |
| P2 | config/workflows/task-pipeline.yaml | Dogfood implement steps repeatedly timed out near 600s, though they often left useful partial diffs. | Recorded as workflow reliability findings; recovered each wave from preserved diffs and kept full gates as the final proof. |
| P2 | task-pipeline implement prompt | Wave B spawned a nested duplicate task-pipeline run from inside the implement step. | Wave D prompt slimming reduced recursive workflow launch pressure; keep a future guard/prompt rule on "continue current task, do not start the same pipeline". |
| P3 | plugins/sp/hooks/hooks.json | Wave E partial diff attempted to reintroduce `${CLAUDE_PLUGIN_ROOT}` as the hook command, conflicting with the prior portability fix. | Corrected back to `superskill hook run sp task-write-guard`; retained versioned local guard logic and tests. |
| P3 | feature lifecycle guard YAML | Feature lifecycle guard commands do not yet thread command-level `--folder` overrides. | Logged as residual bug-747; not blocking 0176 because the shipped path and tests use the default corpus for guarded hops. |
| P3 | plugins/sp/agents/super-coder.md | Installed `sp-super-coder` skill lookup used a stale relative path in this Codex environment. | Used installed-skill fallback; keep as a future packaging/doc fix. |

Final disposition: all planned waves closed, all canonical gates pass, residual items are documented and non-blocking for 0176.
### References
- Decomposition + per-wave dogfood runs (local-only reports, not committed; see each child's own
  References for its run ID): decomposition run recorded under 0176 dogfood monitoring; Wave A
  run `34233eec-d3ed-44c8-9030-e0b813fb03b5`; Wave B run `1b7049d2-1073-4d4d-a97a-47e299bc316e`;
  Wave C run `66561133-64cc-4e93-92d4-2aa8413305d6`; Wave D run `4ac8a861-6233-4e19-ad43-595d99bec537`;
  Wave E run `10ab1085-a744-4e10-aee2-6682b062f550`.
- Related bugs: bug-740, bug-744, bug-745, bug-746, bug-747, bug-748, bug-749.
- Completed children: `0177`, `0178`, `0179`, `0180`, `0181`.
### History
- 2026-07-02T05:36:39.604Z backlog → todo (system)
- 2026-07-02T06:30:20.745Z todo → wip (system)
- 2026-07-02T22:40:34.372Z wip → testing (system)
- 2026-07-02T22:40:38.166Z testing → done (system)
