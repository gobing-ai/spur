---
schema_version: 1
name: "Adopt Superpowers, gstack, and agent-skills lessons into plugins/sp — behavioral hardening + new competencies"
status: todo
template: standard
created_at: 2026-07-06T05:52:30.469Z
updated_at: "2026-07-06T06:26:51.930Z"
priority: P2
---

## 0214. Adopt Superpowers, gstack, and agent-skills lessons into plugins/sp — behavioral hardening + new competencies

### Background
Comparative study (2026-07-05 session) of three vendor repos NOT covered by task 0187 (which absorbed `vendors/skills` / Matt Pocock only): `vendors/Superpowers`, `vendors/gstack`, and `vendors/agent-skills`. Grounded in the CURRENT `plugins/sp` code — 0187's completion claims are treated as history and re-verified against source, per the operator directive "rely on the code, not task files."

**Unifying finding.** sp has strong DETERMINISTIC gates (`spur feature check`, `task-batch.schema.json`, the verify verdict artifact) but almost no BEHAVIORAL counter-pressure. Zero of the 16 skills carry the "Common Rationalizations" + "Red Flags" anatomy that all 24 `agent-skills` skills use to stop an agent from rationalizing past a step under pressure. That anti-rationalization layer is the single highest-leverage, cheapest gap. Beyond it: three genuinely-missing competencies (code-simplification, doubt-driven-development, source-driven-development) plus enrichment opportunities for existing skills (review depth, debugging, HITL prompts, subagent orchestration).

**Code-grounded gap confirmation** (`rg` over `plugins/sp`, 2026-07-05):
- anti-rationalization sections — absent (only incidental keyword hits in `spur-tdd`, `decision-method.md`).
- code-simplification skill/command — absent.
- doubt-driven / in-flight adversarial review — absent (fresh-context subagent building blocks exist in `parallel-execution` + `code-verification`; the discipline itself does not).
- universal verification-before-completion — absent (only the pipeline verdict contract in `cross-cutting.md`).
- Superpowers subagent disciplines (file-handoff / progress ledger / per-role model selection) — absent (zero matches in `parallel-execution`, `super-coder`, `execution-batch`).
- source-driven-development — only referenced (external `cc:anti-hallucination`), not first-class.

**Hard boundary (same as 0187).** ABSORB, never cite — no file under `plugins/sp` may reference `vendors/`; the `sp-no-vendor-refs` boundary rule + structural test R20 enforce it. Provenance lives only in this task's References. Do NOT regress sp strengths: deterministic CLI gates, the spine/competency split (ADR-028), feedback-loop-first debugging, and the CLI-gated section-write contract.
### Requirements
- [ ] R1. Anti-rationalization anatomy. Add a "Common Rationalizations" table and a "Red Flags" list to the gate-bearing skills: `code-verification`, `spur-tdd`, `sys-debugging`, `code-implementation`, `spec-decomposition`, `code-review`, `sys-architecture`, `brainstorm`. Each rationalization pairs an excuse an agent uses to skip a step with a factual rebuttal; each red flag is an observable violation signal. Extend `plugins/sp/tests/skill-structure.test.ts` to enforce presence on the load-bearing set. Absorb into sp vocabulary; never cite `vendors/`.
- [ ] R2. Universal verification-before-completion discipline. A cross-cutting honesty rule — no "done / passing / fixed / works" claim without fresh, pasted verification evidence (command + output run this turn) — applied beyond the pipeline verdict. Land as a `spur-dev/cross-cutting.md` section (or a small skill) with a Red-Flags table (uses "should"/"probably"; expressing satisfaction before verification; trusting a subagent success report).
- [x] R3. `code-simplification` skill + `/sp:dev-simplify` command. New `plugins/sp/skills/code-simplification/SKILL.md`: preserve behavior exactly; Chesterton's Fence (understand before touching); simplification-signal tables (structural / naming / redundancy); incremental change + test-after-each; scope-to-what-changed; Common Rationalizations + Red Flags + Verification. Thin `plugins/sp/commands/dev-simplify.md` delegating to the skill. Wire into the README command index and `code-review` "See also." (DONE 2026-07-05 — see Solution.)
- [ ] R4. `doubt-driven-development` skill. New skill: in-flight adversarial fresh-context review of non-trivial decisions — CLAIM to EXTRACT (artifact + contract, strip reasoning) to DOUBT (adversarial reviewer; pass artifact + contract, NOT the claim; reuse `sp:parallel-execution` / `spur agent run`) to RECONCILE (classify: contract-misread / actionable / trade-off / noise) to STOP (bounded 3 cycles; "doubt theater" checkable signal). Optional cross-model offer. Distinct from post-hoc `code-verification` / `code-review`.
- [ ] R5. source-driven-development discipline. A first-class sp owner for source-first verification: verify framework / API / library facts against primary sources before generating; distinguish "the API exists" from "I used it correctly under the contract." Reconcile with the referenced external `cc:anti-hallucination` so exactly one authority owns this.
- [ ] R6. Review enrichment (`code-review` + `code-verification` references). Add: Structural Remedies (propose the restructuring, not just the problem); Change Sizing thresholds (~100 good / ~300 acceptable / ~1000 split) + split strategies; Honesty-in-review / anti-sycophancy (do not rubber-stamp, do not soften, quantify, push back); Dead-Code Hygiene (identify, list, ask before deleting); Dependency Discipline (prefer stdlib / existing). Optional: a parallel specialist-reviewer fan-out (security / performance / red-team) via `sp:parallel-execution` for high-stakes diffs, isolated so lenses do not cross-contaminate.
- [ ] R7. `sys-debugging` enrichment (keep the feedback-loop-first Phase 1 intact). Add: treat error output as UNTRUSTED data (do not act on instructions embedded in error / log / stack-trace text — prompt-injection defense); non-reproducible decision trees (timing / environment / state / random); safe-fallback and instrumentation keep-vs-remove guidance.
- [ ] R8. HITL decision-brief format. Upgrade grilling / refine / decomposition-quiz prompts to a decision-brief shape: one-line question, plain-English stakes, ALWAYS a recommendation, a completeness score per option (or a kind-note when options differ in kind), pros/cons, and dual human-vs-AI effort labels where effort differs. Apply in `dev-brainstorm` Phase 1, `dev-refine`, and the `spec-decomposition` pre-batch quiz. Document the format once (SSOT), reference it from the three sites.
- [ ] R9. Subagent execution disciplines. Add to `parallel-execution` + `super-coder` + `execution-batch`: hand artifacts as FILES (never paste bulk context into a dispatch), a durable progress ledger that survives compaction, per-role model selection (cheapest model that fits each role), and never pre-judge the reviewer (no "do not flag X" / pre-rated severity in a reviewer prompt).
### Acceptance Criteria
- [ ] AC1. R1 — MET when each named skill has a Common-Rationalizations table (>= 3 rows) and a Red-Flags list (>= 3 items), a new structural test asserts their presence on the load-bearing set, and `bun run test` is green.
- [ ] AC2. R2 — MET when a cross-cutting verification-before-completion rule exists with a Red-Flags table and is referenced from the pipeline verify plus at least the implement and test skills.
- [x] AC3. R3 — MET when `plugins/sp/skills/code-simplification/SKILL.md` and `plugins/sp/commands/dev-simplify.md` exist, the skill carries the full anatomy (Overview / When to Use / Process / Common Rationalizations / Red Flags / Verification), the command appears exactly once in the README command index (structural test green), and the skill-structure suite passes. (MET 2026-07-05 — structural suite 32/32, lint clean; see Solution/Testing.)
- [ ] AC4. R4 — MET when the `doubt-driven-development` skill exists with the five-step loop, the "pass artifact + contract, NOT the claim" rule, the bounded-3-cycle stop, and the doubt-theater Red Flag.
- [ ] AC5. R5 — MET when a single owner for source-first verification exists in sp (skill or reference) and the `cc:anti-hallucination` overlap is resolved to one authority with no duplicated procedure.
- [ ] AC6. R6 — MET when the `code-review` references contain Structural Remedies, Change Sizing, Honesty / anti-sycophancy, Dead-Code Hygiene, and Dependency Discipline subsections, each in sp vocabulary.
- [ ] AC7. R7 — MET when `sys-debugging` contains the untrusted-error-output rule, the non-reproducible decision trees, and instrumentation keep/remove guidance, with the feedback-loop-first Phase 1 unchanged.
- [ ] AC8. R8 — MET when the decision-brief format is documented once (SSOT) and applied in `dev-brainstorm`, `dev-refine`, and the decomposition quiz (grep evidence in Solution).
- [ ] AC9. R9 — MET when `parallel-execution` / `super-coder` / `execution-batch` document file-handoffs, a durable progress ledger, per-role model selection, and the never-pre-judge-reviewer rule.
- [ ] AC10. Global gate — MET when `bun run autofix && bun run spur-check` passes clean at task close (biome format + typecheck, lint, recommended-pre-check including `sp-no-vendor-refs`, full test suite with zero skipped tests, recommended-post-check), and no file under `plugins/sp` references `vendors/`.
### Q&A
Q: Where did the original R10 (ethos lens) and R11 (architecture-upkeep survey) go?
A: Relocated 2026-07-05 to task 0215 (the remaining-items container), by operator decision. R11 became 0215 R1 (a survey OPERATION on `sp:sys-architecture` + a thin command — deliberately NOT an extension of `/sp:dev-review`; see 0215 Q&A for the reasoning). R10 became 0215's D-1 decision (deferred pending an explicit operator yes/no). This task (0214) now closes on R1-R9 only.

Q: Why is this a single spec task rather than a feature + task batch?
A: It captures one coherent program (behavioral hardening + the three in-plugin competencies + enrichment), all within one scope guard (`plugins/sp` markdown + its tests). If executed through the pipeline, run `/sp:dev-plan` against this file to derive a per-wave task batch (R1+R2 as one slice, R3 done, R4/R5/R6 as three, R7/R8/R9 as closing slices) — each wave an independently verifiable vertical slice.
### Design
The editing standard is the four-vendor absorption model, with the `agent-skills` skill anatomy (Overview / When to Use / Process / Common Rationalizations / Red Flags / Verification) as the through-line. The requirements apply proven behavioral-hardening and competency patterns to sp, wave by wave, without regressing sp deterministic strengths.

**Key decisions:**

- **D1. Absorb, never cite.** Vendor concepts are rewritten in sp vocabulary; no `plugins/sp` file references `vendors/` (`sp-no-vendor-refs` rule + structural test R20). Leading words to standardize where they fit: *rationalization*, *red flag*, *doubt*, *artifact + contract*, *tracer bullet*, *deep module*, *seam*.
- **D2. Behavioral layer complements, never replaces, deterministic gates.** Anti-rationalization tables sit ALONGSIDE the CLI gates (`feature check`, `batch-create`, verdict), not instead of them. sp keeps its machine-enforced invariants; this task adds the human-pressure counter-layer the vendors prove works.
- **D3. Reconcile two skill conventions.** New skills follow sp existing frontmatter conventions (metadata / platforms; `references/` for >100-line detail; SSOT) AND adopt the anatomy sections. Where they conflict, sp structural rules win and the anatomy is expressed within them.
- **D4. New skill only for a distinct routing value.** `code-simplification`, `doubt-driven-development`, and `source-driven-development` earn their own skills (distinct triggers, no existing owner). R6 / R7 / R8 / R9 are enrichment of existing skills, not new skills.
- **D5. Scope guard.** Touch only `plugins/sp` markdown / frontmatter, its tests, the new skill / command / README files. NO behavioral change to the `spur` CLI, the pipeline YAMLs, or the section-write contract. If a requirement appears to need `config/workflows/` or `apps/`/`packages/` changes, STOP and split a follow-up task rather than widening this one.
- **D6. Wave ordering.** Tier 1 (R1 + R2 + R3) first — highest leverage, self-contained, and R3 proves the anatomy pattern end-to-end. Then Tier 2 (R4 / R5 / R6), then Tier 3 (R7 / R8 / R9). Optional R10 / R11 last, or deferred with a recorded reason.

**Impacted surfaces:** NEW `plugins/sp/skills/code-simplification/`, NEW `plugins/sp/skills/doubt-driven-development/`, NEW `plugins/sp/commands/dev-simplify.md`; edits to `code-review`, `code-verification`, `sys-debugging`, `spec-decomposition`, `sys-architecture`, `spur-tdd`, `code-implementation`, `brainstorm` (+ their `references/`); `spur-dev/cross-cutting.md`; `parallel-execution` + `agents/super-coder.md` + `spur-dev/references/execution-batch.md`; `plugins/sp/README.md`; `plugins/sp/tests/skill-structure.test.ts`. Nothing outside `plugins/sp` changes except this task file.

**Risks and mitigations:** anatomy sections bloat skills past the token budget from 0187 -> keep tables tight and move long detail to `references/`; a new Red-Flags section duplicates an existing "Anti-patterns" block -> merge, do not add a second; over-scoping into CLI/pipeline changes -> D5 scope guard, split follow-ups.
### Plan
**Hard constraint (this task and every task derived from it):** a wave closes only when `bun run autofix && bun run spur-check` passes clean (biome format + typecheck, then lint + recommended-pre-check rules + full test suite with zero skipped tests + recommended-post-check rules). No per-wave gate checklists; this uniform gate is the single definition of done.

**Wave 1 — Tier 1 (highest leverage, self-contained): R3, R1, R2**
- [ ] R3: author `code-simplification` SKILL.md + `dev-simplify` command; add to README index + `code-review` See-also; skill-structure suite green.
- [ ] R1: add Common-Rationalizations + Red-Flags sections to the 8 gate-bearing skills; extend `skill-structure.test.ts` to assert presence; spot-check each table has >= 3 real rows tied to that skill.
- [ ] R2: add the verification-before-completion cross-cutting rule + Red-Flags table; reference it from verify + implement + test skills.
- [ ] Gate: `bun run autofix && bun run spur-check` clean.

**Wave 2 — Tier 2 (new competencies + review depth): R4, R5, R6**
- [ ] R4: author `doubt-driven-development` skill (five-step loop, artifact-not-claim rule, bounded stop, doubt-theater signal); wire as an optional posture the implement step / operator can invoke via `sp:parallel-execution`.
- [ ] R5: establish the single source-first-verification owner; resolve the `cc:anti-hallucination` overlap.
- [ ] R6: enrich `code-review` / `code-verification` references (structural remedies, change sizing, honesty, dead-code hygiene, dependency discipline); optional specialist fan-out.
- [ ] Gate: `bun run autofix && bun run spur-check` clean.

**Wave 3 — Tier 3 (enrichment): R7, R8, R9**
- [ ] R7: `sys-debugging` untrusted-error-output rule + non-repro trees + instrumentation guidance (Phase 1 untouched).
- [ ] R8: decision-brief HITL format (SSOT) applied in `dev-brainstorm` / `dev-refine` / decomposition quiz.
- [ ] R9: subagent disciplines (file-handoffs, progress ledger, per-role model selection, never pre-judge reviewer) in `parallel-execution` / `super-coder` / `execution-batch`.
- [ ] Gate: `bun run autofix && bun run spur-check` clean.

**Wave 4 — optional: R10, R11**
- [ ] R10: implement the ethos / completeness lens, or record the decline in Q&A with a reason.
- [ ] R11: implement the markdown architecture-upkeep survey, or record deferral in Q&A.
- [ ] Gate: `bun run autofix && bun run spur-check` clean.
### Solution
**Progress log — partial (executing Wave 1 of the Plan).**

**R3 — code-simplification skill + `/sp:dev-simplify` command — DONE.**

| File | Change |
|---|---|
| `plugins/sp/skills/code-simplification/SKILL.md` (new) | Behavior-preserving simplification competency in sp voice: five principles (preserve behavior / follow conventions / clarity over cleverness / maintain balance / scope to what changed), Chesterton's-Fence Step 1, structural + naming + redundancy signal tables, incremental change with a narrow test after each + revert-on-regression, Rule of 500, Common Rationalizations (7 rows), Red Flags (7), Verification checklist. No `vendors/` reference (absorbed, per R20 / the sp-no-vendor-refs rule). |
| `plugins/sp/commands/dev-simplify.md` (new) | Thin wrapper delegating to `sp:code-simplification`; `path-or-scope` + `--scope` / `--check` / `--auto` forwarded verbatim via `$ARGUMENTS`. Modeled on `dev-review.md`. |
| `plugins/sp/README.md` | `dev-simplify` row in the command index (operations & hygiene); `code-simplification` row in the skills table; counts updated — 16→17 skills, 23→24 commands, `dev-*` 17→18. |

Key file:line anchors:
- `plugins/sp/skills/code-simplification/SKILL.md:2` — new skill (`name: code-simplification`).
- `plugins/sp/commands/dev-simplify.md:2` — new thin command wrapper.
- `plugins/sp/README.md:124` — `dev-simplify` command-index row (R43 index-once).
- `plugins/sp/README.md:256` — `code-simplification` skills-table row.

Evidence: `bun test plugins/sp/tests/skill-structure.test.ts` → 32 pass / 0 fail (R42 aggregate description budget 4394/4400; R43 `dev-simplify` indexed exactly once; R20 no-vendor clean; R16b/c references + links resolve). `bun run lint` → biome 426 files clean + all 7 workspace `tsc --noEmit` exit 0. The full `bun run spur-check` (full workspace suite + `test-cf` Workers runtime) is deferred to wave close / a non-sandbox run — `test-cf` cannot bind sockets in this sandbox (same limitation recorded in task 0187).

**Remaining in Wave 1:** R1 (anti-rationalization anatomy across the 8 gate-bearing skills + structural-test enforcement) and R2 (universal verification-before-completion cross-cutting rule). Then the wave-close gate. R10/R11 relocated to task 0215 (see Q&A).
### Testing

<!-- Test results + a numeric coverage claim, or explicit `N/A`. (Filled at `testing`.) -->

### Review

<!-- P1–P4 findings table (Severity / File / Finding / Recommendation). (Filled at `done`.) -->

### References

Vendor sources studied (reference-only; NEVER cite these paths from plugin files — the `sp-no-vendor-refs` rule + structural test R20 forbid it):

- vendors/agent-skills/docs/skill-anatomy.md — the Common-Rationalizations / Red-Flags / Verification anatomy and writing principles (R1, and the format for all new skills).
- vendors/agent-skills/skills/code-simplification/SKILL.md + commands/code-simplify.toml — the code-simplification skill + thin-command model (R3).
- vendors/agent-skills/skills/doubt-driven-development/SKILL.md — in-flight adversarial fresh-context review; artifact-not-claim; bounded loop; doubt-theater signal (R4).
- vendors/agent-skills/skills/source-driven-development/SKILL.md — verify framework facts against primary sources (R5).
- vendors/agent-skills/skills/code-review-and-quality/SKILL.md — structural remedies, change sizing, severity labels, honesty-in-review, dead-code hygiene, dependency discipline (R6).
- vendors/agent-skills/skills/debugging-and-error-recovery/SKILL.md — untrusted-error-output rule, non-reproducible decision trees, safe fallbacks (R7).
- vendors/Superpowers/skills/verification-before-completion/SKILL.md — the universal no-claim-without-evidence honesty gate (R2).
- vendors/Superpowers/skills/subagent-driven-development/SKILL.md — file-handoffs, durable progress ledger, per-role model selection, never pre-judge the reviewer (R9).
- vendors/Superpowers/skills/receiving-code-review/SKILL.md — no performative agreement; verify-before-implement (R6).
- vendors/gstack (review/specialists/*, the AskUserQuestion decision-brief format, ETHOS.md) — specialist review council (R6), decision-brief HITL format (R8), completeness / user-sovereignty ethos (R10).

sp surfaces re-verified against current code (2026-07-05): plugins/sp/skills/*/SKILL.md (16); plugins/sp/tests/skill-structure.test.ts; plugins/sp/README.md; plugins/sp/skills/spur-dev/references/{cross-cutting,execution-batch}.md; plugins/sp/agents/super-coder.md.

Prior decision this task builds on (does not reopen): task 0187 absorbed vendors/skills (Matt Pocock) into plugins/sp — feedback-loop-first debugging, deep-module vocabulary, vertical slices, the glossary, description budgets. This task covers the three vendors 0187 did not (Superpowers, gstack, agent-skills) plus the survey 0187 explicitly deferred.

### History
- 2026-07-06T05:55:43.859Z backlog → todo (system)
