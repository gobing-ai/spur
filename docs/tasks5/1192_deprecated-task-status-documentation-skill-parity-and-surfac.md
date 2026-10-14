---
schema_version: 1
name: Deprecated task status documentation, skill parity and surface-review closure
status: done
template: meta
created_at: 2026-10-13T16:56:12.970Z
updated_at: "2026-10-14T04:32:44.571Z"
feature_id: F43
priority: P3
estimate_hours: 3

dependencies: ["1189", "1190", "1191"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1192-verdict.json
---

## 1192. Deprecated task status documentation, skill parity and surface-review closure

### Background

Implements: R8 — Owner docs and skills record the vocabulary change and its affected surfaces.

Design: docs/design/task-deprecated-status.md §3.1 S13-S15; ADR-137; docs/00_ADR.md, docs/04_DESIGN.md. The design stage already wrote the ADR entry, the satellite and the 04 index row; this slice closes the remaining owners and the audit.

Ordering: last slice — it records what the earlier three landed, so its content depends on them.

### Requirements

- [x] R1. Update the status vocabulary and the lifecycle graph in `docs/design/planning-record-contracts.md` so the TASK_STATUSES list and the task graph match the shipped YAML, and keep `docs/design/rd3-migration-design.md` §2.3 consistent if it enumerates the task statuses.
- [x] R2. Update the `sp:spur-cli` task reference (`plugins/sp/skills/spur-cli/references/tasks.md`) with the `deprecated` status, its legal edges, the freeze guards and the exempt write set from the satellite's §3.2.
- [x] R3. Close the audit rows the design marked 'audit only' (`docs/design/task-deprecated-status.md` §3.1 S14): `plugins/sp/scripts/wrapup-steps.ts` and `plugins/sp/scripts/quality-gate.mjs` either need an explicit terminal-set review or an evidence-backed no-edit note, and S2/S15 (contracts, persistence, init template) get the same treatment with a verified result rather than an assumption.
- [x] R4. Confirm the design satellite's affected-surface table still matches the tree after the three implementation slices — update any anchor that moved and mark the ADR-137 status line from 'implementation pending' to implemented once the slices are verified.

### Acceptance Criteria

- [x] AC8 — Owner docs and skills record the vocabulary change and its affected surfaces

Task-local checks: every 'no edit needed' audit row names the command or read that proves it; no doc restates a status list that can drift from the enum.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen approach: close the documentation owners and re-verify the satellite anchors rather than restating the design in new docs.

Why: the ADR entry, the satellite and the design index row already exist from the idea-pipeline design stage, so this slice must not duplicate them — duplicating a design record is how two sources of truth appear. What the design stage could not do is verify the 'audit only' rows against post-implementation reality, and anchors drift when the guards land.

Rejected: writing a second status-vocabulary list into the skills reference. Link to the satellite and state only the operator-facing facts (which statuses exist, what the freeze refuses, which hops stay permitted).

Invariants: no new authoritative claim without a file anchor; every 'no edit needed' row carries the command or read that proves it; the ADR status line never claims 'implemented' before the slices are verified.

Verification: a keyword scan of the touched docs and skills for a stale status list, plus a read-back of each updated owner section.

### Plan

1. Update the planning record contracts and any other status enumeration.
2. Update the task CLI skill reference with the frozen semantics and the exempt write set.
3. Audit the S14/S2/S15 rows and record the verified result for each.
4. Re-verify the satellite anchors against the tree and flip the ADR-137 status line.
5. Scan the touched docs for a stale status list.

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

- `docs/design/planning-record-contracts.md:220` — §7.3.3's canonical `TaskStatus` vocabulary now lists `deprecated` (ADR-137) and matches `TASK_STATUSES` in `packages/domain/src/planning/schema.ts:20`; `:226` scopes the identity-alias note to ADR-136 (feature) / ADR-137 (task).

- `docs/design/rd3-migration-design.md:153` — §2.3's `TaskStatus` line gains `deprecated`, and the task graph at `:162-163` now matches the shipped `config/workflows/task-lifecycle.yaml`: admitted from `backlog`/`todo`/`wip`/`testing`/`blocked`/`done`, leaving only to `todo` (un-deprecate) or `cancelled` (removed), non-terminal (`:169`). The graph is the section's own subject, so the YAML is restated there rather than in the skill.

- `plugins/sp/skills/spur-cli/references/tasks.md:129` — the `backlog · todo · … · cancelled` enumeration is gone: the skill points at `TASK_STATUSES` (`packages/domain/src/planning/schema.ts`), the shipped graph and the design satellite, so no status list in the reference can drift from the enum.

- `plugins/sp/skills/spur-cli/references/tasks.md:140` — records only the operator-facing facts: `deprecated` is non-terminal and frozen, its legal edges (every status except `cancelled` → `deprecated`; `deprecated` → `todo`/`cancelled`), the two freeze guards (a new dependency edge is refused; a live dependent gets `L4.task-deprecated`), and the exempt write set from the satellite §3.2 (`record`, `migrate-anchors`/verdict writes, and `update --section`, which lands with a freeze warning).

- `docs/design/task-deprecated-status.md:72` — S2 closed as audit-only: all four contract status fields are `z.enum(TASK_STATUSES)` (`packages/contracts/src/task.ts:12,44,79,87`), the package owns no task-status list, and OpenAPI is built at runtime, so nothing regenerates.

- `docs/design/task-deprecated-status.md:84` — S14 closed as audit-only: `plugins/sp/scripts/wrapup-steps.ts:171` is its sole task-status terminal set and correctly excludes the non-terminal `deprecated`; `plugins/sp/scripts/quality-gate.mjs` is generated output whose only terminal set is run statuses (`plugins/sp/lib/quality-gate.generated.mjs:27498`) and whose bundled `TASK_STATUSES` already carries `deprecated`, so hand-editing it would desync the committed twin.

- `docs/design/task-deprecated-status.md:85` — S15 closed as audit-only: no `tasks` table exists in `drizzle/`, no DAO owns task status, and the status is frontmatter-only (`packages/domain/src/planning/schema.ts:20`).

- `docs/design/task-deprecated-status.md:74` — S4's init-template claim re-verified with its evidence: `apps/cli/src/config/scaffold-manifest.ts:33` lists no workflow entry and `apps/cli/src/commands/init.ts:152` seeds the bundled config copy wholesale, so the only task-lifecycle YAML an init produces is a copy of the canonical one.

- `docs/design/task-deprecated-status.md:43` — the satellite's anchors repointed after the 1190/1191 line shifts (`task-service.ts` auto-walk `1834–1915` → `1883–1964`, `idea-handoff.ts` resolver `221` → `256`, `feature-service.ts` closure `486` → `490` at `:56`), including rows S1 `:71`, S5 `:75`, S6 `:76`, S7 `:77`, S8 `:78` and S10 `:80`.

- `docs/design/task-deprecated-status.md:79` — rows S9/S11/S12 now name the files the slices actually touched: `packages/app/src/services/planning-admission.ts` (`:149,193,313`), `plugins/sp/skills/next-router/references/routing-table.md`, and `apps/web/src/modules/task-kanban/TaskCard.tsx:32` / `apps/web/src/modules/task-kanban/task-actions.ts:17`.

- `docs/00_ADR.md:2314` — ADR-137's status line reads `Accepted (implemented)`; both guard slices are `done` in this corpus, so the design stage's "implementation pending" no longer applies.

- `docs/design/planning-record-contracts.md:220` — the task's own verification: every `backlog … cancelled` enumeration in the five touched files either carries `deprecated` or is the live-task set (`backlog|todo|wip|testing|blocked`), which correctly excludes the frozen status.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Vocabulary and graph checked against the shipped sources, not the word `deprecated` alone. `docs/design/planning-record-contracts.md:220` reads `backlog · todo · wip · testing · blocked · done · cancelled · deprecated` (ADR-137) and `:226` scopes the identity-alias note to ADR-136 feature / ADR-137 task; that list is identical to `TASK_STATUSES` at `packages/domain/src/planning/schema.ts:20` (8 members, `deprecated` last). `docs/design/rd3-migration-design.md:153` carries the same list, and its restated graph `:162-163` matches `config/workflows/task-lifecycle.yaml` edge for edge: six sources move to `deprecated` at `:168,173,178,183,188,193`, and `deprecated` leaves only to `todo`/`cancelled` at `:200,205`; `:169`'s "non-terminal" claim is backed by `terminalStates: [cancelled]` at `config/workflows/task-lifecycle.yaml:45`. |
| R2 | MET | `plugins/sp/skills/spur-cli/references/tasks.md:129-135` deletes the old `backlog ... cancelled` enumeration and points at `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`), the shipped graph and the design satellite; `:140-152` records the operator-facing facts only: `deprecated` is non-terminal and frozen, its legal edges (every status except `cancelled` -> `deprecated`; `deprecated` -> `todo`/`cancelled`), both freeze guards (a new dependency edge refused; a live dependent warned via `L4.task-deprecated`) and the exempt write set (`record`; `migrate-anchors` and verdict writes; `update --section` with a freeze warning) — the same set as satellite 3.2 at `docs/design/task-deprecated-status.md:92-98`. No second driftable status list was introduced. |
| R3 | MET | All four "no edit needed" audit rows re-read and falsification attempted. S2: `packages/contracts/src/task.ts:12,44,79,87` are all the enum over `TASK_STATUSES` and a scan of `packages/contracts/src` finds no task-status literal list, so nothing regenerates. S4: `apps/cli/src/config/scaffold-manifest.ts:39` (`SCAFFOLD_MANIFEST`) lists no workflow entry and `seedGlobalConfig` at `apps/cli/src/commands/init.ts:152` seeds the bundled config copy wholesale; `shasum -a 256 config/workflows/task-lifecycle.yaml apps/cli/config/workflows/task-lifecycle.yaml` returns `d11dfccc2894ea661f50112e00bf7b5285d324eedbc79e049572b8b5a4c6974b` for both, so the init copy is the shipped graph. S14: `plugins/sp/scripts/wrapup-steps.ts:171` is the file's sole task-status terminal test and correctly excludes the non-terminal `deprecated`; the generated plugin twin's only terminal set is run statuses at `plugins/sp/lib/quality-gate.generated.mjs:27498`, and its bundled status array at `:29673` already carries `deprecated`. S15: no `tasks` table exists in `drizzle/`, `packages/domain/src/schema/planning.ts:4,19` defines only `planning_events` and `task_run_links`, and the status is frontmatter-only (`packages/domain/src/planning/schema.ts:20`). |
| R4 | MET | Anchors re-read and every one lands on its subject after the 1190/1191 line shifts: S1 `docs/design/task-deprecated-status.md:71` -> `packages/domain/src/planning/schema.ts:20`, `:48`, `:151`, `:201`; S5 `:75` -> `packages/app/src/services/feature-service.ts:490-494` with the closure reused at `:539,606`; S6 `:76` -> `packages/app/src/services/task-service.ts:1494`, with the freeze warning at `:1519,1601` and the warning channel at `:1580,1638,1698,1712`; S7 `:77` -> `packages/app/src/services/task-service.ts:1883` walk start; S8 `:78` -> `packages/app/src/workflow/idea-handoff.ts:148,256` with the refusal at `:271`; S9 `:79` -> `packages/app/src/services/planning-admission.ts:149,193,313`; S10 `:80` -> `packages/app/src/services/task-check.ts:1179,1244` and `packages/config/src/finding-codes.ts:47,48,149,154`. ADR flip justified: `docs/00_ADR.md:2314` reads `Accepted (implemented)`, and the three guarded slices are `status: done` (`docs/tasks5/1189_deprecated-task-status-vocabulary-and-lifecycle-graph.md:4`, `docs/tasks5/1190_deprecated-task-freeze-guards-in-dependency-resolution-admis.md:4`, `docs/tasks5/1191_deprecated-task-derivation-routing-and-board-surfaces.md:4`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC8 — Owner docs and skills record the vocabulary change and its affected surfaces | MET | command | Executable evidence, all three commands run in this repo with exit 0. (1) Vocabulary scan `rg -n 'backlog · todo' docs/design/planning-record-contracts.md docs/design/rd3-migration-design.md docs/design/task-deprecated-status.md plugins/sp/skills/spur-cli/references/tasks.md` → 3 hits, every task-status enumeration ending `· deprecated`: `docs/design/planning-record-contracts.md:220`, `docs/design/rd3-migration-design.md:153,162`; that list equals `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`). The live-task set at `docs/design/planning-record-contracts.md:110` reads `backlog\|todo\|wip\|testing\|blocked` and correctly excludes the frozen `deprecated` — no touched doc restates a driftable list. (2) Init/bundle parity `shasum -a 256 config/workflows/task-lifecycle.yaml apps/cli/config/workflows/task-lifecycle.yaml` → the single digest `d11dfccc2894ea661f50112e00bf7b5285d324eedbc79e049572b8b5a4c6974b` printed for both paths. (3) Read-back `bun apps/cli/src/index.ts workflow validate config/workflows/task-lifecycle.yaml` → `workflow valid: task-lifecycle (explicit(1))`. Owner sections read back line-exact: `docs/design/task-deprecated-status.md:63-65` frozen semantics, `:107-111` legal edges, `:92-98` exempt write set; `docs/00_ADR.md:2312-2314` ADR-137 status `Accepted (implemented)`; `plugins/sp/skills/spur-cli/references/tasks.md:140-152` edges, both freeze guards, exempt write set. No code was touched. Residual outside this slice's owner set (recorded as DEFER-ed P3 review findings, not in this diff): `docs/design/planning-workflow-contracts.md:30`, `packages/domain/src/planning/task-skeleton.ts:39`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Review Report — task 1192 (Deprecated task status documentation, skill parity and surface-review closure)**
**Scope:** the uncommitted 1192 diff vs `HEAD` 3b304c2e5 — 6 tracked files, documentation and skill-reference only (no production code). Every claim was re-checked against `config/workflows/task-lifecycle.yaml`, `packages/domain/src/planning/schema.ts:20` (`TASK_STATUSES`) and the shipped sources each audit row names; the gate was not re-run (`.spur/run/1192-test-gate.status` = PASS).
**Dimensions:** functional traceability · SECUA quality · architectural depth (single-source-of-truth) · test/verification quality
**Verdict:** PASS
**Confidence:** MEDIUM

#### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | SECUA (doc truth) | A doc that restates the task-status vocabulary is still stale and is not named in satellite §3.1 S13. `docs/design/planning-workflow-contracts.md:30` prints the `task-lifecycle.yaml` states as `backlog · todo · wip · testing · blocked · done · cancelled` while declaring that YAML as its source, and its sibling row for `feature-lifecycle.yaml` (same table) already carries ADR-136's `deprecated`. Pre-existing — absent from this diff and from R1's two named docs — but it is a doc whose list now drifts from `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`). | `docs/design/planning-workflow-contracts.md:30` | DEFER (pre-existing; §7.5 lifecycle-contract doc indexed at `docs/04_DESIGN.md:37`; owner selection belongs to the design table, not this diff) |
| 2 | P3 (minor) | architecture (SSOT) | A second task-status key list survives in the domain layer: `matrixStatusSchema` at `packages/domain/src/planning/task-skeleton.ts:39` holds 7 statuses without `deprecated` and its own docstring still says "all 7"; it is mirrored at `apps/cli/schemas/section-matrix.schema.json:56` and bundled at `plugins/sp/lib/quality-gate.generated.mjs:29808`. Not introduced by this diff and latent (no shipped `config/tasks/section-matrix.yaml` variant declares `deprecated`), but S14's "audit only" row examined only *terminal sets*, so this sibling vocabulary went unnamed. | `packages/domain/src/planning/task-skeleton.ts:39` | DEFER (pre-existing; latent — section-matrix.yaml declares no `deprecated` variant; not an artifact regression) |
| 3 | P3 (minor) | verification quality (evidence anchor) | The S4 audit row's newly added anchor `apps/cli/src/config/scaffold-manifest.ts:33` lands on a blank line; `SCAFFOLD_MANIFEST` is declared at `apps/cli/src/config/scaffold-manifest.ts:39`. The row still names the symbol and its second read (`apps/cli/src/commands/init.ts:152`) is exact, so the no-edit claim stays proved — only the line number is off. | `docs/design/task-deprecated-status.md:74` | DEFER (read-only review — tracked source is not mine to edit; off-by-6 anchor with the symbol named) |
| 4 | P4 (advisory) | functional (R2 wording) | `plugins/sp/skills/spur-cli/references/tasks.md:142` paraphrases the deprecated admissions as "every status except `cancelled`", a shorthand that implicitly includes `deprecated` itself; the shipped graph admits exactly `backlog`/`todo`/`wip`/`testing`/`blocked`/`done` (`config/workflows/task-lifecycle.yaml:168-193`). The shorthand is inherited from ADR-137 and the satellite §4.1, and the concrete edge set stated in the same sentence is correct. | `plugins/sp/skills/spur-cli/references/tasks.md:142` | DEFER (advisory wording; the enum-shaped facts in the sentence are correct) |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/design/planning-record-contracts.md:220` now reads `backlog · todo · wip · testing · blocked · done · cancelled · deprecated` (ADR-137), identical to `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`); `docs/design/rd3-migration-design.md:153` carries the same list and `:162-163` restate only the edges the shipped YAML declares — the six sources → `deprecated` (`config/workflows/task-lifecycle.yaml:168,173,178,183,188,193`), `deprecated` → `todo`/`cancelled` (`config/workflows/task-lifecycle.yaml:200,205`) — with `terminalStates: [cancelled]` (`config/workflows/task-lifecycle.yaml:45-46`) backing `:169`'s "non-terminal" claim. Enumeration and graph both checked, not the word `deprecated` alone. |
| R2 | MET | `plugins/sp/skills/spur-cli/references/tasks.md:129-136` deletes the old `backlog … cancelled` enumeration and points at `TASK_STATUSES`, the shipped graph and the satellite; `:140-152` states the legal edges, both freeze guards and the exempt write set — matching satellite §3.2 (`docs/design/task-deprecated-status.md:87-99`) and the shipped code it names (`packages/app/src/services/task-service.ts:1224-1232` refusal naming the un-deprecate exit, `packages/app/src/services/task-check.ts:1244-1250` `L4.task-deprecated`, `packages/app/src/services/planning-admission.ts:149,193,313`). No second status list was introduced (finding 4 is wording only). |
| R3 | MET | The four "no edit needed" rows were re-read and falsification was attempted. S2: all four status fields are `z.enum(TASK_STATUSES)` (`packages/contracts/src/task.ts:12,44,79,87`), and `packages/contracts/src` holds no task-status list of its own (only unrelated status enums such as `packages/contracts/src/runs.ts:86`) — no committed spec to regenerate. S4: `apps/cli/src/config/scaffold-manifest.ts:39` lists no workflow entry and `apps/cli/src/commands/init.ts:152` seeds the bundled config copy wholesale. S14: `plugins/sp/scripts/wrapup-steps.ts:171` is the file's only task-status terminal test, and `plugins/sp/lib/quality-gate.generated.mjs:27498` is the run-status set from `packages/domain/src/dao/run-transfer.ts:71`. S15: no `tasks` table exists in `drizzle/` (only `task_run_links`), and `planning_events.from_status`/`to_status` is an event ledger, not a status store. Two caveats recorded: finding 3 (S4 anchor off 6 lines) and finding 2 (a sibling vocabulary S14's terminal-set scope did not cover). |
| R4 | MET | Repointed anchors spot-checked against the tree and landing on their subjects: `docs/design/task-deprecated-status.md:43` (`task-service.ts:1883–1964` walk start/end), `:48` (`idea-handoff.ts:148,256`), `:56` (`feature-service.ts:490` closure), `:71` (`schema.ts:20,48,151,201`), `:75` (`feature-service.ts:490,491,492,493,494,539`), `:76` (`task-service.ts:1494,1519,1580,1601`), `:77`, `:78` (`idea-handoff.ts:148,256,271`), `:80` (`task-check.ts:1179,1244`; `finding-codes.ts:47,48,149,154`). ADR flip justified: `docs/00_ADR.md:2314` reads `Accepted (implemented)` and the three implementation slices are all `status: done` with PASS verdicts in this corpus (`docs/tasks5/1189_*.md`, `docs/tasks5/1190_*.md`, `docs/tasks5/1191_*.md`). |
| AC8 | PARTIAL | The designated owner docs and the skill record the vocabulary change correctly and with `file:line` evidence (see R1/R2), so the affirmative half of AC8 is met. The "and its affected surfaces" half is not fully met: two surfaces that restate the task-status vocabulary remain stale and are absent from satellite §3.1 — `docs/design/planning-workflow-contracts.md:30` and `packages/domain/src/planning/task-skeleton.ts:39` (findings 1-2). Both are pre-existing and outside this diff, hence P3 DEFER rather than a blocker; the shortfall is the corpus-level reading of the task-local check "no doc restates a status list that can drift from the enum". |

##### Dimension notes

SECUA (docs slice — is every new claim true, anchored, non-duplicative): every new claim in the diff is true and anchored. The ten new/edited evidence claims in the satellite S-table were re-read against their sources and nine land exactly; S4's `scaffold-manifest.ts:33` is off by 6 lines (finding 3). Non-duplicative holds: the skill links to the satellite and the enum instead of restating the vocabulary, and R1's two design docs are the design SSOT for the vocabulary (the header of `packages/domain/src/planning/schema.ts` names `rd3-migration-design.md` §2.3 as its authority), so their enumerations are the source, not copies. No new source-of-truth system was introduced. `spur rule run --file config/rules/boundary/sp-runtime-path.yaml` → "All 1 rule passed"; the only in-scope touched file (`plugins/sp/skills/spur-cli/references/tasks.md`) carries no `config/(plugins|rules|tasks|templates|workflows)` literal, so no rule-forbidden literal was introduced.

Architecture (SSOT discipline): the diff holds it — one canonical list (`TASK_STATUSES`), one graph (the shipped YAML), one operator-facing semantic home (the satellite), and the skill points at all three rather than copying. The single residual is a pre-existing second key list in the domain layer (finding 2), which this slice neither introduced nor was scoped to close.

Test/verification quality: the audit rows' proving reads are real and sufficient for their claims — each names a symbol that exists and a read that decides the claim, and the four I re-ran (S2, S4, S14, S15) survived falsification on their literal assertions. The one gap is scope, not proof: S14 audited *terminal sets* and therefore never looked at the section-matrix key enum that sits in the same generated bundle (finding 2); and the S4 anchor is imprecise (finding 3).

##### Adjudications of the brief's five claims

1. R1 (design-doc vocabulary) — satisfied. §7.3.3's `TaskStatus` row (`docs/design/planning-record-contracts.md:220`) and rd3 §2.3 (`docs/design/rd3-migration-design.md:153`) both match the 8-member `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`), and rd3's restated graph matches the YAML edge-for-edge including the two exits and `terminalStates: [cancelled]`.
2. R2 (CLI skill reference) — satisfied on all four counts: edges correct against the YAML (`config/workflows/task-lifecycle.yaml:168-205`), both freeze guards present and correctly located (resolver + preflight; `L4.task-deprecated`), exempt write set identical to satellite §3.2, and no driftable list introduced. The only defect is the "every status except `cancelled`" shorthand (finding 4, P4).
3. R3 (audit rows) — satisfied. Two proving reads were re-run in full and two more checked against source; no "no edit needed" row is a stale surface on its literal claim. The `wrapup-steps.ts:171` behaviour the implementer flagged (a task deprecated mid-run makes `task-resolve` FAIL) is the **correct** reading, not a defect: `deprecated` is non-terminal (`config/workflows/task-lifecycle.yaml:45-46`) and the task did not complete, so a wrapup batch must not report it as completed — the refusal message (`plugins/sp/scripts/wrapup-steps.ts:173`) says exactly that.
4. R4 (satellite anchors + ADR) — satisfied. Spot-checked anchors land as claimed; the ADR-137 flip to `Accepted (implemented)` (`docs/00_ADR.md:2314`) is justified because 1189, 1190 and 1191 are all `done` with PASS verdicts, i.e. the guarded consumers the ADR describes are shipped and verified.
5. Scope — the S9/S11/S12 location-cell extensions are **in scope for R4, not drift**. Each names a file the slices actually changed or the real home of the behaviour: S9 corrects `quickReadiness` from the plugin adapter to its true source `packages/app/src/services/planning-admission.ts:149,193,313`; S11 adds `plugins/sp/skills/next-router/references/routing-table.md`, changed by 1191; S12 names `apps/web/src/modules/task-kanban/TaskCard.tsx:32` and `apps/web/src/modules/task-kanban/task-actions.ts:17`, both changed by 1191 — R4's mandate is exactly to make the table track the tree. (Minor and non-blocking: the S12 row still does not name `apps/web/src/modules/task-kanban/TaskDetail.tsx`, 1191's largest board edit; the definition it names, `task-actions.ts`, is the load-bearing surface, so the row is not wrong.) No rule-forbidden literal was introduced and no stale status list was introduced; the two stale lists that exist predate the diff (findings 1-2).

**Next:** the three P3 residuals are DEFER-ed with reasons; if the operator wants them closed they belong to the design table's owner set (finding 1) and the domain section-matrix vocabulary (finding 2), not to a re-open of this documentation slice.

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History

- 2026-10-14T03:19:18.545Z todo → wip (system)
- 2026-10-14T04:29:36.313Z wip → testing (system)
- 2026-10-14T04:32:44.564Z testing → done (system)

