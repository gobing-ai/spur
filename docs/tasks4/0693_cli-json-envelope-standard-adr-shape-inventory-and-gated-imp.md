---
schema_version: 1
name: "CLI JSON envelope standard: ADR, shape inventory, and gated implementation in one task"
status: todo
template: feature-impl
created_at: 2026-08-27T20:16:10.932Z
updated_at: "2026-08-27T22:06:10.947Z"
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

- [ ] R1. **ADR entry** in `docs/00_ADR.md` — a dated entry that *adopts* the existing
      `packages/contracts/src/shared.ts` envelope (`{ok: true, data}` / `{ok: false, error:
      {code, message, details?}}`) as the `spur` CLI `--json` standard, rather than inventing a
      third shape. It must state: the decision, the rejected alternatives (ts-utils `ApiEnvelope`;
      a new CLI-only shape), the `API_ERROR_CODES` reuse-or-extend call, and a compat/deprecation
      story keyed to the `--json-envelope` opt-in flag named in Design. Cites the four 0688
      deviations in Background as motivating evidence.

- [ ] R2. **Per-noun shape inventory** in `docs/04_DESIGN.md` — one table row per `--json`-bearing
      verb across all 14 noun modules under `apps/cli/src/commands/`, recording the current
      top-level shape (`bare-array` | `flat-object` | `envelope` | `scalar`) and naming each
      deviation from the R1 envelope. Completeness is checkable: every `toJson(` / `JSON.stringify(`
      emit site in those modules is represented by a row.

- [ ] R3. **HITL consent gate** — implementation (R4) does not begin until the operator explicitly
      approves the R1 decision mid-task, per the ADR-051 amendment for public CLI surface changes.
      The gate is observable: the task records the approval (or the stop) in `### Q&A` before any
      code under `apps/cli/src/` changes.

- [ ] R4. **Implement the envelope** behind the gate, per the approved decision: a single
      opt-in wrapping seam at `apps/cli/src/output.ts` plus per-noun adoption, with existing
      unwrapped output preserved as the default until the deprecation window closes.

**Out of scope (non-goals):** changing any noun's *payload* fields, exit codes, or human
(non-`--json`) output; migrating the oRPC/server surface (`packages/contracts` is the source being
adopted, not a target); retiring the unused `@gobing-ai/ts-utils` `ApiEnvelope` (recorded as a
rejected alternative only); any `apps/cli/src/` implementation before the R3 gate passes; and
re-splitting this work into separate ADR / inventory / implementation tasks (operator
consolidation, 2026-08-27).

### Acceptance Criteria

- [ ] AC1. Given the four `--json` deviations recorded in Background, when the ADR entry is authored
      in `docs/00_ADR.md`, then it is dated, it **adopts** the
      `packages/contracts/src/shared.ts` envelope by name (`apiSuccessSchema` / `apiErrorSchema` /
      `paginatedResponseSchema`) rather than defining a new shape, it records the two rejected
      alternatives, it resolves the `API_ERROR_CODES` extend-vs-collapse question, and it carries a
      compat/deprecation story naming the `--json-envelope` opt-in.

- [ ] AC2. Given every `--json`-bearing verb across the 14 noun modules under
      `apps/cli/src/commands/`, when the inventory lands in `docs/04_DESIGN.md`, then each verb has
      a row naming its current top-level shape and its deviation from the R1 envelope, and re-running
      the `toJson(` / `JSON.stringify(` emit-site sweep surfaces no verb absent from the table.

- [ ] AC3. Given the operator has not recorded approval in `### Q&A`, when the task reaches step 5
      of the Plan, then execution stops at the HITL consent gate and no file under `apps/cli/src/`
      is modified.

- [ ] AC4. Given operator approval is recorded, when the envelope ships, then
      `spur <noun> <verb> --json --json-envelope` emits `{ok: true, data}` (or
      `{ok: false, error: {code, message}}` on failure) validating against the contracts zod
      schemas, **and** the same command without the opt-in emits byte-identical output to the
      pre-change baseline for `task update --section`, `feature check`, and `task check --corpus`.

### Q&A

**CLOSED — implement-ready refinement, 2026-08-27**

- **Q: Invent `{ok, data, error}` or adopt an existing shape?**
  **A: Adopt.** `packages/contracts/src/shared.ts:24-39` already defines exactly
  `{ok: true, data}` / `{ok: false, error: {code, message, details?}}` with a frozen
  `API_ERROR_CODES` union. The filing described this shape as new; it is not. R1 is reframed from
  "propose an envelope" to "adopt the contracts envelope for the CLI" — same wire shape, one source.

- **Q: What about `@gobing-ai/ts-utils`' `ApiEnvelope` (`{code, message, result, data}`)?**
  **A: Rejected alternative, recorded not adopted.** It is a different shape with **zero** call
  sites under `apps/` or `packages/`. Retiring it is explicitly out of scope.

- **Q: Flip `--json` to enveloped by default in this task?**
  **A: No — opt-in only.** The motivating incident was consumers breaking on an unannounced shape
  change; shipping another would repeat it. Default stays raw for the deprecation window; the flip
  is a follow-up task under F95 carrying R1's ADR id.

- **Q: Where does the envelope get applied — call sites or a seam?**
  **A: One seam.** All 102 emit sites route through `toJson()` at `apps/cli/src/output.ts:22`.

- **DEFERRED — `API_ERROR_CODES` extension.** Whether CLI-specific failures need a seventh code or
  collapse to `INTERNAL_ERROR` is decided **in R1's ADR entry**, owner = the R1 author, and blocks
  R4. It is not left open past the consent gate.

- **OPEN — operator consent (R3).** The ADR-051-amendment consent gate for this public CLI surface
  change is **not yet granted**. Record the operator's approval or refusal, with a date, in this
  section before any `apps/cli/src/` edit.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
