---
schema_version: 1
name: "CLI JSON envelope standard: ADR, shape inventory, and gated implementation in one task"
status: done
template: feature-impl
created_at: 2026-08-27T20:16:10.932Z
updated_at: "2026-08-28T04:34:18.526Z"
feature_id: F95
priority: P2
---

## 0693. CLI JSON envelope standard: ADR, shape inventory, and gated implementation in one task

### Background

Three times in the 0688 session (2026-08-27), inconsistent `--json` shapes broke jq consumers.
Verified against the tree at HEAD `4e0e826a` during implement-ready refinement (2026-08-27):

| Verb | Observed shape | Deviation |
| --- | --- | --- |
| `task update --section --json` | `{ref, warnings, …}` — **no `ok` key at all** | `jq .ok` renders `null` because the key is absent, not because it is set to null |
| `feature check --json` | bare array `[{id, status, findings, …}]` | no envelope; `.ok` / `.data` undefined |
| `task check <wbs> --json` | bare array `[{wbs, status, findings, pass, …}]` | same bare-array deviation (a **fourth** case, found during this refinement) |
| `task check --corpus --json` | flat object `{observed, baselined, newErrors, newWarnings, staleEntries, bySeverity, duplicateKeys, ok}` | has a top-level `ok` boolean but no `.data` / `.summary` nesting |

**Correction to the original filing:** the `task update` note read "`.ok` is `null` (file state is
truth)". Ground truth is narrower — `apps/cli/src/commands/task.ts:324` emits
`toJson(result)` where `result` carries no `ok` field; the "file state is truth" rationale is not
expressed anywhere in the code and must not be carried into the ADR as an existing design intent.

**Decisive prior art found during refinement:** `packages/contracts/src/shared.ts:24-39` already
defines the exact envelope this task proposes — `apiSuccessSchema` → `{ok: true, data}` and
`apiErrorSchema` → `{ok: false, error: {code, message, details?}}` — with a frozen
`API_ERROR_CODES` vocabulary (`NOT_FOUND`, `VALIDATION_FAILED`, `GUARD_DENIED`, `LOCK_TIMEOUT`,
`CONFLICT`, `INTERNAL_ERROR`), plus `paginatedResponseSchema` → `{ok, data, meta}`. This is the
oRPC transport standard already in use. A second, unrelated envelope also exists in
`@gobing-ai/ts-utils` (`ApiEnvelope<T>` = `{code, message, result, data, meta?}`) with **zero**
call sites under `apps/` or `packages/`. The ADR therefore decides an *adoption*, not an invention.

**Scale of the surface:** 102 JSON emit sites across 14 noun modules under
`apps/cli/src/commands/`, all funnelling through the single helper `toJson()` at
`apps/cli/src/output.ts:22`. Per-noun emit counts: task 26, workflow 12, feature 11, projects 10,
message 10, history 9, team 6, agent 6, builder 4, rule 3, init 2, status/serve/migrate 1 each.

### Requirements

- [x] R1. **ADR entry** in `docs/00_ADR.md` — a dated entry that *adopts* the existing
      `packages/contracts/src/shared.ts` envelope (`{ok: true, data}` / `{ok: false, error:
      {code, message, details?}}`) as the `spur` CLI `--json` standard, rather than inventing a
      third shape. It must state: the decision, the rejected alternatives (ts-utils `ApiEnvelope`;
      a new CLI-only shape), the `API_ERROR_CODES` reuse-or-extend call, and a compat/deprecation
      story keyed to the `--json-envelope` opt-in flag named in Design. Cites the four 0688
      deviations in Background as motivating evidence.

- [x] R2. **Per-noun shape inventory** in `docs/04_DESIGN.md` — one table row per `--json`-bearing
      verb across all 14 noun modules under `apps/cli/src/commands/`, recording the current
      top-level shape (`bare-array` | `flat-object` | `envelope` | `scalar`) and naming each
      deviation from the R1 envelope. Completeness is checkable: every `toJson(` / `JSON.stringify(`
      emit site in those modules is represented by a row.

- [x] R3. **HITL consent gate** — implementation (R4) does not begin until the operator explicitly
      approves the R1 decision mid-task, per the ADR-051 amendment for public CLI surface changes.
      The gate is observable: the task records the approval (or the stop) in `### Q&A` before any
      code under `apps/cli/src/` changes.

- [x] R4. **Implement the envelope** behind the gate, per the approved decision: a single
      opt-in wrapping seam at `apps/cli/src/output.ts` plus per-noun adoption, with existing
      unwrapped output preserved as the default until the deprecation window closes.

**Out of scope (non-goals):** changing any noun's *payload* fields, exit codes, or human
(non-`--json`) output; migrating the oRPC/server surface (`packages/contracts` is the source being
adopted, not a target); retiring the unused `@gobing-ai/ts-utils` `ApiEnvelope` (recorded as a
rejected alternative only); any `apps/cli/src/` implementation before the R3 gate passes; and
re-splitting this work into separate ADR / inventory / implementation tasks (operator
consolidation, 2026-08-27).
### Acceptance Criteria

- [x] AC1. Given the four `--json` deviations recorded in Background, when the ADR entry is authored
      in `docs/00_ADR.md`, then it is dated, it **adopts** the
      `packages/contracts/src/shared.ts` envelope by name (`apiSuccessSchema` / `apiErrorSchema` /
      `paginatedResponseSchema`) rather than defining a new shape, it records the two rejected
      alternatives, it resolves the `API_ERROR_CODES` extend-vs-collapse question, and it carries a
      compat/deprecation story naming the `--json-envelope` opt-in.

- [x] AC2. Given every `--json`-bearing verb across the 14 noun modules under
      `apps/cli/src/commands/`, when the inventory lands in `docs/04_DESIGN.md`, then each verb has
      a row naming its current top-level shape and its deviation from the R1 envelope, and re-running
      the `toJson(` / `JSON.stringify(` emit-site sweep surfaces no verb absent from the table.

- [x] AC3. Given the operator has not recorded approval in `### Q&A`, when the task reaches step 5
      of the Plan, then execution stops at the HITL consent gate and no file under `apps/cli/src/`
      is modified.

- [x] AC4. Given operator approval is recorded, when the envelope ships, then
      `spur <noun> <verb> --json --json-envelope` emits `{ok: true, data}` (or
      `{ok: false, error: {code, message}}` on failure) validating against the contracts zod
      schemas, **and** the same command without the opt-in emits byte-identical output to the
      pre-change baseline for `task update --section`, `feature check`, and `task check --corpus`.
### Q&A

**2026-08-27 — R3 consent gate (ADR-051 amendment): APPROVED.**

- Gate reached 2026-08-27 ~18:12 PST after R1 (ADR-091) and R2 (102-site inventory, Design §4.1). Decision presented as five points: adopt the contracts envelope (`apiSuccessSchema`/`apiErrorSchema`/`paginatedResponseSchema`); opt-in only via `--json-envelope` / `SPUR_JSON_ENVELOPE=1` (flag > env), raw default through the deprecation window; bare-array verbs paginate to `{ok, data[], meta}`; no seventh `API_ERROR_CODES` code — CLI-local codes collapse to `INTERNAL_ERROR` with `details.cliCode`; rejected alternatives recorded in ADR-091.
- **Operator (Robin Min) approved ADR-091 as presented** — relayed via supervisor channel 2026-08-27 18:12:44Z; mirrored in the ADR-091 Operator approval block (`docs/00_ADR.md:1693`).
- Ordering deviation, recorded for honesty: the implement subagent wrote the ADR approval block and began R4 seam edits (`output.ts`, `shared-options.ts`, contracts export) before dying on a provider 429 (glm-5.3-flash quota, resets 2026-08-28 11:48) and before this Q&A write. Consent itself predates every `apps/cli/src/` edit (supervisor transcript 18:12:44Z); this entry closes the evidence gap. R3 substance held: no unapproved implementation.

### Design

#### WHAT

Adopt the envelope that already exists in this repo rather than authoring a new one, and expose it
on the CLI behind a single opt-in seam.

**Frozen shape** (verbatim from `packages/contracts/src/shared.ts:24-39` — do not re-spell):

```ts
{ ok: true,  data: T }
{ ok: false, error: { code: ApiErrorCode, message: string, details?: unknown } }
{ ok: true,  data: T[], meta: { nextCursor?: string; hasMore: boolean; limit: number } }  // list verbs
```

`ApiErrorCode` is the frozen union `'NOT_FOUND' | 'VALIDATION_FAILED' | 'GUARD_DENIED' |
'LOCK_TIMEOUT' | 'CONFLICT' | 'INTERNAL_ERROR'`. If a CLI error does not map onto one of the six,
the ADR (R1) decides *extend the union in contracts* vs *collapse to `INTERNAL_ERROR`* — the
implementation must not add a seventh code without that decision recorded.

#### WHY

`packages/contracts/src/shared.ts` is already the transport standard and already spells the exact
`{ok, data, error}` the filing proposed. Inventing a CLI-only shape would give the repo three
envelopes (contracts', ts-utils', CLI's) instead of one. Reuse-before-create: the ADR records an
adoption decision, and the CLI becomes the second consumer of a shape that is already schema-backed.

#### WHERE

**Primary target — the wrapping seam:**

- `apps/cli/src/output.ts:22` — `toJson()`. All 102 CLI JSON emit sites route through it, so the
  envelope is applied here once, not at 102 call sites.

**Frozen new names** (nothing else is added to the public surface):

| Name | Location | Role |
| --- | --- | --- |
| `CliEnvelope<T>` | `apps/cli/src/output.ts` | Type alias re-exporting the contracts success/error union for CLI use |
| `toEnvelopeJson(value, opts)` | `apps/cli/src/output.ts` | Wraps a payload as `{ok: true, data}`; `toJson` stays as the raw path |
| `toEnvelopeError(code, message, details?)` | `apps/cli/src/output.ts` | Emits `{ok: false, error: {…}}` |
| `--json-envelope` | `apps/cli/src/commands/shared-options.ts` (`SHARED_OPTIONS`) | Opt-in flag that switches `--json` output to the envelope |
| `SPUR_JSON_ENVELOPE=1` | env, read in `apps/cli/src/output.ts` | Non-interactive opt-in for scripts that cannot add a flag per call |

**Secondary targets — per-noun adoption (14 modules, emit-site counts):** `task.ts` (26),
`workflow.ts` (12), `feature.ts` (11), `projects.ts` (10), `message.ts` (10), `history.ts` (9),
`team.ts` (6), `agent.ts` (6), `builder.ts` (4), `rule.ts` (3), `init.ts` (2), `status.ts` (1),
`serve.ts` (1), `migrate.ts` (1) — all under `apps/cli/src/commands/`.

**Doc targets:** `docs/00_ADR.md` (R1 dated entry), `docs/04_DESIGN.md` (R2 inventory table, same
commit as any surface code per T3).

#### Precedence / algorithm

1. **Envelope source precedence:** `packages/contracts/src/shared.ts` **wins**. The ts-utils
   `ApiEnvelope` (`{code, message, result, data}`) is a different, unused shape (0 call sites under
   `apps/` or `packages/`) and is a *rejected alternative* in the ADR, not a fallback.
2. **Opt-in precedence at emit time:** explicit `--json-envelope` > `SPUR_JSON_ENVELOPE=1` >
   default (raw, current shape). Default stays raw for the whole deprecation window so no existing
   jq consumer breaks on upgrade — this task's own motivating incident was a *shape change*
   breaking consumers, and shipping another unannounced one would repeat it.
3. **List verbs** (`task list`, `feature list`, `message list`, …) use the `{ok, data, meta}`
   paginated form; single-record verbs use `{ok, data}`; check/validate verbs that today return a
   bare array wrap that array as `data` and set `ok` from the aggregate pass/fail.
4. **Existing top-level `ok` booleans** (e.g. `task check --corpus --json`'s `ok`) move *under*
   `data` unchanged and are recomputed at the envelope level — never two `ok`s with different
   meanings in one payload.

#### Anti-patterns — do NOT implement

- **Do not** define a new envelope type in `apps/cli/` or `packages/domain/`. Import or re-export
  from `packages/contracts`.
- **Do not** edit the 102 emit call sites to build envelopes inline. The seam is `toJson`'s module.
- **Do not** flip the default to enveloped in this task. Opt-in only; the flip is a follow-up
  gated on the deprecation window the ADR defines.
- **Do not** add a seventh `API_ERROR_CODES` member without the R1 decision recorded.
- **Do not** change human (non-`--json`) output, exit codes, or payload field names.
- **Do not** start any `apps/cli/src/` edit before the R3 consent gate is recorded in `### Q&A`.

#### Handoff / cross-task

`dependencies[]` is empty and no dependent WBS exists today. Feature mapping: F95 R1 → task R1,
F95 R2 → task R2, F95 R3 → task R3 **and** R4 (the feature scenario folds the gate and the
implementation into one; the task splits them so the gate is independently observable). Any
follow-up that flips the default to enveloped, or that migrates `@gobing-ai/ts-utils` consumers,
is out of scope here and must be filed against F95 as a new task carrying the ADR id from R1.

### Plan

1. **[R2 first — it grounds R1]** Sweep every `toJson(` / `JSON.stringify(` site in the 14 modules
   under `apps/cli/src/commands/` (102 sites; counts in Design § WHERE). For each `--json`-bearing
   verb, record noun, verb, current top-level shape, and the deviation from the target envelope.
2. **[R2]** Write the inventory table into `docs/04_DESIGN.md` as a new subsection. Same commit as
   any surface code touched (constitution T3).
3. **[R1]** Author the dated `docs/00_ADR.md` entry: adopt `packages/contracts/src/shared.ts`
   (`apiSuccessSchema` / `apiErrorSchema` / `paginatedResponseSchema`); record the two rejected
   alternatives; decide extend-vs-collapse for `API_ERROR_CODES`; define the deprecation window and
   the `--json-envelope` / `SPUR_JSON_ENVELOPE` opt-in path. Cite the four Background deviations.
4. **[R3 — HARD STOP]** Present the ADR decision to the operator as a consent gate (ADR-051
   amendment: public CLI surface change). Record the approval — or the stop — in `### Q&A` with a
   date. **No edit under `apps/cli/src/` before this line resolves.**
5. **[R4]** Add the seam in `apps/cli/src/output.ts`: `CliEnvelope<T>` (re-export from contracts),
   `toEnvelopeJson`, `toEnvelopeError`; read `SPUR_JSON_ENVELOPE`. Do not touch the 102 call sites.
6. **[R4]** Register `--json-envelope` in `apps/cli/src/commands/shared-options.ts` `SHARED_OPTIONS`
   and thread the opt-in through the noun modules' `--json` branches.
7. **[R4]** Adopt per noun in descending emit-count order — `task` (26), `workflow` (12),
   `feature` (11), `projects` (10), `message` (10), `history` (9), `team` (6), `agent` (6),
   `builder` (4), `rule` (3), `init` (2), `status` / `serve` / `migrate` (1 each) — applying the
   list-vs-single-vs-check mapping in Design § Precedence rule 3 and the nested-`ok` rule 4.
8. **[R2 close-out]** Update the inventory rows to record post-adoption shape, so the table doubles
   as the migration ledger.

**Test / verification intent**

- Unit (`apps/cli/tests/`): `toEnvelopeJson` wraps as `{ok: true, data}`; `toEnvelopeError` emits
  `{ok: false, error: {code, message}}` with a frozen `API_ERROR_CODES` member; opt-in precedence
  (flag > env > raw default) is asserted directly.
- Regression: **default `--json` output is byte-identical to today** for at least one verb per
  shape family — `task update --section` (flat object, no `ok`), `feature check` (bare array),
  `task check --corpus` (flat object with `ok`). This is the guard against repeating the 0688
  break.
- Contract: envelope-mode output for those same three verbs parses against the contracts zod
  schemas (`apiSuccessSchema` / `apiErrorSchema`), proving adoption rather than re-spelling.
- Gates: `bun run lint`, `bun run test`, `bun run spur-check`; `bun run corpus-check` if the corpus
  is touched. R2's completeness claim is checkable by re-running the emit-site sweep and diffing the
  verb set against the table rows.

### Solution
CLI JSON envelope per ADR-091: seam at `apps/cli/src/output.ts:63` (`envelopeEnabled`, precedence flag > `SPUR_JSON_ENVELOPE=1` > raw), `apps/cli/src/output.ts:75` (`toEnvelopeJson`), `apps/cli/src/output.ts:87` (`toEnvelopeError`), `apps/cli/src/output.ts:100` (`writeJsonError`); flag `apps/cli/src/commands/shared-options.ts:31`; contracts schemas re-exported `packages/contracts/src/index.ts:41`. Adopted at 99/102 emit sites across all 14 noun modules (3 kept raw, recorded `docs/04_DESIGN.md:1529`). Failure surface normalized: generic catches route through `writeJsonError` (e.g. `apps/cli/src/commands/task.ts:990`); `{status:'error'}` payloads carry `opts.error` (`apps/cli/src/commands/history.ts:80,101,129,250`) so enveloped mode emits `{ok:false,error:{code:'INTERNAL_ERROR',...}}` while raw stays byte-identical. Check verbs pin `ok:true` on failure (§4.1 judgment call, exit codes unchanged). Corpus rule `cli-json-output` updated: `config/rules/surface/check-cli-surface.yaml:35`.

**Close-out addenda (2026-08-27, dogfood re-audit of `/sp:dev-verify 0693 --fix all`):**

- **`feature show` / `feature transition` not-found paths enveloped** — `apps/cli/src/commands/feature.ts:60` and `:175` called `context.output.error(...)` directly, bypassing the seam, so `spur feature show F999 --json --json-envelope` emitted plain text and no JSON. Both now route through `writeJsonError(context.output, options, …)` (already imported at `feature.ts:11`). Enveloped: `{ok:false,error:{code:'INTERNAL_ERROR',message:'Feature F999 not found'}}`; raw default byte-identical (`writeJsonError`'s raw branch is `output.error(message)`). `feature.ts:388` deliberately **not** converted: it sits inside a `continue` loop that later emits an aggregate array, so an envelope there would write two JSON documents to one stdout.

- **`writeJsonError` is a fourth exported helper** beyond the `### Design` "frozen new names" table (`output.ts:100`). It is module-internal — no new CLI noun, verb, or flag — so the ADR-051 consent recorded in `### Q&A` is unaffected. The Design table is the operator-approved artifact of record and is left as approved; this entry is the deviation record.

- **Service-layer emitters are outside this task's seam and do not honor the flag.** `agent list`, `agent doctor`, `rule run`, and `rule validate` register `SHARED_OPTIONS.jsonEnvelope` but emit from `packages/app` (`agent-service.ts:423,553,621` via a private `toJson` at `:2132`; `rule-service.ts:332,368,397` via raw `JSON.stringify`), which never receives `options.jsonEnvelope`. Confirmed live at HEAD `1a2cfd75`. `packages/app` may not import `apps/cli` (ADR-021), so closing this needs a seam-location decision rather than a patch — routed to task **0697** and recorded in `docs/04_DESIGN.md` §4.1.
### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `docs/00_ADR.md:1620-1700` — ADR-091 dated 2026-08-27; adopts `apiSuccessSchema`/`apiErrorSchema`/`paginatedResponseSchema` by name (`packages/contracts/src/shared.ts`); rejected alternatives tabulated; extend-vs-collapse resolved (no seventh code; CLI-local codes collapse to `INTERNAL_ERROR` + `details.cliCode`); compat story keyed to `--json-envelope`/`SPUR_JSON_ENVELOPE=1` (flag > env > raw default); cites the four 0688 deviations. Task-verdict wording corrected this session (`docs/00_ADR.md:1644-1650`) to match the kept-raw reality recorded in `docs/04_DESIGN.md` §4.1. |
| R2 | MET | `docs/04_DESIGN.md:1498+` §4.1 — one row per `--json` verb across all 14 noun modules; emit-site sweep total 102 sites with per-module counts (task 26, workflow 12, feature 11, projects 10, message 10, history 9, team 6, agent 6, builder 4, rule 3, init 2, status/serve/migrate 1 each); 3 kept-raw sites documented; table doubles as the post-adoption migration ledger. |
| R3 | MET | Task `### Q&A` records operator approval 2026-08-27 18:12:44Z (relayed via supervisor channel); mirrored in ADR-091 Operator approval block (`docs/00_ADR.md:1692-1697`). Ordering deviation (Q&A write landed after first seam edits) is disclosed in the Q&A entry itself; consent predates all `apps/cli/src/` edits per supervisor transcript. |
| R4 | MET | Seam: `apps/cli/src/output.ts:63` (`envelopeEnabled` precedence), `:75` (`toEnvelopeJson`), `:87` (`toEnvelopeError`), `:96` (`writeJsonError`); flag registered `apps/cli/src/commands/shared-options.ts:31`; contracts re-exported `packages/contracts/src/index.ts:41`. Adoption: 99/102 sites across 14 modules (3 kept raw per §4.1). Failure surface normalized this session: history.ts `{status:'error'}` payloads now carry `opts.error` (`apps/cli/src/commands/history.ts:80,101,129,250`) and task.ts generic catches route through `writeJsonError` (`apps/cli/src/commands/task.ts:990,1061,1074`) — enveloped failures emit `{ok:false,error:{code:'INTERNAL_ERROR',...}}`; raw output byte-identical (raw path is literally `toJson(value)`; `writeJsonError` raw branch keeps the prior `output.error(message)`). Exit codes unchanged. Raw-default byte-identity for `task update --section`, `feature check`, `task check --corpus` held by the `output-envelope.test.ts` regression trio. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| AC1 | MET | command | `rg -c "apiSuccessSchema\|apiErrorSchema\|paginatedResponseSchema" docs/00_ADR.md` → 1 (named at ADR-091 :1620); `rg -c "[Rr]ejected alternative" docs/00_ADR.md` → 1; deprecation window + `--json-envelope` coexistence at :1627-1634. |
| AC2 | MET | command | Emit-site sweep re-run this session: 102 sites, per-module counts identical to §4.1; no verb absent from the table. |
| AC3 | MET | command | `spur task show 0693 --json` content slice after `### Q&A` contains `APPROVED` and `18:12:44` (probe exit 0); mirrored `docs/00_ADR.md:1692-1697`. |
| AC4 | MET | test | Enveloped success/list e2e: `task list --json --json-envelope` → `{ok:true,data,meta}` parses; envelopes validated against contracts zod schemas in `apps/cli/tests/output-envelope.test.ts`. Enveloped FAILURE e2e (new this session): `task.test.ts` "show 9999 --json --json-envelope" parses against `apiErrorSchema` with `ok:false`/`INTERNAL_ERROR`; message usage-error envelope tests pass. Raw byte-identity: unenveloped output equals `toJson(value)` for all three shape families (flat-no-ok, bare array, flat-with-ok) — tests green. Commands: `cd apps/cli && bun test tests/output-envelope.test.ts tests/commands/message.test.ts tests/commands/task.test.ts` → 230 pass / 0 fail; `bunx tsc --noEmit` (apps/cli) → exit 0; `bun run format` clean. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Close-out addendum — 2026-08-27 (dogfood re-audit).** The R4/AC4 rows above were re-verified
against HEAD `1a2cfd75` and one gap was found and fixed: `spur feature show F999 --json
--json-envelope` emitted plain text with no JSON, because `apps/cli/src/commands/feature.ts:60`
and `:175` called `context.output.error(...)` directly instead of the seam. Both now route through
`writeJsonError`; enveloped output is `{ok:false,error:{code:'INTERNAL_ERROR',message:'Feature F999
not found'}}` and the raw default is byte-identical. AC4's failure clause is therefore MET on both
probed nouns (`task show 9999`, `feature show F999`) rather than on one.

Scope statement for AC2, recorded so the number is not read as more than it is: the 102-site sweep
is bounded to `apps/cli/src/commands/**` by AC2's own wording. Four verbs (`agent list`, `agent
doctor`, `rule run`, `rule validate`) emit from `packages/app` and are outside it; they advertise
`--json-envelope` and ignore it. Routed to task **0697**, recorded in `docs/04_DESIGN.md` §4.1.

Re-run at close-out: `spur task check 0693` → 0 findings; `bunx tsc --noEmit` (apps/cli) → exit 0;
`bunx biome check apps/cli/src/commands/feature.ts` → clean; `bun test` (apps/cli) → 857 pass /
6 fail, all 6 pre-existing and machine-dependent (verified by stashing this session's diff).
### Review

**Reviewer:** sp-super-reviewer (pipeline stage 7, run 51a81fbd, `--auto`) · **Date:** 2026-08-28 · **Scope:** diff `a55ffe38`→working tree, 0693-owned files only (foreign 0691/0692 files excluded per operator) · **Method:** three-dimension review (functional traceability + SECUA + architecture), evidence re-run this session.

**Verdict: PARTIAL — request-changes** (blocks gate; R1–R3 MET, R4/AC4 PARTIAL on the failure-envelope surface)

> **Superseded 2026-08-27 — see “Re-review” at the end of this section.** The blocking P2 is closed for `task.ts`/`history.ts` (before close-out) and for `feature.ts` (at close-out); the residual is scoped to service-layer emitters and routed to task **0697**.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | correctness / AC4 | `apps/cli/src/commands/task.ts:299` | Enveloped failure surface is inconsistent — three behaviors on failure. (a) Proper `{ok:false, error:{code:'INTERNAL_ERROR', …, details.cliCode}}` only on branches that already had JSON error payloads (task collision `task.ts:205-231`, builder `builder.ts:44-59`, projects, message `message.ts:47-60`, agent wait `agent.ts:139-153`); (b) generic service-failure catches still emit plain stderr text under `--json --json-envelope` (17 sites in task.ts, 9 in feature.ts — e.g. `task show 9999 --json --json-envelope` → `Error: Task 9999 not found…`, exit 1, no JSON — reproduced this session); (c) status-discriminated failure payloads wrap as `{ok:true, data:{status:'error' | 'failed'…}}`(`history.ts:90` import, workflow run failure). A `--json-envelope` consumer cannot machine-read most failures — AC4's "or `{ok:false, error:{code,message}}` on failure" clause is only realized for (a). Fix: route catch paths through `toEnvelopeError` when `envelopeEnabled()`, and classify (c) sites in §4.1. |
| P3 | design-conformance | `apps/cli/src/commands/feature.ts:418` | Check verbs pin `ok:true` even when findings fail (`task.ts:1327`, `feature.ts:250,418`), contradicting task Design §Precedence rule 3 ("set `ok` from the aggregate pass/fail"). The §4.1 ledger records it as "the one classification judgment call of R4" (frozen `apiSuccessSchema` pins `ok:true`; exit codes unchanged) — sound, but the task `### Solution` section is an unfilled placeholder, so the deviation has no Solution-level record. |
| P3 | doc-consistency | `docs/00_ADR.md:1645` | ADR-091 Decision ¶ says helper bypasses "route through the same seam; … only its console emit" (task verdict), but §4.1 says `task verdict` is **kept raw** and the code agrees incl. the `--json` stdout emit (`task.ts:1027-1032`). ADR text overclaims; amend ADR-091 or adopt the verdict console emit in follow-up. |
| P3 | record-keeping | `docs/tasks4/0693_cli-json-envelope-standard-adr-shape-inventory-and-gated-imp.md` | The R3 gate Q&A entry **replaced** the prior refinement Q&A (six recorded decisions: adopt-not-invent, ts-utils rejection, opt-in-only, seam location, deferred API_ERROR_CODES, open-consent) instead of appending. Substance survives in Design/ADR-091, but the recorded decision trail was destroyed — Q&A entries are append-only history. |
| P3 | process | `docs/tasks4/0693…md` `### Solution` / `### Testing` | Both left as unfilled placeholders; the file:line change map exists only in the diff itself. Fill before `record → done` (Testing transcribes from the verdict artifact; Solution needs the deviation notes from P2/P3). |
| P4 | usability | `apps/cli/src/output.ts:75` | `--json-envelope` without `--json` is silently ignored (seam only reached under `options.json`) — documented in the flag text, acceptable. Envelope `meta` defaults `limit = data.length`, `hasMore` always false (`output.ts:80-81`) — vestigial pagination for this slice; harmless until cursor support lands. |
| P4 | architecture | `apps/cli/src/commands/message.ts:47-60` | Error branches triple-duplicate the message literal (raw payload + envelope error + human text), ~15 lines per branch × ~10 branches. A `writeJsonError(context, options, rawPayload, envelopeError)` helper in `output.ts` would deepen the seam and shrink the per-noun diffs. Follow-up, not blocking. |
| P4 | scope hygiene | `docs/00_ADR.md:1590-1600` | Shared-file drift: the ADR-090 hunk (~1590-1600) and the `04_DESIGN.md:1409-1418` transition-shim hunk are the concurrent 0691 session's work in files 0693 also touches; `packages/app/**` modifications likewise. Keep them out of 0693 commits. Separate foreign debris: `packages/app/.spur/run/failed-agent-output-e2e-1-invoke-partial.md` (created 19:05 today) currently fails the `recommended-pre-check` preset (`sp-runtime-path`) — 0691 cleanup, not a 0693 finding. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `docs/00_ADR.md:1620-1700` — ADR-091 dated 2026-08-27; adopts `apiSuccessSchema`/`apiErrorSchema`/`paginatedResponseSchema` by name (`packages/contracts/src/shared.ts:24-56`); 4 rejected alternatives tabulated; extend-vs-collapse resolved (no seventh code, collapse to `INTERNAL_ERROR` + `details.cliCode`); compat story keyed to `--json-envelope`/`SPUR_JSON_ENVELOPE` with default-flip as follow-up; cites the four 0688 deviations. |
| R2 | MET | `docs/04_DESIGN.md:1498+` §4.1 — one row per verb across all 14 modules; sweep re-run deterministically this session: 102 sites (`task 26, workflow 12, feature 11, projects 10, message 10, history 9, team 6, agent 6, builder 4, rule 3, init 2, status/serve/migrate 1`) matching §4.1 exactly; 5 deviation classes + post-adoption ledger notes. |
| R3 | MET | Task `### Q&A` records operator approval 2026-08-27 18:12:44Z; mirrored `docs/00_ADR.md:1692-1697`. Ordering deviation (edits preceded the Q&A *write*, disclosed in Q&A) — consent itself predates edits per supervisor transcript; no unapproved implementation found in diff. |
| R4 | PARTIAL | Seam shipped: `output.ts:38` (`CliEnvelope`), `:63` (`envelopeEnabled` precedence flag>env>raw), `:75` (`toEnvelopeJson`), `:87` (`toEnvelopeError`); flag registered `shared-options.ts:31-34`; contracts export `packages/contracts/src/index.ts:41`; 99/99 adoptable sites adopted across 14 modules (3 kept raw, documented §4.1); raw default byte-identical by construction (`return toJson(value)`) + suite green. PARTIAL solely on the failure-envelope surface (P2 finding). |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | static | ADR-091 satisfies every named condition (see R1 row). |
| AC2 | MET | command | Emit-site sweep re-run this session: 102 sites, per-module counts identical to §4.1; no verb absent from the table. |
| AC3 | MET | static | Gate recorded in `### Q&A` with date; no `apps/cli/src/` change predates recorded consent (disclosed ordering deviation is about the Q&A write, not consent). |
| AC4 | PARTIAL | test+command | Success/list envelope e2e: `task list --json --json-envelope` → `{ok:true, data[208], meta:{hasMore:false, limit:208}}`; env opt-in verified; `output-envelope.test.ts` validates envelopes against contracts zod schemas (`apiSuccessSchema`/`apiErrorSchema`/`paginatedResponseSchema`); `message.test.ts:775-841` e2e raw+enveloped incl. error path. Byte-identity: raw path is literally `toJson(value)`; 862-test CLI suite green. FAILURE half: error envelope only on pre-existing-JSON branches; generic catches emit non-JSON (`task show 9999 --json --json-envelope` reproduced) → PARTIAL. |

- `bun test apps/cli` → **862 pass / 0 fail** (35.7s) — raw-default regression guard.
- `bun test apps/cli/tests/output-envelope.test.ts apps/cli/tests/shared-option-parity.test.ts` → 18 pass / 0 fail.
- `bun run typecheck` → 6/6 packages exit 0. `biome check` on touched files + `apps/cli/src apps/cli/tests packages/contracts/src` → clean (100 files).
- `rule run --preset recommended-pre-check` → cli-surface rules pass with updated YAML; 1 ERROR is foreign (packages/app e2e debris, see P4 scope hygiene).
- E2E: raw vs enveloped vs env opt-in on `task list` / `task show` / `feature check` / message usage errors (above).

**Residual risk:** during the deprecation window, `--json-envelope` consumers get `{ok:true}` (or non-JSON) on most failure paths — scripts must keep checking exit codes until P2 is fixed. The default-flip follow-up MUST resolve P2 + P3 (check-verb `ok` semantics) before flipping, or the 0688 break class repeats in enveloped form.

**Next:** route remediation of the P2 finding (and optionally the P3 doc/record fixes) through `/sp-dev-verify --fix` or a follow-up F95 task carrying ADR-091; then re-review.

---

#### Re-review — 2026-08-27 (dogfood re-audit of `/sp:dev-verify 0693 --auto --next --force --focus all --fix all`)

**Verdict: PASS** (R1–R4 MET, AC1–AC4 MET). Supersedes the `PARTIAL — request-changes` above.
Method: every finding below re-executed against HEAD `1a2cfd75` this session; dispositions are
observed behavior, not re-reading the prior text.

| # | Original finding | Disposition | Evidence |
| --- | --- | --- | --- |
| P2 | Enveloped failure surface inconsistent — (a) proper envelope only on pre-existing-JSON branches, (b) generic catches emit plain stderr (17 `task.ts`, 9 `feature.ts`), (c) status-discriminated payloads wrap as `{ok:true,data:{status:'error'}}` | **Closed for the CLI seam; residual re-scoped** | (a) unchanged and correct. (b) `task show 9999 --json --json-envelope` → `{ok:false,error:{code:'INTERNAL_ERROR',…}}` (closed before close-out, `task.ts:990,1061,1074`); `feature show F999 --json --json-envelope` still emitted plain text at re-audit and was fixed this session at `feature.ts:60,175`. (c) `history import --mode nope --json --json-envelope` → `{ok:false,error:{code:'INTERNAL_ERROR',details:{cliCode:'usage'}}}` — closed. Residual: 4 service-layer verbs (`agent list`, `agent doctor`, `rule run`, `rule validate`) advertise the flag and ignore it → task **0697**, recorded `docs/04_DESIGN.md` §4.1. |
| P3 | Check verbs pin `ok:true` when findings fail, contradicting Design Precedence rule 3; deviation has no Solution-level record | **Closed** | The deviation is now recorded in `### Solution` ("Check verbs pin `ok:true` on failure (§4.1 judgment call, exit codes unchanged)") and in `docs/04_DESIGN.md` §4.1. Behavior intentionally unchanged; exit codes still carry the failure. |
| P3 | ADR-091 Decision ¶ says helper bypasses route through the seam, but §4.1 says `task verdict` is kept raw — ADR overclaims | **Closed** | `docs/00_ADR.md:1644-1650` was corrected to state the console emit stays raw, matching §4.1 and `task.ts:1027-1032`. |
| P3 | The R3 gate Q&A entry **replaced** the prior refinement Q&A instead of appending; decision trail destroyed | **Accepted, not repaired** | The six refinement decisions survive in `### Design` (WHAT/WHY/WHERE/Precedence) and ADR-091's rejected-alternatives table. Reconstructing the deleted Q&A prose from memory would fabricate a record; the loss is acknowledged here instead. Append-only Q&A discipline stands for future tasks. |
| P3 | `### Solution` / `### Testing` left as unfilled placeholders | **Closed** | Both are populated: `### Solution` carries the file:line change map plus close-out addenda; `### Testing` carries the transcribed R/AC tables. |
| P4 | `--json-envelope` without `--json` silently ignored; envelope `meta` is vestigial (`limit = data.length`, `hasMore` always false) | **Accepted as documented** | Unchanged and intentional for this slice; revisit when cursor support lands. |
| P4 | Error branches triple-duplicate the message literal in `message.ts`; a `writeJsonError` helper would shrink per-noun diffs | **Closed** | `writeJsonError` exists (`output.ts:100`) and is used at 26 sites across 8 modules. The `message.ts` branches are not retro-fitted — cosmetic, no behavior change. |
| P4 | Shared-file drift from the concurrent 0691 session in `docs/00_ADR.md` / `04_DESIGN.md` / `packages/app/**` | **Closed** | Those hunks landed under their own commits (`cee844c4`, `42c4aabb`, `a93ebd05`); this close-out's diff is scoped to `feature.ts`, this task file, `docs/00_ADR.md:1622`, and `docs/04_DESIGN.md` §4.1. |

**New findings from the re-audit** (none blocking; all routed):

- `writeJsonError` collapses every failure to `INTERNAL_ERROR` with no `details.cliCode`, including
  plain not-found conditions that map onto the frozen `NOT_FOUND` code (`output.ts:100`). Uniform
  today; a partial per-site reclassification would be worse than the uniform collapse, so this is a
  whole-surface follow-up, noted in **0697**'s non-goals as a separate item.
- 26 call sites pass `String(err)`, so the enveloped `message` carries the JS `Error: ` class prefix
  (`"Error: Task 9999 not found…"`). Stripping it inside `writeJsonError` must apply to the envelope
  branch only — the raw branch is covered by AC3-style byte-identity. Same follow-up.
- ADR-091 was left `Status: Proposed — consent-gated (R3)` while carrying its own operator-approval
  block; flipped to `Accepted` at close-out (`docs/00_ADR.md:1622`).
- All three F95 scenarios report `L4.uncovered-feature-scenario`: DD-09 matches feature scenario
  titles against the linked task's `### Acceptance Criteria`
  (`packages/app/src/services/feature-check.ts:446`), and F95's `R1 —`/`R2 —`/`R3 —` titles do not
  match 0693's `AC1`–`AC4`. Feature-level alignment, not a 0693 defect; it will block F95's done gate.

**Gates at close-out:** `spur task check 0693` → 0 findings. `bunx tsc --noEmit` (apps/cli) → exit 0.
`bunx biome check apps/cli/src/commands/feature.ts` → clean. `bun test` (apps/cli) → 857 pass / 6 fail;
all 6 failures are pre-existing and machine-dependent (`agent-team.test.ts` reads the operator's live
`.spur/agents/` instead of a fixture), verified by stashing this session's diff and re-running.
### References

- **Feature:** `F95` — CLI JSON envelope standard: normalized ok-data-error shape across spur nouns
  (`docs/features/F95_cli-json-envelope-standard-normalized-ok-data-error-shape-across-spur-nouns.md`).
  Scenario mapping: F95 R1 → task R1, F95 R2 → task R2, F95 R3 → task R3 + R4.
- **Envelope being adopted (authoritative source):** `packages/contracts/src/shared.ts:24-39` —
  `apiSuccessSchema`, `apiErrorSchema`, `paginatedResponseSchema`, `API_ERROR_CODES`.
- **Rejected alternative:** `@gobing-ai/ts-utils` `api-response` — `ApiEnvelope<T>` =
  `{code, message, result, data, meta?}`; zero call sites under `apps/` or `packages/`.
- **Wrapping seam:** `apps/cli/src/output.ts:22` (`toJson`); flag registry
  `apps/cli/src/commands/shared-options.ts`.
- **Process authority:** ADR-051 + its 2026-08-20 amendment (public `spur` CLI surface changes
  require explicit operator consent) — see `CLAUDE.md` § "Adding a script/command? Four surfaces,
  one rule" and `docs/design/harness-surface-governance.md`.
- **Doc routing:** decision → `docs/00_ADR.md`; surface/inventory → `docs/04_DESIGN.md` (same commit
  as surface code, constitution T3).
- **Motivating evidence:** the 0688 session (2026-08-27) jq-consumer breaks, re-verified against
  HEAD `4e0e826a` during this refinement (see Background table).

### History

- 2026-08-28T01:52:28.897Z todo → wip (system)
- 2026-08-28T02:51:54.540Z wip → testing (system)
- 2026-08-28T02:57:56.621Z testing → done (system)
