---
schema_version: 1
name: Deprecated freeze guards in task link, checks, derivation and advance
status: done
template: feature-impl
created_at: 2026-10-12T05:21:53.039Z
updated_at: "2026-10-13T03:21:24.168Z"
feature_id: F42
priority: P1
tags:
  - feature-lifecycle
  - app

dependencies: ["1179"]
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1180-verdict.json
---

## 1180. Deprecated freeze guards in task link, checks, derivation and advance

### Background

Implements: R3 — New work cannot be linked to a deprecated feature; R4 — Checks flag live work under a deprecated feature and advise on edits; R5 — Derivation and routing never pull a deprecated feature back into active work.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surfaces S5–S12, S14 and the next-feature skill (S15). Depends on 1179 (enum + graph).

**Refine corrections (2026-10-11)**
- "Extend guard at create, update and batch-create separately" → all three route through `guardParentFeature` (`packages/app/src/services/task-service.ts:825`); batch-create calls it with `noReopen=true` in phase 1 (`:2052`) → one branch in that function covers every caller.
- "`advance` must be taught to refuse" → `advance` already stops because `forwardPath` (`apps/cli/src/commands/feature.ts:190`) has no `deprecated` key, emitting the generic "cannot reach … along the forward path" → only the un-deprecate hint is new.
- "`refresh` must not change status" → `refresh` is docs-only by contract (`apps/cli/src/commands/feature.ts:337`, "Does NOT change feature frontmatter status") → no change; R5 covers sync and `check --fix` only.
- "`check --fix` reopen" → the reopen repair targets only verifying/done (`docs/design/planning-record-contracts.md:110`) → no change needed; asserted in tests.
- "Section-write warning in the CLI" → `FeatureService.updateSection` (`packages/app/src/services/feature-service.ts:256`) already returns `warnings[]` and is shared by CLI and server → add the warning there, not in the CLI.
- Plugin scripts `plugins/sp/scripts/batch-preflight.ts:144,258` and `wrapup-steps.ts` read task statuses / `verifying` only → audited, no change.

### Requirements

- [x] R1. `guardParentFeature` throws `ParentFeatureStatusError` for a `deprecated` parent regardless of `noReopen`, before any write; the message reads `parent-feature-status: feature <id> is deprecated (frozen); new tasks cannot link to it. Run removal work under its own feature, or un-deprecate: spur feature update <id> active`. Covers `task create --feature`, `task update --feature` and `task batch-create` (whole batch rejected, no task file written, no feature reopened).
- [x] R2. `task check` emits warning `L4.feature-deprecated` (new `FINDING_CODES.L4_FEATURE_DEPRECATED` in `packages/config/src/finding-codes.ts`) for a live task (backlog/todo/wip/testing/blocked) under a deprecated feature, with guidance to re-parent (`spur task update <wbs> --feature <otherId>`) or cancel; terminal tasks get no finding; `--strict` elevates per existing policy.
- [x] R3. `FeatureService.updateSection` on a deprecated feature writes the section and appends `Feature <id> is deprecated (frozen); change it only as part of removal` to `warnings[]`; exit code stays 0.
- [x] R4. `deriveFeatureStatus` returns `{from: 'deprecated', to: 'deprecated', reason: 'Feature is deprecated (frozen)'}` before any task-based rule, so `spur feature sync` (incl. `--all`, `--force`) never changes it; `check --fix` leaves it unchanged.
- [x] R5. `spur feature advance <id>` on a deprecated feature exits 1 with `<id> is deprecated; un-deprecate first: spur feature update <id> active` (GUARD_DENIED under `--json`) and makes no transition.
- [x] R6. `plugins/sp/skills/next-feature/SKILL.md:67` drops `deprecated` alongside done/cancelled.
- Out of scope: override flag, Board (1181), docs beyond next-feature (1182).

### Acceptance Criteria

- [x] AC1 — New work cannot be linked to a deprecated feature (req: R1)
- [x] AC2 — Checks flag live work under a deprecated feature and advise on edits (req: R2, R3)
- [x] AC3 — Derivation and routing never pull a deprecated feature back into active work (req: R4, R5, R6)

Verify lens: service tests observe the real guard and derivation (no mocked FeatureService); the E2E transcript observes CLI exit codes and file immutability.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Approach.** Put the freeze in the four existing seams so every transport inherits it: the parent link guard (task-service), the L4 feature-edge block (task-check), derivation (feature-service), and the section-write result (feature-service). `advance` only gains a precise message. Why: each seam is already the single funnel for its behavior (1132/1137), so no caller needs its own check.

**Frozen names.** Finding code `L4.feature-deprecated` / `FINDING_CODES.L4_FEATURE_DEPRECATED`, severity `warning`. Reuse `ParentFeatureStatusError` (status `deprecated`, `activeSiblings` still computed for the message). Messages exactly as in Requirements. No new flag, verb or option; `--no-reopen` is irrelevant for deprecated.

**Algorithm.**
- `guardParentFeature`: check `feature.status === 'deprecated'` before the `verifying` branch; throw with the deprecated message variant (extend the error constructor's message by status).
- `task-check.ts` (~`:1124`): sibling branch to `featureTerminal`; deprecated is not terminal, so the existing error branch never fires for it.
- `deriveFeatureStatus`: early return right after `from` is read, before the "no linked tasks" branch.
- `advance`: if `initial.status === 'deprecated'` → `writeJsonError(..., 'GUARD_DENIED')`, exit 1, before the loop.

**Files.** `packages/app/src/services/task-service.ts:207,825`; `packages/app/src/services/task-check.ts:1124`; `packages/config/src/finding-codes.ts:138`; `packages/app/src/services/feature-service.ts:256,452`; `apps/cli/src/commands/feature.ts:197`; `plugins/sp/skills/next-feature/SKILL.md:67`. Tests beside the existing 1132 guard / task-check / sync / advance tests in `packages/app/tests/services/` and `apps/cli/tests/`.

**Anti-patterns.** Do not make the finding an error (red gates on unrelated work). Do not reopen or auto-transition a deprecated parent. Do not block section writes. Do not special-case deprecated in `refresh`. Do not duplicate the guard in CLI handlers.

**Handoff.** Assumes 1179's enum and graph. Leaves message strings and the finding code for 1182 to document verbatim.

### Plan

- [x] Step 0: 1179 merged (enum includes deprecated); `spur feature update <tmp> deprecated` works.
- [x] Link guard branch + error message variant (R1); tests for create, update `--feature`, batch-create (no files written).
- [x] Finding code + task-check branch (R2); tests for live vs terminal task.
- [x] Section-write warning (R3); test asserts write landed and warning present.
- [x] Derivation early return (R4); tests: sync with live and terminal tasks, `--force`, `check --fix`.
- [x] `advance` refusal (R5); CLI test for human and `--json`.
- [x] next-feature SKILL.md line (R6).
- [x] E2E: temp project via source CLI covering R1–R5; transcript `.spur/run/1180-e2e.txt`.
- [x] `bun run spur-check`.

### Solution

Implemented F42 S5–S15 (minus Board/docs): the `deprecated` freeze is enforced in the four
existing funnels every transport already routes through, plus one precise CLI message.

**Change map**

| Change | file:line |
| --- | --- |
| `L4.feature-deprecated` added to the code union | packages/config/src/finding-codes.ts:46 |
| `FINDING_CODES.L4_FEATURE_DEPRECATED` constant | packages/config/src/finding-codes.ts:143 |
| `ParentFeatureStatusError` deprecated message variant (exact R1 string) | packages/app/src/services/task-service.ts:216 |
| `guardParentFeature` deprecated refusal before the `verifying` branch, regardless of `noReopen` | packages/app/src/services/task-service.ts:847 |
| shared `activeSiblingsOf` sibling helper (reused by terminal + deprecated) | packages/app/src/services/task-service.ts:870 |
| `task-check` live-under-deprecated warning branch (non-terminal, not an error) | packages/app/src/services/task-check.ts:1151 |
| `updateSection` appends the freeze note to `warnings[]`, write still lands | packages/app/src/services/feature-service.ts:276 |
| `deriveFeatureStatus` sticky `deprecated` early return before any task rule | packages/app/src/services/feature-service.ts:468 |
| `advance` early `GUARD_DENIED` refusal with the un-deprecate hint | apps/cli/src/commands/feature.ts:206 |
| next-feature candidate set drops `deprecated` alongside done/cancelled | plugins/sp/skills/next-feature/SKILL.md:67 |

`refresh` and `feature check --fix` are unchanged by design: refresh is docs-only, and the
reopen repair is already gated to `verifying`/`done`. Batch-create inherits R1 via the shared
`guardParentFeature` (phase-1 reject-only pass), so no caller duplicates the check.

**Tests added**

- packages/app/tests/services/task-section-normalizer.test.ts — R1 create (exact message, no
  file written, parent stays deprecated), `--no-reopen` no-bypass, update `--feature`, batch-create;
  R4 `feature check --fix` leaves a deprecated feature frozen and never calls the transition port.
- packages/app/tests/services/task-check.test.ts — R2 live task warns (severity `warning`, no
  `L4.feature-terminal`), terminal task silent.
- packages/app/tests/services/feature-service.test.ts — R3 section write lands + `warnings[]`
  note; R4 derivation sticky for live and terminal tasks, `sync`/`sync --force` applied=false.
- apps/cli/tests/commands/feature.test.ts — R5 human hint and `--json-envelope` `GUARD_DENIED`.

**Targeted evidence**

```
$ (cd packages/app && bun test tests/services/task-section-normalizer.test.ts)
 26 pass, 0 fail
$ (cd packages/app && bun test tests/services/task-check.test.ts -t 1180)
(pass) R2 (1180): a live task under a deprecated feature warns (not errors) and advises re-parenting
(pass) R2 (1180): a terminal task under a deprecated feature gets no finding
 2 pass, 0 fail
$ (cd packages/app && bun test tests/services/feature-service.test.ts)
(pass) FeatureService > feature status sync > R4 (1180): deriveFeatureStatus keeps a deprecated feature deprecated despite a live task
(pass) FeatureService > feature status sync > R4 (1180): deprecated stays sticky for a terminal task too (no reopen, no done proposal)
 62 pass, 0 fail
$ (cd packages/app && bun test tests/services/task-check.test.ts tests/services/task-section-normalizer.test.ts tests/services/feature-service.test.ts)
 292 pass, 0 fail
$ (cd apps/cli && bun test tests/commands/feature.test.ts)
 52 pass, 0 fail
```

**Probe evidence (transcript `.spur/run/1180-e2e.txt`, throwaway root `/tmp/tmp.sIJwODy80O`)**

```
$ task create 'New work' --feature A --skip-ready --json            # A deprecated
exit=1  parent-feature-status: feature A is deprecated (frozen); new tasks cannot link to it. …
task files before=0 after=0 ; status(A)=deprecated
$ task update 0001 --feature A --json
exit=1 (same parent-feature-status error) ; task 0001 still feature_id: B
$ task batch-create --file batch.json --skip-ready --json
exit=1  code=batch-create-failed (ParentFeatureStatusError: … is deprecated (frozen) …)
task files before=1 after=1 ; status(A)=deprecated
$ task check 0001 --json        # live under deprecated B
exit=0  L4.feature-deprecated warning, severity=warning, pass=true
$ task check 0002 --json        # cancelled task under deprecated C
exit=0  findings=[] (no deprecated finding)
$ feature update A --section Notes --from-file note.md --json
exit=0  warnings["Feature A is deprecated (frozen); change it only as part of removal"] ; section landed
$ feature sync A --json ; feature sync --all --force --json
exit=0  proposal {from: deprecated, to: deprecated, reason: 'Feature is deprecated (frozen)'}, applied=false
$ feature advance A --json --json-envelope
exit=1  {"ok":false,"error":{"code":"GUARD_DENIED","message":"A is deprecated; un-deprecate first: spur feature update A active"}}
```

**Changed-path self-check**

```
$ spur rule run --preset recommended-pre-check --fail-on warning --no-logo
All 51 rules passed — no violations found.
$ bun run script-contract-check
script-contract-check: 22 script(s) baselined, 0 violation(s) — PASS
$ (cd packages/app && bun run typecheck) ; (cd packages/config && bun run typecheck) ; (cd apps/cli && bun run typecheck)
0 errors
```

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-service.ts:846` — shared parent guard throws for deprecated before create/update/batch writes; message at line 216. fresh source-CLI scratch E2E in $TMPDIR this run: task create --feature on a deprecated parent exits 1 with code parent-feature-status and the un-deprecate hint. |
| R2 | MET | `packages/app/tests/services/task-check.test.ts:2792` — live task warns, terminal exempt; code registered at `packages/config/src/finding-codes.ts:47` and line 145; emitted at `packages/app/src/services/task-check.ts:1151`. fresh source-CLI scratch E2E in $TMPDIR this run: task check on a live task under a deprecated feature returns L4.feature-deprecated severity warning, pass true. |
| R3 | MET | `packages/app/tests/services/feature-service.test.ts:240` — deprecated section write lands with the freeze warning (`packages/app/src/services/feature-service.ts:276`); app suites 314 pass / 0 fail. |
| R4 | MET | `packages/app/src/services/feature-service.ts:468` — sticky derivation returns reason at line 473 before task rules; test `packages/app/tests/services/feature-service.test.ts:868`. fresh source-CLI scratch E2E in $TMPDIR this run: feature sync on a deprecated feature proposes deprecated → deprecated, applied false. |
| R5 | MET | `apps/cli/src/commands/feature.ts:206` — advance refuses with the hint at line 210. fresh source-CLI scratch E2E in $TMPDIR this run: feature advance exits 1 with the un-deprecate hint and file hash unchanged. The CLI suite `apps/cli/tests/commands/feature.test.ts:402` could not re-run here: its beforeAll git init is blocked by the sandbox (nested .git writes). |
| R6 | MET | `plugins/sp/skills/next-feature/SKILL.md:67` — candidate set drops deprecated alongside done/cancelled; read this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R3 — New work cannot be linked to a deprecated feature | MET | test | `packages/app/tests/services/task-section-normalizer.test.ts:345` — create/update/batch rejection and no-reopen in app suites 314 pass / 0 fail; fresh source-CLI scratch E2E in $TMPDIR this run create refusal exit 1. |
| Scenario: R4 — Checks flag live work under a deprecated feature and advise on edits | MET | test | `packages/app/tests/services/task-check.test.ts:2792` and `packages/app/tests/services/feature-service.test.ts:240` — app suites pass; fresh source-CLI scratch E2E in $TMPDIR this run task check warning observed. |
| Scenario: R5 — Derivation and routing never pull a deprecated feature back into active work | MET | test | `packages/app/tests/services/feature-service.test.ts:868`, `apps/cli/src/commands/feature.ts:206`, `plugins/sp/skills/next-feature/SKILL.md:67` — app suites pass; fresh source-CLI scratch E2E in $TMPDIR this run sync applied false and advance refused exit 1. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1180

**Scope:** task 1180 change set — `packages/config/src/finding-codes.ts`, `packages/app/src/services/{task-service,task-check,feature-service}.ts`, `apps/cli/src/commands/feature.ts`, `plugins/sp/skills/next-feature/SKILL.md`, regenerated `plugins/sp/lib/*.generated.mjs` + `plugins/sp/scripts/quality-gate.mjs`, and their tests. Landed 1179 (enum + lifecycle graph) judged only as 1180's dependency.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | functional | No P1–P3 findings: R1–R6 and AC1–AC3 all traceable to code with `file:line` evidence; freeze is un-bypassable across every transport (create/update/batch-create/server link all funnel through `guardParentFeature`); fresh targeted tests + E2E transcript + fresh twin regeneration all green | `packages/app/src/services/task-service.ts:847`, `task-check.ts:1151`, `feature-service.ts:276,468`, `apps/cli/src/commands/feature.ts:206` | ACCEPTED |
| 2 | P4 (advisory) | correctness | Design doc prose drifts from the frozen R5 message: doc says `Feature <id> is deprecated; run spur feature update <id> active first`, code implements R5's authoritative `<id> is deprecated; un-deprecate first: spur feature update <id> active`. Docs beyond next-feature are 1182's remit | `docs/design/feature-deprecated-status.md:85` | ACCEPTED |
| 3 | P4 (advisory) | usability | The R2 warning keys `taskTerminal` off the *effective* `--as` status, so `task check <wbs> --as done` on a still-live record under a deprecated feature emits no warning. This deliberately mirrors the existing `L4.feature-terminal` branch; normal (no `--as`) checks behave exactly per R2 | `packages/app/src/services/task-check.ts:1147` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `task-service.ts:847` throws `ParentFeatureStatusError` for `deprecated` before the `verifying` branch, regardless of `noReopen`; message variant at `:216` matches R1 verbatim. All three transports call the one funnel: create `:979`, update `:1093`, batch-create `:2076,:2082` (reject-only phase 1); server `link` → `updateField` → same guard. E2E `.spur/run/1180-e2e.txt` shows exit 1 + zero files written on all three. |
| R2 | MET | `finding-codes.ts:46,143` add `L4.feature-deprecated`; `task-check.ts:1151` pushes it as `severity:'warning'` only for non-terminal tasks, sibling to (not overlapping) `L4.feature-terminal`; `--strict` elevates via `planning-check-base.ts:363`. E2E: live task warns pass=true, cancelled task findings=[]. |
| R3 | MET | `feature-service.ts:276` appends the exact freeze note to `warnings[]` while the section write still lands; exit 0 (E2E). |
| R4 | MET | `feature-service.ts:468` early-returns `{from:'deprecated',to:'deprecated',reason:'Feature is deprecated (frozen)'}` before any task rule; `runSyncFeature:672` short-circuits `from===to` so `--force`/`--all` apply nothing; `check --fix` reopen repair stays gated to verifying/done (`feature-check.ts:249`). E2E: `sync`, `sync --all --force` applied=false. |
| R5 | MET | `feature.ts:206` refuses before the loop with `GUARD_DENIED`, exit 1, message `<id> is deprecated; un-deprecate first: spur feature update <id> active`; no transition. E2E + CLI test. |
| R6 | MET | `plugins/sp/skills/next-feature/SKILL.md:67` now drops `done`/`cancelled`/`deprecated`. |

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | R1 tests in `task-section-normalizer.test.ts:345-435` (create exact-message, `--no-reopen` no-bypass, update `--feature`, batch-create) + E2E R1a/R1b/R1c. |
| AC2 | MET | R2 `task-check.test.ts:2792-2826` (warning not error, strict elevation, terminal silence) + R3 `feature-service.test.ts:240`. |
| AC3 | MET | R4 `feature-service.test.ts:868,897` + `task-section-normalizer.test.ts:548` (`check --fix` frozen); R5 `apps/cli/tests/commands/feature.test.ts:402,428`; R6 SKILL.md diff. |

##### Verification evidence (this review)

- `packages/app` 3 files → 292 pass, 0 fail  · `apps/cli` feature.test.ts → 52 pass, 0 fail  · `packages/config` finding-codes → 1 pass.
- `scripts/commands/bundle-plugin-lib.test.ts` → 16 pass; committed `quality-gate`/`idea-handoff`/`inline-run` `.generated.mjs` regenerate byte-identically (md5 unchanged) → twins genuinely match sources.
- `bun run script-contract-check` → 22 scripts, 0 violations. `tsc --noEmit` clean for config/app/cli.

**Next:** Ready to gate; no P1–P3 to disposition. Optional 1182 doc pass to align `feature-deprecated-status.md` with the frozen R5 string.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-12T06:38:34.126Z todo → wip (system)
- 2026-10-12T07:12:15.984Z wip → testing (system)
- 2026-10-12T07:12:28.435Z testing → done (system)

