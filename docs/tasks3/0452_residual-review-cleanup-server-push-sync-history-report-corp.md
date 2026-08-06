---
template: meta
schema_version: 1
name: "Residual review cleanup: server push sync, history report, corpus migrator, default-by-phase retirement, legacy task aliases, agent-run nits"
description: ""
status: done
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0451"]
created_at: "2026-08-05T23:18:28.343Z"
updated_at: "2026-08-06T14:57:04.252Z"
---

## 0452. Residual review cleanup: server push sync, history report, corpus migrator, default-by-phase retirement, legacy task aliases, agent-run nits

### Background
Post-H83 packages/apps code review (2026-08-05) listed **18 findings**. Companion task **0451** owns the hot path (review #1–#7, #11, #16 + most of #12/#17). This task owns **everything left** so no residual is lost, without bloating the H83 fix batch.

**Companion:** `0451` — agent.run config injection, affinity keying, dual-latch collapse, requireDiff multi-folder, discoverSessionId, feature-check multi-folder test, verdict policy, buffered JSDoc. Frontmatter `dependencies: [0451]` sequences docs/nits that touch the same files; product items R1–R3 and inventory R5–R7 may be drafted in parallel while 0451 is open.

**Authority:** Code review transcript 2026-08-05 (`packages/` + `apps/` workflow / close-path / server / history). Design notes: `docs/04_DESIGN.md` history report + default-by-phase; plans: `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md` (history report parked P8).

**Severity / ETA (remaining only)**

| Review # | Sev | Area | Est. | This task ID |
|----------|-----|------|------|--------------|
| 8 | P2 | Server feature→tasks push sync | 1–2 d | R1 |
| 9 | P2 | `spur history report` TODO stub | 2–4 d (full) / 0.5 d MVP | R2 |
| 10 | P2 | Feature corpus migrator incomplete / unused product path | 2–3 d if shipping | R3 |
| 12 | P3 | Dual-latch / Q8 design docs after 0451 | 1–2 h | R4 (sequence after 0451 R3) |
| 13 | P3 | `default-by-phase` still live (deprecated) | 0.5–1 d after inventory | R5 |
| 14 | P3 | Legacy status aliases / template skeleton noise | 0.5–1 d | R6 |
| 15 | P3 | H1 umbrella + held parallel-worktree task | operator decision only | R7 (no implement of held work) |
| 17 | P4 | capture/buffered comment nits leftover after 0451 R8 | 15 m | R8 |
| 18 | P4 | agent-run sidecar / partial write silent catch | 30 m | R9 |

**Not in this task (already 0451):** review #1–#7, #11, #16.

**Implementer protocol**

1. Sequence R4/R8 after companion 0451 latch/JSDoc work to avoid thrash on agent-run.ts.
2. Ship R5 inventory before deleting `default-by-phase` (config grep + tests).
3. R1 / R2 / R3 are product-sized — implement only with explicit product intent; each has a **minimal MVP** option if full scope is deferred.
4. R7: **never** cancel or implement held H1 parallel-worktree task unless operator overrides; only document / optional AC hygiene. R7 is not a gate for other R#.
5. Fill Solution + Testing; gate with targeted tests then `bun run autofix && bun run spur-check` for any code path.
### Requirements
**P2 — product gaps (implement when product wants them; each has MVP option)**

- [x] **R1. Server feature→tasks push sync (review #8).**
  - **Issue:** `apps/server/src/modules/feature/handlers.ts` ~128–130:
    ```ts
    if (input.direction === 'push') {
        throw new Error('Push sync (feature->tasks cascade) is not implemented');
    }
    ```
    Board/API can call pull-style `syncFeature` but not cascade feature changes down to tasks.
  - **Impact:** Web board operators cannot push feature status/AC cascade to linked tasks via oRPC; only pull/refresh paths work.
  - **Acceptance (full):** Documented push semantics (which fields cascade, which task statuses are eligible); implemented in FeatureService + server handler; unit + handler tests; no silent partial cascade without result DTO.
  - **MVP (if full deferred):** Keep throw, but return structured oRPC error code (not raw Error string) + `docs/04_DESIGN.md` note "push not supported; use pull"; CLI `spur feature sync` remains SSOT for operators.
  - **Primary files:** `apps/server/src/modules/feature/handlers.ts`; `packages/app/src/services/feature-service.ts` (`syncFeature`); contracts for sync direction if any.
  - **Out:** Do not invent a second sync SSOT outside FeatureService.

- [x] **R2. `spur history report` (review #9).**
  - **Issue:** `apps/cli/src/commands/history.ts` ~39–43 — reserved surface prints TODO marker only. README + `docs/04_DESIGN.md` (~368) document the reservation.
  - **Impact:** Operators expecting a real report get a stub; long-parked (plan P8).
  - **Acceptance (full):** Report command produces useful summary (session counts, cost/token aggregates from imported history, top agents) human + `--json`; design section matches behavior.
  - **MVP:** Keep reserved, but improve message to cite DESIGN section + suggested workaround (`spur history analyze` / import) and exit code contract documented; no fake data.
  - **Primary files:** `apps/cli/src/commands/history.ts`; design `docs/04_DESIGN.md`; any history service in packages/app/domain.
  - **Prefer full only if product prioritizes history analytics this cycle.**

- [x] **R3. Feature corpus migrator productization or honest non-support (review #10).**
  - **Issue:** `packages/app/src/services/corpus-migrator.ts` + export from `packages/app/src/index.ts` — migrator class exists; unclear operator entry / completeness for feature corpus moves.
  - **Acceptance (pick one):**
    - **A (ship):** CLI verb or documented `spur` path that runs migrator dry-run + apply with tests; DESIGN updated.
    - **B (honest non-support):** No public CLI; module marked internal/deprecated in docs; do not advertise; optional delete if unused (confirm with `rg CorpusMigrator` — only remove if zero product callers outside tests).
  - **Primary files:** `corpus-migrator.ts`, CLI if A, DESIGN.
  - **Do not** half-ship an untested public migrate command.

**P3 — cleanup / debt**

- [x] **R4. Dual-latch / Q8 design docs after companion 0451 latch fix (review #12).**
  - **Issue:** File headers / skill notes still describe pure latch (`continue: true` inheritance) without H83 affinity matrix. Companion task 0451 R3 changes code behavior — docs must follow.
  - **Sequence:** Prefer after 0451 R3 lands (or document target-state matrix matching 0451 Design while 0451 is open).
  - **Acceptance:** `agent-run.ts` session latch comments + any spur-dev Q8/session notes describe:
    | affinityOn | resume via sessionDir/sessionId; no bare continue from latch |
    | affinityOff | Q8 latch may set continue; 0406 fallback |
  - **Primary:** `agent-run.ts` comments; optional `plugins/sp/skills/spur-dev` session notes if they still claim latch-only.

- [x] **R5. Retire or quarantine `default-by-phase` (review #13).**
  - **Issue:** Deprecated shim still live: config schema `packages/config/src/index.ts` ~310–318; `agent-service.ts` resolve path ~858–884 emits deprecation warning; tests assert warning still works.
  - **ADR/DESIGN:** ADR-033 / DESIGN default-by-phase retained as shim; CHANGELOG already mentions retire intent.
  - **Acceptance (inventory first):**
    1. Repo + operator-config scan: who still sets `agent.default-by-phase` (this monorepo `.spur/config.yaml`, fixtures, docs examples).
    2. **If zero real configs:** remove schema field, resolve branch, tests that only cover deprecation; update DESIGN to "removed".
    3. **If still used:** keep shim, add DESIGN "removal milestone", ensure stage model_policy is the documented replacement; do not break callers.
  - **Primary:** `agent-service.ts`, `packages/config`, tests `agent-service.test.ts` default-by-phase describe.
  - **Do not** remove without inventory evidence in Solution.

- [x] **R6. Legacy status aliases / template skeleton noise (review #14).**
  - **Issue:** `task-service.ts` still carries template-as-skeleton paths and any legacy status alias normalization that confuses agents (intentional compatibility, noisy).
  - **Acceptance:** Inventory aliases + skeleton fallbacks; either (A) document intentional list in DESIGN/AGENTS one-liner, or (B) remove dead aliases with tests proving no corpus uses them. Prefer **no behavior change** without corpus proof.
  - **Primary:** `task-service.ts` create/render paths (~195, ~641, ~1376); status normalize helpers if any.
  - **Out:** Full template system rewrite.

- [x] **R7. H1 umbrella hygiene note + held H1 parallel-worktree task (review #15) — process only, non-blocking.**
  - **Issue:** H1 stays open while the held H1 parallel-worktree task remains blocked (parallel worktree / mid-step HITL). Many H1 AC scenarios unlinked.
  - **Operator policy (non-negotiable unless overridden):** Continue holding 0142; do **not** cancel or implement that held H1 task in this task; do **not** force H1 to `done`. Completing other R#s on this task does **not** require 0142 to leave blocked.
  - **Acceptance:** Solution cites current H1 notes + that held task's status; optional hygiene **only if operator asks**: trim clearly orphan H1 scenarios with feature update (CLI-gated). Default: document "no code change for R7" + leave backlog note.
  - **Primary:** feature H1 notes; the held H1 task frontmatter (read-only).

**P4 — nits**

- [x] **R8. Leftover capture/buffered comment nits (review #17).**
  - After companion 0451 R8, re-grep for "buffered" / capture wording that still implies nonInteractive is buffered-only (`AgentRunInvocation.outputMode` docs, option comments).
  - **Acceptance:** Same grep gate as 0451; no remaining false buffered claims for pipe path.
  - **Primary:** `agent-run.ts`, `agent-service.ts` types/JSDoc.

- [x] **R9. Sidecar / partial-work write silent catch (review #18).**
  - **Issue:** `agent-run.ts` ~344, ~512+ — best-effort writes (`*-agent-session.json`, partial.md) swallow errors with empty `catch {}`.
  - **Acceptance:** On write failure, emit debug/trace via existing logger or observability bus (if available on runner) **or** at minimum a single best-effort comment + optional debug log; never mask the primary `ok:false` agent result. Unit test optional (mock FS throw → still returns agent failure).
  - **Primary:** `agent-run.ts` sidecar block ~328–346; `writePartialWorkArtifact` ~449–520.

**Explicitly owned by companion task 0451 (do not re-implement here)**

- Config injection, affinity keying, latch code, requireDiff, discoverSessionId, multi-folder feature-check test, verdict policy, primary buffered JSDoc + duplicate comment cleanup.
### Acceptance Criteria
```gherkin
Feature: Residual review cleanup outside 0451 hot path

  @core
  Scenario: R1 — push sync is either implemented or honest
    Given the server feature sync API with direction push
    When an operator invokes push
    Then either FeatureService performs a documented cascade with tests
    Or the API returns a structured not-implemented error and DESIGN states push is unsupported

  @core
  Scenario: R2 — history report is either real or honest
    Given spur history report
    When invoked with and without --json
    Then either a useful report is produced from imported history data
    Or the reserved-surface message cites DESIGN and a workaround without fabricating metrics

  @core
  Scenario: R3 — corpus migrator product stance is explicit
    Given CorpusMigrator in packages/app
    When the task completes
    Then either a tested operator entry exists or docs mark it internal/non-supported

  @core
  Scenario: R4 — latch docs match post-0451 affinity matrix
    Given 0451 R3 behavior (or target matrix if 0451 still open)
    When agent-run session comments are read
    Then affinity-on vs affinity-off continue rules are accurate

  @core
  Scenario: R5 — default-by-phase inventory then act
    Given an inventory of default-by-phase usages
    When removal or keep-shim is chosen
    Then Solution cites inventory evidence and tests match the choice

  @core
  Scenario: R6 — legacy aliases documented or removed with proof
    Given task-service skeleton and status alias paths
    When cleanup completes
    Then either DESIGN lists intentional aliases or dead paths are removed with tests

  @core
  Scenario: R7 — held H1 parallel-worktree task remains blocked
    Given operator hold on the H1 parallel-worktree task
    When this task finishes
    Then that held task is not cancelled or implemented by this task
    And H1 is not force-closed

  @core
  Scenario: R8-R9 — nits cleared
    Given greps for stale buffered claims and silent empty catches on sidecar writes
    When R8-R9 are done
    Then no false buffered-only claims remain for pipe path
    And write failures are observable without masking agent failure
```
### Q&A
**Q1: Why not fold this into 0451?**
0451 is the H83 correctness hot path (~1 day). These items are multi-day product work (server, history, migrator) or operator policy (0142). Separate task keeps implementers focused.

**Q2: Must every R# ship full product depth?**
No. R1–R3 allow MVP “honest non-support” so the finding is closed without a multi-day feature. Prefer full only when product prioritizes.

**Q3: Is the held H1 parallel-worktree task in scope?**
No implementation. R7 is documentation / optional H1 AC hygiene only under operator ask. Operator continues the hold (WBS listed only under References).

**Q4: Dependency on 0451?**
Soft: R4 and R8 should follow 0451 latch/JSDoc work to avoid thrash. R1–R3, R5–R7, R9 can proceed in parallel.

**Q5: Feature link?**
None required — multi-area residual cleanup (meta). Do not attach to H83 (done) unless a new umbrella feature is created later.
### Design
## Approach

Work **bottom-up by risk of thrash**: nits and inventories first, product gaps only after MVP-vs-full choice is explicit in Solution.

| Order | Work | Notes |
|------:|------|-------|
| 1 | R7 confirm hold (read-only) | Document H1 + held parallel-worktree task; zero code |
| 2 | R9 sidecar logging | Local to agent-run; independent of 0451 latch logic |
| 3 | R5 inventory default-by-phase | Then remove or keep-shim |
| 4 | R6 alias/skeleton inventory | Prefer document over remove |
| 5 | R1 / R2 / R3 MVP or full | Product call; one PR per area if large |
| 6 | R4 + R8 after 0451 | Docs/comments only |

## R1 — Push sync

**Full sketch:** FeatureService method `syncFeaturePush(id)` that maps feature status/AC to linked tasks per documented rules (status cascade only when tasks terminal? AC rewrite never automatic — prefer status-only push). Server handler calls it for `direction === 'push'`. Return `{ updated: [...], skipped: [...] }`.

**MVP sketch:** structured error `FEATURE_PUSH_SYNC_UNSUPPORTED` + DESIGN one paragraph.

## R2 — History report

**Full sketch:** Read imported history aggregates (domain DAOs / existing analyze helpers); print table + `--json` DTO. Reuse analyze, do not re-parse raw JSONL in CLI.

**MVP sketch:** better TODO message + exit 0 or 2 per DESIGN; point to `spur history analyze`.

## R3 — Corpus migrator

Inventory callers: `rg CorpusMigrator`. If only tests + export: prefer stance B (internal). If product needs multi-folder feature moves: wire CLI with `--dry-run` default.

## R5 — default-by-phase

```bash
rg -n "default-by-phase|defaultByPhase" .spur packages apps docs config --glob '!node_modules/**'
```

Removal checklist: schema optional field, agent-service branch, deprecation tests → replacement tests for stage model_policy only, DESIGN + ADR note “removed”.

## R9 — silent catch

```ts
} catch (err) {
    // best-effort sidecar; never override agent ok/error
    this.observabilityBus?.emit?.(…debug…) // if bus available
    // or logger.debug if composition provides one
}
```

If no logger on runner, a single debug console is **not** preferred (project forbids raw console in app if logger exists). Prefer bus event or silent with explicit comment citing R9 closed as “comment-only” if no sink exists — state choice in Solution.

## Touch map

| File | R# |
|------|-----|
| `apps/server/src/modules/feature/handlers.ts` | R1 |
| `packages/app/src/services/feature-service.ts` | R1 |
| `apps/cli/src/commands/history.ts` | R2 |
| `packages/app/src/services/corpus-migrator.ts` | R3 |
| `packages/app/src/workflow/actions/agent-run.ts` | R4, R8, R9 |
| `packages/app/src/services/agent-service.ts` | R5, R8 |
| `packages/config/src/index.ts` | R5 |
| `packages/app/src/services/task-service.ts` | R6 |
| `docs/04_DESIGN.md` | R1–R3, R5 (same-commit surface) |
| H1 + held parallel-worktree task corpus | R7 read-only |

## Verification

```bash
# After any code change
bun test packages/app/tests/services/agent-service.test.ts --test-name-pattern 'default-by-phase|phase'
bun test packages/app/tests/workflow/actions/agent-run.test.ts
# server if R1 full
bun test apps/server  # or package-local pattern
bun run autofix && bun run spur-check
```

## Risks

| Risk | Mitigation |
|------|------------|
| Push sync corrupts task corpus | Status-only cascade; dry-run; tests |
| Removing default-by-phase breaks operators | Inventory first |
| Touching held H1 task | Forbidden unless operator override |
| Thrash with 0451 on agent-run | Sequence R4/R8 after 0451 |
### Plan
- [x] R7: Confirm held H1 parallel-worktree task + H1 notes; document no implement (read-only).
- [x] R9: Observable or explicitly documented best-effort catches on sidecar/partial writes.
- [x] R5: Inventory default-by-phase; remove or keep-shim with DESIGN update.
- [x] R6: Inventory legacy aliases/skeleton; document or remove with proof.
- [x] R1: Choose MVP vs full push sync; implement + tests or structured unsupported.
- [x] R2: Choose MVP vs full history report; implement accordingly.
- [x] R3: Ship migrator CLI or mark internal/non-supported.
- [x] R4: After 0451 R3, refresh latch/affinity docs comments.
- [x] R8: Final buffered/capture grep cleanup.
- [x] Solution + Testing filled; spur-check green for code-changing paths.
### Solution
**R1 — Server push sync (MVP)**
- `apps/server/src/modules/feature/handlers.ts:128-132` — `HTTPException(501)` with pull/CLI workaround (not raw Error).
- `docs/04_DESIGN.md` feature sync — push documented as unsupported.

**R2 — history report (MVP)**
- `apps/cli/src/commands/history.ts:39-52` — reserved stub cites DESIGN + `history analyze`/`import`; human + `--json`; exit 0.
- `docs/04_DESIGN.md` history report section updated.

**R3 — Corpus migrator (option B)**
- `packages/app/src/services/corpus-migrator.ts:519-522` — `@internal`, no public CLI.
- `packages/app/src/index.ts:45-46` — export marked internal.

**R4 — Latch/affinity docs**
- `packages/app/src/workflow/actions/agent-run.ts:77-88` — header matrix affinityOn vs affinityOff.

**R5 — default-by-phase removed**
- **Inventory:** monorepo `.spur/config.yaml` / `config.example.yaml` only commented examples; no live product field values.
- Removed: Zod field `packages/config/src/index.ts`, JSON schema `apps/cli/schemas/spur-config.schema.json`, resolve path + deprecation warn in `agent-service.ts`, deprecation/phase-map tests.
- DESIGN routing § updated to stage model_policy only.

**R6 — Legacy aliases (document)**
- Keep intentional input normalization; DESIGN status alias policy documents them.

**R7 — H1/0142 hold**
- 0142 `blocked`, H1 `backlog` — not cancelled/implemented here.

**R8 — buffered nits**
- Grep clean for nonInteractive buffered-only claims (post-0451).

**R9 — Sidecar/partial catches**
- `packages/app/src/workflow/actions/agent-run.ts` sidecar + partial-work catches document R9 best-effort; never mask agent failure.
### Testing
**Verify (0452 close-out)** — 2026-08-06

**Verdict: PASS**

**Commands:**
```
bun test packages/app/tests/services/agent-service.test.ts packages/app/tests/workflow/actions/agent-run.test.ts
# → 186 pass, 0 fail

bun run apps/cli/src/index.ts history report
# → not-implemented + DESIGN + analyze workaround

bun run apps/cli/src/index.ts history report --json
# → {"status":"not-implemented",...}

rg -n "default-by-phase" packages/app/src/services/agent-service.ts packages/config/src/index.ts
# → comments only (removed field/resolve)

spur task show 0142 --json | jq -r .status
# → blocked

spur task check 0452 --strict-core
# → PASS
```

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/server/src/modules/feature/handlers.ts:128-132` |
| R2 | MET | `apps/cli/src/commands/history.ts:39-52` + smoke |
| R3 | MET | `packages/app/src/services/corpus-migrator.ts:519-522` |
| R4 | MET | `packages/app/src/workflow/actions/agent-run.ts:77-88` |
| R5 | MET | schema/runtime removed; inventory commented-only; tests green |
| R6 | MET | DESIGN alias policy; intentional keep |
| R7 | MET | 0142 blocked |
| R8 | MET | grep clean |
| R9 | MET | documented catches on sidecar/partial |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R1 — push sync is either implemented or honest | MET | static-ref | handlers 501 |
| Scenario: R2 — history report is either real or honest | MET | command | history report smoke |
| Scenario: R3 — corpus migrator product stance is explicit | MET | static-ref | @internal |
| Scenario: R4 — latch docs match post-0451 affinity matrix | MET | static-ref | agent-run header |
| Scenario: R5 — default-by-phase inventory then act | MET | test + static-ref | removal + 186 tests |
| Scenario: R6 — legacy aliases documented or removed with proof | MET | static-ref | DESIGN |
| Scenario: R7 — held H1 parallel-worktree task remains blocked | MET | command | 0142 blocked |
| Scenario: R8-R9 — nits cleared | MET | static-ref | grep + catch comments |

Coverage: N/A (targeted 186). Design-conformance: pass (MVP R1–R3; R5 remove).
### Review
**Verdict: PASS**

**Priority findings**

| Priority | Dimension | Finding | Status |
|----------|-----------|---------|--------|
| P1 | — | None | PASS |
| P2 | — | None open (R5 incomplete removal completed this close-out) | PASS |
| P3 | Product depth | R1–R3 MVP not full features | ACCEPTED per task |
| P4 | Observability | R9 comment-only (no bus event) | ACCEPTED |

**SECUA:** structured 501 for push; default-by-phase fully removed from runtime; no secrets; 0142 hold preserved.
### References
- Companion hot-path task: `docs/tasks3/0451_h83-follow-up-agent-run-config-injection-affinity-session-ke.md` (review #1–#7, #11, #16)
- Review source: packages/apps code review 2026-08-05 findings #8–#10, #12–#15, #17–#18
- Server push: `apps/server/src/modules/feature/handlers.ts` (~128–130)
- History report: `apps/cli/src/commands/history.ts` (~39–43); `docs/04_DESIGN.md` history report; README history report line
- Corpus migrator: `packages/app/src/services/corpus-migrator.ts`; export `packages/app/src/index.ts`
- default-by-phase: `packages/config/src/index.ts` agent schema; `packages/app/src/services/agent-service.ts` (~858–884); tests `agent-service.test.ts`
- Task skeleton/aliases: `packages/app/src/services/task-service.ts`
- Sidecar/partial: `packages/app/src/workflow/actions/agent-run.ts` (~328–346, ~449+)
- Held: task `0142`, feature H1 notes
- Plan park: `docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md` P8 history report
### History
- 2026-08-05T23:20:53.303Z backlog → todo (system)
- 2026-08-06T09:23:55.095Z todo → wip (system)
- 2026-08-06T14:57:03.935Z wip → testing (system)
- 2026-08-06T14:57:04.252Z testing → done (system)
