---
template: feature-impl
schema_version: 1
name: "Task authoring contract: external-evidence citation form and AC-altitude declaration"
description: ""
status: done
type: task
profile: standard
feature_id: F91
parent_wbs: null
priority: P1
tags: ["corpus", "gate", "docs"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-17T22:18:51.234Z"
updated_at: "2026-08-18T01:39:59.354Z"
---

## 0584. Task authoring contract: external-evidence citation form and AC-altitude declaration

### Background
Two gate rules are unsatisfiable today, for the same underlying reason: **the corpus contract has no
way for a task to declare what kind of thing it is saying**, so the checker assumes, and the
assumption is wrong for a large minority of tasks. Both decisions are authoring-contract decisions
about the same object — what a task file is allowed to assert — so they are decided together, once.

**External evidence has no legal spelling.** `extractBacktickLineAnchors`
(`packages/app/src/services/task-check.ts:207`) matches any backticked `path:line`, and
`checkLineAnchors` resolves it from **this** repo's root. That is the only notation the contract
defines, so evidence that does not live here has nowhere valid to go. Of 851
`L4.stale-line-anchor` warnings measured 2026-08-17, **244 are genuinely external** —
`@gobing-ai/ts-llm-jsonl-importer` sources under `~/xprojects/ts-libs`, and gitignored
`.spur/run/**` artifacts. Task 0564 alone carried ten no repair could clear. Worse, the anchor form
actively hid drift: spot-checking 0564's importer citations against the real ts-libs tree found two
that had drifted **there** too (`mappers.ts:418` → 481-483; `mappers.ts:483` → 546). The notation
asserted a false location *and* the wrong line.

**AC altitude is assumed, not declared.** `checkAcCoverage`
(`packages/domain/src/bdd/coverage.ts:74`) requires every task Gherkin title to be a
normalized-title subset of its linked feature's AC. That holds for a task that *graduates* a feature
scenario — E5's 0553–0556 mirror E5 R1–R7 exactly and warn zero. It is unsatisfiable for a task
whose criteria sit at a finer altitude: a fix task's per-defect regression criteria are not, and
should not be, the feature's ship contract. Measured 2026-08-17: **619** warnings across **57
tasks**. Task 0564 carried 11 that were cleared only by rewriting its Gherkin into AC bullets,
because bullets are invisible to the rule — the corpus teaching authors to evade the gate by
switching notation, which is worse than the warning.
### Requirements
- [x] **R1.** `checkLineAnchors` recognizes the frozen external-evidence form (named origin + backticked path + line number outside the backticks) and records it as external, never emitting `L4.stale-line-anchor` for it. Measurable: the 244 citations classified external today produce zero stale-anchor findings after reconciliation.
- [x] **R2.** A repo-relative anchor stays required for in-repo evidence: a bare basename that resolves uniquely inside the repository is **not** eligible for the external form and still reports. Measurable: a test asserts a uniquely-resolvable basename in external form still produces a finding.
- [x] **R3.** `ac_altitude: graduating | task-local` exists on the task frontmatter schema; `checkAcCoverage` enforces the DD-09 subset rule for `graduating` and skips it for `task-local`. Measurable: the 57 tasks currently reporting `L4.uncovered-task-scenario` report none once declared `task-local`.
- [x] **R4.** The altitude is read **only** from the declared field — never inferred from `template`, `status`, or whether the AC uses Gherkin. Measurable: a `task-local` task written in Gherkin and a `graduating` task written in bullets each behave per their field, asserted by test.
- [x] **R5.** A `graduating` task whose scenario titles drift from its feature's is still reported. Measurable: a test asserts a drifted title on a `graduating` task still yields `L4.uncovered-task-scenario`.
- [x] **R6.** Both contracts are taught where authors read them — `sp:code-verification`, `cross-cutting.md`, `ac-style-guide.md`, `docs/04_DESIGN.md` — in the same commit (constitution T3). Measurable: each names the frozen form/field and when to use it.

**Out of scope / non-goals:** promoting any finding to error severity (task 0583 owns the
warning→error promotion); the anchor-qualification migration (0583); reconciling the warning
baseline (0582); any change to `--strict-core` `testing → done` gate layers.
### Acceptance Criteria
```gherkin
Scenario: R3 — Evidence outside the repository has a legal citation form
  Given verification evidence that lives outside this repository
  When it is cited in the documented external-evidence form
  Then the checker records it as external rather than as a stale repo-root anchor
  And a repo-relative path is still required for evidence that lives in this repository

Scenario: R6 — A task declares its AC altitude instead of having one assumed
  Given a task whose acceptance criteria are finer-grained than its feature's ship contract
  When spur task check runs
  Then no uncovered-scenario finding is raised for that task
  And a task that does graduate its feature's scenarios is still held to the DD-09 subset rule
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Both decisions are FROZEN (operator, 2026-08-17). No open questions remain; implement as written.**

**Decision 1 — external evidence uses a non-anchor prose form.** Frozen shape: a named origin plus
a backticked path with the line number **outside** the backticks.

```
Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 481 — omp call_id write
```

`extractBacktickLineAnchors` (`packages/app/src/services/task-check.ts:207`) must not match it —
its regex requires the line number inside the backticks (`` `path:NN` ``), so this form is already
invisible to it. The work is therefore **classification, not parsing**: recognize the form, record
it as external evidence, and never emit `L4.stale-line-anchor` for it.

*Rejected:* a package-qualified anchor resolved via `node_modules`. Verifiable only when the package
happens to be installed, so the same corpus yields different verdicts on different machines — the
failure mode that gets gates disabled. And the 2026-08-17 audit showed a resolvable external anchor
still drifts silently: 0564 cited `mappers.ts:418` for the omp `call_id` write, which actually sits
at line 481. Verifiability we cannot maintain is worse than an honest unverifiable citation.

**Decision 2 — AC altitude is a frontmatter field.** Frozen name and vocabulary:

```yaml
ac_altitude: graduating | task-local
```

Declared at `packages/domain/src/planning/schema.ts:288`, directly beside the existing
`ac_numbering: z.literal('task-local').optional()` — the closest sibling concept, kept in one place.
`graduating` enforces the DD-09 subset rule; `task-local` skips it. **Optional with no default**, and
an absent field keeps today's behavior (rule enforced), so no existing task changes meaning
silently.

*Rejected:* a marker inside the AC body. Not machine-readable from `task show --json`, not
schema-validated, and it puts a traceability contract in prose — the same class of mistake as
letting notation choice decide whether a rule applies.

**Anti-patterns — do not implement.** Do not default new tasks to `task-local` (silently disables
DD-09 corpus-wide). Do not key altitude off `template`, `status`, or the presence of a Gherkin block
— inference is exactly what let notation-switching evade the gate (R4). Do not silently downgrade
unresolvable anchors to informational, which deletes the signal instead of routing it. Do not
resolve external paths by scanning the filesystem outside the repo root.

**File targets.** `packages/domain/src/planning/schema.ts` (field); `packages/domain/src/bdd/coverage.ts`
(`checkAcCoverage` gains the altitude parameter); `packages/app/src/services/task-check.ts`
(external-form classification in `checkLineAnchors`, altitude threaded into the DD-09 call);
authoring guidance in `plugins/sp/skills/code-verification/SKILL.md`,
`plugins/sp/skills/spur-dev/references/cross-cutting.md`,
`plugins/sp/skills/spur-dev/references/ac-style-guide.md`, and `docs/04_DESIGN.md` §7.1/§7.3.

**Cross-task.** No dependencies. **Leaves for task 0583:** the external-evidence classifier must
land before 0583's subject-matching rule runs, or all 244 external citations become false positives;
0583 consumes the classification and must not re-implement or re-interpret it.
### Plan
- [x] Add `ac_altitude` to the task frontmatter schema beside `ac_numbering`, optional, no default (R3)
- [x] Thread altitude into `checkAcCoverage` so `graduating` enforces DD-09 and `task-local` skips it (R3, R4)
- [x] Assert the field is the only altitude input — Gherkin/bullets and template must not change behavior (R4)
- [x] Keep the subset rule fully enforced for `graduating`, including drifted titles (R5)
- [x] Classify the frozen external-evidence form in `checkLineAnchors` as external, not stale (R1)
- [x] Keep a uniquely-resolvable in-repo basename ineligible for the external form (R2)
- [x] Reconcile the 244 external citations to the frozen form and declare the 57 altitude tasks honestly (R1, R3)
- [x] Document both contracts in the four authoring surfaces; run `bun run lint` / `test` / `build` (R6)
### Solution
**Both decisions were frozen (operator, 2026-08-17) — implemented as written.**

- `packages/domain/src/planning/schema.ts:288` — added `ac_altitude: z.enum(['graduating','task-local']).optional()` directly beside `ac_numbering` (the closest sibling concept, R3). Optional with **no default**: an absent field keeps today's behavior (DD-09 subset rule enforced, `graduating`), so no existing task changes meaning silently.
- `packages/domain/src/bdd/coverage.ts:74` — `checkAcCoverage` gained an `acAltitude?: 'graduating' | 'task-local'` parameter. `task-local` returns a covered/empty result immediately (subset rule skipped, R3); absent/`graduating` runs the full DD-09 normalized-title subset check unchanged (R5). The altitude is an explicit argument, never inferred — notation (Gherkin vs bullets) and template are ignored (R4).
- `packages/app/src/services/task-check.ts:712` — `runL4` reads `fm.ac_altitude` and threads it into the private `checkAcCoverage`, which early-returns for `task-local` and passes it through to the shared 0043 `checkAcCoverage` for `graduating` (R3/R4/R5, single code path — never a private matcher).
- `packages/app/src/services/task-check.ts` — `checkLineAnchors` + new exported `classifyExternalEvidence()` implement the frozen external-evidence form (R1/R2):
  - `classifyExternalEvidence` matches the frozen shape — a **named origin** (must contain `/`, `@`, `.`, `_`, or `-` so sentence prose like `at \`path\` line N` is never promoted) + backticked path + line number **outside** the backticks (`` `path` line N `` / `` `path` lines N-M ``). The line is outside the backticks, so `extractBacktickLineAnchors` (regex requires `path:NN` inside) can never match it — the form is classified external, never `L4.stale-line-anchor` (R1). Consumed by task 0583's subject-matching rule; it must not re-implement or re-interpret this classification.
  - R2: `hasUniqueRepoBasename` walks the tree (excluding `.spur`, `node_modules`, `.git`, `dist`, `build`, `coverage`) and, when an external-form citation's basename resolves **uniquely** in-repo, raises `L4.stale-line-anchor` — in-repo evidence must use a repo-relative backtick anchor, not the external form.
- Authoring guidance (R6, same commit): `plugins/sp/skills/code-verification/SKILL.md` (external form + line-anchor rule), `plugins/sp/skills/spur-dev/references/ac-style-guide.md` (new AC-altitude section), `plugins/sp/skills/spur-dev/references/cross-cutting.md` (authoring-contract note), and `docs/04_DESIGN.md` §7.1/§7.3.1 (frontmatter table row + external-form note).

**Deliberate choices / notes:** the classifier's named-origin separators gate is the anti-pattern guard from the task Design ("classification, not parsing") — it prevents pre-existing prose (`0493`/`0494`/`0420` cite in-repo paths with `line N` in sentence form) from entering the R2 net and manufacturing new baseline debt; verified zero new corpus findings from this change. `task-local` skips DD-09 only — every other check (L1–L3, other L4 edges) stays live.
### Testing
**Verdict: PASS** — independent verify 2026-08-17 (`/sp:dev-verify 0584 --auto --next --force --focus all --fix all`), re-run after the `--fix all` pass. Implementation was authored by another agent; this run audits it and repairs two defects it found. Artifact: `.spur/run/0584-verdict.json`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/task-check.ts:248` (`EXTERNAL_EVIDENCE_RE`, frozen shape: named origin + backticked path + line number **outside** the backticks) and `:262-291` (`classifyExternalEvidence`, with a named-origin gate requiring a structural separator so sentence prose is never promoted). Wired into the anchor gate at `:1105-1108`. **Real-corpus proof:** task 0564 carries the ten hand-converted importer citations and now reports **0 warnings** (`spur task check 0564` this run) where it previously carried ten unfixable `L4.stale-line-anchor` |
| R2 | MET | `packages/app/src/services/task-check.ts:1112` rejects a citation whose basename resolves uniquely in-repo, per citation; helper `uniqueRepoBasenames` at `:1180-1213`. **Repaired this run** — see P2 below. Tests: `packages/app/tests/services/task-check.test.ts` "an in-repo path cited in external form is flagged" + new "only the citation that resolves in-repo is flagged, not its external siblings" |
| R3 | MET | `packages/domain/src/planning/schema.ts:304` (`ac_altitude: z.enum(['graduating','task-local']).optional()`, sibling to `ac_numbering`); `packages/domain/src/bdd/coverage.ts:87-89` (early return skips the subset rule for `task-local`); read at `packages/app/src/services/task-check.ts:773-774`. **Second surface repaired this run** — `packages/app/src/services/task-service.ts:1211-1212` now threads it too; see P2 below |
| R4 | MET | Altitude is read only from the declared field — exhaustive grep of `ac_altitude`/`acAltitude` across `packages/*/src` and `apps/*/src` returns exactly the four sites above, none of them keyed on `template`, `status`, or notation. Tests: "altitude is field-only — a task-local task written in Gherkin does not warn" (task-check) and "altitude is field-only: Gherkin notation does not change behavior" (coverage) |
| R5 | MET | `graduating` and absent both enforce the subset rule: `packages/domain/src/bdd/coverage.ts:87` gates only on the literal `'task-local'`. Tests: "a graduating task with drifted titles still reports (field, not notation)", "graduating altitude still enforces the subset rule on drifted titles", "absent altitude keeps legacy behavior — subset rule still enforced", plus the new write-surface counterpart |
| R6 | MET | Both contracts taught where their authors read them: external-evidence form in `plugins/sp/skills/code-verification/SKILL.md` and `plugins/sp/skills/spur-dev/references/cross-cutting.md`; `ac_altitude` in `plugins/sp/skills/spur-dev/references/ac-style-guide.md`; both in `docs/04_DESIGN.md`. Structural assertions green in `plugins/sp/tests/skill-structure.test.ts` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R3 — Evidence outside the repository has a legal citation form | MET | test+query | 4 `classifyExternalEvidence` tests (recognition, line ranges/plural wording, repo-root anchor **not** external, prose without a named origin **not** classified) + the live 0564 result: 10 citations, 0 warnings |
| Scenario: R6 — A task declares its AC altitude instead of having one assumed | MET | test | 8 altitude tests across `coverage.test.ts` and `task-check.test.ts` covering task-local skip, graduating enforce, absent-legacy, and field-only behavior; plus 2 new write-surface tests added this run |

**SECUA Review** (`--focus all`)

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | C | `packages/app/src/services/task-check.ts` | **R2 flagged every external citation in a section when any one resolved in-repo.** `hasUniqueRepoBasename` answered a single boolean for the whole set, and the caller then emitted a finding per citation whose message named *that* citation's path as in-repo — false for all but one. A section with ten genuinely-external citations plus one in-repo slip would have produced ten findings, nine of them lying. Compounding it, `reported` was never incremented in that branch, so the per-section 5-finding cap did not bound it. **Fixed this run:** `uniqueRepoBasenames` returns the set of basenames resolving to exactly one repo file (one tree walk, unchanged cost), the caller filters per citation, and `reported` increments. Regression test added and **proven load-bearing** — reverting the filter fails it |
| P2 | C | `packages/app/src/services/task-service.ts` | **The altitude was honored by `task check` but not on section write.** `checkAcSubsetWarning` (the DD-09 warning emitted by `spur task update --section "Acceptance Criteria"`) called `checkAcCoverage` with three arguments, so `ac_altitude` was never passed and the rule still fired. An author who correctly declared `task-local` would be warned on every AC write — exactly the notation-switching pressure R3/R4 exist to remove, surviving on the surface authors touch most. **Fixed this run:** altitude threaded at `:1211-1212`. Two regression tests added and **proven load-bearing** — reverting the 4th argument fails the task-local one |
| P4 | A | `packages/domain/src/bdd/coverage.ts:87-98` | The `task-local` early return yields `{covered: true, orphans: [], uncovered: [], issues: []}`. Only `.uncovered` is read on the altitude-aware path, so this is inert today — but `packages/app/src/services/feature-check.ts:485-491` reads `.orphans` from the same function, and a future caller passing altitude there would silently see "no orphans" for a reason unrelated to coverage. **Closed this run** — a CAUTION comment at the early return records that `orphans` is not a computed result there, and what to do if a caller ever needs it |

**Gate checks (fresh this run)**

- `bun test` over `task-check.test.ts` + `task-service.test.ts` + `coverage.test.ts` + `skill-structure.test.ts` → **315 pass / 0 fail**
- Both repairs proven load-bearing by reverting each fix in isolation and observing the new test fail, then restoring
- `bunx biome check` on all 4 changed files → clean; `packages/app` and `packages/domain` `tsc --noEmit` → exit 0
- `spur task check --corpus` → `errors 406 observed, 365 baselined, 0 new, 0 stale; warnings 2537 observed, 902 baselined, 0 new, 0 stale` — **OK**
- `spur task check 0584 --strict-core` → pass, 0 errors, 0 warnings

**Fix pass (`--fix all`) — applied this run**

1. `packages/app/src/services/task-check.ts` — `hasUniqueRepoBasename` → `uniqueRepoBasenames` (per-citation set, not a set-wide boolean); caller filters per citation and increments `reported` so the 5-finding cap applies.
2. `packages/app/src/services/task-service.ts` — `checkAcSubsetWarning` reads `ac_altitude` and passes it to `checkAcCoverage`; docstring records why the second surface must honor it.
3. `packages/app/tests/services/task-check.test.ts` — regression test asserting only the in-repo citation is flagged, not its external siblings.
4. `packages/app/tests/services/task-service.test.ts` — two regression tests: `task-local` writes silently, `graduating` still reports a drifted title.
5. `packages/domain/src/bdd/coverage.ts` — CAUTION comment closing the P4 advisory on the early return's `orphans`.

Gitignored fix-pass writes: `.spur/run/0584-verdict.json` (verdict, 6 requirement rows, 2 AC rows, 4 checks).

**Residual: none.**

**Shippable: FAIL** — Feature F91. `spur feature check F91` passes, but linked task **0583** ("Anchor integrity") is still `todo`, so the feature is not ship-ready. 0582 and 0584 are `done`. Expected mid-feature; recorded because `--fix all` makes the gate mandatory.

**`--next`: no-op — task already terminal (`done`).** The `testing → done` transition cannot fire. The PASS above is post-repair: 0584 was marked `done` carrying both P2 defects, and both were live in the tree at that point.

Coverage: N/A (verdict-based audit; the verify pipeline does not measure code coverage).
### Review
**Review verdict: PASS — no P1/P2/P3 findings. P4 notes recorded.**

Reviewed task 0584 (working tree diff, 10 files, +443/−17) against R1–R6 + AC + Frozen Design.

**Functional traceability (R1–R6):**
- R1 — `classifyExternalEvidence` (`packages/app/src/services/task-check.ts:240`) recognizes the frozen external form (named origin + backticked path + line number OUTSIDE backticks); unit tests confirm it is classified external and never `L4.stale-line-anchor`. The frozen shape keeps the line outside backticks so `extractBacktickLineAnchors` (regex requires `path:NN` inside) cannot match it.
- R2 — `hasUniqueRepoBaseline` + `checkLineAnchors` (task-check.ts:1100) flag an in-repo-uniquely-resolvable basename cited in external form; test asserts a real finding with message containing `R2`.
- R3 — `ac_altitude: z.enum(['graduating','task-local']).optional()` added beside `ac_numbering` (`packages/domain/src/planning/schema.ts:288`); `checkAcCoverage` gained an altitude param (`packages/domain/src/bdd/coverage.ts`) that skips DD-09 for `task-local`; `TaskCheckService.checkAcCoverage` threads `fm.ac_altitude` through (`task-check.ts:771`).
- R4 — altitude field-only, never inferred from notation/template: tests cover a `task-local` task written in Gherkin (no warning) vs a `graduating` task (reports) with identical drifted scenario.
- R5 — `graduating` still enforces the subset rule on drifted titles (unit test).
- R6 — authoring guidance in-commit: `code-verification/SKILL.md`, `ac-style-guide.md`, `cross-cutting.md`, `docs/04_DESIGN.md` §7.1/§7.3 (T3 satisfied).

**SECUA / architecture:**
- Security: no new inputs at a trust boundary; reads only local corpus + own FS tree walk (excludes `.spur`/`node_modules`/`.git`/`dist`/`build`/`coverage`). No network.
- Correctness: classifier origin-separator gate (`[/@._-]`) prevents pre-existing prose ("at `path` line N") from entering the R2 net — verified zero new corpus findings (task 0584 adds 0 corpus delta).
- No anti-patterns from the Frozen Design: no default-to-task-local, no inference from template/status/Gherkin, no external FS scan outside repo, no silent downgrade of unresolvable anchors.
- Performance: `hasUniqueRepoBaseline` walks the repo tree per L4 anchor check; bounded and only traverses pre-existing check surfaces (L4 traceability). Acceptable at gate cadence; a precomputed index is a 0583 follow-up, not required here.

**P1–P4 findings table:**

| Priority | Finding | Evidence / Location | Disposition |
| --- | --- | --- | --- |
| P1 | None — no security, correctness, or scope blocker | — | — |
| P2 | None — no functional-traceability gap against R1–R6 | — | — |
| P3 | None found in this pass | — | — |
| P4 | `hasUniqueRepoBaseline` does a full recursive tree walk on every L4 anchor check with external-form citations; acceptable at corpus-gate cadence, but a path index would remove the repeated walk | `packages/app/src/services/task-check.ts:1162` | Non-blocking; candidate for task 0583's subject-matching consolidation |
| P4 | The classifier's origin-separator gate is heuristic (package-like origins only); a future origin that is prose without separators would be misallocated — acceptable given the frozen form is package/project-named | `classifyExternalEvidence` | Documented in Source comment; revisit if 0583 exposes a miss |

**Residual risk:** the concurrent session's untracked `K2`/`0585` adds 3 corpus warnings that keep the full `spur-check` red independent of this task — 0584 adds 0 corpus findings and must not be reconciled into the baseline by this task. Not in scope; belongs to the K2 owner.

Verification: `bun test packages/app/tests/services/task-check.test.ts packages/domain/tests/bdd/coverage.test.ts` → **151 pass / 0 fail**; `tsc -p packages/app` → clean; 0 staged files this pass.
### References
- **ADR-062** — Corpus Gates Verify Evidence Content, and Every Severity Is Ratcheted (`docs/00_ADR.md`) — the decision record for this feature.
- **ADR-050** — the two-sided error baseline this work extends.
- **ADR-058** — tracked transition shims: the warning-first-then-tighten precedent and the two-sided manifest shape.
- **ADR-063** — top-level feature-node consent (why this feature lives at F91, not a root letter).
- **Feature F91** — `docs/features/F91_*.md`; parent **F9** owns `checkAcCoverage`, the stable finding codes, and the severity-override map this work builds on.
- **Origin audit** — the 2026-08-17 E5 re-audit (`/sp:dev-verifyall --feature E5 --force --fix all`) that surfaced all four root causes; tasks 0553/0554/0555/0564 carry the repaired citations.
### History
- 2026-08-18T01:01:09.258Z todo → wip (system)
- 2026-08-18T01:11:09.856Z wip → testing (system)
- 2026-08-18T01:14:37.703Z testing → done (system)
