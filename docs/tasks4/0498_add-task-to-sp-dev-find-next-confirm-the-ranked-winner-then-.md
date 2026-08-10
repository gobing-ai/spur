---
template: feature-impl
schema_version: 1
name: "Add --task to /sp:dev-find-next — confirm the ranked winner, then dispatch the planning half to implement-ready tasks"
description: ""
status: done
type: task
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T05:32:15.299Z"
updated_at: "2026-08-10T05:49:59.284Z"
---

## 0498. Add --task to /sp:dev-find-next — confirm the ranked winner, then dispatch the planning half to implement-ready tasks

### Background
**Type:** implement · **Map:** H12 · **Resolves:** OQ1 (dispatch vs report)

Task 0497 shipped `/sp:dev-find-next` **report-only** and recorded OQ1 as an open operator question:
does the command chain into a follow-on action on the winner, or stop at the ranked report?
`plugins/sp/skills/next-feature/references/handoff-routing.md:27-35` reserves the extension point and
explicitly forbids hand-rolling it.

The operator has now ruled: **dispatch**, but toward the *planning* half rather than `/sp:dev-next`.
The useful answer to "which feature should we work on now?" is not only a name — it is a set of
implement-ready tasks under that feature.

Two facts make this a composition problem, not a build problem:

- `/sp:dev-plan --feature <id>` already owns decomposition → `spur task batch-create` (atomic,
  `task-batch.schema.json`-gated). A second decomposer inside `sp:next-feature` would duplicate
  `sp:spec-decomposition` and bypass that gate — a direct violation of the CLI-gated-corpus-writes
  non-negotiable.
- `/sp:dev-refineall --feature <id> --auto --depth ready` is already the repo's named mechanism for
  "implement-ready" (`dev-operations.md` §5a; the implement-ready checklist at §5).

The rubric also already carries the routing key. `ranking-rubric.md:13` defines **T3 — specify
first** as "most valuable to *specify*, not to start", and `:49-52` makes "decompose T3 candidates"
one of three honest actions on an empty frontier. `--task` automates that existing recommendation.
### Requirements
- R1 — `/sp:dev-find-next --task` extends the shipped report: after the ranked frontier is printed, the command confirms one target feature with the operator (default offer = rank 1; the operator may pick another candidate or decline), then acts on the confirmed target. Without `--task` the command's behaviour is byte-for-byte unchanged.
- R2 — Compose, never rebuild. `sp:next-feature` runs no decomposition of its own and invokes neither `spur task create` nor `spur task batch-create`. Task creation happens only via `/sp:dev-plan --feature <id>`; implement-ready freeze only via `/sp:dev-refineall --feature <id> --auto --depth ready`.
- R3 — Routing is keyed to the tier the rubric already assigned, with no new classification logic: T3 with valid AC and zero tasks → plan then refineall; T3 with placeholder/invalid AC → stop and print the next-router B4 hop without inventing idea text; T1 (already has open tasks) → refineall only, never a second decomposition; T2 → refuse and name the blocker; T4 → refuse and route to wrap/sync.
- R4 — No path exists from `--task` to a created or mutated task file without an explicit operator confirmation. The confirmation pauses regardless of `--auto` (Auto-Decision Principle #5 — taste); `--auto` propagates only into the dispatched child commands, never into the confirm.
- R5 — The defect-half honesty contract narrows precisely rather than being deleted: the skill still performs no `spur feature move` and writes nothing under `docs/features/**`; the command's blanket "read-only with respect to the corpus and docs" claim is restated as read-only *unless* `--task` is passed, naming the dispatched surfaces as the sole mutation path.
- R6 — Contract surfaces agree mechanically: `flag-glossary.md`'s `--task` entry lists `dev-find-next` as a declaring command (the C1 gate in `plugins/sp/scripts/validate-flag-contracts.ts` compares that list against command argument-hints), `docs/04_DESIGN.md` §1.3.2 records the flag in the same commit (T3), and the `plugins/sp` contract suite stays green.
### Acceptance Criteria
```gherkin
Feature: 0498 --task on dev-find-next

  Scenario: R1 — the flag extends the report with a confirmed target
    Given the operator runs /sp:dev-find-next --task
    When the ranked frontier has been printed
    Then the command offers the rank-1 candidate as the default target
    And the operator may confirm it, name another candidate, or decline
    And running /sp:dev-find-next without --task produces the unchanged report

  Scenario: R2 — task creation composes existing surfaces
    Given the shipped skill's --task protocol step
    When it is inspected for corpus writes
    Then it invokes neither spur task create nor spur task batch-create
    And it contains no decomposition procedure of its own
    And task creation is delegated to /sp:dev-plan --feature <id>
    And implement-ready freeze is delegated to /sp:dev-refineall --feature <id> --auto --depth ready

  Scenario: R3 — routing keys off the already-assigned tier
    Given a confirmed target that the rubric placed in a tier
    When --task acts on it
    Then a T3 target with valid AC and zero tasks is dispatched to dev-plan then refineall
    And a T3 target with placeholder or invalid AC stops with the next-router B4 hop printed
    And a T1 target is dispatched to refineall only, with no second decomposition
    And a T2 target is refused with its blocker named
    And a T4 target is refused and routed to wrap/sync

  Scenario: R4 — confirmation cannot be waived
    Given /sp:dev-find-next --task --auto
    When the command reaches the confirmation
    Then it still pauses for an explicit operator decision
    And --auto is forwarded only to the dispatched child commands

  Scenario: R5 — the honesty contract narrows, it is not deleted
    Given the shipped command and skill after this change
    When their mutation claims are read
    Then the skill still performs no spur feature move
    And it still writes nothing under docs/features/**
    And the read-only claim is scoped to runs without --task, naming the dispatched surfaces

  Scenario: R6 — the contract surfaces agree
    Given --task is added to the dev-find-next argument-hint
    When the sp contract gates run
    Then flag-glossary.md lists dev-find-next as a declaring command for --task
    And validate-flag-contracts reports no C1 violation
    And docs/04_DESIGN.md section 1.3.2 records the flag in the same commit
    And the plugins/sp test suite passes
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**WHAT** — One new flag on an existing prompt-first surface. No TypeScript, no new spur verb, no
schema change (H12 substrate decision holds). Edits to five markdown files plus two test constants.

**WHY this shape** — `--task` is a *router*, not a builder. Everything it needs already exists and is
already gated; the only thing missing is the confirmed hop between "which feature" and "which tasks".

**KEY DECISIONS**

- **Dispatch target is the planning half, not `/sp:dev-next`.** `handoff-routing.md:34` deferred OQ1's
  dispatch reading toward next-router. The operator's ruling redirects it: the valuable follow-on to
  "which feature" is decomposition, not within-target step routing. `/sp:dev-next <id>` stays the
  printed hint for operators who want the report-only behaviour.
- **Tier-keyed routing, zero new classification.** Steps 1–5 already place every candidate in exactly
  one tier (`ranking-rubric.md:9-17`). `--task` is a lookup on that tier, so a change to the rubric
  cannot desynchronise the routing.
- **Confirm is unconditional.** Auto-Decision Principle #5: choosing what to invest in is a taste
  decision, and `ranking-rubric.md:5` already states "the operator overrides". `--auto` forwards to
  the children (`dev-plan --auto`, `refineall --auto`) but never answers the confirm.
- **T1 → refineall, never a second decompose.** A T1 feature passed the B3 gate, so it has open
  unblocked tasks by construction. Decomposing again manufactures duplicates.
- **Optional value is a feature id.** `--task [<feature-id>]` mirrors `dev-brainstorm`'s existing
  optional-value shape; supplying an id skips the confirm's default-offer step but not the confirm.

**FROZEN NAMES** — flag `--task` (optional value `<feature-id>`); protocol step **7** in `SKILL.md`;
handoff-routing section heading `## --task — confirmed dispatch into the planning half` replacing
`## OQ1 — conditional dispatch (deferred, not implemented)`; glossary anchor `#flag-task` unchanged.

**ANTI-PATTERNS — do not implement these**

- A decomposition procedure, task-shaping heuristic, or `spur task create` call inside `sp:next-feature`.
- A `--yes` / `--force` escape on the confirm, or letting `--auto` imply it.
- Re-deriving the tier at step 7 instead of reading the placement from step 4.
- Deleting the "propose, never apply" or "no corpus mutation" claims outright — they remain true of
  the defect half and must be scoped, not removed.
- Adding `--task` to the argument-hint without updating the glossary's declaring-command list (C1).

**WHERE**

| File | Change |
| --- | --- |
| `plugins/sp/commands/dev-find-next.md` | frontmatter `argument-hint`; flag table row; usage block; scope the read-only claim |
| `plugins/sp/skills/next-feature/SKILL.md` | protocol step 7; one anti-pattern; references-table row |
| `plugins/sp/skills/next-feature/references/handoff-routing.md` | replace the OQ1-deferred section with the shipped tier→hop routing table and the confirm contract |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md` | add `dev-find-next` to the `--task` entry's declaring commands |
| `docs/04_DESIGN.md` §1.3.2 | record the flag (T3 same-commit) |
| `plugins/sp/tests/*` | flag-parity / command-contract constants if the counts move |
### Plan
- [x] Rewrite the OQ1 section of `handoff-routing.md` as the shipped `--task` contract: tier→hop table, confirm rules, dispatched-command argv (R1, R3, R4)
- [x] Add protocol step 7 and the "never decompose here" anti-pattern to `next-feature/SKILL.md` (R2, R3)
- [x] Add the flag to `dev-find-next.md` — argument-hint, flag table, usage — and scope the read-only claim to runs without `--task` (R1, R5)
- [x] List `dev-find-next` as a declaring command on the `--task` entry in `flag-glossary.md` (R6)
- [x] Record the flag in `docs/04_DESIGN.md` §1.3.2, same commit (R6)
- [x] Run `bun run apps/cli/src/index.ts` contract gates: validate-flag-contracts (C1 clean) and the `plugins/sp` suite; update count constants only if the suite demands it (R6)
- [x] Verify: confirm no `spur task create` / `batch-create` / decomposition text entered the skill; write Solution + Testing and the verdict artifact (R2)
### Solution
**Shipped 2026-08-10** — one flag, six markdown files, no TypeScript. `--task` is a router: it adds
a confirmed hop between "which feature" and "which tasks" and delegates every write.

| File | Change |
| --- | --- |
| `plugins/sp/skills/next-feature/references/handoff-routing.md:27` | The OQ1-deferred section replaced by the shipped contract — compose-never-rebuild owners table (`:42-43`) naming `/sp:dev-plan` and `/sp:dev-refineall --depth ready`, the five-row tier→hop routing table (`:55-59`), the unconditional-confirm table (`:65-68`), and a "what `--task` does not change" clause. Outputs table gained the dispatch row (`:85`). |
| `plugins/sp/skills/next-feature/SKILL.md:90` | Protocol **step 7** — offer rank 1 (or `--task <id>`), explicit confirm, route on the tier step 4 already assigned. Step 6 (`:87`) scoped to "Without `--task`". |
| `plugins/sp/skills/next-feature/SKILL.md:105` | Anti-pattern: no decomposition / `spur task create` / `batch-create` here; no `--auto`-implied confirm; never decompose a T1 feature. |
| `plugins/sp/skills/next-feature/SKILL.md:40` | "Propose, never apply" narrowed rather than deleted — still no `spur feature move`, still nothing under `docs/features/**`; `--task` named as the sole, confirm-gated exception writing `docs/tasks*/` through the children's gates. |
| `plugins/sp/commands/dev-find-next.md` | `argument-hint` (`:3`), flag-table row (`:21`, default `omitted`), usage lines (`:32-33`), and a `--task` behavior paragraph; the blanket read-only claim scoped to runs without `--task`. |
| `plugins/sp/skills/spur-dev/references/flag-glossary.md:196` | `--task` entry rewritten as a **flag family** (`:201`) — see the pre-existing defect below. |
| `docs/04_DESIGN.md:599` | §1.3.2 heading now cites tasks 0497, 0498; signature gained `[--task [<feature-id>]]`; behavior step (7) at `:626` records the routing, the confirm rule, and the OQ1 resolution (T3 same commit). |

**Pre-existing defect found and fixed (not in the original scope).** The C1 flag-contract gate
failed on the first suite run with `glossary declaring-commands list for --task omits dev-debug,
dev-dogfood`. Cause: `dev-debug` and `dev-dogfood` have always declared `--task` in their
argument-hints, but the glossary entry mentioned only `dev-brainstorm`, in prose the extractor could
not parse — so the gate had no list to compare against and stayed silent. Adding a parseable bullet
list exposed the gap. The entry is now a **flag family** covering all four declaring commands and
their three distinct semantics: `dev-brainstorm [<feature-id>]` *creates* a task, `dev-find-next
[<feature-id>]` *dispatches* the planning half, `dev-debug [<wbs>]` *attaches* findings to an
existing task, `dev-dogfood` (no value) *records* outcomes. The `#flag-task` anchor and the entry
heading are unchanged, so no inbound link moved.

**Deviations from Design:** none. Frozen names held (`--task`, protocol step 7, the replaced section
heading). The design did not anticipate the C1 pre-existing gap; fixing it was required to make the
gate pass and is reported here rather than folded silently into the diff.
### Testing
**Forced re-audit — `/sp:dev-verify 0498 --auto --next --force --focus all --fix all`, 2026-08-10.**
This pass **executed** the shipped protocol against the live corpus rather than reading it, and
found two defects that the original inline verification missed. Both were repaired in the fix pass;
both are recorded below rather than folded silently into the diff.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `plugins/sp/commands/dev-find-next.md:3` argument-hint, `:21` flag row (default `omitted`), `:32-33` usage; `plugins/sp/skills/next-feature/SKILL.md:87` scopes step 6 to "Without `--task`" |
| R2 | MET | `rg 'spur task create\|spur task batch-create'` over skill + command → 5 hits, **all prohibition/owner-attribution prose, zero invocations**; `plugins/sp/skills/next-feature/references/handoff-routing.md:44-45` names `/sp:dev-plan` + `/sp:dev-refineall` as the owners |
| R3 | MET *(after fix)* | `plugins/sp/skills/next-feature/references/handoff-routing.md:62-66` tier rows; **`:53` added this pass** — see Defect 2. Executed: B3 gate over 32 live features → T1={H1} (task 0496 open+unblocked), 31 gated; T3-reachable set = **18 candidates** (was 0 pre-fix) |
| R4 | PARTIAL | `plugins/sp/skills/next-feature/references/handoff-routing.md:71-75` confirm table, `:75` "no `--yes` / `--force` bypass" — **static evidence only.** The interactive pause was not executed; firing a real prompt inside a verify run would be a spurious interruption. Residual, see Review P2. |
| R5 | MET | `plugins/sp/skills/next-feature/SKILL.md:40` still "performs no `spur feature move` and writes nothing under `docs/features/**`"; `:104` anti-pattern intact; command read-only claim scoped, not deleted |
| R6 | MET *(after fix)* | See Defect 1. `plugins/sp/skills/spur-dev/references/flag-glossary.md:200` now carries the declaring set in a first-paragraph parenthetical; C1 **proven live** by probe + negative control below |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — command answers which feature, not which step | MET | static | `plugins/sp/commands/dev-find-next.md:3`, `:21`, `:32-33` re-read this run |
| R2 — task creation composes existing surfaces | MET | command | `rg` over shipped surface → zero `spur task create` / `batch-create` invocations |
| R3 — unactionable features gated, not ranked | MET | command | executed B3 gate on live corpus: 1 ranked (H1), 31 gated with reasons; T1 routes to refineall-only |
| R4 — confirmation cannot be waived | PARTIAL | static | contract text in 3 places, no escape hatch; **interactive pause unexecuted** |
| R5 — honesty contract narrows, not deleted | MET | static | `plugins/sp/skills/next-feature/SKILL.md:40`, `:104` re-read this run |
| R6 — contract surfaces agree | MET | command | `validate-flag-contracts` → "All 66 contract surfaces agree"; **plus** live-coverage probe (below) |

**Defect 1 — the original R6 evidence was invalid (my own fix had disabled the gate).**
The first inline verification cited `validate-flag-contracts` reporting "All 66 contract surfaces
agree" as proof C1 was satisfied for `--task`. It was not. `glossaryDeclaringClaims`
(`plugins/sp/scripts/validate-flag-contracts.ts:130-142`) registers a flag **only** when its
first paragraph carries a parenthetical with ≥2 backticked `dev-*` names (`:139`). The bullet-list
rewrite moved those names out of the parenthetical, so C1 stopped registering `--task` altogether —
the green meant *the gate stopped looking*, not that the surfaces agreed. Repaired at
`plugins/sp/skills/spur-dev/references/flag-glossary.md:200` by restoring the parenthetical
enumeration while keeping the per-command semantics. **Now proven live, not assumed:**

- baseline on the real tree → **0 violations**
- probe (inject a bogus `dev-zzprobe` declarer) → **caught**: "omits dev-zzprobe that declared it"
- negative control (drop `dev-dogfood` from the list) → **caught**: "omits dev-dogfood that declared it"

**Defect 2 — the primary `--task` case was unreachable.** Executing the protocol showed step 2's B3
gate excludes zero-task features from the frontier, while the T3 row calls "valid AC, zero tasks"
**the primary case** — so that row could never fire. `ranking-rubric.md` already tiers gated
features (T2 = "fails the gate"; T4 = gate reason "all tasks terminal"), so the rubric was right and
the routing wording was wrong. Repaired at
`plugins/sp/skills/next-feature/references/handoff-routing.md:53` and
`plugins/sp/skills/next-feature/SKILL.md:91`: T1 comes from the ranked frontier, T2/T3/T4 from the
gated list. Measured effect on this tree: T3-reachable candidates **0 → 18**.

**Executed protocol evidence (live corpus, read-only — nothing written):**

| Step | Command | Result |
| --- | --- | --- |
| 0 sync-first | `spur feature sync --all --dry-run --json` | 25 proposals would change status → report leads "sync first" |
| 1 candidate set | `spur feature list --json` | 32 non-terminal features |
| 2 B3 gate | child-task open+unblocked walk | **1 ranked (H1, via task 0496)**, 31 gated |
| 3-4 tier | rubric placement | H1 = T1 → routes to refineall only, **not** decompose (R3's T1 row exercised) |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | Correctness | `plugins/sp/scripts/validate-flag-contracts.ts:139` | The `≥2 names in a first-paragraph parenthetical` rule means an entry written in prose silently disables C1 for that flag. Measured: **14 of 30 multi-declarer flags currently have C1 off** — `--agent`(21 declarers), `--auto`(14), `--json`(8), `--feature`(8), `--next`(6), `--focus`(6), `--mode`(5), `--depth`(3), `--since`(3), `--dry-run`(6), `--full`, `--until`, `--wrap`, and `--task` until this pass. Pre-existing and out of 0498's scope — reported, not fixed. |
| P2 | Correctness | `plugins/sp/skills/next-feature/references/handoff-routing.md` | The interactive confirm (R4/AC-4) remains unexecuted; no run has driven `--task` through a real pause and dispatch. |
| P4 | Architecture | `plugins/sp/scripts/validate-flag-contracts.ts:733` | C1 considers only `dev-*` command files, so `rule-*` / `workflow-*` / `spur-init` declarations are invisible to it (e.g. `--force` on `spur-init`, `--scope` on `rule-refine`). Likely intentional scoping; noted for the record. |

`spur task check 0498` → pass, 0 findings (run this pass, not stale). `plugins/sp` suite → 642 pass,
0 fail. Coverage: N/A (prompt-first markdown surface; no runtime code path added).
### Review
| Priority | Severity | File | Finding | Recommendation |
|---|---|---|---|---|
| P2 | major | `plugins/sp/skills/next-feature/references/handoff-routing.md` | The `--task` routing is specified but **unexecuted** — no live run has driven a confirm through `/sp:dev-plan` + `/sp:dev-refineall`. Same class as 0497's shipped-but-undogfooded finding, and on this tree the primary T3 path is hard to exercise: 0493 measured the post-sync actionable frontier as empty. | Dogfood `/sp:dev-find-next --task` once a real T3 candidate exists (or against a deliberately-seeded one). Until then the tier→hop table is a contract, not evidence. |
| P3 | minor | `plugins/sp/skills/spur-dev/references/flag-glossary.md` | `--task` is now documented as a family with three distinct semantics (create / dispatch / attach / record) under one anchor. That is honest but unusual — most glossary entries describe one behavior. A future reader may take one bullet as the flag's whole meaning. | Acceptable while the family has four members. If a fifth semantic appears, split the entry per-command rather than growing the list. |
| P4 | advisory | `plugins/sp/commands/dev-find-next.md` | The command's mutation posture is now conditional ("read-only unless `--task`"), stated in three places (command doc, SKILL.md, 04_DESIGN). Three copies of a conditional claim drift more easily than three copies of an absolute one. | The C1/C4 gates cover flag claims but not prose posture. If it drifts, promote the posture sentence to one surface and link it. |
### References

H12

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-10T05:34:06.408Z todo → wip (system)
- 2026-08-10T05:39:34.137Z wip → testing (system)
- 2026-08-10T05:39:43.862Z testing → done (system)
