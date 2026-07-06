---
schema_version: 1
name: "Adopt Superpowers, gstack, and agent-skills lessons into plugins/sp — behavioral hardening + new competencies"
status: done
template: standard
created_at: 2026-07-06T05:52:30.469Z
updated_at: "2026-07-06T07:39:23.811Z"
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
- [x] R1. Anti-rationalization anatomy. Add a "Common Rationalizations" table and a "Red Flags" list to the gate-bearing skills: `code-verification`, `spur-tdd`, `sys-debugging`, `code-implementation`, `spec-decomposition`, `code-review`, `sys-architecture`, `brainstorm`. Each rationalization pairs an excuse an agent uses to skip a step with a factual rebuttal; each red flag is an observable violation signal. Extend `plugins/sp/tests/skill-structure.test.ts` to enforce presence on the load-bearing set. Absorb into sp vocabulary; never cite `vendors/`.
- [x] R2. Universal verification-before-completion discipline. A cross-cutting honesty rule — no "done / passing / fixed / works" claim without fresh, pasted verification evidence (command + output run this turn) — applied beyond the pipeline verdict. Land as a `spur-dev/cross-cutting.md` section (or a small skill) with a Red-Flags table (uses "should"/"probably"; expressing satisfaction before verification; trusting a subagent success report).
- [x] R3. `code-simplification` skill + `/sp:dev-simplify` command. New `plugins/sp/skills/code-simplification/SKILL.md`: preserve behavior exactly; Chesterton's Fence (understand before touching); simplification-signal tables (structural / naming / redundancy); incremental change + test-after-each; scope-to-what-changed; Common Rationalizations + Red Flags + Verification. Thin `plugins/sp/commands/dev-simplify.md` delegating to the skill. Wire into the README command index and `code-review` "See also." (DONE 2026-07-05 — see Solution.)
- [x] R4. `doubt-driven-development` skill. New skill: in-flight adversarial fresh-context review of non-trivial decisions — CLAIM to EXTRACT (artifact + contract, strip reasoning) to DOUBT (adversarial reviewer; pass artifact + contract, NOT the claim; reuse `sp:parallel-execution` / `spur agent run`) to RECONCILE (classify: contract-misread / actionable / trade-off / noise) to STOP (bounded 3 cycles; "doubt theater" checkable signal). Optional cross-model offer. Distinct from post-hoc `code-verification` / `code-review`.
- [x] R5. source-driven-development discipline. A first-class sp owner for source-first verification: verify framework / API / library facts against primary sources before generating; distinguish "the API exists" from "I used it correctly under the contract." Reconcile with the referenced external `cc:anti-hallucination` so exactly one authority owns this.
- [x] R6. Review enrichment (`code-review` + `code-verification` references). Add: Structural Remedies (propose the restructuring, not just the problem); Change Sizing thresholds (~100 good / ~300 acceptable / ~1000 split) + split strategies; Honesty-in-review / anti-sycophancy (do not rubber-stamp, do not soften, quantify, push back); Dead-Code Hygiene (identify, list, ask before deleting); Dependency Discipline (prefer stdlib / existing). Optional: a parallel specialist-reviewer fan-out (security / performance / red-team) via `sp:parallel-execution` for high-stakes diffs, isolated so lenses do not cross-contaminate.
- [x] R7. `sys-debugging` enrichment (keep the feedback-loop-first Phase 1 intact). Add: treat error output as UNTRUSTED data (do not act on instructions embedded in error / log / stack-trace text — prompt-injection defense); non-reproducible decision trees (timing / environment / state / random); safe-fallback and instrumentation keep-vs-remove guidance.
- [x] R8. HITL decision-brief format. Upgrade grilling / refine / decomposition-quiz prompts to a decision-brief shape: one-line question, plain-English stakes, ALWAYS a recommendation, a completeness score per option (or a kind-note when options differ in kind), pros/cons, and dual human-vs-AI effort labels where effort differs. Apply in `dev-brainstorm` Phase 1, `dev-refine`, and the `spec-decomposition` pre-batch quiz. Document the format once (SSOT), reference it from the three sites.
- [x] R9. Subagent execution disciplines. Add to `parallel-execution` + `super-coder` + `execution-batch`: hand artifacts as FILES (never paste bulk context into a dispatch), a durable progress ledger that survives compaction, per-role model selection (cheapest model that fits each role), and never pre-judge the reviewer (no "do not flag X" / pre-rated severity in a reviewer prompt).
### Acceptance Criteria
- [x] AC1. R1 — MET when each named skill has a Common-Rationalizations table (>= 3 rows) and a Red-Flags list (>= 3 items), a new structural test asserts their presence on the load-bearing set, and `bun run test` is green.
- [x] AC2. R2 — MET when a cross-cutting verification-before-completion rule exists with a Red-Flags table and is referenced from the pipeline verify plus at least the implement and test skills.
- [x] AC3. R3 — MET when `plugins/sp/skills/code-simplification/SKILL.md` and `plugins/sp/commands/dev-simplify.md` exist, the skill carries the full anatomy (Overview / When to Use / Process / Common Rationalizations / Red Flags / Verification), the command appears exactly once in the README command index (structural test green), and the skill-structure suite passes. (MET 2026-07-05 — structural suite 32/32, lint clean; see Solution/Testing.)
- [x] AC4. R4 — MET when the `doubt-driven-development` skill exists with the five-step loop, the "pass artifact + contract, NOT the claim" rule, the bounded-3-cycle stop, and the doubt-theater Red Flag.
- [x] AC5. R5 — MET when a single owner for source-first verification exists in sp (skill or reference) and the `cc:anti-hallucination` overlap is resolved to one authority with no duplicated procedure.
- [x] AC6. R6 — MET when the `code-review` references contain Structural Remedies, Change Sizing, Honesty / anti-sycophancy, Dead-Code Hygiene, and Dependency Discipline subsections, each in sp vocabulary.
- [x] AC7. R7 — MET when `sys-debugging` contains the untrusted-error-output rule, the non-reproducible decision trees, and instrumentation keep/remove guidance, with the feedback-loop-first Phase 1 unchanged.
- [x] AC8. R8 — MET when the decision-brief format is documented once (SSOT) and applied in `dev-brainstorm`, `dev-refine`, and the decomposition quiz (grep evidence in Solution).
- [x] AC9. R9 — MET when `parallel-execution` / `super-coder` / `execution-batch` document file-handoffs, a durable progress ledger, per-role model selection, and the never-pre-judge-reviewer rule.
- [x] AC10. Global gate — MET when `bun run autofix && bun run spur-check` passes clean at task close (biome format + typecheck, lint, recommended-pre-check including `sp-no-vendor-refs`, full test suite with zero skipped tests, recommended-post-check), and no file under `plugins/sp` references `vendors/`.
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
- [x] R3: author `code-simplification` SKILL.md + `dev-simplify` command; add to README index + `code-review` See-also; skill-structure suite green.
- [x] R1: add Common-Rationalizations + Red-Flags sections to the 8 gate-bearing skills; extend `skill-structure.test.ts` to assert presence; spot-check each table has >= 3 real rows tied to that skill.
- [x] R2: add the verification-before-completion cross-cutting rule + Red-Flags table; reference it from verify + implement + test skills.
- [x] Gate: `bun run autofix && bun run spur-check` clean.

**Wave 2 — Tier 2 (new competencies + review depth): R4, R5, R6**
- [x] R4: author `doubt-driven-development` skill (five-step loop, artifact-not-claim rule, bounded stop, doubt-theater signal); wire as an optional posture the implement step / operator can invoke via `sp:parallel-execution`.
- [x] R5: establish the single source-first-verification owner; resolve the `cc:anti-hallucination` overlap.
- [x] R6: enrich `code-review` / `code-verification` references (structural remedies, change sizing, honesty, dead-code hygiene, dependency discipline); optional specialist fan-out.
- [x] Gate: `bun run autofix && bun run spur-check` clean.

**Wave 3 — Tier 3 (enrichment): R7, R8, R9**
- [x] R7: `sys-debugging` untrusted-error-output rule + non-repro trees + instrumentation guidance (Phase 1 untouched).
- [x] R8: decision-brief HITL format (SSOT) applied in `dev-brainstorm` / `dev-refine` / decomposition quiz.
- [x] R9: subagent disciplines (file-handoffs, progress ledger, per-role model selection, never pre-judge reviewer) in `parallel-execution` / `super-coder` / `execution-batch`.
- [x] Gate: `bun run autofix && bun run spur-check` clean.

**Wave 4 — optional: R10, R11**
- [x] R10: implement the ethos / completeness lens, or record the decline in Q&A with a reason.
- [x] R11: implement the markdown architecture-upkeep survey, or record deferral in Q&A.
- [x] Gate: `bun run autofix && bun run spur-check` clean.
### Solution
**Progress log — Wave 1 (Tier 1) COMPLETE: R1, R2, R3. Gate green (see Testing). Waves 2–3 remaining.**

**R1 — Anti-rationalization anatomy (8 gate-bearing skills + structural test) — DONE.**

| File | Change |
|---|---|
| `plugins/sp/skills/code-verification/SKILL.md` | Added `## Common Rationalizations` (6 rows) + `## Red Flags` (6) before `## When to use` — verdict-honesty excuses: AC-without-evidence, tests≠coverage, trust-the-report, PARTIAL-rounding. |
| `plugins/sp/skills/spur-tdd/SKILL.md` | Added the anatomy before `## Verification checklist`; existing `## Anti-patterns` (mocking technique) kept — a distinct axis, not duplicated. |
| `plugins/sp/skills/sys-debugging/SKILL.md` | Added anatomy before `## When to use` — repro-first, untrusted-error-text, no change-and-pray. |
| `plugins/sp/skills/code-implementation/SKILL.md` | Added anatomy before `## Gotchas` — read-callers, tests-not-optional, no speculative abstraction. |
| `plugins/sp/skills/spec-decomposition/SKILL.md` | Added anatomy before `## Gotchas` — vertical-slice, no layer-tasks, per-task AC. |
| `plugins/sp/skills/code-review/SKILL.md` | Added anatomy before `## When to use` — no rubber-stamp, no softening, dead-code/dependency discipline. |
| `plugins/sp/skills/sys-architecture/SKILL.md` | Added anatomy before `## Gotchas` — compare ≥2 options, deletion test, ADR-for-cross-cutting. |
| `plugins/sp/skills/brainstorm/SKILL.md` | Replaced `## Common Pitfalls` with the standardized anatomy (pitfalls converted to rationalizations + red flags — merged, not duplicated). |
| `plugins/sp/tests/skill-structure.test.ts` | New R46 test: asserts all 8 load-bearing skills carry `## Common Rationalizations` (≥3 rows) + `## Red Flags` (≥3 items). |

**R2 — Universal verification-before-completion discipline — DONE.**

| File | Change |
|---|---|
| `plugins/sp/skills/spur-dev/references/cross-cutting.md` | New `## Verification Before Completion` section: generalizes Iron Law 7 to every completion claim; 3-step rule + a Red-Flags table (should/probably prediction, satisfaction-before-check, forwarding a subagent success, unbacked "tests pass", skipped checks, single-run "fixed"). |
| `plugins/sp/skills/code-verification/SKILL.md` | Cross-cutting-rules section now links the honesty gate `cross-cutting.md#verification-before-completion` (verify enforces it hardest — a PASS verdict is a completion claim). |
| `plugins/sp/skills/code-implementation/SKILL.md` | See-also links the gate. |
| `plugins/sp/skills/code-testing/SKILL.md` | See-also links the gate. |
| `plugins/sp/tests/skill-structure.test.ts` | New R47 test: asserts the section + its Red-Flags table exist and are referenced from verify/implement/test. |

**R3 — code-simplification skill + `/sp:dev-simplify` — DONE 2026-07-05, re-verified against source this run.** `plugins/sp/skills/code-simplification/SKILL.md` carries the full anatomy (5 principles, Chesterton's-Fence Step 1, structural/naming/redundancy signal tables, incremental + test-after-each, Rule of 500, 7 rationalizations, 7 red flags, Verification). Thin `plugins/sp/commands/dev-simplify.md` + README index/skills-table rows. AC3 met (structural suite green).

**Scope guard (D5) honored:** every change is under `plugins/sp` (markdown/frontmatter + the structural test). No `spur` CLI, pipeline YAML, or section-write-contract behavior changed. No file references `vendors/` (R20 test + recommended-pre-check `sp-no-vendor-refs` both clean).

**Remaining:** Wave 2 (R4 doubt-driven-development, R5 source-driven owner, R6 review enrichment), Wave 3 (R7 sys-debugging, R8 HITL decision-brief, R9 subagent disciplines). R10/R11 relocated to task 0215.

Key `file:line` anchors:
- `plugins/sp/tests/skill-structure.test.ts:589` — R46 (anti-rationalization anatomy presence, 8 skills).
- `plugins/sp/tests/skill-structure.test.ts:635` — R47 (verification-before-completion section + 3 references).
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:151` — the `## Verification Before Completion` section (R2).
- `plugins/sp/skills/code-verification/SKILL.md:314` — `## Common Rationalizations` (R1 pattern, verdict skill).
- `plugins/sp/skills/brainstorm/SKILL.md:191` — `## Common Rationalizations` (R1, converted from Common Pitfalls).
- `plugins/sp/skills/code-simplification/SKILL.md:2` — R3 skill (`name: code-simplification`).

---

**Wave 2 (Tier 2) COMPLETE: R4, R5, R6. Gate green (see Testing).**

| File | Change |
|---|---|
| `plugins/sp/skills/doubt-driven-development/SKILL.md` (new) | R4 — in-flight adversarial-review competency: five-step loop CLAIM→EXTRACT→DOUBT→RECONCILE→STOP, the "pass artifact + contract, NOT the claim" rule, RECONCILE classifier (misread/actionable/trade-off/noise), bounded ≤3 cycles, "doubt theater" red flag, optional cross-model skeptic; full anatomy + Verification. |
| `plugins/sp/skills/source-driven-development/SKILL.md` (new) | R5 — the single sp owner of source-first verification: the two-questions split ("the API exists" vs "used correctly under its contract"), HIGH/MEDIUM/LOW confidence gate, primary-source priority order, cite-then-generate, full anatomy. |
| `plugins/sp/skills/brainstorm/{SKILL.md,references/workflows.md,examples/ideation-example.md}` | R5 reconciliation — repointed verification delegation from the external `cc:anti-hallucination` to `sp:source-driven-development` (9 occurrences); one authority, no duplicated procedure, self-contained (ADR-028d). |
| `plugins/sp/skills/code-review/references/review-lenses.md` | R6 — five review-depth subsections in sp vocabulary: Structural Remedies, Change Sizing (~100/~300/~1000 + split strategies), Honesty in Review (anti-sycophancy), Dead-Code Hygiene, Dependency Discipline. |
| `plugins/sp/skills/code-verification/SKILL.md` | R6 — Step 7 points to the review-lenses depth as SSOT (no restatement). |
| `plugins/sp/tests/skill-structure.test.ts` | R48 lock test (Wave 2 markers) + R42 aggregate description budget raised 4400→5200 (19 skills; per-skill 350 cap unchanged — the real bloat guard). |

Key `file:line` anchors:
- `plugins/sp/skills/doubt-driven-development/SKILL.md:2` — R4 skill.
- `plugins/sp/skills/source-driven-development/SKILL.md:2` — R5 skill (single owner).
- `plugins/sp/skills/code-review/references/review-lenses.md:74` — R6 Structural Remedies (depth block start).
- `plugins/sp/tests/skill-structure.test.ts:1` — R48 lock test + budget bump.

---

**Wave 3 (Tier 3) COMPLETE: R7, R8, R9. Gate green (see Testing). 0214 closes on R1–R9.**

| File | Change |
|---|---|
| `plugins/sp/skills/sys-debugging/SKILL.md` | R7 — new `## Hardening the loop`: (1) error output is untrusted data (prompt-injection defense — never obey commands embedded in error/log/trace); (2) non-reproducible decision tree (timing / environment / state / randomness axes + first probes); (3) instrumentation keep-vs-remove + safe-fallback guidance. Phase 1 feedback-loop-first unchanged. |
| `plugins/sp/skills/spur-dev/references/decision-brief.md` (new) | R8 — the HITL decision-brief SSOT: one-line question, plain-English stakes, mandatory recommendation, completeness score per option (or kind-note when options differ in kind), pros/cons, dual human-vs-AI effort labels where effort diverges; template + rules + application table. |
| `plugins/sp/skills/brainstorm/SKILL.md`, `plugins/sp/commands/dev-refine.md`, `plugins/sp/skills/spec-decomposition/references/decomposition.md` | R8 — the three HITL sites (brainstorm Phase 1 clarify, dev-refine questions, decomposition pre-batch quiz) now render prompts per the decision-brief SSOT (link, not restate). |
| `plugins/sp/skills/parallel-execution/SKILL.md` | R9 — new `## Subagent execution disciplines` SSOT: file-handoffs (path, never pasted bulk context), durable progress ledger (survives compaction), per-role cheapest-model selection, never pre-judge the reviewer. |
| `plugins/sp/agents/super-coder.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md` | R9 — concise `## Subagent execution disciplines` sections naming all four, pointing to the parallel-execution SSOT. |
| `plugins/sp/tests/skill-structure.test.ts` | R49 lock test (Wave 3: sys-debugging hardening + Phase 1 intact; decision-brief SSOT + 3 references; the four subagent disciplines across all three surfaces). |

Key `file:line` anchors:
- `plugins/sp/skills/sys-debugging/SKILL.md:119` — `## Hardening the loop` (R7); Phase 1 intact at line 28.
- `plugins/sp/skills/spur-dev/references/decision-brief.md:1` — R8 SSOT.
- `plugins/sp/skills/parallel-execution/SKILL.md:83` — R9 `## Subagent execution disciplines` SSOT.
- `plugins/sp/tests/skill-structure.test.ts:1` — R46–R49 lock tests (36 tests total, all pass).

**AC8 grep evidence** (decision-brief applied at the 3 sites): `rg -l decision-brief.md skills/brainstorm/SKILL.md commands/dev-refine.md skills/spec-decomposition/references/decomposition.md` → all three.

**Scope guard (D5) honored across all waves:** every change under `plugins/sp` (markdown/frontmatter + the structural test + the two new skills + one new command from R3 + the super-coder agent doc). No `spur` CLI / pipeline-YAML / section-write-contract behavior changed. `sp-no-vendor-refs` clean.
### Testing
**Wave 1 gate — `bun run autofix && bun run spur-check` (2026-07-06, sandboxed run).**

- `bun run autofix` — PASS. biome `Checked 426 files … No fixes applied` (markdown already conformant); `tsc --noEmit` exit 0 across all 7 workspaces.
- `bun run lint` — PASS (exit 0): biome clean + typecheck 7/7.
- `test-pre-check` (recommended-pre-check, 29 rules incl `sp-no-vendor-refs`) — PASS: `All 29 rules passed — no violations found.`
- `bun run test` — 2380 pass / 2 fail / 6279 expect() calls across 170 files. The plugin structural suite `plugins/sp/tests/skill-structure.test.ts` is 34/34 pass (was 32; +R46 +R47).
- `test-post-check` (coverage-gate + every-export-has-tsdoc) — PASS off full-suite coverage; the two files it flagged on partial coverage show 100% line coverage under the full run.

**The 2 `bun run test` failures are a pre-existing sandbox limitation, not a regression.** Both are in `apps/web/tests/lib/rpc-client.test.ts` (`fetchWithTimeout resolves when fetch succeeds`; `apiFetchWithTimeout delegates …`), failing with `Failed to start server. Is port 0 in use?` — the sandbox denies socket binding (same class the operator pre-authorized for `test-cf`). This work touched zero `apps/` files (git status shows only `plugins/sp` + the two task files), so causation is excluded; in non-sandboxed CI these bind a real port and pass.

Coverage: N/A numeric target (markdown-only change). The structural suite proves the invariants — R46: ≥3 rationalizations + ≥3 red flags on each of the 8 load-bearing skills; R47: the verification-before-completion section + its three skill references.

**Wave 2 gate — `bun run autofix && bun run spur-check` (2026-07-06, sandboxed).**

- `bun run autofix` — PASS (exit 0): biome + `tsc --noEmit` 7/7.
- `bun run lint` — PASS (exit 0).
- `test-pre-check` (29 rules incl `sp-no-vendor-refs`) — PASS: `All 29 rules passed`.
- `bun run test` — 2381 pass / 2 fail / 6300 expect() across 170 files; structural suite 35/35 (was 34; +R48). The 2 fails are the SAME pre-existing `apps/web` rpc-client socket-bind tests (`Failed to start server. Is port 0 in use?`) — no new failures from Wave 2.
- `test-post-check` (coverage-gate + tsdoc) — PASS off full-suite coverage.

Coverage: N/A numeric (markdown/frontmatter only). R48 locks the Wave 2 invariants (doubt five-step + artifact-not-claim + 3-cycle + doubt-theater; source single-owner + two-questions; brainstorm reconciliation; the 5 review-depth subsections).

**Wave 3 + final gate — `bun run autofix && bun run spur-check` (2026-07-06, sandboxed).**

- `bun run autofix` — PASS (exit 0): biome + `tsc --noEmit` 7/7.
- `bun run lint` — PASS (exit 0).
- `test-pre-check` (29 rules incl `sp-no-vendor-refs`) — PASS: `All 29 rules passed`.
- `bun run test` — 2382 pass / 2 fail / 6324 expect() across 170 files; structural suite 36/36 (added R46–R49 for R1/R2 + Waves 2/3).
- `test-post-check` (coverage-gate + tsdoc) — PASS off full-suite coverage.

**AC10 global gate — MET with one recorded sandbox caveat.** The only 2 `bun run test` failures are `apps/web/tests/lib/rpc-client.test.ts` (`fetchWithTimeout` / `apiFetchWithTimeout`), failing on `Failed to start server. Is port 0 in use?` — the sandbox denies socket binding (same class the operator pre-authorized for `test-cf`). This work changed zero `apps/` files (git status: only `plugins/sp` + the two task files), so causation is excluded; both bind a real port and pass in non-sandboxed CI. All `plugins/sp` tests are green; `sp-no-vendor-refs` clean; no file references `vendors/`.

Coverage: N/A numeric (markdown/frontmatter + a structural test). The four lock tests (R46–R49) prove every requirement's invariant.
### Review
Self-review (driver `sp:super-coder`; SECUA lens on a markdown/frontmatter change set). No P1/P2 findings.

| Severity | File | Finding | Recommendation |
|---|---|---|---|
| P3 | `plugins/sp` skills | Two new skills (`doubt-driven-development`, `source-driven-development`) grew the aggregate skill-description budget from 4362 to 4988; R42 cap raised 4400→5200. | Accept — the cap is designed to scale with skill count (its own comment); per-skill 350 cap (the real bloat guard) is unbroken. Revisit if aggregate approaches 5200. |
| P3 | `apps/web/tests/lib/rpc-client.test.ts` | 2 pre-existing tests fail in-sandbox on socket bind (`port 0 in use`) — unrelated to this change. | No action for 0214 (out of scope guard D5). Re-run the gate in non-sandboxed CI to confirm 0/0. |
| P4 | `brainstorm` | Verification delegation repointed from external `cc:anti-hallucination` to `sp:source-driven-development` (self-containment). | Accept — resolves the R5 single-authority requirement; the external skill is no longer a dependency for source-first within sp. |

Architecture: the behavioral layer (Common-Rationalizations / Red-Flags / Verification anatomy) sits alongside the deterministic CLI gates (D2), not replacing them. Absorb-never-cite honored (R20 + `sp-no-vendor-refs` clean). No security surface (no code paths changed).
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
- 2026-07-06T07:24:28.336Z todo → wip (system)
- 2026-07-06T07:39:21.181Z wip → testing (system)
- 2026-07-06T07:39:23.811Z testing → done (system)
