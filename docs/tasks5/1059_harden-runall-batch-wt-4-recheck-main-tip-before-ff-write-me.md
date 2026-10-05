---
schema_version: 1
name: "Harden runall batch WT-4: recheck main tip before FF, write merged marker only after ref move"
status: done
template: feature-impl
created_at: 2026-10-02T23:30:10.890Z
updated_at: "2026-10-05T18:22:32.265Z"
feature_id: D63

priority: P2
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1059-verdict.json
---

## 1059. Harden runall batch WT-4: recheck main tip before FF, write merged marker only after ref move

### Background

**Origin:** D62 runall session (2026-10-02), dogfood finding F1 (`docs/dogfood/2026-10-02-D62-workflow-execution-economy-runall-dogfood.md`, local-only per `.gitignore:189`; summary duplicated here because that file is gitignored).

**Historical session report (not independently replayed):** The D62 batch (`sp/runall-d62-1c23`, base `7b2d0476d`, 4 tasks 1053-1056) hit the WT-4 hop while a concurrent session was actively committing to `main`. Six foreign commits landed mid-batch-to-wrap (`562f42256`, `936f53d7d`, `7512794bc`, `9f919a28d`, `c8d183969`, `d5334e9c6` — docs/memory/tasks only). Consequences, in order:

1. **FF impossible twice.** The runbook's FF-only contract (`plugins/sp/skills/spur-dev/references/execution-batch.md`, section "WT-4 — Success path (R4)", subsection "Fast-forward only") mandates: base diverged so FF was impossible → NO rebase/merge-commit/conflict resolution → fall to WT-5 (retain worktree + branch, report divergence). The session instead executed an **operator-authorized deviation**: rebase via a throwaway worktree (`/tmp/sp-d62-final`) with a disjoint-path check (`git diff --name-only` both sides) before each rebase, full gate re-run after the first rebase (`bun install --frozen-lockfile` first — stale deps broke TS2307), targeted typecheck after the second (docs-only) rebase, then FF. The deviation worked but is **outside the written contract**; the closed decision below keeps WT-5 retention and makes divergence reports actionable.
2. **Premature marker flip.** During the first failed FF attempt the worktree marker (`.spur/run/worktree-runall-d62-1c23.json`, WT-3 schema) was flipped to the terminal success state (exact existing spelling in Q&A) before the merge ref moved; it had to be manually reverted to `active` and re-flipped after the verified ref move (`mergeCommit: 92cf0af88`). Marker hygiene rule: the marker reflects **landed merges only**. The runbook ends its create-mode block, after `spur projects remove`, with a marker-update comment (exact state spelling in Q&A) with no guard, no ordering statement, and no verification step, for both create and reuse mode.
3. **Environmental note:** one `git worktree remove` half-failed (link deregistered, directory left behind, "Directory not empty" on retry) requiring manual cleanup — the originally suggested prune/delete recovery is withdrawn; the bounded inspection-only recovery is specified below.

**Excluded (already resolved in-session, do not re-fix):** the batch itself is success state (`92cf0af88`) and wrapped; the marker is correctly in its terminal success state; no code change was made to any driver script — the driver is the inline host-session procedure, so the deliverable here is the runbook contract (+ its contract test), not a bugfix.

**Refine corrections (2026-10-02)**

Any base movement was treated as a halt → movement is compatible with FF when the current base remains an ancestor of the pinned batch tip → test ancestry, not equality with creation baseSha. git fetch was proposed → this is local-ref integration and fetching does not serialize local writers → omit fetch. Ref equality after cleanup was proposed → branch deletion makes that check impossible and later legitimate base commits break equality → capture immutable tip before cleanup and verify it was landed. Failed persistence/cleanup can occur after a successful ref move → report landed-but-retained explicitly, never claim nothing landed. Partial-removal recovery proposed unconditional directory deletion → keep recovery non-destructive and require explicit authorization for recursive removal.

The corrected Requirements, Design and Plan below supersede the historical proposals above; incident narrative is preserved for provenance.

### Requirements

- [x] R1. Harden both WT-4 create/reuse examples with explicit fail-stop control flow, a pinned batch tip and fresh local base-tip/ancestry check immediately before FF. Retain the zero-commit guard. On divergence name both captured tips and divergent commits; retain tree and branch through WT-5.
- [x] R2. Define marker and partial-success ordering in both modes: a failed FF never writes success state; successful FF must establish the pinned tip was landed before marking completion or deleting the branch. Persist-out remains mandatory before teardown; persistence or cleanup failure records landed-but-retained facts without falsifying Git history.
- [x] R3. Keep strict FF-only policy. Document partial worktree-removal recovery using inspection, owned path verification and explicit cleanup authorization; do not automatically fetch, rebase, prune registrations, kill unrelated holders or recursively remove leftover directories.

Out of scope: runtime engine changes, new public APIs, unrelated fixes from 1053–1056, production operations or external publication.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Fresh base ancestry controls FF eligibility (req: R1)
  Given clean, advanced-ancestor and divergent scratch refs
  When both WT-4 modes execute
  Then eligible ancestry can land and divergence halts with tips and commit evidence while retaining the tree

Scenario: AC2 — Marker state reflects observed integration (req: R2)
  Given a failed FF or a successful FF followed by persistence or cleanup failure
  When the scratch executable sequence runs
  Then failed FF never writes success state and partial success reports its landed SHA and retained resources without querying a deleted branch

Scenario: AC3 — Integration policy and recovery stay bounded (req: R3)
  Given the corrected WT-4 and WT-5 runbook
  When contract checks and scratch recovery review run
  Then strict FF-only remains with inspection-only recovery and no automatic rebase or destructive directory cleanup
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-02T23:58:07.614Z

Closed: strict FF-only remains; the historical operator-authorized D62 rebase is an exception, not a new unattended reroute. Closed: no network fetch for local refs. Closed: baseSha is provenance, not a frozen equality lock. Closed: use ancestry and pinned SHA; preserve active on failed FF and retained on partial completion with truthful mergeCommit. Closed: recursive leftover deletion needs explicit operator authorization at recovery time.

#### Q&A entry — 2026-10-02T23:59:13.200Z

Frozen existing marker vocabulary: the success value described above as success state is exactly `status: "merged"`; pre-FF failure initially stays `active`, then follows WT-5 `retained`. Partial completion records `mergeCommit: BATCH_TIP` with `status: "retained"` and truthful report text. This is a clarification of existing fields, not a new schema or renamed state. The prose label success state refers to that existing value; it is not a literal or a schema change.

### Design

No runtime API or new marker schema. Owners: plugins/sp/skills/spur-dev/references/execution-batch.md WT-4/WT-5 and plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts. Reuse WT-3 marker fields baseRef, baseSha, branch, path, adopted, status and mergeCommit. Freeze local variables BATCH_TIP (rev-parse branch before cleanup) and BASE_TIP (fresh local base ref). Fresh base may differ from baseSha: allow only when git merge-base --is-ancestor BASE_TIP BATCH_TIP succeeds; distinguish command/read errors from ordinary non-ancestry. All examples must explicitly stop on failed checkout, guard, merge, evidence persistence and destructive cleanup. git merge --ff-only remains the actual mutation guard; prechecks do not eliminate concurrent-writer races. After merge, verify BATCH_TIP is an ancestor of current base (and captured merge result contains it); concurrent subsequent base descendants are valid. A removed branch is never queried. Keep marker active on pre-merge failure, then WT-5 retained disposition; only set success state after landed-tip verification and required persistence/terminal handling. If a later step fails, keep retained disposition with mergeCommit identifying the landed tip and a clear halt report; WT-5 wording must distinguish pre-merge failure from landed-but-incomplete cleanup. No stronger transactional/locking guarantee is claimed. Preserve adopted/reuse tree lifetime rules and existing evidence persistence; do not implement residual citation-retention redesign from 1056 here. 1058 owns cwd pinning; reference that protocol rather than duplicating it.

### Plan

1. Write scratch-Git execution cases first: clean FF, advanced-but-ancestor base, divergent base, failed FF, post-FF base advance, injected persist failure and cleanup failure; run create/reuse paths and assert marker/ref/tree disposition. Reuse existing contract test infrastructure; save hashes/tips and JSON in .spur/run/1059-wt4-proof/.
2. Replace WT-4 trailing comments with explicit fail-stop operations and captured tip/ancestry verification in create and reuse modes (R1/R2).
3. Correct WT-5 partial-success report and preserve strict FF-only; add inspection-only partial-removal recovery and authorization boundary (R2/R3).
4. Run execution-batch-contract.test.ts inside plugins/sp, scratch cases and plugin-smoke; run applicable task-local spur-check and task check as done after real evidence. Superskill installation dry-run validates projection; actual shared host installation is not completion evidence required by this task.

### Solution

Change map (HEAD diff on two files; line anchors at time of writing):

- `plugins/sp/skills/spur-dev/references/execution-batch.md:878`
  - :878-1012 — WT-4 create mode rewritten as an explicit fail-stop sequence: pinned marker path; fail-stop `git checkout`; zero-commit guard (`git rev-list --count` -> WT-5); `BATCH_TIP="$(git rev-parse "$BRANCH")"` captured before any cleanup; fresh `BASE_TIP`; rc-distinguished `git merge-base --is-ancestor "$BASE_TIP" "$BATCH_TIP"` immediately before the sole mutation (rc > 1 fails closed, rc = 1 halts naming both tips and both divergent ranges); `git merge --ff-only` failure check naming the surviving concurrent-writer race; post-merge landed verify `git merge-base --is-ancestor "$BATCH_TIP" "$LANDED_BASE_TIP"`; `write_marker` helper; persist-out and holder-halt failures record `retained` + `mergeCommit`; existence-guarded `git rev-parse --verify --quiet` before `git branch -D`; success `write_marker merged` written once, last.
  - :1014-1074 — reuse mode gets the identical fail-stop sequence (guard -> captured tips -> ancestry rc check -> FF-only -> landed verify) plus required Step-5 evidence persistence before the success marker; tree/branch still retained; persistence failure records `retained` + `mergeCommit`.
  - :1076 — FF-only policy upgraded: `git merge --ff-only` is the sole mutation; local refs only (no fetch anywhere); a failed FF leaves the marker `active`; the concurrent-writer race survives every precheck.
  - :1089-1098 — auto-decision carve-out justification updated: FF fails closed, branch deletion is post-landing, persisted, existence-guarded; no widening for reuse mode.
  - :1123-1184 — WT-5 split into frozen-vocabulary classes: pre-merge failure (marker stays `active`) vs landed-but-incomplete (`retained` + `mergeCommit` BATCH_TIP; a removed branch is never queried); retention report gains a `Merge state` line; :1186 adds inspection-only partial-removal recovery with owned-path verification and explicit authorization for recursive deletion.
  - :1338 — integrate(t) summary reflects the existence-guarded `git branch -D`.
  - Review hop (F1/F2/F3): `write_marker` (:926 create, :1049 reuse) is read-modify-write — an existing marker keeps its WT-3 fields (`id`, `command`, `selector`, `createdAt`, `adopted`, `adoptedAt`); only `status`/`mergeCommit` change; absent-fallback keeps the 6-field write. `git branch -D` (:1000) is fail-stop — refusal halts via `write_marker retained`; `-D`-over-`-d` rationale stated. WT-5 report sentence is class-conditional: pre-merge keeps "nothing was merged onto the base ref"; landed-but-incomplete states the merge LANDED with mergeCommit/base-ref.

- `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`
  - :313-374 — new spec-pin describe (task 1059): pins BATCH_TIP/BASE_TIP capture, "immediately before the sole mutation", rc-distinguished ancestry, landed verify, frozen marker vocabulary (active/merged/retained + mergeCommit), fail-stop delete with retained marker and `-D` rationale, marker read-modify-write in both blocks, class-conditional WT-5 sentence (unconditional claim absent), inspection-only recovery wording, and `no fetch` with `git fetch` absent.
  - :570-1009 — new executable suite (6 scratch-git cases, real hashes in `.spur/run/1059-wt4-proof/`): canonical `wt4Block` (:637) executes under `sh` and ends in a read-modify-write marker write; cases at :725 (clean FF), :777 (advanced-but-ancestor base merges with stale baseSha preserved), :821 (divergent halt names both tips, tree/branch retained, marker active), :870 (race between ancestry and merge -> `--ff-only` halts, marker active), :911 (post-FF base advance keeps BATCH_TIP an ancestor), :950 (persist failure after landed merge -> `retained` + mergeCommit from the captured variable, exit 1 after the retained marker write, no deleted-branch query). Cases 1 and 6 seed WT-3-like fields (`id`/`command`/`selector`/`createdAt`/`adopted`/`adoptedAt`) onto the active marker and assert they survive the merged and retained rewrites — the read-modify-write proof.

Rationale: the doc prose and the executable cases share one canonical fail-stop WT-4 shape so the contract is checkable rather than aspirational. Key decisions: test ancestry (`--is-ancestor BASE_TIP BATCH_TIP`), not equality with the marker's creation `baseSha` (an advanced-but-ancestor base still FFs; a divergent base halts with evidence); distinguish command/read errors (rc > 1, fail closed) from ordinary non-ancestry (rc = 1); freeze the marker vocabulary (`active` = nothing landed, `merged` = landed + persisted + cleaned, `retained` = landed-but-incomplete with `mergeCommit`); capture BATCH_TIP before cleanup and never query a removed branch; keep partial-removal recovery inspection-only with recursive deletion behind explicit authorization; terminal marker writes preserve prior marker fields (read-modify-write), so cross-command resume metadata survives every terminal transition.

Resolved tension: the chunk brief said "delete branch after marker" (marker first). The canonical `wt4Block`, case 6, and the Q&A "terminal handling" direction all place the single success marker LAST — after landed verification, persistence, and cleanup — so a marker can never precede or outlive its verified integration. Followed the canonical shape: pre-merge failures leave `active`, landed-but-incomplete failures write `retained` + `mergeCommit`, and only full success writes `merged`.

Requirements/AC checkboxes are intentionally untouched; the record stage owns that flip.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both WT-4 modes carry explicit fail-stop flow with pinned tips and fresh ancestry check immediately before FF: create `plugins/sp/skills/spur-dev/references/execution-batch.md:898-933` (`BATCH_TIP`/`BASE_TIP` capture, rc-distinguished `--is-ancestor`, `git merge --ff-only` halt), reuse identical at `plugins/sp/skills/spur-dev/references/execution-batch.md:1024-1047`; divergence names both tips and both ranges `plugins/sp/skills/spur-dev/references/execution-batch.md:926-929`; zero-commit guard retained `plugins/sp/skills/spur-dev/references/execution-batch.md:894-896`; WT-5 retention on divergence `plugins/sp/skills/spur-dev/references/execution-batch.md:1123-1131`. Executable: divergent/failed-FF cases halt with tree+branch retained `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:821-869`, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:870-910`. |
| R2 | MET | Failed FF never writes success state (`plugins/sp/skills/spur-dev/references/execution-batch.md:1076-1081`; executable `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:870-910` asserts `status: active`, no `mergeCommit`); success marker written once, last, after landed verify + persistence + cleanup (`plugins/sp/skills/spur-dev/references/execution-batch.md:999-1001`, reuse `:1066-1069`); landed-tip verify before marking/deleting `plugins/sp/skills/spur-dev/references/execution-batch.md:934-939`; persist-out mandatory before teardown `plugins/sp/skills/spur-dev/references/execution-batch.md:943-955`; persist/cleanup failures record `retained`+`mergeCommit` from captured tip without querying a removed branch (`plugins/sp/skills/spur-dev/references/execution-batch.md:924-925`, WT-5 classes `:1123-1136`; executable `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:950-1008` asserts `retained`, `mergeCommit == batchTip`, exit 1, no deleted-branch query). Marker read-modify-write preserves WT-3 fields in both blocks (`plugins/sp/skills/spur-dev/references/execution-batch.md:926-936`, `:1049-1059`; proven in cases 1/6). |
| R3 | MET | FF-only policy: `git merge --ff-only` is the sole mutation, local refs only, no fetch — `plugins/sp/skills/spur-dev/references/execution-batch.md:1076-1085`; test pins `no fetch` present and `git fetch` absent across the whole spec (`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:354-355`, passing). Partial-removal recovery is inspection-only with owned-path verification and explicit operator authorization for recursive deletion `plugins/sp/skills/spur-dev/references/execution-batch.md:1186-1197`; no automatic rebase/prune/holder-kill pinned in test `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:347-353`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Fresh base ancestry controls FF eligibility (req: R1) | MET | test | Clean FF (case 1), advanced-but-ancestor base merges with stale baseSha preserved (case 2), divergent base halts naming both tips and both `git log` ranges with tree/branch retained, marker `active` (case 3): `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:725-869`, all passing in reproduced run; doc contract `plugins/sp/skills/spur-dev/references/execution-batch.md:920-933`. |
| AC2 — Marker state reflects observed integration (req: R2) | MET | test | Failed FF after race keeps marker `active` with no success write (case 4, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:870-910`); persist failure after landed merge records `retained`+`mergeCommit` from the captured variable, exit 1 after retained write, deleted branch never queried (case 6, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:950-1008`); frozen vocabulary pinned `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:331-341`. |
| AC3 — Integration policy and recovery stay bounded (req: R3) | MET | test | FF-only/no-fetch/recovery pins pass in the reproduced contract run (46 pass / 0 fail, 225 expects); inspection-only recovery wording pinned `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:347-353` and implemented `plugins/sp/skills/spur-dev/references/execution-batch.md:1186-1197`; structural gate `spur task check 1059 --json` → `pass: true`, no findings. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

plugins/sp/skills/spur-dev/references/execution-batch.md:848; create-mode marker comment at :920; reuse comment at :937; FF-only policy at :944; WT-5 report at :985; plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts. D62 run narrative is historical operator-reported evidence, not an executable driver implementation. Current contract suite: 35 batch cases passed during audit.

Audit: HEAD 8467f6f6d; only the main worktree was registered; `task list --status wip --json` returned []; active todo titles reviewed for duplicate ownership. Recheck before delegation. No implementation dependencies. 1058 and 1059 share execution-batch.md: serialize their writes or use isolated worktrees and review integration.

### History

- 2026-10-02T23:41:46.151Z backlog → todo (system)
- 2026-10-03T02:53:00.321Z todo → wip (system)
- 2026-10-03T03:28:57.659Z wip → testing (system)
- 2026-10-03T03:29:11.452Z testing → done (system)

