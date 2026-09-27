---
schema_version: 1
name: Extract executor-tier policy from agent-service into its own module
status: done
template: standard
created_at: 2026-09-26T04:38:48.882Z
updated_at: "2026-09-27T06:45:24.841Z"

feature_id: B21
ac_numbering: task-local
---

## 0965. Extract executor-tier policy from agent-service into its own module

### Background

Source: `/sp:dev-review packages --focus all` (2026-09-25), architecture candidate **C3 (tight coupling / weak locality)**, rescoped from cancelled task 0963. Commit base `959f84bd6`.

The capability-tier **policy** — a small pure function set — lives inside the 3,370-line `packages/app/src/services/agent-service.ts`, so two unrelated services depend on the agent god-module just to read it:

- `agent-service.ts:3302` — `export function getExecutorTier(executor)` (declared tier wins; else regex inference → `cheap` / `capable-1` / `standard`).
- `agent-service.ts:3322` — `export function cheapestEligibleExecutors(executors, minTier)` (the single role→executor funnel, 0543 R1).
- `agent-service.ts:2680` — private `executorDisabled(executor)` used by the funnel.
- Uses `TIER_RANK` / `isTierEligible` from `packages/domain/src/stage-registry/schema.ts:426,435`.

Consumers importing policy through the god-module (rg, 2026-09-25):
- `packages/app/src/services/fleet-service.ts:32` — `cheapestEligibleExecutors`, `getExecutorTier` (:245).
- `packages/app/src/services/history-service.ts:84` — `getExecutorTier` (:1423).
- `packages/config/src/index.ts:659` — doc comment reference only (must stay accurate).

Out of scope (deliberately): the warn-once transition-shim state at `agent-service.ts:2873-2912` — see 0963 for why. Advisory severity; no behavior change.

### Requirements

- [x] R1. `getExecutorTier`, `cheapestEligibleExecutors`, `executorDisabled` and the `AgentExecutorConfig` interface live in `packages/app/src/services/executor-tier.ts`, which imports nothing from `agent-service.ts` (only `@gobing-ai/spur-config` / `@gobing-ai/spur-domain` symbols they already use: `normalizeExecutorAvailability`, `ExecutorDisabledValue`, `CapabilityTier`, `isTierEligible`, `TIER_RANK`).
- [x] R2. `fleet-service.ts:32` and `history-service.ts:84` import tier policy from `./executor-tier`, not `./agent-service`.
- [x] R3. `agent-service.ts` imports the policy from `./executor-tier` and re-exports `type AgentExecutorConfig` so every existing importer (`agent-usage-producer.ts`, `capability-attestation.ts`, `src/index.ts:90`, tests) compiles unchanged. The tier functions are not in the barrel today and are not added.
- [x] R4. `packages/app/tests/services/executor-tier.test.ts` directly covers: declared tier wins over inference; legacy bare `capable` → `capable-1`; each inference branch (`cheap` keywords, `capable-1` keywords, `standard` fallback); inference never yields `capable-2`/`capable-3`; `executorDisabled` for boolean and object (`{owner,since,reason}`) forms and `undefined`; `cheapestEligibleExecutors` filters disabled, filters below `minTier`, sorts ascending by tier rank.
- [x] R5. Policy text is moved byte-identically (doc comments included). The vocabulary comment at `packages/config/src/index.ts:655-662` names symbols, not files — no edit.

### Acceptance Criteria

Graduates all four of feature B21's scenarios (exact titles below); the numbered rows are the verify lens.

- [x] AC1 — R1 — Tier policy lives in a leaf module (req: R1, R5)
- [x] AC2 — R2 — Fleet and history read tier policy without the agent module (req: R2)
- [x] AC3 — R3 — Tier policy has a direct test surface (req: R4)
- [x] AC4 — R4 — Policy behavior and existing imports are unchanged (req: R3)

**Verify lens**

- **AC1** — `rg -n "agent-service" packages/app/src/services/executor-tier.ts` returns nothing; `rg -n "^export function (getExecutorTier|cheapestEligibleExecutors)|^function executorDisabled|^export interface AgentExecutorConfig" packages/app/src/services/agent-service.ts` returns nothing.
- **AC2** — `rg -n "from './agent-service'" packages/app/src/services/fleet-service.ts packages/app/src/services/history-service.ts` shows no `getExecutorTier` / `cheapestEligibleExecutors` (fleet may still import `AgentRoleDefinition` from agent-service).
- **AC3** — `(cd packages/app && bun test --coverage tests/services/executor-tier.test.ts)` passes and reports `src/services/executor-tier.ts` at 100% functions and ≥ 95% lines.
- **AC4** — `git diff <base> --stat -- packages/app/src/services/agent-usage-producer.ts packages/app/src/services/capability-attestation.ts apps/` is empty; `git diff <base> -- 'packages/app/tests/**'` touches only the new test file; `bun run typecheck` and `bun run spur-check` green.

### Q&A

- **Q:** `AgentExecutorConfig` is declared in `agent-service.ts:113` — the leaf module needs it. Import it back (a type-only back-edge) or move it? **A:** Move it into `executor-tier.ts`; `agent-service.ts` re-exports it as a type so its six existing importers stay untouched. A type-only import would still fail AC1 and keep the conceptual dependency. Decided 2026-09-25 (refinement).
- **Q:** Are `getExecutorTier` / `cheapestEligibleExecutors` exported from the `@gobing-ai/spur-app` barrel? **A:** No (checked `src/index.ts`, 2026-09-25). Only in-package consumers exist; nothing to preserve at the barrel beyond `AgentExecutorConfig`.
- **Q:** `executorFingerprint` (`agent-service.ts:2689`) uses `executorDisabled` — move it too? **A:** No. It is doctor-cache logic owned by agent-service; it imports `executorDisabled` from the new module (exported from there, not from the barrel).
- **Q:** Does anything test these functions today? **A:** Not directly — `rg` finds no test importing them; they are exercised via `AgentService` / `FleetService` suites. Hence R4.
- **Q:** Why not also move the transition-shim warn-once state? **A:** Dropped with 0963: those shims are scheduled for removal; relocating them is wasted work.

### Design

Move-only extraction; policy text byte-identical.

```text
packages/app/src/services/executor-tier.ts   (new, leaf)
  export interface AgentExecutorConfig          ← agent-service.ts:100-120 (with its doc comment)
  export function executorDisabled(...)         ← agent-service.ts:2674-2682 (was private; now exported for agent-service + fleet)
  export function getExecutorTier(...)          ← agent-service.ts:3294-3313
  export function cheapestEligibleExecutors(...)← agent-service.ts:3315-3330
  imports: normalizeExecutorAvailability, type ExecutorDisabledValue (spur-config);
           type CapabilityTier, isTierEligible, TIER_RANK (spur-domain) — same specifiers agent-service uses today
```

`agent-service.ts`:
- `import { type AgentExecutorConfig, cheapestEligibleExecutors, executorDisabled, getExecutorTier } from './executor-tier';`
- `export type { AgentExecutorConfig } from './executor-tier';` (keeps `src/index.ts:90` and other importers valid)
- Drop now-unused imports (`normalizeExecutorAvailability` etc.) only if Biome/tsc flags them unused.

`fleet-service.ts:32` → `import type { AgentRoleDefinition } from './agent-service'; import { cheapestEligibleExecutors, getExecutorTier } from './executor-tier';` (keep `AgentRoleDefinition` wherever it lives today).
`history-service.ts:84` → `import { getExecutorTier } from './executor-tier';`

**Invariant (0343):** inference yields only `cheap` / `standard` / `capable-1`; the regexes are copied verbatim.
**Invariant (0543 R1):** one role→executor funnel — `cheapestEligibleExecutors` moves, no second selector appears.

**Rejected:** moving the policy into `packages/domain/src/stage-registry/` next to `TIER_RANK` — `AgentExecutorConfig` carries a config-layer field (`disabled: ExecutorDisabledValue`), and pulling config shapes into domain widens domain's dependency for no caller benefit.

**Grilling:** *Challenge:* three functions don't justify a file. *Defense:* the cost removed is two services' compile-time edge into a 3.4K-line module and its import graph; the leaf gives the policy a direct test surface.

### Plan

- [x] Create `services/executor-tier.ts` by cutting the four declarations from `agent-service.ts` (Design map); keep doc comments.
- [x] In `agent-service.ts`: add the import + `export type { AgentExecutorConfig }` re-export; remove the moved bodies.
- [x] Re-point `fleet-service.ts:32` and `history-service.ts:84`.
- [x] Write `tests/services/executor-tier.test.ts` covering every R4 bullet (table-driven `test.each` for inference branches).
- [x] Focused: `(cd packages/app && bun test --coverage tests/services/executor-tier.test.ts tests/services/fleet-service.test.ts tests/services/agent-service.test.ts)`.
- [x] Gates: `bun run spur-check`; AC1–AC4 probes pasted into Testing.
- [x] One commit: `refactor(app): extract executor tier policy into a leaf module (0965)`.

### Solution

Move-only extraction of the capability-tier policy into a leaf module; no behavior change.

| File | Change |
| --- | --- |
| `packages/app/src/services/executor-tier.ts` (new, 76 lines) | `AgentExecutorConfig` (:22), `executorDisabled` (:37, now exported — was private), `getExecutorTier` (:48), `cheapestEligibleExecutors` (:68). Imports only `@gobing-ai/spur-config` (`normalizeExecutorAvailability`, `ExecutorDisabledValue`) and `@gobing-ai/spur-domain` (`CapabilityTier`, `isTierEligible`, `TIER_RANK`) — no `agent-service` edge (R1). Policy text and doc comments moved verbatim (R5); the only edit is the `export` keyword on `executorDisabled`, required by the Design map. |
| `packages/app/src/services/agent-service.ts` | Import + `export type { AgentExecutorConfig }` re-export at :70-82 (R3); the four declarations removed (:104-124 interface, :2657-2662 `executorDisabled`, :3268-3300 tier functions). Net −83/+20 lines. Unused `normalizeExecutorAvailability`-adjacent import narrowing: `ExecutorDisabledValue` dropped from the `spur-config` import (only the moved interface used it); `normalizeExecutorAvailability` is still used by other availability/probe sites in this file. |
| `packages/app/src/services/fleet-service.ts:32-33` | Split import: `AgentRoleDefinition` type stays from `./agent-service`, `cheapestEligibleExecutors` + `getExecutorTier` from `./executor-tier` (R2). |
| `packages/app/src/services/history-service.ts:85` | `getExecutorTier` re-pointed to `./executor-tier` (R2). |
| `packages/app/tests/services/executor-tier.test.ts` (new, 95 lines) | Direct test surface (R4) — three describes: tier resolution/inference (declared wins, legacy `capable` → `capable-1`, each inference branch, never `capable-2`/`capable-3`), availability reader (boolean/object/undefined), funnel (disabled filter both forms, `minTier` filter, ascending tier rank). |

Rationale: the cost removed is two unrelated services' compile-time edge into a 3,306-line god-module and its import graph, plus a direct test surface for policy that previously had none (R4 Q&A). `executorFingerprint` stays in `agent-service` (doctor-cache owner) and now imports `executorDisabled` from the leaf, per the Design decision. Invariants preserved: 0343 (inference yields only `cheap`/`standard`/`capable-1`), 0543 R1 (one role→executor funnel — no second selector introduced), 0890 (single availability classifier).

Verification: `(cd packages/app && bun test --coverage tests/services/executor-tier.test.ts)` — 16 pass, `executor-tier.ts` at 100% functions / 100% lines (AC3 needs 100% funcs / ≥95% lines); focused `executor-tier + fleet-service + agent-service` — 263 pass, 0 fail; `bun run --filter @gobing-ai/spur-app typecheck` exit 0; AC1/AC2/AC4a probes empty as required.

Bundle note: the source change makes `plugins/sp/lib/inline-run.generated.mjs` regenerate with a behavior-identical minifier chunk-order reshuffle (7+/7− lines). That regenerated file **is part of this commit** — `scripts/commands/bundle-plugin-lib.test.ts:71-79` asserts on-disk === fresh regeneration (`expect(after).toBe(before)`), and the gate failed that parity test while the file was reverted (fixed by `bun run build:plugin-lib` in the `test-fix` hop). `src/index.ts` needs no edit — `AgentExecutorConfig` reaches it through the `agent-service` re-export (R3).

Review (fresh-context reviewer, run `592e7ec4`): no P1/P2 code defect; P2-1 above was raised and corrected here, P3-1 resolved in `## Testing`, P4-1..3 recorded as cosmetic/pre-existing follow-ups.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/executor-tier.ts` (76 lines) declares `AgentExecutorConfig` (:22), `executorDisabled` (:37, now `export`), `getExecutorTier` (:48), `cheapestEligibleExecutors` (:68); its only imports are `@gobing-ai/spur-config` (:7) and `@gobing-ai/spur-domain` (:8) — no agent-service edge. |
| R2 | MET | `packages/app/src/services/fleet-service.ts:33` imports `cheapestEligibleExecutors` + `getExecutorTier` from `./executor-tier` (:32 keeps only the type-only `AgentRoleDefinition` edge); `packages/app/src/services/history-service.ts:85` imports `getExecutorTier` from `./executor-tier` and no longer imports `./agent-service` at all. |
| R3 | MET | `packages/app/src/services/agent-service.ts:70-75` imports the three functions from `./executor-tier`; `:82` `export type { AgentExecutorConfig } from './executor-tier'` keeps the six existing importers and the type-only barrel (`src/index.ts:90`) valid — `bun run typecheck` exit 0, all 7 packages code 0. |
| R4 | MET | `packages/app/tests/services/executor-tier.test.ts` (95 lines, 16 tests, 0 fail) asserts each R4 bullet: declared tier wins (:19), legacy bare `capable` → `capable-1` (:24), every inference branch incl. name+model+agent concat (:29-35), never `capable-2`/`capable-3` (:37), `executorDisabled` boolean/object/`undefined` + missing `disabled` (:46-58), funnel disabled-filter/minTier-filter/ascending-order/empty-roster (:75-92). |
| R5 | MET | Scripted brace-matched chunk comparison of the four moved declarations against `git show 939789e5f083fee2648f000449b1446f9e4a23b1:packages/app/src/services/agent-service.ts`, whitespace-normalized: `AgentExecutorConfig` identical (215 chars), `getExecutorTier` identical (578), `cheapestEligibleExecutors` identical (333), `executorDisabled` identical (162) — the only difference in the diff is the required added `export` keyword. No duplicate declaration remains in `agent-service.ts` (3/3 rg counts = 0). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `rg -n "agent-service" packages/app/src/services/executor-tier.ts` → no output, exit 1 (leaf has no back-edge). `rg -n "^export function (getExecutorTier\|cheapestEligibleExecutors)\|^function executorDisabled\|^export interface AgentExecutorConfig" packages/app/src/services/agent-service.ts` → no output, exit 1 (all four declarations gone from the god-module). |
| AC2 | MET | command | `rg -n "from './agent-service'" packages/app/src/services/fleet-service.ts packages/app/src/services/history-service.ts` → exactly one hit, `fleet-service.ts:32: import type { AgentRoleDefinition } from './agent-service'` (type-only, not a tier symbol); `history-service.ts:85` imports `getExecutorTier` from `./executor-tier` (exit 0, one line — the agent-service edge is gone). |
| AC3 | MET | test | `(cd packages/app && bun test --coverage tests/services/executor-tier.test.ts)` → `16 pass / 0 fail`, `16 expect() calls`, coverage row `src/services/executor-tier.ts │ 100.00 % funcs │ 100.00 % lines` (no uncovered lines) ⇒ AC3 floor (100 % funcs, ≥ 95 % lines) met, run fresh in this pass. |
| AC4 | MET | command | `git diff 939789e5f083fee2648f000449b1446f9e4a23b1 --stat -- packages/app/src/services/agent-usage-producer.ts packages/app/src/services/capability-attestation.ts apps/` → empty (exit 0; `apps/` exists — apps/cli, apps/server, apps/web — so the pathspec is non-vacuous). `git diff <base> --stat -- 'packages/app/tests/**'` → one file only, `packages/app/tests/services/executor-tier.test.ts \| 95 +++` — the new test file, no tracked test edited. `bun run typecheck` → exit 0, all 7 packages `code 0`. Gate receipt `.spur/run/0965-check-receipt.json`: `status: PASS`, `tier: full`, `inputDigest: sha256:2e22dc09026e5ddd76bfd4e618f2b34e2bfe2026913194ea87691e7d80b0ba0c`, `completedAt 2026-09-27T06:39:49.704Z`; `.spur/run/0965-test-gate.log` tail `9267 pass / 0 fail`, `All 2 rules passed`, `proof-digest: sha256:2e22dc09…`. Re-running `.spur/run/0965-proof-capture.ts` on the current tree prints `sha256:2e22dc09…` — identical to the receipt, so the recorded PASS is fresh for the certified bytes. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Reviewer: fresh-context re-certification pass (POST-REMEDIATION), run at proof digest `sha256:2e22dc09026e5ddd76bfd4e618f2b34e2bfe2026913194ea87691e7d80b0ba0c`. The code diff is unchanged (5 modified + 2 new paths, now committed as `a4f288280`); the corpus rewrite (checked AC1–AC4 + Plan boxes, `## Testing` written) is what moved the digest off `sha256:d27492c5…`.

**Verdict: PASS** — no P1 (blocker), no open P2, no open P3. AC1–AC4 and R1–R5 re-verified by fresh execution this pass; the gate receipt reads PASS at the new digest.

| Field | Value |
| --- | --- |
| Scope | `git diff 939789e5f083fee2648f000449b1446f9e4a23b1` — 5 modified + 2 new paths; committed as `a4f288280` (6 files, +191/−83) |
| Dimensions | functional traceability, correctness, security, efficiency, usability, architecture |
| Proof digest | `sha256:2e22dc09…` (`.spur/run/0965-proof-digest.txt`) |
| Gate receipt | `.spur/run/0965-check-receipt.json` — `tier: full`, `status: PASS`, `inputDigest: sha256:2e22dc09…`, log `.spur/run/0965-test-gate.log` |
| Verdict | **PASS** (P1 0, open P2 0, open P3 0, P4 5 advisory/deferred) |

#### Findings (ranked)

| Priority | Dimension | Finding | Location | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| P2-1 | correctness | Stale Solution note claimed the regenerated plugin bundle was deliberately left out of the commit; the file is in fact committed as part of `a4f288280` | `plugins/sp/lib/inline-run.generated.mjs` | `git show a4f288280 --stat` lists the bundle (7+/7−); re-verified this pass by executing `bun test scripts/commands/bundle-plugin-lib.test.ts` → 6 pass / 0 fail (on-disk === fresh regeneration) | FIXED (Solution text corrected; parity now re-confirmed by execution) |
| P3-1 | functional | AC evidence was unrecorded in the corpus — AC boxes unticked and `## Testing` still the placeholder — while the receipt already read PASS | `docs/tasks5/0965_extract-executor-tier-policy-from-agent-service-into-its-own.md` | Re-certified this pass: `grep -c '^- \[ \]'` → 0; AC1–AC4 and the two Plan boxes checked; `## Testing` carries the AC lens table with pasted evidence | RESOLVED (boxes flipped + Testing written in the `test-fix` hop) |
| P4-1 | architecture | Two doc comments stack above `executorFingerprint`; the first was already orphaned pre-move (anchors shifted from the prior note by the interface removal above them) | `packages/app/src/services/agent-service.ts:2651-2661` | `sed -n '2651,2662p'` — orphaned `Executor-set identity (R3)` block, then the function's own comment, then the declaration at :2662 | ADVISORY — fold into the next touch of that function; R5 keeps the moved text byte-identical |
| P4-2 | architecture | Pre-existing, not caused by this diff: the role→executor funnel is re-implemented inline, and three sites read `normalizeExecutorAvailability(...).disabled` directly instead of `executorDisabled` | `packages/app/src/services/agent-service.ts:2124-2132` (also `:569`, `:636`, `:712`) | `rg -n` shows the inline filter + ascending sort copy alongside the real `executorDisabled` importers; 0543 R1 / 0890 hold only where the moved helpers are used | DEFER — follow-up task candidate; a move-only extraction must not consolidate them |
| P4-3 | correctness | Test fixture teaches an invalid shape: `since: '2026-01-01'` is not RFC 3339 | `packages/app/tests/services/executor-tier.test.ts:49` (also `:69`) | `executorDisabledObjectSchema` (`packages/config/src/index.ts:318-323`) rejects it; the policy never validates | ADVISORY |
| P4-4 | usability | `## Testing`'s AC4 cell still describes the pre-commit state ("new test untracked ⇒ no tracked test edited"); at the committed tree the same lens returns an add-only row | `docs/tasks5/0965_extract-executor-tier-policy-from-agent-service-into-its-own.md` (`## Testing`) | `git diff 939789e5… --stat -- 'packages/app/tests/**'` → one file, `packages/app/tests/services/executor-tier.test.ts`, +95 insertions only | ADVISORY — conclusion unchanged (AC4 still MET); a review-only pass does not rewrite `## Testing` |
| P4-5 | usability | `## Testing` cites anchors in short form (`fleet-service.ts:33`, `history-service.ts:85`, `agent-service.ts:70-76`, `src/index.ts:90`), which the L4 checker cannot resolve to a root-relative path | `docs/tasks5/0965_extract-executor-tier-policy-from-agent-service-into-its-own.md` (`## Testing`) | `spur task check 0965 --json` → `pass: true` with 4 `L4.stale-line-anchor` **warnings**, all in `## Testing`; this Review uses full `packages/app/...` paths and adds none | ADVISORY — non-blocking warnings; the Testing hop owns that section |

#### Re-certification evidence — commands executed this pass

| Check | Command | Result |
| --- | --- | --- |
| AC1 | `rg -n "agent-service" packages/app/src/services/executor-tier.ts` | no output, exit 1 (required) |
| AC1 | `rg -n "^export function (getExecutorTier\|cheapestEligibleExecutors)\|^function executorDisabled\|^export interface AgentExecutorConfig" packages/app/src/services/agent-service.ts` | no output, exit 1 (required) |
| AC2 | `rg -n "from './agent-service'" packages/app/src/services/fleet-service.ts packages/app/src/services/history-service.ts` | only `fleet-service.ts:32` — type-only `AgentRoleDefinition`; both tier imports come from `./executor-tier` (`fleet-service.ts:33`, `history-service.ts:85`) |
| AC3 | `(cd packages/app && bun test --coverage tests/services/executor-tier.test.ts)` | 16 pass / 0 fail; coverage row `src/services/executor-tier.ts` 100.00 funcs / 100.00 lines (floor: 100 funcs, ≥95 lines) |
| AC4 | `git diff 939789e5f083fee2648f000449b1446f9e4a23b1 --stat -- packages/app/src/services/agent-usage-producer.ts packages/app/src/services/capability-attestation.ts apps/` | empty |
| AC4 | `git diff 939789e5f083fee2648f000449b1446f9e4a23b1 --stat -- 'packages/app/tests/**'` | one file — `packages/app/tests/services/executor-tier.test.ts` (+95) |
| AC4 | `bun run --filter @gobing-ai/spur-app typecheck` | exit 0 |
| AC4 | `bun run spur-check` (gate, recorded) | PASS — 9267 pass / 0 fail, 535 files; receipt `inputDigest: sha256:2e22dc09…` |
| R5 | scripted chunk comparison of the four moved declarations (doc comment + body) against `git show 939789e5…:packages/app/src/services/agent-service.ts`, whitespace-normalized | 4/4 identical (`executorDisabled` differs only by the added `export`) |
| Corpus | `grep -c '^- \[ \]'` + TODO/FIXME/XXX/HACK scan | 0 unchecked boxes, no diff markers |
| Corpus shape | `spur task check 0965 --json` | `pass: true`, 0 errors; 4 pre-existing `L4.stale-line-anchor` warnings, all in `## Testing` (P4-5) |
| Digest stability | `.spur/run/0965-proof-capture.ts <task> <feature>` re-run after this Review write | `sha256:2e22dc09026e5ddd76bfd4e618f2b34e2bfe2026913194ea87691e7d80b0ba0c` — unchanged; `Review` is not a hashed proof input (`TASK_SPEC_SECTIONS` = Background/Requirements/Acceptance Criteria/Design/Plan), so the receipt still certifies the reviewed bytes |

#### Functional traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/executor-tier.ts:7-8` imports only `@gobing-ai/spur-config` + `@gobing-ai/spur-domain`; both AC1 probes empty |
| R2 | MET | `fleet-service.ts:33` and `history-service.ts:85` import from `./executor-tier`; no tier symbol through `./agent-service` |
| R3 | MET | `agent-service.ts:70-76` import, `:82` `export type { AgentExecutorConfig } from './executor-tier'`; `packages/app/src/index.ts:90` still resolves (type-only barrel block); typecheck exit 0 |
| R4 | MET | 16 tests / 0 fail; `executor-tier.ts` at 100 % funcs / 100 % lines; every R4 bullet asserted — declared-wins `:21`, legacy `capable`→`capable-1` `:24`, each inference branch + name/model/agent concat `:29-35`, never `capable-2/3` `:38-41`, `executorDisabled` boolean/object/`undefined` `:46-53`, missing `disabled` `:57`, funnel disabled-filter-both-forms + `minTier` filter + ascending order + empty roster `:76-93` |
| R5 | MET | 4/4 moved chunks byte-identical to base after whitespace normalization (only `export` added to `executorDisabled`); `packages/config/src/index.ts:655-662` names symbols only ⇒ no edit needed, none made |

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 | MET | both AC1 probe rows above (exact lens commands, exit 1 / no output) |
| AC2 | MET | fleet keeps only the type-only `AgentRoleDefinition` edge; history's `./agent-service` edge is gone entirely |
| AC3 | MET | 16 pass / 0 fail with `executor-tier.ts` at 100.00 / 100.00 |
| AC4 | MET | three AC4 rows above plus gate receipt PASS at `sha256:2e22dc09…`; the Plan's "One commit" box is satisfied by `a4f288280` (message matches: `refactor(app): extract executor tier policy into a leaf module (0965)`) |

#### Dimensions reviewed

**Functional traceability** — all five requirements and all four ACs re-verified by fresh execution at the new digest (tables above). The corpus rewrite introduced no regression, and the previously-open gap (unticked AC boxes / placeholder Testing) is closed: 0 unchecked boxes remain.

**SECUA** — *correctness:* move-only; the four declarations are byte-identical after normalization, so semantics are unchanged, and both the app typecheck and the full gate are green at the new digest. *Security:* no new input boundary, no secret/logging surface, no new dependency (leaf imports existing config/domain symbols only). *Efficiency:* pure functions relocated; the import graph is strictly narrower — two services no longer reach a 3.3K-line module for policy — and one-way (`agent-service → executor-tier`, no cycle). *Usability/dev-experience:* policy gains a direct test surface (previously exercised only through `AgentService`/`FleetService` suites) and a module header carrying the vocabulary note. *Accessibility:* N/A.

**Architecture** — the extraction is the deep-module direction: a leaf with a small interface (four exports) and no back-edge. Boundary decisions re-judged sound: moving `AgentExecutorConfig` instead of type-importing it back is what actually removes the dependency (a type-only back-edge would have failed AC1's intent); `export type {…}` is the minimal way to keep six importers and the barrel's type-only re-export intact; `executorFingerprint` correctly stays with its doctor-cache owner while consuming `executorDisabled` from the leaf.

#### Residual risk

1. Unrelated load flake `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts:408` (5 s shell-guard timeout): failed once under full-suite load at the previous digest, passed in the same-digest gate re-run and 11/11 in isolation. Not touched — AC4's lens forbids editing another test file — but it deserves its own task.
2. The regenerated minified bundle cannot be semantically diffed in review; behavior-neutrality rests on unchanged bundle sources + the regeneration-parity test (re-run this pass, 6/6) + 9267/0 in the gate at the new digest.
3. Line-number anchors in this Review are a working-tree snapshot; P4-2's prior anchors (`:2127-2138`) and P4-3's (`:44`) were stale and are corrected here.
4. Review-only pass: the pre-commit wording in `## Testing` (P4-4) is deliberately left as-is.
5. `spur task check` reports 4 non-blocking `L4.stale-line-anchor` warnings in `## Testing` (short anchor form); neither the gate nor the done gate treats them as errors.

**Next:** none — PASS with no blocking findings; filing the P4-2 inline-funnel consolidation is the only follow-up worth queueing.

### References

- Feature: B21 (parent B2 — invocation-agnostic executor selection).
- Review source: `/sp:dev-review packages --focus all`, 2026-09-25, candidate C3; base commit `959f84bd6`. Supersedes cancelled 0963.
- Task 0343 (tier inference invariant), 0543 R1 (single funnel), 0890 (availability object form).

### History

- 2026-09-26T04:40:25.361Z backlog → todo (system)
- 2026-09-27T05:55:31.261Z todo → wip (system)
- 2026-09-27T06:45:12.890Z wip → testing (system)
- 2026-09-27T06:45:24.841Z testing → done (system)

