# dev-* Spine Cost + Drift Inventory (feature I6 / task 0594)

> Measurement + inventory only. No source code changed by this task. The fix path
> graduates into features — this document does not decide them.
>
> **CLI provenance:** all live-CLI assertions and cost measurement used the source-local
> binary `apps/cli/src/index.ts` (importer `@gobing-ai/ts-llm-jsonl-importer@0.4.38`), never
> the stale `spur` on PATH. Import run recorded `binary=apps/cli/src/index.ts`.

---

## Executive summary

The `/sp:dev-*` spine is **not** the token-weight the operator premise assumed. The 33 entry
points are thin (1,622 lines total); the weight lives in the shared `sp:spur-dev` reference set
(4,602 lines across 16 files) loaded behind each entry point. **Measured** over real history since
feature I3 closed (2026-08-15): 198 sessions / 1,390 `/sp:dev-*` messages spent **310.2K fresh
input tokens** against **26,680.5K cache-read tokens** — a **98.85 % prefix-cache-hit ratio**. The
bootstrap is real but it is **served from cache** across repeated invocations, not re-paid per
call. The one measurable cache-miss concentration is **cold subagent launches**.

Drift: I2/I3's existence-check parity (is this verb/flag real?) largely **held** — every
`feature`/`agent`/`workflow` verb the plugin asserts still exists live and vice versa. The drift
that survived is **semantic-class**: a valid flag applied to the wrong operand. Exactly one live
instance confirmed (`sp:wayfinder` `--section tags`), zero siblings. Re-drift rate: **0 / 7
surface rows** (I3's 7 unverified items remain unverified, none surfaced to mismatch; I2/I3's
verb/flag inventories all still resolve).

---

## R1 — Cost attribution

### Method

Cost is measured from recorded sessions, not file arithmetic. Substrate: `spur history import
--mode full` (source-local), then direct SQL over the `history_message` ETL for `content_text
LIKE '%/sp:dev-%'`. The `.spur/context/token-ledger.jsonl` was also read but carries only
per-tool-call write metadata (no per-file prompt injection), so it cannot attribute cost to
individual file loads — the history `input_tokens` / `cache_read_tokens` columns are the
measurement.

### Measured result (history, since feature I3 closed 2026-08-15)

| Metric | Value |
| --- | --- |
| Sessions invoking `/sp:dev-*` | **198** |
| Messages invoking `/sp:dev-*` | **1,390** |
| Fresh input tokens | **310.2 K** |
| Cache-read tokens | **26,680.5 K** |
| Output tokens | **182.4 K** |
| **Prefix-cache-hit ratio** | **98.85 %** |

Per-session cold-start: the first `/sp:dev-*` message of a session averages **~0.4 K fresh** input
(many are continuations mid-session); the large host batches of 2026-08-18 show the true flat
~6–8 K bootstrap per new session (each new session pays the entry md + SKILL.md refs once, then
everything else is cache-read).

### Load chain (deterministic structure — context, NOT the measurement)

Per entry point the load order is: **command md → `Skill()` → `SKILL.md` → `references/*.md`**.

| Layer | Path | Lines | Load class |
| --- | --- | --- | --- |
| 0 | `plugins/sp/commands/dev-*.md` (33 files, 32–128 lines each) | 1,622 | entry-specific |
| 1 — spine core | `skills/spur-dev/SKILL.md` + `cross-cutting.md` (709), `dev-operations.md` (549), `flag-glossary.md` (439), `glossary.md` (95) | ~1,792 | **unconditional** spine (loaded for every dev-* command) |
| 1 — spine routing | `execution-batch.md` (799), `execution-workflow.md` (361), `planning-workflow.md` (355), `inline-pipeline-driver.md` (130) | ~1,645 | **on-demand** (per command half) |
| 2 — specialized | `ac-style-guide` (229), `product-planning` (206), `feature-link-helper` (191), `gate-checklists` (175), `done-housekeeping` (164), `idea-evaluation` (80), `decision-brief` (80), `section-batching` (40) | ~1,165 | **on-demand** (per entry point) |
| 3 | dispatched competency skills (`sp:code-implementation`, `sp:code-testing`, `sp:code-verification`, …) | — | on-demand |

**Attribution ceiling:** per-file *token* cost is **not recoverable from current data**. The ETL
records per-message totals (input/cache/output) and per-tool-call metadata, but not which reference
file each prompt injected. Reporting per-file tokens would require the token ledger to record the
injected file list per message (a platform/import change). So: **R1 is measurable in the
aggregate** (above) and **structurally attributable** (load chain), but **not token-attributable
per file** with today's data.

---

## R2 — Prefix-cache breakers (tested, not assumed)

Candidate → status → evidence.

| Candidate | Status | Evidence |
| --- | --- | --- |
| **Cold subagent launches** (`spur agent run` → `sp-super-coder`/`sp-super-reviewer` subprocess) | **CONFIRMED** | Subagent transcripts average **97.15 %** cache ratio vs **98.96 %** host `/sp:dev-*`; short-lived transcripts drop to **85–90 %** (e.g. `041bce88_sp-super-reviewer` 88.4 %, `16e58914_sp-super-coder` 89.7 %, `3944e029…reviewer` 85.1 %). Cold by construction: a subprocess has no prior prefix until its own run accumulates one. |
| `Skill()` ordering variance per invocation | **RULED OUT (common path)** | Dev-* commands have stable `Skill()` chains; the shared prefix is cache-read at 98.85 % across 198 sessions. Reordering would show as falling fresh cost or rising cache misses; neither is present on the aggregate. |
| Varying SessionStart-hook output per session | **UNTESTED** | Not isolated by this DB projection (no per-hook input attribution). Listed, not asserted. |
| Dynamic `<system-reminder>` injection | **UNTESTED** | Same — needs a platform/context-level comparison. Listed, not asserted. |

**Bottom line:** the dominant, evidence-backed cache-cost is **cold subprocess agents**, and only
for the first messages of each launch. The recurring bootstrap that *is* measured (~6–8 K per new
host session) is a one-time cost per session, not per invocation.

---

## R3 — Drift table (`feature` / `agent` / `workflow` only; `task` excluded per F92)

Ground truth = live `--help` + commander source (`apps/cli/src/commands/{feature,agent,workflow}.ts`).
Both directions checked: *asserted-but-absent* and *available-but-unused*.

| # | Noun | Finding | Class | CLI side | Plugin side | Status vs I2/I3 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | feature | `sp:wayfinder` documents `spur feature update <id> --section tags`, but `tags` is **frontmatter**, not a section; live CLI rejects a non-section `--section` and the correct route is `--field tags --value` | **semantic (flag→wrong operand)** | `apps/cli/src/commands/feature.ts` (`--section` validated against closed-world section set; `--field` for frontmatter) | `plugins/sp/skills/wayfinder/SKILL.md:123` | **NEW** — a semantic misuse existence-check parity structurally cannot catch |
| D2 | feature | `spur feature get` alias for `show` shipped post-I3 (0534); plugin facade documents `get` | **parity (verb added)** | `apps/cli/src/commands/feature.ts:47` (`.alias('get')`) | `spur-cli/references/features.md` | OK (both surfaces agree) |
| D3 | agent | role-tier SSOT **moved into `packages/config`** post-I3 (c14dc3be) | **config/reference moved** | `packages/config` (task 0572) | `spur-cli/references/agent.md` | re-aligned (facade refs still name the verbs; ownership moved) |
| D4 | workflow | `clean`/`cancel` split (bulk vs single-run) documented in facade and matches live | **parity (verb set)** | `apps/cli/src/commands/workflow.ts` | `spur-cli/references/workflows/operations.md` | OK |
| D5 | agent | `wait`/`loop` (G4) present in facade + live | **parity (verb set)** | `apps/cli/src/commands/agent.ts` | `spur-cli/references/agent.md` | OK |

**Verified ok** (I2/I3 reconciliation held): agent `list/doctor/run/loop/wait/create/edit/delete`,
feature `create/show/update/advance/list/move/refresh/check/sync`, workflow
`validate/run/continue/clean/cancel/list/trace` all resolve in both directions with zero
asserted-but-absent or available-but-unused findings. The I3-explicit fix at
`plugins/sp/skills/parallel-execution/references/dispatch-surface.md:116` (removed bogus `--stage`
CLI claim) is confirmed still-correct.

---

## R4 — Known discrepancy + sibling sweep

- **Confirmed present:** `sp:wayfinder` `--section tags` (D1, `wayfinder/SKILL.md:123`). The
  correct route (`--field tags --value …`) is documented in task 0473
  (`docs/tasks3/0473…:152,226,288`). The charting-forensics task 0534 is `done` but did **not**
  touch this line, so it remains live.
- **Sibling sweep:** `rg '--section (tags|priority|status|phase|id|parent|name|owner|scope)'` over
  `plugins/` → **one hit only** (`wayfinder/SKILL.md:123`). **No siblings.** The `--section` surface
  is otherwise applied only to genuine section bodies.

---

## R5 — Ranked fix path (S/M/L; recommendation only, operator decides open question 2)

| # | Finding | Size | Expected cost delta | Recommendation |
| --- | --- | --- | --- | --- |
| F1 | Fix `wayfinder/SKILL.md:123` to `--field tags --value wayfinder-map` | **S** | Removes a live failed-write path when users tag a map; corrects a class the parity harness cannot see | Fix now — document-only, no surface change |
| F2 | Teach the parity harness a **semantic layer** (flag-valid-but-wrong-operand), starting with `--section <frontmatter-key>` | **M** | Catches the D1 class and future semantic drift that existence-checks miss (D3's move is the nearest trigger) | Add after F1; it is the enforcement that keeps this audit from re-drifting |
| F3 | Record the **injected file list per message** in the token ledger / ETL so per-file token cost is measurable | **M–L** | Turns R1 from aggregate-only to per-file attribution — directly answers "where exactly does the bootstrap go" | High value, cross-package; file as a separate history-plane feature |
| F4 | (Conditional) reduce cold-subagent bootstrap by reusing a warm prefix or coalescing stage reads | **L** | Bounds the confirmed 97.15 %→98.96 % cache gap in short subprocess launches | Only worth it after F3 quantifies per-file cost; do not speculatively optimize now |

**Open question 2 (relocate `plugins/sp` prose into CLI `--help`/`--json`?) — RECOMMENDATION
(not a decision):** **No, not wholesale.** The measured data shows the spine reference set is
already cache-served at 98.85 % — relocating it into `--help` would not reduce bootstrap tokens and
would couple the help surface to lifecycle prose. Instead, the fix is cheaper and higher-leverage:
**keep the ownership split**, add the semantic-drift layer (F2), and let the facades' `--help`
point at `references/*.md` (already the pattern). Relocating *verb/flag inventories* (as opposed to
prose guidance) out of duplicated catalogs is the only relocation with a clear win — that is
already delegated to the facade ownership split per I2/ADR-054. Operator owns the final call on the
map.

---

## R6 — Delta vs I2/I3 + re-drift rate

**Baseline extracted from closed features:**

- **I2** (`done`, tasks 0512–0519): facade/spine parity suite green; **empty finding set** at
  close. All 8 I2 scenarios satisfied-by-parity.
- **I3** (`done`, task 0539): inventory report `docs/tasks2/0539-inventory.md` — **279 ok ·
  0 mismatch · 7 unverified**. Two confirmed defects repaired (`dispatch-surface --stage`,
  `feature-sync-bounded`/`task-size-precheck` CLI resolution).

**Re-audit result (this task):**

- Of the **7 I3 unverified items**: 0 surfaced to mismatch (still unverified/no contradiction).
- Of the **verb/flag inventories I2/I3 reconciled**: 0 re-drifted — every asserted noun/verb/flag
  still resolves against the live source-local CLI.
- Confirmed drift found: **1 new semantic finding (D1)** — not present in I2/I3's finding set
  because their existence-check method could not see a valid-flag-wrong-operand.

**Re-drift rate = 0 / 7 (0 %)** for the reconciliation surface.
**Why I3's fix did not hold for the one finding that survived:** it was never in I3's *visible*
scope — I3 checked *surface existence* (flag present); D1 is a *semantic* misuse (flag valid,
operand wrong). Mechanism mismatch, not a fix that rotted. F2 is the enforcement that closes the
visible-world boundary.

---

## R7 — Cross-workflow YAML duplication

- The 3 bulk YAMLs: `task-pipeline.yaml` (733), `idea-pipeline.yaml` (732),
  `planning-pipeline.yaml` (249) — 1,714 of the 3,410 tracked YAML lines.
- **Duplication is LOW across the three.** They share the action-kind grammar
  (`kind: shell|agent.run|note|hitl.confirm|file.read.into-var`) — that is the **schema**, not
  literal copy-paste. The task-pipeline-specific blocks — `retry_transient` (defined **3×**),
  `feature-sync-bounded`, `solution-from-diff`, `task-size-precheck`, `requireDiff` — are **absent**
  from `idea-pipeline.yaml` and `planning-pipeline.yaml`.
- The only repeated boilerplate is **self-duplication inside `task-pipeline.yaml`**: the
  `retry_transient` SQLite-lock retry shell block is copy-pasted across its `implement`/`record`/
  `done` steps (3 definitions of the same function).
- **Engine fragment mechanism:** **none exists.** `ts-dual-workflow-engine` exposes state-machine
  schema + extension-module import (`extensions.d.ts`) but no `$fragment`/`include`/yaml-merge for
  shared step blocks. A shared-fragment mechanism would have to be **invented** (new engine
  surface) — not a drift fix, out of scope here; if pursued, size as **L** and under a `D`
  (workflows) feature, not through this inventory ticket.

---

## Verification (Testing)

- **Cost figures trace to a history artifact:** all R1/R2 numbers come from
  `spur history import --mode full` (`apps/cli/src/index.ts`, importer `0.4.38`), read via direct
  SQL over the `history_message` ETL (the analyze JSON artifact at
  `.spur/run/../history` generates a 2.7 MB `/tmp/hist-analyze.json` cross-check). The 198-session /
  1,390-msg / 310.2K-input / 26,680.5K-cache figures are `GROUP BY` aggregates, not line counts.
- **Drift rows carry two sides:** each row above names a CLI `path:line` and a plugin `path:line`.
- **Zero source files modified** — `git status` shows only this design doc + task corpus edits.
  `feature check I6` is unaffected structurally (no corpus layout change).

## Review — risks / open concerns

- **R1 per-file attribution is unmeasurable with current data** (the ledger does not record
  injected file lists). This is reported honestly as the ceiling; aggregate + structural
  attribution is complete.
- R2's two UNTESTED candidates need a platform-level comparison harness; they are not asserted.
- Cold-subprocess cache gap is **small and graded** (97.15 % vs 98.96 %, short runs dipping to
  ~85–90 %) — worth bounding only after F3 quantifies per-file cost.
- Scope guard held: `spur task`, `packages/app/src/services/task-*`, and the section matrix were
  not touched (F92). No source, dependency, schema, or CLI surface change.
