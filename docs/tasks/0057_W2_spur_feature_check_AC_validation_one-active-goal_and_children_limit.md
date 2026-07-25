---
name: "W2: spur feature check — AC validation, one-active-goal and children limit"
description: "W2: spur feature check — AC validation, one-active-goal and children limit"
status: done
created_at: 2026-06-13T01:08:18.983Z
updated_at: 2026-06-14T18:08:52.656Z
folder: docs/tasks
type: task
feature-id: F3
priority: P0
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0057. "W2: spur feature check — AC validation, one-active-goal and children limit"

### Background

Design §3, B08/B09, DD-13/DD-14.


### Requirements

R1. Gherkin/checklist AC validation via the shared BDD module.
R2. One active P0 goal across {active, verifying}.
R3. ≤9 children per node enforced (split-the-parent signal).
R4. Traceability: feature_id edges of linked tasks resolve; orphan-scenario warnings.


### Q&A



### Design

Authority: design §3 (layers apply to features), B08 (AC Gherkin/checklist validation via the shared BDD
module — never a private parser), B09 + DD-13 (one active P0 goal counted over {active, verifying}),
DD-14 (≤9 children per node — overflow is a split-the-parent signal, reported as a finding, not
engineered around).


### Solution

1. `packages/app/src/services/feature-check.ts`: mirrors 0051's layered composition; feature-specific
   rules: two-tier AC validation (shared 0043 module — Gherkin fenced-block OR `- [ ]` checklist,
   `validateAcceptanceCriteria` + `parseChecklist`), one-active-goal, corpus-derived children limit, and
   L4 incoming traceability (tasks linking this feature via `feature_id` resolve; orphan-scenario
   warnings). (The done/cancelled outgoing-edge check is task-check's direction, not the feature's.)
2. Findings model and `--strict`/exit-code behavior identical to task check (shared findings types).
3. Tests: goal-rule fixtures (two active P0s; P0 in verifying still owns the goal), 9-children overflow,
   malformed AC, dangling edges; run against the real docs/features corpus as a must-pass fixture.
4. Same commit: `04 §7.2` check row. Gate: `bun run check`; ≥90%.


### Plan

- [x] R1: L3 BDD AC validation via shared `validateAcceptanceCriteria` (0043 module, never a private parser)
- [x] R2: one-active-P0-goal over {active, verifying} — corpus scan (`checkOneActiveGoal`)
- [x] R3: ≤9-children per node — corpus-DERIVED count, reported as an L3 finding (fixed dead `_childrenCount` read)
- [x] R4: L4 traceability — incoming `feature_id` edge resolution + orphan-scenario warnings (fixed no-op runL4)
- [x] CLI `spur feature check [<id>]` (`--strict`/`--folder`/`--json`, exit 0/1, validate-all)
- [x] Findings model + `--strict` mirror task check (shared severity/exit semantics)
- [x] Tests: goal fixtures, children boundary + overflow, malformed AC, orphan/linked scenarios; E2E
- [x] R-doc: `04_DESIGN §7.2` feature check row


### Review

**SECU verdict: PARTIAL → PASS** (verified + fixed 2026-06-14 via `/rd3:dev-verify 0057 --force --fix all`)

As shipped, R1 (BDD AC) + R2 (one-active-goal) were genuinely implemented and well-tested, but R3
(children-limit) was non-functional dead code, R4 (traceability) was unimplemented, and there was no
`spur feature check` CLI subcommand. Fixed all during the fix-pass.

**S — Security:** Read-only validation; no injection surface. BDD AC validation goes through the shared
`@gobing-ai/spur-domain` `validateAcceptanceCriteria` (never a private parser, B08).

**C — Correctness / architecture:**
- R1 ✓ L3 AC validation calls the shared BDD module `validateAcceptanceCriteria` (`feature-check.ts:231`),
  errors+warnings mapped to L3 findings. Tested (valid + invalid Gherkin).
- R2 ✓ `checkOneActiveGoal` (`feature-check.ts`) — at most one P0 feature across {active, verifying};
  scans the corpus. Tested: two active P0s conflict; verifying P0 still owns the goal; non-P0 exempt.
- R3 ✓ **FIXED** — children-limit was reading a non-existent `fm._childrenCount` (dead rule, never fired).
  Replaced with `checkChildrenLimit`: count is **derived from the corpus** (length-(id+1) IDs prefixed by
  this node, DD-14), reported as an **L3** finding (per Design §3, was misplaced in L4). DD-14's single
  `[1-9]` digit makes >9 unrepresentable in a valid corpus, so the warning is defense-in-depth against a
  corrupt/duplicate-id corpus — tested via a duplicate-child corpus (10 length-2 children of A → warning).
- R4 ✓ **FIXED** — `runL4` was a no-op. Now scans `tasksDir` for tasks whose `feature_id` == this feature
  (incoming edges), warns on a linked task that fails to parse (dangling edge), and emits an
  **orphan-scenario** warning when AC has scenarios but no task links the feature (DD-07). Tested + E2E.
- CLI ✓ Added `spur feature check [<id>]` (`--strict`/`--folder`/`--json`, exit 0/1; validates all when id
  omitted), passing `featuresDir`+`tasksDir` so R2/R3/R4 actually run.

**U — Usability:** Findings carry layer + section + message; `--strict` elevates warnings; mirrors
`spur task check`.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | R4 traceability entirely unimplemented: `runL4` was a no-op comment ("inverse lookup is done in task-check") — no incoming `feature_id` edge resolution, no orphan-scenario warnings. | Correctness | `feature-check.ts` runL4 | P1 | **FIXED** — incoming-edge scan + orphan-scenario warning; tested + E2E-verified. |
| 2 | R3 children-limit dead: read `fm._childrenCount`, a frontmatter field that doesn't exist (children are corpus-derived) — the rule never fired. Also misplaced in L4 vs Design's L3. | Correctness | `feature-check.ts:345` | P2 | **FIXED** — corpus-derived `checkChildrenLimit` in L3; defense-in-depth warning tested via a duplicate-id corpus. |
| 3 | No `spur feature check` CLI subcommand — the service was unreachable from the CLI; §7.2 had no check row. | Correctness | `apps/cli/src/commands/feature.ts` | P2 | **FIXED** — added `check` subcommand + §7.2 doc row. |
| 4 | R1 incomplete: AC validation passed the raw section body (incl. the ```` ```gherkin ```` fence) to the Gherkin validator → every fenced-AC feature got spurious "Unrecognized syntax" warnings. Found by the dogfood corpus must-pass test. | Correctness | `feature-check.ts` runL3 | P2 | **FIXED** — `stripCodeFence` removes the markdown fence before validating. |
| 5 | R1 incomplete: only Gherkin AC was supported; **checklist** AC (`- [ ]`, R1 "Gherkin/checklist") hard-failed with "No Feature declaration". | Correctness | `feature-check.ts` runL3 | P2 | **FIXED** — two-tier AC: detect checklist via the shared `parseChecklist` and validate it as a checklist, else Gherkin. |
| 6 | Matrix vs template mismatch: `active`/`verifying`/`done`/`blocked`/`cancelled` had no `optional` list, so the template's own `Tasks`/`Notes`/`History` sections were flagged "not allowed" (closed-world). | Correctness | `feature-check.ts` DEFAULT_FEATURE_MATRIX | P3 | **FIXED** — added the template sections as `optional` for each status. |
| 7 | Corpus gap (NOT a 0057 code bug): the 8 top-level group features A–H are `active` but have **no `## Acceptance Criteria`** section, so `feature check` correctly FAILs them on the L2 AC gate. The check is working; the corpus is incomplete. | Process | `docs/features/{A..H}_*.md` | P3 | **FLAGGED** — corpus completion (add AC or move group features off `active`) belongs to a corpus pass / 0058 refresh, not 0057. The dogfood test asserts the corpus PARSES (L1 clean), which it does. |

No remaining P1/P2 in 0057's code scope.

**Gate (post-fix):** `bun run lint` clean (251 files; 7 workspaces typecheck) · `bun run test` 1057 pass / 0
fail · `feature-check.ts` 100% line+func · `feature.ts` 95% func / 92% line · E2E `spur feature check`
fires the orphan-scenario warning. Dogfood: the real `docs/features/` corpus parses with no fence
warnings (Gherkin + checklist both handled); remaining FAILs are the legitimate missing-AC finding (#7).


### Testing

Verified 2026-06-14. Tests genuine (real assertions).

- `packages/app/tests/services/feature-check.test.ts` — 22 tests: L1 schema (valid/missing-field/bad-id/parse-fail),
  L2 section-matrix (active gate, backlog, cancelled, custom matrix, strict), L3 BDD AC (valid + invalid Gherkin
  via the shared module), L3 Scope in/out, **R2 one-active-goal** (conflict, solo, non-P0 exempt, verifying counts),
  **R3 children-limit** (9-child boundary + non-child exclusion; >9 corrupt-corpus warning via duplicate ids),
  **R4 traceability** (orphan-scenario warning; no warning when a task links via feature_id).
- `apps/cli/tests/commands/feature.test.ts` — `feature check` tests: per-feature `--json` result, unknown-id
  exit 1, human PASS/FAIL output, validate-all (no id) branch.
- **Dogfood + two-tier AC** (added in fix-pass): every feature in the real `docs/features/` corpus parses
  with no L1 errors and no ```` ```gherkin ```` fence warnings; a fenced Gherkin AC and a `- [ ]` checklist
  AC both validate without spurious errors.

E2E through the real CLI: `spur feature check A` on an active feature with AC scenarios but no linked task
emits the L4 orphan-scenario warning.

Full suite: 1057 pass / 0 fail. `feature-check.ts` 100% line+func.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


