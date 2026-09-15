---
schema_version: 1
name: Retire the team-scoped ADRs the fleet model replaced
status: done
template: feature-impl
created_at: 2026-09-14T17:39:45.260Z
updated_at: "2026-09-15T01:23:18.157Z"
feature_id: G64

---

## 0854. Retire the team-scoped ADRs the fleet model replaced

### Background

The G6 program replaced team-scoped composition with project-scoped fleets, and the source side is
already consistent with that: the Workspace / Inbox / Teams Board modules were deleted behind
redirects (0849), the `spur team` noun is deprecated with every verb moved to its owning noun (0848),
and the roster is declared in `<projectPath>/.spur/fleet.json` (0835). The ADR corpus was only
partially brought along: ADR-052 is marked superseded by the new ADR-116, but two older decisions
still read as current authority.

- **ADR-042** ("One Inbox Module with Per-Agent Timelines") decided a module and a client-side merge
  that no longer exist: `apps/web/src/modules/inbox/**` including `timeline.ts` and its
  `mergeTimeline` function were deleted by 0849, and the durable message plane is now the Projects
  Conversation tab. Its status line still names only ADR-052 — which is itself superseded — so the
  chain dead-ends one hop short of the authority that replaced it.
- **ADR-086** ("Materialized Agent Instances Are Runtime State, Not Committed Spec Files") is still
  correct in its decision (three-layer taxonomy; instances are runtime rows, not committed specs) but
  its roster framing is stale: point 2 calls `agent.team.<id>.members` the config roster, attributes
  instance rows to `team up`, and closes with the `agent.team.demo` example. The roster is now a
  fleet declaration, materialized by `FleetService.materialize` at `spur serve` start.

Leaving either as-is keeps two contradictory authorities in the tree, which
`docs/99_PROJECT_CONSTITUTION.md`'s "fix authority first, then derived docs" rule forbids — the same
defect 0850 fixed for ADR-052.

### Requirements

- **R1** — Every ADR whose decision died with the team-scoped surface is marked superseded, naming the
  live authority (ADR-116) and keeping the existing chain visible.
- **R2** — Every ADR whose decision survives but whose roster framing does not is amended
  **additively**: a dated amendment block re-points the framing at the fleet, and no historical
  sentence is rewritten.
- **R3** — ADR-116 names every ADR it now supersedes, directly or transitively.
- **R4** — The outcome is machine-checkable: the supersession chain and the amendment are asserted by
  a test, not by prose.
- **R5** — Only the ADRs whose facts changed are touched; no feature receipt, task file, or unrelated
  ADR is edited.

### Acceptance Criteria

```gherkin
Feature: The team-scoped ADRs retire with the surface they decided

  @core
  Scenario: Superseded authority is corrected at its owner
    Given ADR-042 decides an Inbox module that no longer exists
    And ADR-086 frames the roster layer on agent.team and a `team up` materializer
    When the fleet model's replacement authority is applied
    Then ADR-042's status names ADR-116 with its ADR-052 chain still visible
    And ADR-086 carries a dated amendment re-pointing the roster at .spur/fleet.json
    And both decisions' original text is unchanged

  @core
  Scenario: History is preserved
    Given the retired and amended ADRs' decision text
    When the supersession and amendment land
    Then no historical decision or receipt is rewritten
    And the amendment is dated and additive
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-14T17:40:27.112Z

**Q: Why not delete the retired ADRs?** The file's own pattern is additive: a status line records
current authority and the decision text stays as the historical record (ADR-052 did exactly this in
0850; ADR-041 and ADR-078's predecessors before it). Deleting an ADR would erase *why* the older
choice was made, which is the one thing a later reader needs when the fleet model is questioned.

**Q: Why is ADR-086 amended rather than superseded?** Its decision is about where agent instances
live — runtime rows, not committed specs — and that is still true. Only the framing of the roster
layer and its examples moved. Superseding a live decision to fix a stale example would misstate the
corpus.

### Design

**WHAT.** Two dispositions, no retconning:

- **Supersede — ADR-042.** Its decision is dead (the Inbox module, its tabs, and the client-side
  `mergeTimeline` were deleted by 0849). The status line becomes
  `Superseded by ADR-116 (via ADR-052)`: the file's single-hop convention stays readable, the existing
  chain stays visible, and the live authority is named. The body is not touched. The durable message
  plane survives as the Projects Conversation tab, which the amendment line says.
- **Amend — ADR-086.** Its decision is intact, so the edit is an additive dated amendment (the file's
  own established pattern, e.g. the 2026-08-26 verification correction): point 2's roster layer is
  `<projectPath>/.spur/fleet.json` resolved and materialized by `FleetService` at `spur serve` start;
  `agent.team.<id>.members` still parses but is no longer the roster; the `agent.team.demo` demo
  example is now the fleet shape. The taxonomy and the runtime-state decision are explicitly restated
  as unchanged.

**Invariants.** The compat surface is recorded, not deleted: `packages/config/src/index.ts:658` still
parses `agent.team` (the `misplacedGlobalKeys` path reports the key rather than rejecting it), and
`config/transition-shims.json`'s `team-noun-retired` entry owns the noun's removal condition. The
cutover commit therefore owns the only remaining deletion work, and these ADRs now say so.

**Test intent.** `apps/cli/tests/adr-supersession.test.ts` already asserts ADR-052 → ADR-116. It gains
(a) a chain invariant: ADR-042's status names ADR-116 and preserves the `via ADR-052` hop, with
ADR-042's decision text byte-identical; (b) an amendment assertion: ADR-086 carries the dated
2026-09-14 amendment naming `.spur/fleet.json` and `FleetService`, and still contains its original
three-layer decision sentences.

### Plan

1. Flip ADR-042's status line to `Superseded by ADR-116 (via ADR-052)` and add the one-line amendment
   recording that the module and `timeline.ts` were deleted by 0849 while the message plane moved to
   the Projects Conversation tab. _(R1, R2)_
2. Append the dated amendment block to ADR-086 re-pointing the roster layer at
   `<projectPath>/.spur/fleet.json` + `FleetService.materialize`, restating the taxonomy as unchanged,
   and re-pointing the demo example. _(R2)_
3. Have ADR-116 name ADR-042 in its `Supersedes`/Detail so the superseded set is complete from the
   replacement's own entry. _(R3)_
4. Extend `apps/cli/tests/adr-supersession.test.ts` with the chain invariant and the ADR-086 amendment
   assertion. _(R4)_
5. Gate: `bun run spur-check`, then `spur task check 0854`; record the final diff in the Solution. _(R5)_

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/adr-supersession.test.ts:102` |
| `apps/cli/tests/adr-supersession.test.ts:106` |
| `apps/cli/tests/adr-supersession.test.ts:131` |
| `apps/cli/tests/adr-supersession.test.ts:133` |
| `apps/cli/tests/adr-supersession.test.ts:164` |
| `apps/cli/tests/adr-supersession.test.ts:195` |
| `apps/cli/tests/adr-supersession.test.ts:198` |
| `apps/cli/tests/adr-supersession.test.ts:2` |
| `apps/cli/tests/adr-supersession.test.ts:204` |
| `apps/cli/tests/adr-supersession.test.ts:47` |
| `apps/cli/tests/adr-supersession.test.ts:57` |
| `apps/cli/tests/adr-supersession.test.ts:6` |
| `apps/cli/tests/adr-supersession.test.ts:63` |
| `apps/cli/tests/adr-supersession.test.ts:69` |
| `apps/cli/tests/adr-supersession.test.ts:71` |
| `apps/cli/tests/adr-supersession.test.ts:80` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | ADR-042 superseded at its owner: `docs/00_ADR.md:357` — `Status: Superseded by ADR-116 (via ADR-052) · Date: 2026-08-04` (anchor re-read this run); chain stays visible: `docs/00_ADR.md:506` — ADR-052 `Superseded by ADR-116 … Supersedes: ADR-042` (re-read); carrier-set closure asserted by the adr-supersession suite (only {42, 52} carry the ADR-116 pointer) inside the fresh CLI batch: cd apps/cli && bun test tests/commands/projects.test.ts tests/commands/team-retirement.test.ts tests/adr-supersession.test.ts tests/commands/agent-spec-flag.test.ts tests/commands/agent.test.ts — exit 0, 95 pass / 0 fail / 344 expect (fresh 2026-09-14); the sole other `spur team` mentions are the deprecation record (`docs/00_ADR.md:1169`) and the prohibition (`:1657`) — re-read this run; ADR-057 stays Accepted by design (`docs/00_ADR.md:590`, retained at `:1707` — re-read) |
| R2 | MET | ADR-086 amended additively: dated `Amendment (2026-09-14 · ADR-116 / task 0854)` at `docs/00_ADR.md:1159-1164` re-points Layer 2 at `<projectPath>/.spur/fleet.json`; the live-coupling note at `:1166-1171` (re-read this run); original three-layer decision survives verbatim (`:1133-1157` — re-read); the earlier 2026-08-26 amendment preserved at `:1173-1178` (re-read); additivity proven by `git show a1c647eae --numstat` → 29 added / 2 removed (the two removals are the replaced status lines; fresh this run) |
| R3 | MET | `docs/00_ADR.md:1697` — ADR-116 status line names `Supersedes: ADR-052 (and ADR-042 via it)` (anchor re-read this run); heading at `:1695`; `Retains: ADR-037 / ADR-057 / ADR-022` at `:1707` (re-read); no other ADR is superseded by either (carrier-set closure, test (c2), green in the fresh CLI batch) |
| R4 | MET | `apps/cli/tests/adr-supersession.test.ts` — fresh this run inside the CLI batch (exit 0, 95 pass / 0 fail / 344 expect): (c1) chain invariant, (c2) carrier-set closure + transitive naming, (d) ADR-086 dated-amendment + taxonomy intact, (f) ADR-057 exact-identity pin, (e) diff-additivity guard |
| R5 | MET | Touch discipline verified against the committed record: `git show a1c647eae --name-only` → exactly `apps/cli/tests/adr-supersession.test.ts`, `docs/00_ADR.md`, `docs/design/inter-agent-control-plane.md`, plus the 0854 task file (fresh this run); no `docs/features/**` receipt modified; compat invariants recorded not deleted (`config/transition-shims.json:26` shim intact — re-read; `docs/design/inter-agent-control-plane.md:9` is ADR-057's own Detail-named satellite — re-read) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Superseded authority is corrected at its owner | MET | test | ADR-042 `:357` and ADR-052 `:506` chains terminate at ADR-116 (`:1695`, `:1697`, Retains `:1707`) — anchors re-read this run; adr-supersession guard tests green inside the fresh 95-pass CLI batch |
| Scenario: History is preserved | MET | command | `git show a1c647eae --numstat` → 29 added / 2 removed (replacement status lines only); original decision bodies at `:1133-1157` and the prior amendment at `:1173-1178` survive verbatim (re-read this run); no receipt-class file touched (name-only listing fresh) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0854 (pass 3)

**Scope:** task `docs/tasks4/0854_retire-the-team-scoped-adrs-the-fleet-model-replaced.md` (R1–R5 + both Gherkin scenarios) against the working diff — 3 tracked paths vs `b93fc93e` (`apps/cli/tests/adr-supersession.test.ts` +126/−32, `docs/00_ADR.md` +29/−2, `docs/design/inter-agent-control-plane.md` ±1) plus the untracked task file.
**Dimensions:** functional traceability, correctness, security, efficiency, usability, architecture
**Verdict:** PASS — no P1/P2; R1–R5 and both scenarios MET; the pass-2 P3 is genuinely closed; one narrower sibling of that class (P3, non-blocking) and five P4s are recorded and explicitly acceptable to carry.

**Fresh evidence, captured on this tree.**

- **The ADR is byte-identical to pass 2's reviewed content — confirmed.** `shasum -a 256 docs/00_ADR.md` → `e0a8f3bd24d63afe783883d4e0c2be3d3d5f024ca59968ded05f257209c2b6e5`, i.e. the handoff's `e0a8f3bd` prefix. Corroborated independently of the hash: **every line number pass 2 cited still lands on the same content** — `:357` ADR-042 status, `:362` its amendment, `:506` ADR-052's `**Supersedes:** ADR-042`, `:590` ADR-057's status, `:598` its amendment, `:1159` ADR-086's amendment, `:1697` ADR-116's `**Supersedes:**`, `:1707` its `**Retains:**`. (The file's mtime moved to 11:10:03Z because of the handoff's mutation experiment; content hash unchanged.)
- **Gate digest independently recomputed — matches.** I re-ran the real code path (`computeProofInputFingerprint`, `packages/app/src/workflow/proof-input-fingerprint.ts:369`) with `taskContent` = this task file and `featureContent` = `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md` → **`sha256:2cb0f890973fac6c198527492eca3d7a41a9e58a5e36387ef053aa578adbdc99`**, byte-identical to `.spur/run/0854-test-gate.log`'s trailer. `.spur/run/0854-test-gate.status` = `PASS`; the log reads `8484 pass / 0 fail`, 34678 expect, 476 files, `All 2 rules passed — no violations found`.
- **The digest is Review-insensitive (checked, not assumed).** `extractTaskProofData` folds only `Background/Requirements/Acceptance Criteria/Design/Plan` (`:310-318`); I proved it empirically by recomputing with a task file whose `### Review` body was replaced by dummy text → **same `2cb0f890…`**. So writing this report does not stale the recorded gate evidence, and the evidence post-dates the source edits (log 11:14:24Z > test 11:09:51Z > ADR content 11:10:03Z mtime).
- **Only one source path changed since pass 2 — corroborated.** The tracked set vs `b93fc93e` is exactly pass 2's three paths; the satellite's mtime (10:52:07Z) and the ADR content (hash + line-number cross-check) both predate pass 2's 11:03 evidence, so the only post-pass-2 content edit is the test file.
- `bun test apps/cli/tests/adr-supersession.test.ts` → **7 pass / 0 fail, 69 expect() calls**; the diff is dirty, so `(e)` does not take its vacuous early return (`:162`) — positive controls E/F below prove both of its branches execute.
- **Mutation matrix, six mutations, each restored byte-identically (ADR `e0a8f3bd…`, test `86e0a0b7…`, digest `2cb0f890…` re-verified after restore).** "Pass-2 guard" is a faithful reconstruction from pass 2's own report (all five amended ADRs' HEAD statuses in `allowedRemovals` at its `:180-182`; `(f)` as `toContain('Accepted')` at its `:140`).

| Mutation | Current guard (this tree) | Pass-2 guard (reconstructed) |
|----------|---------------------------|------------------------------|
| A — ADR-057 status → `Superseded by ADR-116` (the handoff's wording) | **2 fail**: `(c2)`, `(f)` | **2 fail**: `(c2)`, `(f)` |
| B — ADR-057 status → ADR-116's status line (Accepted-bearing; pass 2's demonstrated hole) | **1 fail**: `(f)` | **7 pass — hole live** |
| C — ADR-116 status → `Superseded by ADR-052` (its `**Supersedes:**` clause kept) | **7 pass — survives** | — |
| D — ADR-086's amendment line injected verbatim into ADR-043's block (pass 2 #2) | **7 pass — survives** | 7 pass |
| E — ADR-043's status rewritten (removal-branch control) | **2 fail**: `(c2)`, `(e)` | — |
| F — novel line injected into ADR-043 (addition-branch control) | **1 fail**: `(e)` | — |

  **Adjudication of the handoff's mutation claim: reproduced in substance, refuted in attribution.** "Swapping ADR-057's status line to `Superseded by ADR-116` now fails 2 tests" — reproduced exactly (mutations A: `(c2)` and `(f)`). "Before the fix it passed 7/7" — **not true for that mutation**: it failed those same 2 tests under pass 2's guard too (`(c2)` predates this change and `(f)`'s then-looser `toContain('Accepted')` already rejected it). The mutation the fix actually closes is pass 2's demonstrated exemplar — the **Accepted-bearing** swap (B): 7 pass pre-fix → 1 fail now. So the fix is real and effective; only the named witness was wrong.
- **Removal side is now exactly the two lines that moved.** `allowedRemovals` (`:181-189`) intersects the amended set with "current status ≠ HEAD status" → `{ADR-042's HEAD status, ADR-116's HEAD status}` = precisely the diff's 2 removals; every other removal fails (positive control E). The over-broad set of pass 2 #1 is gone.
- **Corpus re-swept fresh, not trusted:** the only `Superseded by` statuses are ADR-013/042/046/052/061/083 (+ ADR-018 `Skipped`), none of which is a team-scoped decision other than 042/052, whose chains now terminate at ADR-116; the only other `spur team` mention in the corpus is a prohibition (`:1657`, ADR-114), and ADR-057 remains `Accepted` by design (`:1707` retains it). R1/R3 hold on the corpus as it stands.
- **R5 file set re-checked:** `git status --porcelain` lists only the 3 deliverable paths + this task file; no `docs/features/**` receipt and no other ADR is modified. Additivity re-derived: `git diff HEAD --numstat -- docs/00_ADR.md` → **29 added / 2 removed**, both removals being `**Status:**` lines (`:357`, `:1697`).

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | **Narrower sibling of the just-closed P3: ADR-116's own liveness is unpinned.** Flipping ADR-116's status to `Superseded by ADR-052` while keeping its `**Supersedes:**` clause leaves **7 pass / 0 fail** (mutation C) — the corpus's head would name a dead authority and no test would object. Inherent to the narrowing: ADR-116's status line legitimately moved (its `(and ADR-042 via it)` parenthetical), so its HEAD status sits in `allowedRemovals` and any replacement inside block 116 clears the addition side. Strictly narrower than pass 2 #1 — it needs a deliberately self-contradictory edit (the file's own `Supersedes:` line would deny it), not metadata drift, and nothing outside this file parses `Supersedes:`/`Superseded by` (grepped) so the full suite cannot catch it either. The corpus is correct; this is guard precision only. One line closes it (`expect(status(116)).toContain('Accepted')` beside `:140`); explicit acceptance is equally defensible, in which case it belongs to 0850's assertion surface rather than 0854's (that ADR is 0850's deliverable and `(a)`/`(b)` are 0850's block). Does not block the verdict. | `apps/cli/tests/adr-supersession.test.ts:67-81`, `:140`; `docs/00_ADR.md:1697` |
| 2 | P4 (advisory) | correctness | The addition side still pins line *content* membership, not *placement*: any line that appears verbatim in an amended block is accepted anywhere in the corpus. Reconfirmed on this tree — injecting ADR-086's amendment line into ADR-043's block (addition only) leaves **7 pass** (mutation D); the control F (novel line) does fail. Requires deliberate verbatim copying. Carried from pass 2 #2. | `apps/cli/tests/adr-supersession.test.ts:196-201` |
| 3 | P4 (advisory) | traceability | Stale derived pointers outside R5's edit set, all reconfirmed: the design doc still labels the G3 boundary `(feature G3 / ADR-052)`; the G4 receipt still reads "Authority: ADR-057 (complements ADR-052…)" and "G3 / ADR-052 owns un-merge"; the G64 receipt row still asserts "ADR-052 remains Accepted today", which `7db3fb9ba` made false. R5 forbids editing feature receipts, so these are recorded, not 0854 defects — but the authority and its one amended satellite now say something the receipts contradict. Carried from pass 2 #3. | `docs/design/inter-agent-control-plane.md:211`; `docs/features/G4_inter-agent-control-plane.md:113`, `:35`; `docs/features/G64_retire-workspace-inbox-teams-and-spur-team.md:261` |
| 4 | P4 (advisory) | consistency | ADR-086's amendments remain out of append-in-date order: the 2026-09-14 block sits above the 2026-08-26 verification correction (the corpus tolerates it — most multi-amendment ADRs are date-monotonic, ADR-047 is not). Reader-path nit; both blocks are visibly dated and address different layers. Carried from pass 2 #4. | `docs/00_ADR.md:1159` vs `:1173` |
| 5 | P4 (advisory) | correctness | `(b)`'s Supersedes assertion is still shape-free: `find((l) => l.includes('**Supersedes:**'))` then `toContain('ADR-052')`, so a bare in-line mention on that line satisfies it. `(c2)` is tight (`includes('**Supersedes:** ADR-052')`, `:109-111`). Cosmetic; the frozen-body checks carry the weight. Carried from pass 2 #5. | `apps/cli/tests/adr-supersession.test.ts:71-72` |
| 6 | P4 (advisory) | traceability | The Solution and Testing sections are still template comments, so Plan step 5's "record the final diff in the Solution" is unfulfilled and the file:line change map plus the gate evidence live only in `.spur/run/0854-*`. `spur task check 0854` passes at `wip`; a later reader of the task file cannot see either. Carried from pass 2's residual-risk list, now given a row and an owner. | `docs/tasks4/0854_retire-the-team-scoped-adrs-the-fleet-model-replaced.md` — Solution, Testing sections |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `docs/00_ADR.md:357` ADR-042 = `Superseded by ADR-116 (via ADR-052)` — live authority first, hop visible and real (`:506` carries `**Supersedes:** ADR-042`); `:506` ADR-052 = `Superseded by ADR-116`. Corpus-wide sweep this pass: the `Superseded by` set is {013, 042, 046, 052, 061, 083} and no other member decides the team-scoped surface; the sole other `spur team` mention is a prohibition (`:1657`); ADR-057 is `retained`, not superseded (`:1707`, amendment `:598-603`). |
| R2 | MET | `git diff HEAD --numstat -- docs/00_ADR.md` → 29 added / 2 removed; both removals are `**Status:**` metadata lines, every added line lands inside blocks 42/57/86/116 (pinned by `(e)`, positively controlled by E/F). Amendments are dated and additive: `:362`, `:598`, `:1159` (all `2026-09-14 · ADR-116 / task 0854`); ADR-086's three-layer decision and its `agent.team.demo` sentence survive verbatim (`:1137`, `:1141`, `:1156-1157`, pinned by `(d)`). |
| R3 | MET | `docs/00_ADR.md:1697` = `**Supersedes:** ADR-052 (and ADR-042 via it)`; closure re-derived: no line anywhere else names ADR-042/052 as superseded, no ADR is superseded *by* either, and no other `Superseded by` chain enters ADR-116 → `{042, 052}` is complete. `(c2)` pins the carrier set to `[42, 52]`. |
| R4 | MET | 7 pass / 0 fail / 69 expect() on this tree; non-vacuity proven by controls E and F (removal and addition branches each fail on a real mutation) rather than asserted. Durability: `(a)`–`(d)` + `(f)` remain the committed-state guard. Residual precision: findings #1 and #2. |
| R5 | MET | Tracked changes are only `docs/00_ADR.md`, its test, and one line of the amended ADR's own satellite (`docs/design/inter-agent-control-plane.md:9`, the file ADR-057's `**Detail:**` names) — that edit follows the constitution's "authority first, derived doc after" order and leaves the doc's historical §9 table (`:211`) untouched. No feature receipt, no unrelated ADR, no foreign task file; the 0850 wrapup-memory paths pass 1 flagged are committed under `b93fc93e` and no longer in this diff. |

##### Scenario verdicts

| Scenario | Status | Evidence type | Evidence |
|----------|--------|---------------|----------|
| Superseded authority is corrected at its owner | MET | command | `docs/00_ADR.md:357` (status names ADR-116, `via ADR-052` kept), `:506` (hop recorded), `:1159-1171` (ADR-086's dated amendment naming `<projectPath>/.spur/fleet.json`, `FleetService.materialize`, and the still-live autostart coupling), bodies unchanged (29/2, both removals metadata; `(d)` green). Mutation E/F prove the "unchanged" half is checked, not asserted. |
| History is preserved | MET | command | `git diff HEAD --numstat` 29 added / 2 removed; ADR-042/057/086/116 decision text substring-pinned against originals by (a)/(c1)/(d)/(f); `git status --porcelain` shows no `docs/features/**` receipt modified; both amendments dated and additive. |

##### Prior pass disposition

Pass 1 reported PASS with three P3s and three P4s; pass 2 (`#### Review Report — 0854 (pass 2)`, superseded by this section) reported PASS with no P1/P2, one P3 and four P4s. Disposition re-verified on **this** tree, never trusted from the handoff summary:

| Source | Finding | Priority then | Status now | Evidence |
|--------|---------|---------------|-----------|----------|
| Pass 1 #1 | Diff guard lost the identity pin on removals — any status line could be rewritten provided the replacement text also appeared in an amended block | P3 (minor) | **RESOLVED** (verified by control E) | Removals are constrained to HEAD-derived status lines (`:170-189`); rewriting a foreign ADR's status (E) fails `(e)` **and** `(c2)`. |
| Pass 1 #2 | ADR-057 still named superseded ADR-052 as its live companion; propagated to the design doc and the G4 receipt | P3 (minor) | **RESOLVED at the ADR and its satellite; receipt residue carried as #3** | `docs/00_ADR.md:598-603` dated amendment (ADR-052 superseded by ADR-116; ADR-057 explicitly retained), historical `**Why.**` untouched; satellite `:9` re-pointed (one line, diff shown); G4 receipt still stale (#3). |
| Pass 1 #3 | ADR-086's compat sentence understated a live coupling | P3 (minor) | **RESOLVED** | `:1166-1171` now states the key is live — it selects autostart members at serve boot, unioned with `SPUR_TEAM_AUTOSTART`, while the fleet schema deliberately carries no autostart field. |
| Pass 2 #1 | Removal pin's *set* was broader than the change (all five amended ADRs' statuses removable; ADR-057's status guarded only by `toContain('Accepted')`) | P3 (minor) | **RESOLVED — the hole is demonstrably closed**; narrow sibling recorded as #1 | `allowedRemovals` now derives only statuses that actually moved (`:181-189`) → exactly the diff's 2 removals. Mutation A reproduces "fails 2 tests" (`(c2)`, `(f)`); mutation B — pass 2's demonstrated 7/7 survivor — now fails `(f)` (6 pass / 1 fail). Claim attribution corrected in the evidence above. |
| Pass 2 #2 | Addition side pins content membership, not placement | P4 (advisory) | **CARRIED** — now #2 | Mutation D: ADR-086's amendment line injected into ADR-043 → 7 pass. |
| Pass 2 #3 | Stale derived claims outside R5's edit set | P4 (advisory) | **CARRIED** — now #3 | All four citations reconfirmed verbatim on this tree. |
| Pass 2 #4 | ADR-086 amendment ordering | P4 (advisory) | **CARRIED** — now #4 | `:1159` above `:1173`. |
| Pass 2 #5 | `(b)`'s shape-free Supersedes assertion | P4 (advisory) | **CARRIED** — now #5 | `:71-72` unchanged; `(c2)` remains the tight one. |
| Pass 1 #4 / #5 / #6 | Amendment ordering; `(b)` relaxation; 0850 wrapup-memory paths in the diff | P4 (advisory) | **#6 RESOLVED (moot)**; the other two are the carried #4/#5 | `git status --porcelain` lists only the 3 deliverable paths + this task file. |
| Pass 2 residual risk | `Solution`/`Testing` unbackfilled; `(e)` transient by construction; legacy roster still wired via `agent.team.*` autostart and `config/transition-shims.json` `team-noun-retired` | — | **Carried** — #6, plus the residuals/owners table below | The transient `(e)` early return (`:162`) is by design — `(a)`–`(d)` + `(f)` are the committed-state guard; controls E/F show it is live while it lasts. |

##### Residuals, owners, and disposition

| Residual | Owner | Disposition |
|----------|-------|-------------|
| #1 ADR-116's own status liveness unasserted | 0854's own closure (one line at `:140`) — or accepted as 0850's assertion surface | Recorded; non-blocking. Acceptable to carry. |
| #2 Addition side pins content, not placement | 0854's own closure | Acceptable to carry — deliberate-copy hazard only. |
| #3 Stale derived pointers (`G4` receipt `:113`/`:35`, design doc `:211`, `G64` feature row `:261`) | **Cutover commit** (ADR-116's retirement step) / doc-evolve surface for the feature rows — **unassigned** for the G4/G64 receipts, since R5 forbids editing them here | Recorded; explicitly not 0854's deliverable. |
| #4 ADR-086 amendment ordering | 0854's own closure (cosmetic) | Acceptable to carry. |
| #5 `(b)` shape-free assertion | 0854's own closure (cosmetic) | Acceptable to carry. |
| #6 `Solution`/`Testing` backfill (Plan step 5) | 0854's own closure — pipeline verify/finalize stage | Acceptable to carry only if the stage that owns them writes them before `done`. |
| Legacy roster still wired: `agent.team.*` selects autostart at serve boot, key accepted via `misplacedGlobalKeys`, noun shim `team-noun-retired` | **Cutover commit** — already recorded in ADR-086's amendment (`:1166-1171`) | Correctly recorded, not deleted. |
| Two duplicate `"wbs":"0850"` rows in `.spur/memory/wrapup-metrics.jsonl:118-119` (committed in `b93fc93e`) | Wrapup tooling | Out of scope for 0854; already committed elsewhere. |

**I consider findings #2–#6 acceptable to carry to closure as recorded**, with the owners above — #2/#4/#5 are guard cosmetics or deliberate-mutation-only, #3 is outside R5's edit set by construction, and #6 is a task-document backfill rather than a tree defect. **Finding #1 is the one open question**: it is P3, it does not block the gate (`blocker`/`major` block; `minor` is recorded), and either disposition — the one-line assertion or explicit acceptance naming it as 0850's surface — is defensible. The run can close on this PASS as-is.

##### Judgment calls

1. **ADR-057's disposition remains right (re-affirmed, not inherited).** Its decision is alive, so R1's supersede branch must not reach it and `Accepted` is correct; what had gone stale was the companion pointer, which is R2's additive-amendment instrument by function (R2's literal wording says "roster framing"). The alternative — leaving a live ADR naming an authority that no longer exists — is the exact defect 0854 exists to remove. All three claims in the amendment check out: ADR-052 is superseded, ADR-057 is retained (`:1707`), and both planes survive as the Projects Conversation tab (0841) and the member terminal (0842).
2. **`(f)`'s exact-identity pin is the right instrument, and it is not over-tight.** It asserts one metadata line, which is precisely what a supersession moves; ADR-057's `Accepted` status is R1's evidence that a retained ADR was not swept up. Mutation A shows the cost is only that a legitimate future change to that line must also update the test — which is R4's intent.
3. **The narrowing does not make `(e)` vacuous or self-defeating.** Controls E (removal) and F (addition) both fail on real mutations introduced this pass, so the guard is live in both directions; its only tolerance is for legitimate content inside the amended blocks, which is the window finding #2 describes.
4. **`(and ADR-042 via it)` carries no tooling risk, re-confirmed.** Fresh grep: no source file, rule (`recommended-post-check` = coverage-gate + tsdoc-exports), script or test other than this test file reads `Supersedes:`/`Superseded by`, so the parenthetical is consumed only by humans and prefix-substring assertions. Keeping the live authority first with the hop parenthesized is the precedent future transitive retirements should copy.
5. **The gate evidence and the tree are consistent, and my write keeps them consistent.** The digest is keyed on the spec sections, not on `### Review` (proved by recomputation), so the recorded `2cb0f890…` still names this tree after this report lands.

##### Residual risk

- **`(e)` is transient by construction** (`:162`): once this commits, the durable guard is `(a)`–`(d)` + `(f)`. That is 0850's recorded acceptance, inherited deliberately — stated so the early return is later mistaken for drift.
- **The head of the chain is asserted loosely** (#1): after commit, a contradictory edit to ADR-116's own status would pass the suite.
- **Task-document completeness** (#6) is the one item that can silently ship: `wip` checks pass, and the change map + gate evidence remain only under `.spur/run/0854-*`.

**Next:** close the run on this PASS with #2–#6 accepted and #3 owned by the cutover commit; optionally add the one-line ADR-116 liveness assertion (`:140`) if a third remediation pass is cheap, otherwise record #1 as accepted on 0850's surface.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-14T17:42:17.661Z backlog → wip (system)
- 2026-09-14T21:40:56.204Z wip → testing (system)
- 2026-09-14T21:41:32.656Z testing → done (system)

