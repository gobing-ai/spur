---
template: feature-impl
schema_version: 1
name: "0451 pipeline post-mortem: process and infrastructure hardening"
description: "Fix 6 findings from the 0451 pipeline runs: YAML shell syntax validation, feature reopen lifecycle, verdict parser format, task check error messages, and agent output format mismatches"
status: done
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P2
tags: ["pipeline", "infrastructure", "process"]
dependencies: []
created_at: "2026-08-05T23:59:00.000Z"
updated_at: "2026-08-06T03:10:46.510Z"
---

## 0453. 0451 pipeline post-mortem: process and infrastructure hardening
### Background
During task **0451** pipeline runs (2026-08-05), four attempts across **three distinct failure modes** burned ~26 minutes of agent compute plus operator diagnosis. All six root causes are preventable with targeted fixes. This task hardens process/infra so follow-up work on a **done** feature (or a verify answer with a non-canonical table header) does not brick the pipeline again.

**Pipeline run timeline (from 0451 logs):**

| Run ID | Phase | Outcome | Waste | Cause |
|--------|-------|---------|-------|-------|
| 8d19a847 | precheck | FAIL | ~30s | Feature H83 `done` — live task → `L4.feature-terminal` error |
| c567bd2d | implement→test | FAIL | 17m 54s | YAML `#` comments inside `>-` folded blocks broke shell `if/else` syntax (schema-valid YAML, invalid shell) |
| 6dda08de | precheck | FAIL | ~30s | Same terminal-feature precheck failure path |
| 12a3bf2c | verify | FAIL | 7m 55s | Verify answer used `\| R# \| Severity \| Evidence \| Status \|`; verdict parser only recognized `\| Req \| Status \|…` and assumed status at column 2 → `UNKNOWN` / 0 requirements |

**What is already true in the product (do not re-invent):**

1. **Design already says feature `done` is re-enterable** (`docs/04_DESIGN.md` §7.5: "`done` is re-enterable (reopen, warned); `cancelled` is truly terminal"). Task lifecycle already has `done → wip`; feature lifecycle YAML is the gap.
2. **`FeatureService.deriveFeatureStatus` already proposes `done → active`** when non-terminal tasks are linked, with `requiresConfirm: true`, and `syncFeature({ forceConfirm: true })` applies hops — but **`feature-lifecycle.yaml` has no `done → active` edge**, so production `spur feature update <id> active` fails: `No transition from "done" to "active"` (confirmed on H83). Unit tests that apply force-reopen only pass when the lifecycle adapter allows the hop (or is stubbed).
3. **`L4.feature-terminal` only errors when the feature is terminal *and* the task is still live** (`task-check.ts` ~582–594, task 0339). Done task under done feature is legal.
4. **`sp:code-verification` already documents** the canonical table `| Req | Status | Evidence |` — agents still emit variants; the **parser must be tolerant** (R2) and prompts tightened (R5).
5. **Solution `file:line` citations** are already an L3 hard core on `spur task check` (`task-check.ts` Solution section). Implement skill does not yet mandate backtick form (R6).

**Companion tasks (out of scope here):**

- **0451** — H83 agent.run follow-up (done); source of the dogfood failures.
- **0452** — residual code-review cleanup (server push sync, history report, …) — independent findings, not this pipeline post-mortem.

**Authority:** 0451 pipeline logs under `.spur/run/`; `docs/04_DESIGN.md` §7.5 / `spur feature sync --force`; `packages/app` task-check / task-verdict / feature-service; `config/workflows/feature-lifecycle.yaml`.

**Severity / ETA**

| ID | Sev | Area | Est. |
|----|-----|------|------|
| R1 | P1 | Feature done→active lifecycle + precheck reopen | 2–3h |
| R2 | P1 | Verdict parser header + **named status column** | 1–2h |
| R3 | P2 | `workflow validate` shell `sh -n` | 2–3h |
| R4 | P2 | Actionable `L4.feature-terminal` message | 30–45m (same file as R1) |
| R5 | P3 | Verify skill hard-format header | 30m |
| R6 | P3 | Implement skill backtick `path:line` | 30m |

**Total implement ETA:** ~1 day focused. Do not expand into full shell lint, dry-run execution, or cancelled-feature reopen.
### Requirements
**P1 — must fix (blocking pipeline runs)**

- [x] **R1. Wire feature `done → active` reopen (lifecycle + precheck), matching design §7.5 and existing sync proposals.**

  **Issue (verified).**
  - `config/workflows/feature-lifecycle.yaml` has **no** outgoing transition from `done` (only `cancelled` is in `terminalStates`, but `done` is dead-ended by missing edges).
  - `spur feature update H83 active` → `GuardDeniedError: No transition from "done" to "active"`.
  - `FeatureService.deriveFeatureStatus` already returns `{ from: 'done', to: 'active', requiresConfirm: true, hops: ['active'] }` when any linked task is non-terminal (`feature-service.ts` ~385–395). `syncFeature({ forceConfirm: true })` tries to apply that hop — **production lifecycle rejects it**.
  - Live task under done feature fails precheck: `L4.feature-terminal` error (`task-check.ts` ~587–594): `Feature "…" is done — remove or re-parent this task` (no reopen guidance).
  - Pipeline precheck guard is only `spur task check $wbs` (`task-pipeline.yaml` ~340) — no reopen step.

  **Non-goals for R1**
  - Do **not** add `cancelled → active` (design: cancelled is truly terminal). If `deriveFeatureStatus` still proposes cancelled reopen, leave a one-line follow-up note or tiny guard in sync — do not implement cancelled reopen here.
  - Do **not** weaken `L4.feature-terminal` to allow live tasks under done features without reopen (done would lie).

  **Acceptance**
  - Lifecycle allows `done → active` with `guard: always` (external `requestTransition`, same pattern as `verifying → active` rework). Description must require a History note on reopen (mirror task-lifecycle `done → wip` wording).
  - `spur feature update <id> active` succeeds when feature is `done` (manual path).
  - `spur feature sync <id> --force` successfully applies done→active when non-terminal linked tasks exist (closes the sync/lifecycle hole).
  - Pipeline precheck (profile=`auto`): if task `feature_id` resolves to a `done` feature, reopen to `active` **before** `spur task check` (prefer `spur feature sync <id> --force` so one-active-goal conflict handling in `syncFeature` is reused; fall back to `spur feature update <id> active` only if sync is unavailable).
  - Pipeline precheck (profile≠`auto`): do not silent-reopen; either HITL confirm (`hitl.confirm`) or leave check fail with R4 message (document choice in Solution — prefer HITL if a one-step shell/HITL pattern already exists in pipeline; else fail-loud + R4 is OK for v1).
  - Unit/integration: lifecycle transition test or feature-service force-reopen green against real YAML; regression that cancelled still has no reopen edge.

  **Primary files (all copies that dogfood/ship):**
  - `config/workflows/feature-lifecycle.yaml` (monorepo SSOT)
  - `apps/cli/config/workflows/feature-lifecycle.yaml` (published seed — keep in sync)
  - `.spur/workflows/feature-lifecycle.yaml` (this repo runtime)
  - `config/workflows/task-pipeline.yaml` + `.spur/workflows/task-pipeline.yaml` (+ `apps/cli/config/…` if present) precheck
  - `packages/app/src/services/task-check.ts` (R4 message; shared with R1 UX)
  - Tests: `packages/app/tests/services/feature-service.test.ts` (existing force-reopen), any lifecycle adapter tests

---

- [x] **R2. Verdict parser: accept non-canonical requirement headers *and* locate Status by column name.**

  **Issue (verified).** `extractRequirements` (`task-verdict.ts` ~97–125):
  1. Header only if `h0` includes `req` / equals `requirement` **and** `h1` includes `status` / equals `verdict`.
  2. Data rows always take **status from `cells[1]`**, evidence from `cells[2]`.

  The failing verify table was:
  ```text
  | R# | Severity | Evidence | Status |
  | R1 | P1 | … | MET |
  ```
  - `h0=r#` does not match `req`; even after accepting `R#`, **`h1=severity` fails the status-in-col2 check**.
  - If header detection were forced open without column mapping, status would read `P1` (Severity), not `MET`.

  **Therefore the Design sketch that only adds `h0 === 'r#'` is insufficient.**

  **Acceptance**
  - Treat id-column headers (case-insensitive): `req`, `requirement`, `reqs`, `r#`, bare `r`, or `/^r\d+$/` (e.g. mistaken `R1` as header).
  - On header row, **scan all cells** for a status column (`status` / `verdict` substring) and optional evidence column (`evidence` substring). Remember column indices for subsequent data rows.
  - If no status column found by name, fall back to current col1 status / col2 evidence (backward compatible with `| Req | Status | Evidence |`).
  - Fixture tests:
    1. Canonical `| Req | Status | Evidence |` still works.
    2. `| R# | Severity | Evidence | Status |` extracts MET/PARTIAL/UNMET correctly (status col 4).
    3. `| R# | Status | Evidence |` works (R# + status col2).
  - Do not require Severity column; ignore unknown middle columns.

  **Primary files:** `packages/app/src/services/task-verdict.ts`, `packages/app/tests/services/task-verdict.test.ts`

---

**P2 — should fix (process hardening)**

- [x] **R3. `spur workflow validate` runs `sh -n` on shell action/guard commands.**

  **Issue (verified).** `WorkflowService.validate` (`workflow-service.ts` ~392–413) only `loadWorkflowDef` (schema). Folded `>-` blocks with `#` comments can be schema-valid yet produce broken shell (0451 test hop).

  **Acceptance**
  - After successful schema load, walk the def for every action/guard with `kind: shell` (and equivalent) that has a string `options.command` (or `command`).
  - Syntax-check each via `sh -n` through the project's `ProcessExecutor` (not raw `child_process.execSync` — match app patterns). Empty / missing command → skip or warn (document).
  - Failure → `valid: false` with a message naming **workflow state/node id + action index** and the shell stderr snippet. File:line is best-effort (re-scan source YAML if cheap; else state id is enough for AC).
  - Template vars (`$wbs`, `${vars.x}`) must not cause false failures (`sh -n` treats them as literals — OK).
  - Current monorepo `config/workflows/task-pipeline.yaml` validates clean.
  - Unit test: fixture YAML with a deliberate `if` without `fi` fails validate; a known-good snippet passes.

  **Primary files:** `packages/app/src/services/workflow-service.ts` (`validate`), tests under `packages/app/tests/services/workflow-service.test.ts` (or new fixture file)

---

- [x] **R4. Actionable `L4.feature-terminal` message (and only that finding).**

  **Issue (verified).** Message today (`task-check.ts` ~593):
  `Feature "${featureId}" is ${featureStatus} — remove or re-parent this task`
  No reopen command; contradicts design that done is re-enterable once R1 lands.

  **Acceptance**
  - When `featureStatus === 'done'`: message includes copy-paste reopen:
    `Reopen: spur feature update ${featureId} active` (and mention `spur feature sync ${featureId} --force` when non-terminal tasks already exist).
  - When `featureStatus === 'cancelled'`: do **not** suggest reopen; keep re-parent / unlink guidance (cancelled stays terminal).
  - Severity remains `error` for live tasks; no behavior change for done-under-done (still silent).
  - Unit test asserts message contains `spur feature update` for the done case.

  **Primary file:** `packages/app/src/services/task-check.ts` ~587–594; tests in `task-check.test.ts` (~2119 live-under-done case)

---

**P3 — docs / skill debt (clear for task done)**

- [x] **R5. Harden verify skill: canonical `| Req | Status | Evidence |` only in agent-authored tables.**

  **Issue.** Skill already mentions the header (`plugins/sp/skills/code-verification/SKILL.md` ~265–266) but agents still emit `R#` / Severity columns. Parser tolerance (R2) is the safety net; skill must forbid the bad shape as the **authoring** contract.

  **Acceptance**
  - Explicit MUST in `code-verification` (and `functional-review` if it emits the same table): author tables as exactly `| Req | Status | Evidence |` (optional 4th columns only after Evidence).
  - Explicit MUST NOT: `| R# |…|` as the sole id header without Status in column 2; MUST NOT put Severity between Req and Status.
  - Add one line to Red Flags / Common Rationalizations.
  - No code path change beyond skill markdown (parser is R2).

  **Primary files:** `plugins/sp/skills/code-verification/SKILL.md`; optionally `plugins/sp/skills/functional-review/SKILL.md` / `plugins/sp/skills/code-verification/references/verdict-schema.md`

---

- [x] **R6. Harden implement skill: Solution citations as backtick `` `path:line` ``.**

  **Issue.** L3 requires ≥1 `file:line` citation in Solution (`task-check.ts`); stale-anchor L4 expects backticks. `sp:code-implementation` never states the format — agents write prose `path:line` without backticks and trip check after implement.

  **Acceptance**
  - `plugins/sp/skills/code-implementation/SKILL.md` (and `references/implementation-patterns.md` Solution bullet) require:
    - Every file reference in Solution as `` `relative/path.ts:123` `` or `` `relative/path.ts:10-20` ``.
    - Prefer paths from repo root (e.g. `packages/app/src/...`).
  - Note that `spur task record` / solution-from-diff is complementary, not a substitute for implement-time Solution.
  - No product code change required for R6.

  **Primary files:** `plugins/sp/skills/code-implementation/SKILL.md`, `plugins/sp/skills/code-implementation/references/implementation-patterns.md`

**Explicitly out of scope**
- Full shell static analysis / shellcheck
- `workflow run --dry-run` executing commands
- Softening done-feature policy to allow live tasks without reopen
- `cancelled → active` reopen
- Changing H83 status as part of this task (operator may reopen when running pipelines)
- 0452 residual review items
### Acceptance Criteria
```gherkin
Feature: 0451 pipeline post-mortem — process and infrastructure hardening

  @core
  Scenario: R1 — feature done→active reopen is legal and used by precheck under auto
    Given feature-lifecycle.yaml includes from done to active with always guard
    And a done feature F with a linked non-terminal task T
    When an operator runs spur feature update F active
    Then the transition succeeds and F status is active
    And when spur feature sync F --force is run against the same shape
    Then the sync applies hop active (no GuardDeniedError)
    And when task-pipeline precheck runs for T with profile=auto and F still done
    Then precheck reopens F to active before spur task check
    And task check does not emit L4.feature-terminal for T

  @core
  Scenario: R2 — verdict parser maps Status by header name
    Given answer text with table header | R# | Severity | Evidence | Status |
    And a data row | R1 | P1 | packages/app/src/foo.ts:10 | MET |
    When deriveVerdict / extractRequirements parses the answer
    Then requirement R1 has status MET (not P1)
    And a canonical | Req | Status | Evidence | table still parses as today
    And | R# | Status | Evidence | also parses

  @core
  Scenario: R3 — workflow validate catches shell syntax errors
    Given a workflow YAML whose shell command has an unclosed if
    When spur workflow validate runs on that file
    Then valid is false and the error names the state or action
    And the monorepo task-pipeline.yaml still validates successfully

  @core
  Scenario: R4 — L4.feature-terminal message is actionable for done features
    Given a live (todo/wip) task whose feature_id points at a done feature
    When spur task check runs
    Then the L4.feature-terminal error mentions spur feature update <id> active
    And for a cancelled feature the message does not offer reopen

  @core
  Scenario: R5 — verify skill mandates canonical Req table header
    Given plugins/sp/skills/code-verification/SKILL.md
    When an implementer reads the verify output contract
    Then it MUST require | Req | Status | Evidence |
    And it MUST NOT present | R# | Severity | … | as acceptable authoring

  @core
  Scenario: R6 — implement skill mandates backtick path:line in Solution
    Given plugins/sp/skills/code-implementation/SKILL.md
    When an implementer writes ## Solution
    Then citations must use backtick path:line form from repo root
```
### Q&A

**Q1: Why reopen done features instead of forcing re-parent?**
Design §7.5 already states done is re-enterable. Follow-up work (0451 on H83) belongs on the same feature id. Re-parenting spawned empty skeleton features (L/N) and AC subset noise.

**Q2: Why not reopen cancelled?**
Cancelled is abandoned. Sync historically proposed cancelled→active; this task intentionally does **not** add that edge. Optional follow-up: stop proposing cancelled reopen in `deriveFeatureStatus`.

**Q3: Why column mapping instead of only accepting `R#`?**
The 0451 failure table had Status in column 4 and Severity in column 2. Header-name-only fixes still mis-parse status as Severity.

**Q4: Why `feature sync --force` in precheck rather than only `feature update`?**
Sync already encodes “non-terminal tasks under closed feature ⇒ reopen”, confirmation, and one-active-goal refusal. Prefer one product path.

**Q5: Is R5 redundant if R2 is tolerant?**
No. R2 is the safety net; R5 is the authoring contract so new agents stop inventing headers. Both required.

**Q6: Workflow file copies?**
Monorepo SSOT is `config/workflows/`. Runtime dogfood reads `.spur/workflows/`. CLI seed is `apps/cli/config/workflows/`. Implementer must keep basename copies aligned for feature-lifecycle and task-pipeline edits.

**Q7: Does this need an ADR?**
No new ADR if work only implements design §7.5 already published. If product chooses to allow live tasks under done *without* reopen, that would need ADR — out of scope.
### Design
## Approach

Ship **P1 first** (R1–R2) — these are the two hard failures from the 0451 timeline. Then **P2** (R3–R4). Then **P3** skill text (R5–R6). Prefer **reuse existing seams** (`feature sync --force`, design §7.5 reopen language, ProcessExecutor) over new parallel mechanisms.

**Dual/triple workflow file discipline (monorepo):** edit the SSOT under `config/workflows/`, then keep dogfood runtime `.spur/workflows/` and published seed `apps/cli/config/workflows/` in sync for the same basename. Diff-check before done.

---

## R1 — Feature done→active reopen


Add to `feature-lifecycle.yaml` (all copies):

```yaml
  # Reopen: done → active (design §7.5 — done is re-enterable; cancelled is not)
  - from: done
    to: active
    description: >
      Reopen completed feature for follow-up work (mandatory History entry).
      Mirrors task-lifecycle done→wip. Prefer spur feature sync --force when
      non-terminal tasks are already linked.
    guard:
      kind: always
```

**Do not** add `cancelled → active`.


| Caller | Behavior |
|--------|----------|
| Manual | `spur feature update <id> active` (now legal) |
| Sync | `spur feature sync <id> --force` already proposes/applies hop when non-terminal tasks exist — becomes real once edge exists |
| Pipeline precheck (`profile=auto`) | Before `spur task check`: resolve `feature_id` from task JSON; if status is `done`, run `$spurBin feature sync $FID --force` (or `feature update $FID active` if sync returns no-op without linked non-terminals — prefer update when sync does not reopen because task not yet linked in FS view). Exit non-zero only if reopen fails hard. |
| Pipeline precheck (non-auto) | v1 acceptable: skip auto-reopen; rely on R4 message. Optional HITL if cheap. |

**One-active-goal:** `syncFeature` already refuses activation when another P0 is active (`findOneActiveGoalConflict`). Precheck must surface that reason (do not swallow). Non-P0 features like H83 reopen freely.

**History:** feature transition path already appends History on status change — confirm reopen gets an entry; if not, document gap.


| Alternative | Why rejected |
|-------------|--------------|
| Soften L4 to allow live tasks under done features | Makes `done` mean “maybe still open”; breaks feature completeness signals |
| Only document “re-parent to new feature” | Creates skeleton features (L/N anti-pattern); follow-ups belong on the same feature id |
| Engine `ActionRunContext` changes | Irrelevant here |

---

## R2 — Verdict parser column mapping

Replace hard-coded col1=status with header-driven indices:

```ts
// Pseudocode — implement cleanly in extractRequirements
type ColMap = { id: number; status: number; evidence?: number };

function isIdHeader(h: string): boolean {
  const x = h.toLowerCase().trim();
  return x.includes('req') || x === 'requirement' || x === 'r#' || x === 'r' || /^r\d+$/.test(x);
}
function isStatusHeader(h: string): boolean {
  const x = h.toLowerCase().trim();
  return x.includes('status') || x === 'verdict';
}
function isEvidenceHeader(h: string): boolean {
  return h.toLowerCase().includes('evidence');
}

// On header row where isIdHeader(cells[0]) OR any cell is id-like:
//   statusIdx = cells.findIndex(isStatusHeader); if <0 fallback 1
//   evidenceIdx = cells.findIndex(isEvidenceHeader); if <0 fallback 2
// Data rows: status = cells[statusIdx], evidence = cells[evidenceIdx], id = cells[idIdx]
```

**Must-have fixtures** in `task-verdict.test.ts`:

1. Canonical three-column table (no regression).
2. Four-column `R# | Severity | Evidence | Status` → MET not P1.
3. `R# | Status | Evidence`.

Update the file header comment at `task-verdict.ts` ~76–80 to describe column-name matching.

---

## R3 — Shell syntax validation

In `WorkflowService.validate`, after `loadWorkflowDef` succeeds:

1. Collect `{ stateId, kind: 'action'|'guard', index, command }` from states' onEnter/onExit and transitions' guards (mirror engine shape — inspect loaded def; if structure is nested, walk generically for `kind==='shell'` + string command).
2. For each command, `ProcessExecutor.run({ command: 'sh', args: ['-n', '-c', command], … rejectOnError: false })` (or project-equivalent). Non-zero → push error string.
3. If any shell errors: return `{ ok: false, valid: false, errors: [...] }` even though schema passed.
4. Tests with temp YAML files (no dependency on live task-pipeline for the negative case).

**Note:** `#` inside folded scalars is a content problem `sh -n` catches only when it breaks grammar (e.g. mid-token). That is enough for the 0451 class of `if`/`fi` breakage.

---

## R4 — Message only

```ts
// done branch
message:
  `Feature "${featureId}" is done — live tasks cannot stay linked without reopening. ` +
  `Reopen: \`spur feature update ${featureId} active\` ` +
  `(or \`spur feature sync ${featureId} --force\` when non-terminal tasks are already linked). ` +
  `Alternatively re-parent: \`spur task update <wbs> --feature <otherId>\`.`;

// cancelled branch — no reopen
message:
  `Feature "${featureId}" is cancelled — re-parent or unlink this live task ` +
  `(\`spur task update <wbs> --feature <otherId>\`).`;
```

---

## R5–R6 — Skill text only

Surgical markdown edits; no runtime code. Point implementer at exact headings in those SKILL.md files. After edit, no need for full spur-check for skill-only — but monorepo gate still runs once at end if code changed for R1–R4.

---

## Touch map

| File | R# |
|------|----|
| `config/workflows/feature-lifecycle.yaml` (+ `.spur/` + `apps/cli/config/` copies) | R1 |
| `config/workflows/task-pipeline.yaml` (+ copies) precheck | R1 |
| `packages/app/src/services/task-check.ts` + tests | R1/R4 |
| `packages/app/src/services/task-verdict.ts` + tests | R2 |
| `packages/app/src/services/workflow-service.ts` + tests | R3 |
| `packages/app/tests/services/feature-service.test.ts` | R1 (force reopen against real edge) |
| `plugins/sp/skills/code-verification/SKILL.md` | R5 |
| `plugins/sp/skills/code-implementation/SKILL.md` + `references/implementation-patterns.md` | R6 |
| `docs/04_DESIGN.md` §7.5 (optional one-line: edge now exists) | R1 T3 if surface changes — only if lifecycle table claims need refresh |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Auto-reopen surprises operators | Only under `profile=auto`; R4 for interactive |
| One-active-goal blocks reopen | Surface sync conflict; do not force P0 collisions |
| `sh -n` false positives on exotic shells | Use `sh` only; document; skip empty commands |
| Parser becomes too loose | Require id-like first column or explicit Req/R# header cell |
### Plan
- [x] R1a: Add `done → active` to feature-lifecycle.yaml in config/, .spur/, and apps/cli/config/; confirm `spur feature update <done-id> active` works on a fixture or dogfood feature.
- [x] R1b: Precheck step in task-pipeline.yaml (all copies): under profile=auto, reopen done feature via `feature sync --force` / `feature update` before `task check`; document non-auto behavior in Solution.
- [x] R1c: Confirm feature-service force-reopen test still green (or fix adapter so it exercises the new edge).
- [x] R4: Rewrite L4.feature-terminal messages (done vs cancelled); unit test string contains reopen command for done.
- [x] R2: Column-map extractRequirements; three fixtures (canonical, R#/Severity/Status, R#/Status); update file comment.
- [x] R3: Post-schema shell walk + sh -n in WorkflowService.validate; good/bad fixtures; task-pipeline still validates.
- [x] R5: code-verification SKILL.md hard format + red flag.
- [x] R6: code-implementation SKILL.md + implementation-patterns.md backtick path:line.
- [x] Gate: targeted tests (`task-verdict`, `task-check`, `workflow-service`, `feature-service`) green; `bun run autofix && bun run spur-check` once; `spur workflow validate` on task-pipeline + feature-lifecycle.
- [x] Solution: change-map with full `packages/...` or `config/workflows/...` backtick path:line citations.
- [x] Testing: paste commands + outcomes for verify handoff.
### Solution
**R1 — Feature done→active reopen**

- `config/workflows/feature-lifecycle.yaml:77-86` — `done → active` with `guard: always` (History-note description). Mirrored in `.spur/workflows/` and `apps/cli/config/workflows/`.
- `config/workflows/task-pipeline.yaml:116-130` — precheck onEnter: under `profile=auto`, `feature sync --force` then fallback `feature update … active` before task-check guard. Non-auto: no silent reopen (R4 message).
- `packages/app/src/services/task-check.ts:587-598` — L4.feature-terminal messages (done vs cancelled); shared with R4.

**R2 — Verdict parser column mapping**

- `packages/app/src/services/task-verdict.ts:80-159` — header-driven `ColMap` (id / status / evidence by column name); supports `| Req | Status | Evidence |`, `| R# | Severity | Evidence | Status |`, `| R# | Status | Evidence |`.
- `packages/app/tests/services/task-verdict.test.ts` — fixtures for all three shapes (status not taken from Severity).

**R3 — Shell syntax validation**

- `packages/app/src/services/workflow-service.ts:401-451` — after schema load, `collectShellCommands` + `sh -n` via `NodeProcessExecutor`.
- `packages/app/src/services/workflow-service.ts:993-1043` — walker for transition-flow + state-machine; onEnter/onExit indices correct (fix-pass).
- `packages/app/tests/services/workflow-service.test.ts` — good/bad shell fixtures; monorepo task-pipeline validates clean.

**R4 — Actionable L4.feature-terminal message**

- `packages/app/src/services/task-check.ts:588-597` — done → reopen commands; cancelled → re-parent only.
- `packages/app/tests/services/task-check.test.ts` — asserts `spur feature update` in done-case message.

**R5 — Verify skill hard format**

- `plugins/sp/skills/code-verification/SKILL.md:265-273` — MUST `| Req | Status | Evidence |`; MUST NOT `R#`/Severity-between; Red Flag row added.

**R6 — Implement skill backtick path:line**

- `plugins/sp/skills/code-implementation/SKILL.md:94` — red flag for non-backtick citations.
- `plugins/sp/skills/code-implementation/references/implementation-patterns.md:49-54` — mandatory backtick `path:line` from repo root.

**Design conformance:** R1 reuses sync/`forceConfirm` (not a parallel reopen path). R2 named columns (not header-only). Cancelled reopen not added. Dual/triple YAML copies updated for lifecycle + precheck.
### Testing
**Re-verify (standalone `/sp:dev-verify 0453 --force --fix all`)** — 2026-08-06

**Verdict: PASS**

**Commands run this verify (fresh):**
```
bun test packages/app/tests/services/task-verdict.test.ts packages/app/tests/services/task-check.test.ts packages/app/tests/services/workflow-service.test.ts
# → 193 pass, 0 fail

bun test packages/app/tests/services/task-verdict.test.ts --test-name-pattern 'R#|Severity|column'
# → 2 pass (R2 four-col + R#/Status)

bun test packages/app/tests/services/task-check.test.ts --test-name-pattern 'feature-terminal|done feature|reopen|terminal'
# → 15 pass (includes R4 reopen message)

bun test packages/app/tests/services/workflow-service.test.ts --test-name-pattern 'shell|sh -n|validate'
# → 8 pass

spur workflow validate config/workflows/task-pipeline.yaml --json
# → ok:true valid:true

spur workflow validate config/workflows/feature-lifecycle.yaml --json
# → ok:true valid:true

spur task check 0453 --strict-core
# → PASS
```

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `config/workflows/feature-lifecycle.yaml:77-86` done→active; `config/workflows/task-pipeline.yaml:116-130` auto precheck reopen; copies in `.spur/` + `apps/cli/config/`; force-reopen tests green |
| R2 | MET | `packages/app/src/services/task-verdict.ts:115-151` ColMap; tests R#/Severity/Status → MET not P1 |
| R3 | MET | `packages/app/src/services/workflow-service.ts:415-440` sh -n; `collectShellCommands` `:993-1043`; validate ok on task-pipeline |
| R4 | MET | `packages/app/src/services/task-check.ts:588-597`; task-check tests assert reopen command |
| R5 | MET | `plugins/sp/skills/code-verification/SKILL.md:266-273` MUST/MUST NOT + red flag |
| R6 | MET | `plugins/sp/skills/code-implementation/SKILL.md:94`; `plugins/sp/skills/code-implementation/references/implementation-patterns.md:49-54` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 — feature done→active reopen is legal and used by precheck under auto | MET | static-ref + test | lifecycle yaml:78 + pipeline:116-130; feature-service force-reopen tests |
| Scenario: R2 — verdict parser maps Status by header name | MET | test | task-verdict.test.ts R2 fixtures 2/2 |
| Scenario: R3 — workflow validate catches shell syntax errors | MET | test + command | workflow-service shell fixtures; validate task-pipeline ok |
| Scenario: R4 — L4.feature-terminal message is actionable for done features | MET | test | task-check live-under-done asserts spur feature update |
| Scenario: R5 — verify skill mandates canonical Req table header | MET | static-ref | code-verification SKILL.md MUST/MUST NOT |
| Scenario: R6 — implement skill mandates backtick path:line in Solution | MET | static-ref | code-implementation SKILL + implementation-patterns |

**Fix-pass this verify:**
- `packages/app/src/services/workflow-service.ts:1027-1036` — onEnter/onExit visitAction uses loop index (was always 0)
- Testing/Solution/verdict rewritten with accurate line anchors + AC rows
- `.spur/run/0453-verdict.json` re-emitted

Coverage: N/A (targeted suite; no new runtime product path beyond validate walker). Design-conformance: pass.
### Review
**SECU findings** (standalone re-verify 2026-08-06 — verdict PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P3 | Correctness | `workflow-service.ts` collectShellCommands | onEnter/onExit index always 0 — **fixed this verify** |
| advisory | Correctness | `feature-service.ts` deriveFeatureStatus | still proposes cancelled→active; lifecycle has no edge (accepted out-of-scope) |
| — | Security | — | `sh -n` is syntax-only; precheck reopen is best-effort under profile=auto |
| — | Architecture | — | Reuses feature sync force path; no parallel reopen FSM |

No open P1–P2. Phantom SECUA subsection headings removed from prior review dump.
### References
- Feature: `docs/features/N_0451-pipeline-post-mortem-process-and-infrastructure-hardening.md`
- Design authority: `docs/04_DESIGN.md` §7.5 (feature done re-enterable; cancelled terminal); `spur feature sync --force`
- Feature lifecycle: `config/workflows/feature-lifecycle.yaml:77-86` (`done → active`) + `.spur/workflows/` + `apps/cli/config/workflows/` copies
- Task pipeline precheck reopen: `config/workflows/task-pipeline.yaml:116-130` (profile=auto)
- Task check: `packages/app/src/services/task-check.ts:588-597` (`L4.feature-terminal` messages)
- Feature sync reopen proposal: `packages/app/src/services/feature-service.ts` ~385–395
- Verdict parser: `packages/app/src/services/task-verdict.ts` `extractRequirements` ColMap
- Workflow validate shell: `packages/app/src/services/workflow-service.ts` `validate` + `collectShellCommands`
- Skills: `plugins/sp/skills/code-verification/SKILL.md`, `plugins/sp/skills/code-implementation/SKILL.md`
- Companion: 0451 (done, H83 follow-up), 0452 (residual review, independent)
- Dogfood: 0451 pipeline runs under `.spur/run/`
- Verdict artifact: `.spur/run/0453-verdict.json` (PASS)
### History

- 2026-08-06T00:59:39.066Z todo → wip (system)
- 2026-08-06T01:37:18.369Z wip → testing (system)
- 2026-08-06T01:37:19.202Z testing → done (system)
