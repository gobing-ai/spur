---
schema_version: 1
name: "Route service-layer JSON emission through the ADR-091 envelope seam"
status: todo
template: feature-impl
created_at: 2026-08-28T04:31:45.643Z
updated_at: "2026-08-28T04:39:46.748Z"
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
- [ ] R1. **Decide the seam location** — record in `docs/00_ADR.md` (amend ADR-091 or a new dated
      entry) whether the envelope helpers move to a package both `apps/cli` and `packages/app` may
      import, or whether services receive an envelope decision through their call signatures.
      `packages/app` importing `apps/cli` is not an option (ADR-021). State the rejected alternative.

- [ ] R2. **Wire the four confirmed verbs** — `agent list`, `agent doctor`, `rule run`,
      `rule validate` honor `--json-envelope` / `SPUR_JSON_ENVELOPE=1` with the same precedence as
      the CLI seam (flag > env > raw), emitting `{ok: true, data}` / `{ok: true, data, meta}` on
      success and `{ok: false, error: {code, message, details?}}` on failure.

- [ ] R3. **Raw-default byte-identity** — with neither the flag nor the env var set, all four verbs
      emit output byte-identical to the pre-change baseline. Guarded by regression tests, not by
      inspection.

- [ ] R4. **Close the inventory** — re-run the emit-site sweep with `packages/app` service emitters
      included, and update `docs/04_DESIGN.md` §4.1 so every verb that registers
      `SHARED_OPTIONS.jsonEnvelope` has a row stating whether it honors the flag. No verb may
      advertise the flag without either honoring it or carrying a documented kept-raw reason.

**Out of scope (non-goals):** flipping the enveloped shape to default (ADR-091 defers that to the
end of its deprecation window); changing any payload fields, exit codes, or human output; migrating the
`@gobing-ai/ts-utils` `ApiEnvelope`; per-site `API_ERROR_CODES` reclassification away from the
`INTERNAL_ERROR` collapse (separate follow-up).
### Acceptance Criteria
- [ ] AC1. Given `packages/app` cannot import `apps/cli`, when the seam decision lands in
      `docs/00_ADR.md`, then it names the chosen mechanism, the rejected alternative, and the
      package that owns the helpers after the change.

- [ ] AC2. Given each of `agent list`, `agent doctor`, `rule run`, `rule validate`, when invoked
      with `--json --json-envelope`, then stdout parses against `apiSuccessSchema` (or
      `paginatedResponseSchema` for list shapes) from `packages/contracts/src/shared.ts`, and the
      same command with `SPUR_JSON_ENVELOPE=1` and no flag produces the identical document.

- [ ] AC3. Given each of the same four verbs invoked with `--json` alone, when compared against the
      pre-change baseline captured in the test fixture, then the bytes are identical.

- [ ] AC4. Given a static scan of every `.command()` block registering `SHARED_OPTIONS.jsonEnvelope`,
      when the scan is re-run after the change, then every such verb either emits through the
      envelope seam or appears in the `docs/04_DESIGN.md` §4.1 kept-raw list with a reason — the
      scan surfaces no verb that advertises the flag and ignores it.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
