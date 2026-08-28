---
schema_version: 1
name: "Route service-layer JSON emission through the ADR-091 envelope seam"
status: done
template: feature-impl
created_at: 2026-08-28T04:31:45.643Z
updated_at: "2026-08-28T06:57:41.864Z"
feature_id: F95
priority: P2
ac_altitude: task-local
---

## 0697. Route service-layer JSON emission through the ADR-091 envelope seam

### Background

ADR-091 (task 0693, feature F95) adopted the contracts envelope at the CLI seam
`apps/cli/src/output.ts` behind the opt-in `--json-envelope` flag, and 0693 adopted it at 99 of
102 emit sites across the 14 modules under `apps/cli/src/commands/`.

The 0693 sweep was scoped, by AC2's own wording, to `apps/cli/src/commands/**`. Several verbs do
not emit their JSON there — they delegate to a service in `packages/app`, which formats with a
**private** helper and never sees `options.jsonEnvelope`. The result is a flag the CLI advertises
and silently ignores. Reproduced 2026-08-27 against HEAD `1a2cfd75`:

| Verb | `--json --json-envelope` output | Emit site |
| --- | --- | --- |
| `agent list` | raw `{agents: [...]}` — no envelope | `packages/app/src/services/agent-service.ts:423` (private `toJson`, `:2132`) |
| `agent doctor` | raw `{agents: [...]}` — no envelope | `packages/app/src/services/agent-service.ts:553,621` |
| `rule run` | raw `{preset, ruleCount, findings, fixes}` | `packages/app/src/services/rule-service.ts:332,368,397` (`JSON.stringify`) |
| `rule validate` | raw `{valid, kind, source}` | `packages/app/src/services/rule-service.ts:368` |

All four register `SHARED_OPTIONS.jsonEnvelope` (`agent.ts`, `rule.ts:32,74`) but the option never
reaches the emitter. A static scan of `.command()` blocks flags 12 candidate verbs; 4 are
confirmed live, `message inbox` and the `team` verbs route through in-module helpers and are
correctly enveloped.

`docs/04_DESIGN.md` §4.1 already records `agent doctor` / `agent list` as "not adopted
(service-side, outside the 14-module sweep)"; `rule run` / `rule validate` were not recorded and
are added by this task's inventory update.

**Why this is not a 0693 fix.** `packages/app` must not import from `apps/cli` (apps are thin
transports; logic lives in `packages/app`, ADR-021). Wiring the service layer therefore requires
either relocating the envelope helpers to a shared package or threading an envelope decision
through the service call signatures — an architecture choice, not a patch. 0693 closed with the
gap documented and routed here.

### Requirements

- [ ] R1. **Record the seam-relocation decision** — a dated amendment to ADR-091 in
      `docs/00_ADR.md` stating where the envelope helpers live after this task and why. This is an
      internal module relocation, not a public CLI surface change (no new noun, verb, or flag), so
      the ADR-051 consent gate does **not** apply; the amendment exists so the next reader knows
      why `apps/cli/src/output.ts` became a re-export. Must name the rejected alternatives
      (`packages/contracts`; duplicating the helpers) and the dependency-direction fact that rules
      out the naive option.

- [ ] R2. **Wire the four confirmed verbs** — `agent list`, `agent doctor`, `rule run`,
      `rule validate` honor `--json-envelope` / `SPUR_JSON_ENVELOPE=1` with the same precedence as
      the CLI seam (explicit flag > env > raw), emitting `{ok: true, data}` / `{ok: true, data, meta}`
      on success and `{ok: false, error: {code, message, details?}}` on failure. The precedence is
      applied by the moved `envelopeEnabled()`, not re-implemented per service.

- [ ] R3. **Raw-default byte-identity** — with neither the flag nor the env var set, all four verbs
      emit output byte-identical to the pre-change baseline. Guarded by regression tests that
      capture the baseline, not by inspection.

- [ ] R4. **Close the inventory** — re-run the emit-site sweep with `packages/app` service emitters
      included, and update `docs/04_DESIGN.md` §4.1 so every verb that registers
      `SHARED_OPTIONS.jsonEnvelope` has a row stating whether it honors the flag. No verb may
      advertise the flag without either honoring it or carrying a documented kept-raw reason. The
      §4.1 "Not adopted (service-side…)" bullet added at 0693 close-out is replaced by the closed
      result.

**Out of scope (non-goals):** flipping the enveloped shape to default (ADR-091 defers that to the
end of its deprecation window); changing any payload fields, exit codes, or human output; migrating
the `@gobing-ai/ts-utils` `ApiEnvelope`; per-site `API_ERROR_CODES` reclassification away from the
`INTERNAL_ERROR` collapse, and stripping the `Error:` prefix that `String(err)` call sites put in
the envelope `message` (both are whole-surface follow-ups, filed separately); refactoring services
to return payloads and let the CLI emit them (the larger inversion — noted in Design as the
long-term shape, deliberately not done here).

### Acceptance Criteria

- [ ] AC1. Given `apps/cli` already depends on `@gobing-ai/spur-app` (so the reverse import would be
      circular), when the seam decision lands as an ADR-091 amendment in `docs/00_ADR.md`, then it
      names the module that owns the helpers after the change, the two rejected alternatives, and
      the dependency-direction fact — and states that no ADR-051 consent gate applies because no
      CLI noun, verb, or flag changes.

- [ ] AC2. Given each of `agent list`, `agent doctor`, `rule run`, `rule validate`, when invoked
      with `--json --json-envelope`, then stdout parses against `apiSuccessSchema` from
      `packages/contracts/src/shared.ts` — all four emit flat objects, so `{ok: true, data}` is the
      expected form and `paginatedResponseSchema` does not apply — and the same command with
      `SPUR_JSON_ENVELOPE=1` and no flag produces the identical document.

- [ ] AC3. Given each of the same four verbs invoked with `--json` alone, when compared against the
      pre-change baseline captured in the test fixture, then the bytes are identical.

- [ ] AC4. Given a static scan of every `.command()` block registering `SHARED_OPTIONS.jsonEnvelope`,
      when the scan is re-run after the change, then every such verb either emits through the
      envelope seam or appears in the `docs/04_DESIGN.md` §4.1 kept-raw list with a reason — the
      scan surfaces no verb that advertises the flag and ignores it.

- [ ] AC5. Given the 99 CLI call sites already adopted at task 0693, when the helpers move out of
      `apps/cli/src/output.ts`, then none of those call sites is edited and `bunx tsc --noEmit`
      passes for every workspace — the re-export carries them unchanged.

### Q&A

**2026-08-27 — refine `--depth ready`. Decisions closed before implementation:**

- **Where the helpers live: `packages/app`, not `packages/contracts`.** Contracts is transport DTOs
  only (AGENTS.md § oRPC), and `envelopeEnabled` reads `process.env` — runtime behavior. `packages/app`
  already depends on `@gobing-ai/spur-contracts`, so the zod schemas stay reachable. Rejected:
  contracts (boundary violation), a new shared package (a package for four functions), duplicating
  the helpers (a second envelope implementation inside the task meant to finish the first).

- **Direction of the move is forced, not chosen.** `apps/cli` depends on `@gobing-ai/spur-app`
  (`apps/cli/package.json` devDependencies; five command modules import it at runtime), so
  `packages/app → apps/cli` would be circular. The original filing attributed this to ADR-021;
  corrected during this refine — ADR-021 governs *where logic belongs* and happens to agree, but the
  binding constraint is the workspace graph.

- **No ADR-051 consent gate.** The original R1 was written as if this needed operator consent like
  0693 did. It does not: no CLI noun, verb, or flag changes — `--json-envelope` already exists and
  is already approved. R1 is a dated ADR-091 *amendment* recording the relocation, not a new
  decision requiring consent. Corrected in this refine.

- **`--json` raw baseline is captured before any edit.** Plan step 1. A baseline captured after the
  move would tautologically pass AC3.

- **Deferred, with owner:** `INTERNAL_ERROR` → `NOT_FOUND` reclassification and the `Error:` prefix
  strip on `String(err)` messages are whole-surface changes; a partial pass is worse than the current
  uniform collapse. Both stay F95 follow-ups, filed separately, not folded in here. The
  services-return-payloads inversion is the right long-term shape and is likewise deferred — it
  rewrites every service's return contract.

- **The 6 red `apps/cli` tests are not this task's.** Verified pre-existing at clean HEAD
  `1a2cfd75` (857 pass / 6 fail with and without the 0693 close-out diff). They are test-isolation
  defects that read the operator's real environment. Recorded in Plan step 9 so the implementer does
  not chase them or read them as a regression.

### Design

#### WHAT

Move the ADR-091 envelope helpers **down** one package — out of `apps/cli/src/output.ts` into
`packages/app` — and re-export them from their old home so no existing CLI call site changes. The
four service-emitting verbs then import the same helpers from their own package and receive the
opt-in decision through their existing options object.

**Frozen shape** (unchanged from ADR-091 / `packages/contracts/src/shared.ts:24-39`, do not re-spell):

```ts
{ ok: true,  data: T }
{ ok: false, error: { code: ApiErrorCode, message: string, details?: unknown } }
{ ok: true,  data: T[], meta: { nextCursor?: string; hasMore: boolean; limit: number } }  // list verbs
```

#### WHY

`packages/app` is where the four broken verbs actually emit, and it **already** depends on
`@gobing-ai/spur-contracts` (`packages/app/package.json` `dependencies`), so the envelope zod
schemas are already reachable from there. `apps/cli` in turn depends on `@gobing-ai/spur-app`
(`apps/cli/package.json` `devDependencies`, and five command modules import it at runtime), so
moving the helpers down and re-exporting up is the only direction that adds no dependency edge.

The reverse — `packages/app` importing `apps/cli` — is not merely discouraged; it is **circular**
against the existing workspace graph. This is the dependency-direction fact, not ADR-021: ADR-021
("Functionality Lives in `packages/app`", `docs/00_ADR.md:156`) governs *where logic belongs* and
independently points the same way.

Reuse-before-create: one envelope implementation stays one implementation. The whole point of
ADR-091 was to stop the repo growing a third envelope; duplicating the helpers into `packages/app`
would do exactly that inside the task meant to finish the adoption.

#### WHERE

**New module (the relocation target):**

- `packages/app/src/output/envelope.ts` — new file; receives the bodies of `envelopeEnabled`,
  `toEnvelopeJson`, `toEnvelopeError`, `writeJsonError`, and the `CliEnvelope` /
  `EnvelopeErrorPayload` / `EnvelopeOptions` types moved verbatim from
  `apps/cli/src/output.ts:38-108`.
- `packages/app/src/index.ts` — export the new module.

**Frozen names** (nothing else is added to any public surface):

| Name | Location after this task | Role |
| --- | --- | --- |
| `envelopeEnabled(explicit?: boolean)` | `packages/app/src/output/envelope.ts` | Unchanged signature and precedence (explicit > `SPUR_JSON_ENVELOPE=1` > raw) |
| `toEnvelopeJson(value, opts)` | same | Unchanged |
| `toEnvelopeError(code, message, details?)` | same | Unchanged |
| `writeJsonError(output, options, message)` | same | Unchanged behavior; `output` param typed as `EnvelopeCapableOutput` |
| `CliEnvelope` | same | Unchanged |
| `EnvelopeCapableOutput` | same — **new type** | `{ write(m: string): void; error(m: string): void }`; the structural sink that both `CommandOutput` (`apps/cli/src/output.ts:12`) and `RuleServiceOutput` (`packages/app/src/services/rule-service.ts:52`) already satisfy |
| `enveloped?: boolean` | `RuleServiceOptions`; agent-service list/doctor arg objects | **New optional field**; how `options.jsonEnvelope` reaches the emitter |

**Stays in `apps/cli/src/output.ts`** (CLI-only concerns): `CommandOutput`, `consoleOutput`,
`toJson`. The file adds a re-export line so `import { toEnvelopeJson, writeJsonError } from
'../output'` keeps resolving at all 99 adopted call sites.

**Emit sites to convert (verified at HEAD `1a2cfd75`):**

- `packages/app/src/services/agent-service.ts:423` — `agent list` plain path, `toJson({ agents })`
- `packages/app/src/services/agent-service.ts:553` — `agent list --specs`
- `packages/app/src/services/agent-service.ts:621` — `agent doctor`
- `packages/app/src/services/agent-service.ts:2132` — the private `function toJson`; **delete** it
  and route its callers through the moved helpers (`:528`, `:647` already emit `{error: {code,
  message}}` pseudo-envelopes and should become `toEnvelopeError`)
- `packages/app/src/services/rule-service.ts:332` — `rule run`, `JSON.stringify(payload, null, 2)`
- `packages/app/src/services/rule-service.ts:368`, `:397` — `rule validate` / verbose branch

**Flag threading (command layer):** `apps/cli/src/commands/agent.ts` and
`apps/cli/src/commands/rule.ts` already register `SHARED_OPTIONS.jsonEnvelope` (`rule.ts:32`,
`rule.ts:74`); pass `options.jsonEnvelope` into the service call alongside the existing `json`
boolean. No new option is registered.

**Doc targets:** `docs/00_ADR.md` (ADR-091 amendment, R1), `docs/04_DESIGN.md` §4.1 (R4 — replaces
the "Not adopted (service-side, outside the 14-module sweep)" bullet added at 0693 close-out).

#### Precedence / algorithm

1. **Precedence is not re-implemented.** The service passes its `enveloped` value into
   `envelopeEnabled(explicit)`, which applies explicit > env > raw exactly as it does for the CLI.
   A service that reads `process.env.SPUR_JSON_ENVELOPE` itself is a bug.
2. **All four are `{ok, data}` — the paginated form does not apply.** Verified at HEAD `1a2cfd75`:
   every one of the four emits a **flat object**, not a bare array — `agent list` and `agent doctor`
   emit `{agents: [...]}`, `rule run` emits `{preset, ruleCount, findings, fixes}`, `rule validate`
   emits `{valid, kind, source}`. The array is already a *field* inside the payload. So each wraps
   as `{ok: true, data: <payload>}` via `apiSuccessSchema`; do **not** reach for
   `paginatedResponseSchema`, and do **not** unwrap `agents`/`findings` to the top level to make a
   list form fit. Match the shape the raw payload already has.
3. **Existing top-level `ok`.** `rule validate`'s raw payload carries its own `valid` boolean, not
   `ok`, so there is no collision. If a payload does carry `ok`, it moves under `data` unchanged and
   the envelope `ok` is recomputed as command success — never two `ok`s with different meanings.
4. **Failure paths.** `agent-service.ts:528` and `:647` emit `{error: {code: 'agent-resolution',
   message}}` — a pseudo-envelope with no discriminant. Enveloped mode collapses these to
   `{ok:false, error:{code:'INTERNAL_ERROR', message, details:{cliCode:'agent-resolution'}}}`, matching
   the `details.cliCode` convention ADR-091 froze. Raw mode keeps the existing bytes.

#### Anti-patterns — do NOT implement

- **Do not** duplicate the envelope helpers into `packages/app`. Move them; leave a re-export.
- **Do not** move them to `packages/contracts` — that package is transport DTOs only, and
  `envelopeEnabled` reads `process.env`, which is runtime behavior, not a DTO.
- **Do not** make `packages/app` import from `apps/cli`. It is circular against the workspace graph.
- **Do not** edit any of the 99 CLI call sites already adopted at 0693; the re-export exists so the
  diff stays at the seam. A diff that touches `apps/cli/src/commands/task.ts` has gone wrong.
- **Do not** change payload fields, exit codes, or human (non-`--json`) output.
- **Do not** flip the default to enveloped, and do not add a seventh `API_ERROR_CODES` member.
- **Do not** refactor services to return payloads for the CLI to emit. That inversion is the right
  long-term shape and is explicitly out of scope — it changes every service's return contract.
- **Do not** reclassify `INTERNAL_ERROR` to `NOT_FOUND`, or strip the `Error:` prefix from
  `String(err)` messages, in this task. Both are whole-surface changes; a partial pass leaves a more
  inconsistent surface than the current uniform collapse.

#### Handoff / cross-task

`dependencies[]` is empty. **Assumes** task 0693 shipped the seam and the opt-in flag
(`apps/cli/src/output.ts:63,75,87,100`; `shared-options.ts:31`) — this task relocates that code, it
does not re-invent it. **Leaves for dependents:** the enveloped-by-default flip at the end of
ADR-091's deprecation window, the `API_ERROR_CODES` per-site reclassification, and the `Error:`
prefix strip — all F95 follow-ups. Does **not** re-own ADR-091's decisions; the amendment records
where the code lives, never a new envelope shape.

### Plan

1. **Capture the raw baseline first (R3 blocker).** Before any source edit, record the exact
   `--json` bytes of `agent list`, `agent doctor`, `rule run`, `rule validate` into a fixture the
   byte-identity test reads. A baseline captured after the move proves nothing.
2. **Create `packages/app/src/output/envelope.ts`** — move `envelopeEnabled`, `toEnvelopeJson`,
   `toEnvelopeError`, `writeJsonError`, `CliEnvelope`, `EnvelopeErrorPayload`, `EnvelopeOptions`
   verbatim from `apps/cli/src/output.ts:38-108`. Add `EnvelopeCapableOutput` and widen
   `writeJsonError`'s first parameter to it. Export from `packages/app/src/index.ts`. (R1, R2)
3. **Turn `apps/cli/src/output.ts` into a re-export** for the moved names, keeping `CommandOutput`,
   `consoleOutput`, and `toJson` local. Run `bunx tsc --noEmit` across every workspace — this is the
   AC5 gate and it must pass with **zero** edits under `apps/cli/src/commands/`. (R2, AC5)
4. **Thread the flag into rule-service** — add `enveloped?: boolean` to `RuleServiceOptions`; pass
   `options.jsonEnvelope` from `apps/cli/src/commands/rule.ts` (`run` and `validate` actions);
   convert `rule-service.ts:332,368,397` from `JSON.stringify(x, null, 2)` to `toEnvelopeJson`. (R2)
5. **Thread the flag into agent-service** — add `enveloped?: boolean` to the list/doctor argument
   objects; pass from `apps/cli/src/commands/agent.ts`; convert `agent-service.ts:423,553,621` to
   `toEnvelopeJson`, convert the `:528`/`:647` pseudo-envelopes to `toEnvelopeError` with
   `details.cliCode: 'agent-resolution'`, and **delete** the private `toJson` at `:2132`. (R2)
6. **Extend the tests.** In `apps/cli/tests/output-envelope.test.ts`: for each of the four verbs,
   assert the enveloped document parses against `apiSuccessSchema` / `paginatedResponseSchema`
   (AC2), assert flag and `SPUR_JSON_ENVELOPE=1` produce identical output (AC2), and assert the raw
   document equals the step-1 fixture byte-for-byte (AC3).
7. **Write the AC4 scan as a runnable check, not a manual sweep** — a test that walks every
   `.command()` block registering `SHARED_OPTIONS.jsonEnvelope` and asserts each either reaches an
   envelope emitter or is named in an explicit kept-raw allowlist. This is the artifact that stops
   the class of defect, not just this instance. (R4, AC4)
8. **Docs in the same commit (T3).** ADR-091 amendment in `docs/00_ADR.md` (R1) and the §4.1 rewrite
   in `docs/04_DESIGN.md` replacing the "Not adopted (service-side…)" bullet with the closed
   result (R4).
9. **Gates.** `bun run lint` · `bun run test` (apps/cli + packages/app) · `bun run build` ·
   `bun run corpus-check` · `spur task check 0697`. Note the standing caveat: `bun test` in
   `apps/cli` is red by 6 pre-existing, machine-dependent failures (`agent-team.test.ts` reads the
   live `.spur/agents/`, `workflow.test.ts` picks up a globally installed `@gobing-ai/spur`) — compare
   against that baseline, do not read 6 failures as a regression, and do not "fix" them here.

**Verification intent.** AC2/AC3 are executable (zod parse + fixture byte-compare). AC5 is
executable (`tsc --noEmit` plus a diff-scope assertion). AC4 is executable **only if** step 7 lands
as a test; if it degrades to a manual sweep, the requirement ships unverifiable — build the scan.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
| ---------------------- |
| `apps/cli/src/commands/agent.ts:265` |
| `apps/cli/src/commands/agent.ts:38` |
| `apps/cli/src/commands/agent.ts:59` |
| `apps/cli/src/commands/agent.ts:87` |
| `apps/cli/src/commands/rule.ts:60` |
| `apps/cli/src/commands/rule.ts:87` |
| `apps/cli/src/output.ts:0` |
| `apps/cli/src/output.ts:2` |
| `apps/cli/src/output.ts:36` |
| `apps/cli/tests/output-envelope.test.ts:130` |
| `apps/cli/tests/output-envelope.test.ts:2` |
| `apps/cli/tests/output-envelope.test.ts:7` |
| `packages/app/src/index.ts:34` |
| `packages/app/src/output/envelope.ts:10` |
| `packages/app/src/output/envelope.ts:100` |
| `packages/app/src/output/envelope.ts:25` |
| `packages/app/src/output/envelope.ts:27` |
| `packages/app/src/output/envelope.ts:7` |
| `packages/app/src/services/agent-service.ts:2120` |
| `packages/app/src/services/agent-service.ts:2127` |
| `packages/app/src/services/agent-service.ts:2180` |
| `packages/app/src/services/agent-service.ts:2601` |
| `packages/app/src/services/agent-service.ts:420` |
| `packages/app/src/services/agent-service.ts:424` |
| `packages/app/src/services/agent-service.ts:445` |
| `packages/app/src/services/agent-service.ts:492` |
| `packages/app/src/services/agent-service.ts:509` |
| `packages/app/src/services/agent-service.ts:51` |
| `packages/app/src/services/agent-service.ts:538` |
| `packages/app/src/services/agent-service.ts:575` |
| `packages/app/src/services/agent-service.ts:591` |
| `packages/app/src/services/agent-service.ts:594` |
| `packages/app/src/services/agent-service.ts:611` |
| `packages/app/src/services/agent-service.ts:648` |
| `packages/app/src/services/agent-service.ts:677` |
| `packages/app/src/services/agent-service.ts:703` |
| `packages/app/src/services/rule-service.ts:143` |
| `packages/app/src/services/rule-service.ts:30` |
| `packages/app/src/services/rule-service.ts:337` |
| `packages/app/src/services/rule-service.ts:367` |
| `packages/app/src/services/rule-service.ts:373` |
| `packages/app/src/services/rule-service.ts:402` |
| `packages/app/src/services/rule-service.ts:94` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | ADR-091 amendment `docs/00_ADR.md:1715-1740` (dated 2026-08-28, task 0697): owning module named (`packages/app/src/output/envelope.ts`), both rejected alternatives named with reasons (contracts = DTOs-only vs `process.env` runtime; duplication = second implementation), binding fact stated as workspace-graph circularity (`apps/cli` → `@gobing-ai/spur-app`, reverse import circular; ADR-021 corrected to non-binding), and explicit "No ADR-051 consent gate applies" |
| R2 | MET | Helpers moved with precedence single-sourced in `envelopeEnabled` (`packages/app/src/output/envelope.ts:63-66`); threading: `apps/cli/src/commands/rule.ts:60,87` → `RuleService` `enveloped` (`rule-service.ts:95,144`) → `toEnvelopeJson` at `rule-service.ts:337,373,402`; `agent.ts:31-33,50-57` → `agent-service.ts:420-424` (list), `:575-577`/`:648-650` (doctor via `renderDoctor` `:612`); pseudo-envelopes at `agent-service.ts:539-547` and `:677-688` normalize to `{ok:false, error:{INTERNAL_ERROR, details.cliCode:'agent-resolution'}}` in enveloped mode only; private `toJson` deleted (grep: zero `function toJson` in agent-service.ts); no service reads the env var (grep: only `envelope.ts`) |
| R3 | MET | Fixtures captured pre-edit: `apps/cli/tests/fixtures/raw-json-baseline/{rule-run.json,rule-validate-preset.json}` compared with exact `toBe` (no trim) in `apps/cli/tests/output-envelope.test.ts` ("raw default byte-identity" describe); agent verbs pinned structurally `raw.text === toJson(enveloped.data)` with documented in-test justification (host-specific payloads); formatter drift blocked by `biome.json:63-68` |
| R4 | MET | Runnable default-deny sweep in `output-envelope.test.ts` ("jsonEnvelope registration sweep"): >50-target sanity assert; every flag-registering verb must emit, thread, or be in `DELEGATED_EMITTERS` with the delegate source verified to exist AND emit; §4.1-row regex check; `docs/04_DESIGN.md` §4.1 "Service-side adoption closed (task 0697)" supersedes the 0693 note, rows added/updated for `agent list`/`doctor`/`run` (`:1620-1622`) and `rule run`/`validate` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| AC1 [docs-only] | MET | static-ref | `docs/00_ADR.md:1715-1740` — all four named elements verified present (owning module; contracts + duplication rejections; circular workspace graph as the binding fact, ADR-021 demoted to agreeing; explicit no-ADR-051-consent statement) |
| AC2 | MET | test | `apps/cli/tests/output-envelope.test.ts` SERVICE_VERBS loop: all four verbs with `--json --json-envelope` parse via `apiSuccessSchema(z.unknown())` (flat `{ok,data}`; no paginated form, correct per task Q&A); env-only run text `===` flag-run text (exact string identity); post-fix `agent run` env case additionally parses via `apiErrorSchema` |
| AC3 | MET | test | Same file "raw default byte-identity vs pre-change baseline": rule verbs exact-fixture `toBe`; agent verbs `raw === toJson(enveloped.data)` structural pin; green in post-fix gate (attested 6634/0) |
| AC4 | MET | test | Same file sweep test: default-deny over every `.command()` block registering `SHARED_OPTIONS.jsonEnvelope`; offenders `[]`; delegated emitters verified to exist and emit in source; §4.1 row presence asserted |
| AC5 | MET | command | `apps/cli/src/output.ts:5-13` re-exports all moved names from `@gobing-ai/spur-app` (`CommandOutput`/`consoleOutput`/`toJson` stay local); `packages/app/src/index.ts:36-43` exports the module; call sites unchanged (spot-checked `task.ts:45,195`, `feature.ts:66`, `message.ts:341`, `team.ts`, `serve.ts:45` — all keep the 0693 `{ enveloped: options.jsonEnvelope }` shape); cross-workspace `bunx tsc --noEmit` green in the post-fix gate (attested; re-run before commit) |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

- **Feature:** `docs/features/F95_cli-json-envelope-standard-normalized-ok-data-error-shape-across-spur-nouns.md`
- **Upstream task:** `0693` — CLI JSON envelope standard: ADR, shape inventory, and gated
  implementation. Shipped the seam this task relocates (`apps/cli/src/output.ts:63,75,87,100`) and
  the `--json-envelope` flag (`apps/cli/src/commands/shared-options.ts:31`).
- **ADR-091** — `docs/00_ADR.md:1620` — The CLI `--json` Surface Adopts the Contracts Envelope
  Behind an Opt-In `--json-envelope` Flag (Accepted 2026-08-27). R1 amends this entry.
- **ADR-021** — `docs/00_ADR.md:156` — Functionality Lives in `packages/app`. Agrees with the move
  direction; not the binding constraint (see Q&A).
- **ADR-051** — public-CLI-surface consent gate. Cited to record that it does **not** apply here.
- **Envelope schemas** — `packages/contracts/src/shared.ts:24-39` (`apiSuccessSchema`,
  `apiErrorSchema`, `paginatedResponseSchema`), exported publicly at
  `packages/contracts/src/index.ts:41`.
- **Shape inventory** — `docs/04_DESIGN.md` §4.1, `:1498`. R4 rewrites its "Not adopted
  (service-side, outside the 14-module sweep)" bullet.
- **Discovery evidence** — `docs/dogfood/2026-08-27-dev-verify-0693-dogfood.md` (P1/P2 findings from
  the `/sp:dev-verify 0693 --fix all` dogfood that surfaced the advertised-but-ignored flag).

### History

- 2026-08-28T05:54:27.897Z todo → wip (system)
- 2026-08-28T06:57:27.173Z wip → testing (system)
- 2026-08-28T06:57:41.864Z testing → done (system)
