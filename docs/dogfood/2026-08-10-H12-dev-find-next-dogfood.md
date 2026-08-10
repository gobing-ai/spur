---
run_id: 2026-08-10-H12-dev-find-next
status: done
testee: "/sp:dev-find-next (skill sp:next-feature, shipped by task 0497)"
classification: slash-command
mode: report
max_retry: 0
testee_agent: omitted (inline)
started_at: 2026-08-10T04:40:00Z
finished_at: 2026-08-10T04:45:00Z
protocol: sp:dogfood-testing@1.2 (abbreviated — read-only testee, no fix loop)
---

## Dogfood Report — `/sp:dev-find-next` (feature H12, task 0497)

### 1. Testee

- **Command:** `/sp:dev-find-next` → `Skill(skill="sp:next-feature")`, executed inline, report reading (OQ1 deferred).
- **Purpose:** prove the shipped protocol runs end-to-end over the live corpus and produces an
  evidence-carrying answer — including when that answer changed since the research spike.

### 2. Execution Summary

- **Result:** PASS — all six protocol steps executed; the report reproduced 0493's measured shape
  and correctly absorbed two corpus changes since the spike (H12's tasks completing; new task 0496
  appearing under H1 mid-session).
- **Fix attempts:** 0 (read-only testee).

### 3. Protocol walk (each step, with the command run)

**Step 0 — sync-first precondition.** `spur feature sync --all --dry-run --json` → **26 proposals**.
Report leads with "sync first": 24 of the 25-feature frontier would advance (22 to `done`,
H1/G3 territory shifts), group roots F/H included.

**Step 1 — candidate set.** Post-sync non-terminal features: `A, B, C, E, G` (group-tagged
containers — excluded, defect D1), leaving **G3 (blocked), H1 (active), K (backlog)**.

**Step 2 — actionability gate** (B3 read at runtime from routing-table.md:83):

| Feature | Tasks (`spur task list --feature <id> --json`) | Gate |
| --- | --- | --- |
| H1 | 0496 todo, deps `[]` | **PASSES** — open + unblocked |
| G3 | none in CLI corpus (0197 lives in legacy `docs/tasks2/`, invisible to the CLI) | GATED — no open tasks |
| K | none (container; K1 done) | GATED — no open tasks |

**Step 3 — signals** (surviving four, derived for the gate survivor): H1 — AC coverage **70
scenarios** (richest in corpus); churn **343 commits/40d** on `packages/app` + `plugins/sp` (highest);
dogfood proximity high by construction; authority pull **absent** (no `H1` mention in
`docs/02_ROADMAP.md` / `docs/00_ADR.md` — noted as evidence, not disqualifier).

**Step 4 — tiered ranking:**

| rank | feature | tier | evidence |
| --- | --- | --- | --- |
| 1 | H1 — Batch execution & pipeline orchestration | T1 work-now | gate passed (0496 todo, no deps); 70 AC scenarios; 343 commits/40d churn |

Gated list: G3 (no open tasks — external design approval outstanding on 0197), K (container, no own
work; near-duplicate candidate of F8 — see proposals).

**Step 5 — defect pass (D1–D4):**

- **D1** — 5 containers (A/B/C/E/G) correctly excluded from the candidate set. Rule working.
- **D2** — K ⊕ F8 near-duplicate: **low-confidence candidate** (K's Scope documents the split as
  intentional, `docs/features/K_features-module-spur-board.md:26`). Not auto-proposed — correct per
  the evidence bar.
- **D3** — K has child K1, no `group` tag: live instance, reported.
- **D4** — recycled K: map records `K → J1` applied 2026-07-28; live K created 2026-07-29. Detector
  must resolve against live IDs. Reported as a detector rule, not a proposal row.

**Step 6 — report + handoff:** ranked table + gated list + proposals printed; handoff line
`/sp:dev-next H1`; no mutation attempted anywhere.

### 4. Findings about the testee

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | minor | G3's gate reason is "no open tasks" because 0197 lives in legacy `docs/tasks2/`, outside the CLI task corpus — the gate answer is right (G3 is not workable) but the *reason* loses the external-block nuance 0493 reported. | Accepted for v1; corpus-folder scoping is a CLI property, not a skill defect. Noted in signal-derivation §1 as a caveat candidate for the next revision. |
| F2 | advisory | The ranked answer changed within one session (0496 appeared) — the protocol correctly recomputes per run, confirming the no-cache decision. | None needed. |

### 5. Verdict

The shipped command+skill produce the correct, evidence-carrying answer over the live tree:
**H1 is the frontier** (one actionable task 0496), G3/K gated with reasons, defects reported to
contract, nothing mutated. The protocol's empty-frontier honesty case (0493) and its non-empty case
(this run) are both exercised. PASS.
