# Signal derivation — sync precondition, actionability gate, measured signals

Every signal derives from the corpus as it stands: existing `spur … --json` verbs, `git`, `rg`, and
authority docs. No frontmatter field, schema, or verb is added to support a signal. A signal that
cannot be derived is reported as **unavailable**, never fabricated.

## §0 — Sync-first precondition (step zero)

```bash
spur feature sync --all --dry-run --json
```

Feature `status` is manual bookkeeping and drifts (0493: 24 of 25 rankable features would change
status on sync). Rules:

- If the dry run proposes status changes for any candidate-set feature: the report leads with a
  **"sync first"** block listing the proposals, and all downstream ranking uses the **post-sync**
  status view (apply the proposals in memory; do not run the mutating sync).
- Urgency signals premised on raw `status` (sunk-work decay, WIP pressure, staleness) are computed
  only against the post-sync view — 0493 rejected all three as standalone signals; post-sync they
  survive only as tie-break texture (see ranking-rubric.md).
- The dry run is captured **exactly once per run**; the captured result is the sole source of the
  post-sync status view for protocol steps 1–4 (gating, roster completion, and signal derivation
  all read the same in-memory capture). This is a prompt-run capture, not a cache/state file: the
  run never issues a second `spur feature sync --all --dry-run --json` call, and no other verb
  reproduces it in this run.

## §1 — Actionability gate (runtime citation, never restated)

**The predicate is SSOT'd in `plugins/sp/skills/next-router/references/routing-table.md` row B3.**
Read that row at execution time; this file intentionally does not copy it. (If the row is ever
renamed, the fallback key is its content: "frontier = open ∧ unblocked".)

Inputs per candidate feature:

```bash
spur task list --feature <id> --json
```

`task list --feature` is **active-folder-only**: it enumerates tasks in the active task folder
(`.spur/config.yaml`) and omits linked tasks archived in the other configured folders. Apply B3 over
that list. **Zero actionable tasks ⇒ gated, not ranked.** Record the gating
reason verbatim for the report's gated list: `all tasks terminal` / `blocked: <task wbs> — <reason>`
/ `no tasks`. A blocked task with no corpus dependency is an **external** block (approval, trigger) —
report it as such; it is not satisfiable by ranking other work first.

**Complete the roster before declaring terminal or empty.** If the active view yields no B3
frontier candidate and the tentative reason is `all tasks terminal` or `no tasks`, the active view
is not authoritative — a frontier task may be archived outside it. Run the fallback once:

1. Consult the §0 capture (the run's single `spur feature sync --all --dry-run --json` result) for
   the feature's row as an **anomaly hint** only: it may flag the feature without naming a WBS. The
   sync reason is never treated as a WBS source — no WBS is ever inferred from sync prose.
2. Scan the whole corpus for linked tasks:
   ```bash
   rg -l '^feature_id: "?<id>"?$' docs/tasks*/
   ```
   Corpus ids are `[A-Z][0-9]+`-shaped, so `<id>` is regex-safe as-is; escape metacharacters if a
   non-conforming id ever appears.
3. Parse the leading WBS from each matched basename; resolve every corpus-only WBS (not present in
   the active list) with `spur task show <wbs> --json`.
4. Union the active-list records with the resolved corpus records, deduplicate by WBS, and reapply
   runtime B3 to the complete set.
5. Record the gating reason from the complete roster. If the union exposes a blocked task that the
   active view omitted, the classification is `blocked: <task wbs> — <reason>` — never `all tasks
   terminal` — with the blocker text taken from the resolved task body, not from sync prose.

## §2 — The four surviving signals

0493 measured eight candidate signals over this corpus; exactly four discriminate. Derivation
commands (per candidate feature `<id>`):

| Signal | Derivation | Notes |
| --- | --- | --- |
| **AC coverage** (readiness proxy) | `spur feature show <id> --json` → count `Scenario:` in the frozen response's `.content` (the JSON carries the full body as `.content`); `spur feature check <id> --json` for validity findings | 0 scenarios ⇒ "specify next", not "work next" (routes toward B4/B5 territory; see handoff-routing.md) |
| **Churn exposure** (urgency proxy — WSJF cost-of-delay, numerator only) | `git rev-list --count --since="<40 days ago>" HEAD -- <dirs the feature's scope touches>` | 40d window is 0493's measured default; tune on dogfood. Scope = the paths named in the feature's Goal/Scope |
| **Dogfood proximity** (compound leverage) | `rg -c 'plugins/sp | apps/cli | task-pipeline | sp:' docs/features/<id>_*.md` + child task bodies | Degenerate-high in this harness (everything touches itself); discriminates mainly at **zero** — a 0-hit feature is "specify, don't ship" |
| **Authority pull** (declared intent) | `rg -n '\b<id>\b' docs/02_ROADMAP.md docs/00_ADR.md` | Presence is positive evidence; absence is not negative |

**Freeze each candidate input once.** Per candidate `<id>`, capture at most one
`spur feature show <id> --json` and at most one `spur feature check <id> --json`; reuse those
captures wherever the four-signal pass needs feature metadata, body, or AC validity. Count
`Scenario:` in the frozen show response's `.content` — the body is carried as `.content`, so no
`.filePath` re-read is required (read the file only when the response does not carry the corpus text
needed). No signal re-invokes a frozen capture. Churn, dogfood, and authority pull continue using
their own prescribed `git`/`rg` derivations above — they do not derive from the feature show/check
captures.

**Degenerate-spread rule.** After deriving a signal across the candidate set, check its spread. One
dominant value (as `priority` was at 76% P2) ⇒ the signal does not discriminate on this frontier:
report it as **rejected with its measured spread** for this run, and proceed without it. A rejected
signal with its spread is a result, not an omission — it stops the next run re-testing it.

**Rejected signals (0493, do not revive without new corpus evidence):** unblocking fan-out (1 genuine
cross-root dependency edge in 495 tasks — graph too sparse), sunk-work decay / WIP pressure /
staleness as standalone urgency (all artifacts of status drift; post-sync texture only).

## §3 — What each signal reads (for the defect pass)

The proposal contract keys defects to the tree property a signal reads: AC coverage → feature body;
churn → git scope; dogfood → body text; authority → roadmap/ADR mentions; the gate → child-task set.
A malformation of one of those properties that moves a rank is a candidate defect (D1–D4,
proposal-contract.md). A malformation with no corrupting path to a surviving signal is noise — do
not emit it.
