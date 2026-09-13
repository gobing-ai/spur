# G63 batch report — projects board module and global input wiring

- **RUN_ID:** `20260912T205800Z-G63BATCH`
- **Worktree:** `spur-g63-exec`, branch `wayfind/g63-projects-board` (base `bb6313459`) → merged `5505ec777` into `wayfind/project-agent-fleet`
- **Feature:** G63 `projects-board-module-and-global-input-wiring` — advanced to **done**
- **Tasks:** 0840–0845, all **done**, every one with gate rc0, bound proof digest, pipeline provenance link, and PASS verify verdict.

## Per-task outcomes

| WBS | Scope | Review path | Verify |
| --- | --- | --- | --- |
| 0840 | ProjectsShell: header, project-path identity, frozen tab frame | PASS w/ contract-touching P3 → fix hop (F1) | PASS |
| 0841 | ConversationView: per-project durable drafts, explicit reference capture | P3 `parseDraftRecord` routed to 0844 (landed there) | PASS |
| 0842 | AgentsView fleet roster + member detail; WorkView reuses task/feature surfaces | PASS | PASS |
| 0843 | Work-view reference capture | PARTIAL → spec-vs-frozen-constraint amendment (see below), code untouched, no re-gate | PASS (double) |
| 0844 | GlobalAgentBar durable submission + receipt/result states | PARTIAL (P2 polling + P3 doc) → fix hop → double PASS | PASS |
| 0845 | Keyboard/IME a11y, live-region announcements, responsive 390/1440 | PARTIAL (failed browser run) → fix hop (runner repair + CDP degradation) → double PASS | PASS |

**Final counts:** web 912 pass / 0 fail (68 files, ~4.0k expects); server 412 / 0; `tsc --noEmit` rc0 both suites. Browser verification (0845): 18/18 ok at 390 px and 1440 px, Chrome 140.0.7339.16, receipt in `docs/reports/g6-projects-prototype.md`.

## Notable decisions & incidents

1. **0843 spec-vs-spec amendment (R2):** reviewer flagged R2's "feature-half" reference capture as unimplementable without violating frozen R4 (no FeaturesShell seam). Resolution: task doc amended to task-capture-only (R-numbers stable), CLOSED Q&A entry added, code untouched. Fingerprint excludes `docs/tasks*`/`docs/features*`, so the bound digest stayed valid — no re-gate.
2. **0844 fixture cascade:** BoardLayout now mounts the full provider tree (ProjectProvider + ConversationDraftProvider + GlobalAgentBar). Bare-`{}` `/api/project/*` stubs in older fixtures parsed as a truthy fleet without `orchestrator`, crashing render and poisoning the happy-dom reconciler process-wide (172-fail cascade). Repair: full `ProjectFleetSnapshot` fixtures (bound-online orchestrator) across all BoardLayout-mounting tests.
3. **0844 declared deferrals (recorded in task Solution, executed at wrap):** AgentsView silent `!ok`; MemberTerminal fire-and-forget POST; StrategyRuntime heartbeat/resume callers (requests route is read-only); message.send ledger wiring rides 0832 `requestKey` idempotency.
4. **0845 browser-run failure → degradation:** Chrome 140 rejects every `Input.imeSetComposition` parameter shape (5 variants probed). Runner degraded to `Input.insertText` + contract-shaped KeyboardEvents (`isComposing` / `keyCode 229`) — same shape the happy-dom suite dispatches; composition-Enter and post-composition-Enter both proven in real Chrome at both widths. Runner-side bugs also repaired: `/api/team/processes` roster payload shape, Shift+Enter filter, per-width post-count deltas.
5. **Merge:** fleet branch had advanced 3 commits (G64 retire-batch). Auto-merge clean except adjacent learnings-append conflict (resolved keeping both). Post-merge semantic check caught one real skew: `node_modules` ts-db 0.4.62 (method `n`) vs catalog pin `^0.4.65` (`enqueueIdempotent`) — stale install, not a conflict; `bun install` restored parity. Merged tree: web 912/0, server 412/0, tsc rc0.

## Learnings appended (`.spur/context/learnings.md`)

Provider-tree fixture requirements · gate-load spawnSync flake class (one re-run before diagnosing) · verify-answer Evidence Type vocabulary (`test|command|doc|static` compounds only — `browser` drops rows) · record-after-verdict ordering · record's done-walk auto-creates the pipeline provenance link · CDP IME degradation path · DD-09 scenario-insertion convention.

## Follow-ups

- G64 tasks 0849/0850 (dep 0845) are now **unblocked** by this merge.
- Open P4 advisories from 0844 review (non-blocking): `ProjectRequests.requests` keyed by `messageId` doc/impl mismatch; roving tabindex/Home-End accepted-away at 3 tabs (0845).
- 0845 receipt restates untested compatibility surfaces (IME on non-Chrome engines etc.).
