---
title: Dogfood testing hardening — report delivery, content, cost honesty
date: 2026-07-12
topic: dogfood-testing-hardening
needs_design: true
status: draft
---

# Brainstorm: Dogfood testing hardening

**Date:** 2026-07-12  
**Command:** `/sp:dev-brainstorm` (discovery + ideation)  
**Surfaces:** `plugins/sp/commands/dev-dogfood.md`, `plugins/sp/skills/dogfood-testing/`

## Overview

`sp:dogfood-testing` (backed by `/sp:dev-dogfood`) is the measurement loop for slash commands and skills: Plan → Execute+fix → Monitor → Report. It has already improved via skill extraction (task 0125), report-contract enforcement (0182/0184), and cache-conservation guidance (0139). Remaining foundation gaps are operational, not conceptual:

1. **Report delivery is best-effort.** The ledger is working memory; the six-section report and summary footer are prompt-enforced. If Phase 4 is skipped, context is truncated, or the session dies, the operator gets no report — even when the testee run finished.
2. **Report quality still drifts.** Historical artifacts range from contract-excellent (e.g. 0196 refine runs) to non-conforming / retrospective-shaped (e.g. 0181 banner, 2026-07-09 system-events retrospective).
3. **Token cost is an admitted estimate.** `monitor-ledger.md` uses `ceil(chars/4)` rounded to 100; the skill itself says it cannot read a token meter. `ccusage` is daily aggregate only (task 0139). Numbers are useful as trends only when the agent is honest — and often are not.

This brainstorm locks a delivery-first hardening path with honest multi-source cost labeling and minimal structural report upgrades. It is **orthogonal** to `docs/plans/2026-07-09-p3-mandatory-dogfood-design.md` (feature-level gate requiring a dogfood artifact to exist); that design *consumes* reliable reports — this work makes those reports exist.

## Decision Tree (Phase 1 — locked)

### Root: Primary outcome
- **Resolved:** Always emit a report (delivery reliability first)
- **Rationale:** Fixes the “test finished, no report” failure mode; content and cost ride on top

### Branch: Delivery mechanism
- **Resolved:** Always write a live run file (incremental)
- **Rationale:** Mid-run death must leave partial evidence, not nothing

### Branch: Partial / abort semantics
- **Resolved:** Partial-OK with explicit `status: running | aborted | complete`
- **Rationale:** Never invent narrative for unfinished sections; never lose ledger rows

### Branch: Token / cost accuracy
- **Resolved:** Honest multi-source with confidence labels (not full per-step instrumentation this pass)
- **Rationale:** Kill vibes-based precision without building observability infra as a blocker

### Branch: Report content scope
- **Resolved:** Minimal structural upgrades (frontmatter, Cost block, Repro line, abort markers)
- **Rationale:** Improve parseability without rewriting the six-section contract consumers already use

### Branch: Artifact locations
- **Resolved:** Always write **both** live file **and** `docs/dogfood/…` (promote on finalize/abort)
- **Rationale:** Operators already look in `docs/dogfood/`; live file is durability mid-run; `--save` becomes redundant path-print / no-op
- **Note:** Live path should still prefer existing gitignored run layout (e.g. `.spur/run/dogfood/<run-id>.md`) so incremental writes are not lost if `docs/dogfood` promote fails mid-flight

### Branch: Enforcement style
- **Resolved:** Hard terminal checklist in the skill (finalize-or-abort before stop); structural `rg` for consumers
- **Rationale:** No new runtime driver this pass; prompt-only wording historically insufficient (0182/0184)

## Approaches

### Approach 1: Protocol hardening in skill + template ⭐ Recommended

**Description:** Keep dogfood as a skill-driven protocol (no new runner process). Teach Phase 1 to open a live run file and a skeleton under `docs/dogfood/`, Phase 2/3 to append ledger rows to disk as steps resolve, and Phase 4 as a **non-skippable terminal gate**: set `status`, finalize six sections (or mark incomplete), always promote/update `docs/dogfood/…`, always print the summary footer with paths. Upgrade report template with YAML frontmatter, a Cost block (method + confidence + optional meters), and a Repro line. Token rows stay estimate-based for trends; aggregates gain multi-source labels when meters exist.

**Decision trace:** Satisfies all locked branches (delivery-first, live file, partial-OK, multi-source cost, minimal content, always both paths, terminal checklist).

**Trade-offs:**
- **Pros:**
  - Surgical surface: `SKILL.md`, `report-template.md`, `monitor-ledger.md`, thin command flag doc — no app/CLI packages
  - Aligns with 0125 extraction (protocol lives in skill) and 0184 structural-check pattern
  - Partial files fix the real failure mode (Phase 4 never reached)
  - Cost honesty without blocking on telemetry product work
- **Cons:**
  - Still agent-cooperative: a misbehaving session can skip the checklist (mitigated by loud MUST + consumer `rg` gates, not eliminated)
  - Always writing `docs/dogfood/` increases local file noise (already gitignored — acceptable)
  - Token accuracy improves honesty/labeling, not true per-step metering

**Implementation notes:**
1. **Phase 1 — open artifacts**
   - Generate `run_id` (uuid or timestamp-slug)
   - Write live file: `.spur/run/dogfood/<run_id>.md` with frontmatter (`status: running`, testee, mode, timestamps, paths)
   - Write skeleton `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md` with same frontmatter + empty ledger table
2. **Phase 2/3 — live append**
   - On each step resolve, append/update the ledger row in **both** files (or live first, docs copy on a short cadence / every N steps — document one rule)
   - Anti-fiction: if estimate basis missing → cached `~0` + Basis note
3. **Phase 4 — terminal checklist (non-skippable)**
   - Before skill may stop (success, partial, or abort):
     1. Set `status: complete | aborted`
     2. Ensure six headings exist; unfinished narrative sections use `⚠ incomplete — not reached` (no fiction)
     3. Write Cost block (see below)
     4. Sync final content to `docs/dogfood/…`
     5. Print summary footer with `[Live: …]` and `[Report: …]` always
4. **Cost block (multi-source)**
   - Always: ledger-derived `~estimate` total/cached/cache% + method line (`chars/4 heuristic`, confidence: LOW|MEDIUM)
   - Optional when available: `ccusage` session/daily delta (label confidence MEDIUM, scope: day/session not per-step); any agent usage fields if present in tool results; mark `n/a` when absent
   - Never print an unsubstantiated precise integer as if metered
5. **Command surface**
   - `--save` → default-on behavior / deprecated no-op that still documents the path (keep flag for back-compat)
   - Document always-on report paths in `dev-dogfood.md`
6. **Consumer gates**
   - Keep super-coder terminal `rg` for Monitor Ledger + footer; add optional `status:` frontmatter check
7. **Out of scope this approach:** per-step instrumentation in `spur agent run`, helper scripts, mandatory-feature dogfood (P3 design)

**Confidence:** HIGH  
**Sources:**
- `plugins/sp/skills/dogfood-testing/SKILL.md` (phases, gotchas) | **Verified:** 2026-07-12
- `plugins/sp/skills/dogfood-testing/references/{report-template,monitor-ledger}.md` | **Verified:** 2026-07-12
- Task 0184 (report contract enforcement) | **Verified:** 2026-07-12
- Task 0139 (ccusage aggregate-only; estimate honesty) | **Verified:** 2026-07-12
- `.gitignore` `/.spur/run` + `docs/dogfood` local convention | **Verified:** 2026-07-12

---

### Approach 2: Scripted ledger I/O + skill protocol

**Description:** Same delivery contract as Approach 1, but mechanical file ops live in small Bun helpers under `plugins/sp/skills/dogfood-testing/scripts/` (`open-run`, `append-row`, `finalize`). The skill shells out so ledger writes and promote-to-`docs/dogfood` are deterministic JSON→markdown transforms. Cost block can pull `ccusage` via the same script path used by `daily-summary`.

**Decision trace:** Meets delivery + dual-path + partial-OK + multi-source cost; enforcement is hybrid (script + checklist). Content still minimal upgrades.

**Trade-offs:**
- **Pros:**
  - Less free-form markdown editing by the model for ledger math (aggregates recomputed by code)
  - Easier unit tests for cache% formula and frontmatter status transitions
  - Clearer recovery: `finalize --aborted` can be re-run after a crash if live JSON state exists
- **Cons:**
  - New code surface in the plugin (tests, packaging, platform notes for non-Bun agents)
  - Agent can still forget to call the script — reliability improves for *format*, not for *invocation*
  - Slightly higher coupling than pure-protocol docs

**Implementation notes:**
- Store live state as `.spur/run/dogfood/<run_id>.json` + render markdown on append/finalize
- Skill protocol becomes: call script at phase boundaries; never hand-edit the ledger table
- `--task` sink still skill-owned (spur CLI)

**Confidence:** MEDIUM  
**Sources:**
- Existing plugin script pattern (`daily-summary/scripts/daily-summary.ts` + ccusage) | **Verified:** 2026-07-12
- Approach 1 protocol needs | **Verified:** 2026-07-12

---

### Approach 3: Out-of-band dogfood driver (runtime guarantee)

**Description:** Introduce a real driver (CLI verb or workflow) that owns the dogfood loop: spawns the testee, records steps, writes reports regardless of agent cooperation. The skill becomes documentation + thin UX; the report is a side effect of the runner. Token usage can be captured from subprocess/agent streams.

**Decision trace:** Strongest “always get a report,” but exceeds locked enforcement style (terminal checklist, not full driver) and enlarges scope beyond skill/template.

**Trade-offs:**
- **Pros:**
  - True delivery guarantee (process exits only after finalize)
  - Path to real per-step telemetry if agent stdout exposes usage
  - Cleaner CI/automation story
- **Cons:**
  - Product-sized: CLI/app packages, workflow wiring, agent spawn contracts
  - Overkill for the locked “skill checklist” decision
  - Does not ship in a small hardening pass; delays the reliability fix

**Implementation notes:**
- Would likely need ADR + feature track; interacts with `spur agent run` and workflow engine
- Defer unless Approach 1/2 still lose reports after 2–3 dogfood-of-dogfood cycles

**Confidence:** MEDIUM (architecture clear; wrong altitude for this pass)  
**Sources:**
- ADR-014 CLI dispatch, workflow run persistence under `.spur/run` | **Verified:** 2026-07-12 (layout)
- Operator lock: hard terminal checklist, not full driver | **Verified:** 2026-07-12

## Recommendations

**Ship Approach 1** for this pass.

It matches every locked discovery decision: delivery-first, live file + always `docs/dogfood`, partial-OK status, multi-source cost labels, minimal report structure, skill-level terminal checklist without a new runtime. It reuses patterns already proven (0125 skill home, 0184 structural markers, 0139 honesty about meters).

**When to consider Approach 2:** If after Approach 1 lands, agents still corrupt ledger math or skip dual-write — add scripts as a second slice (not a rewrite).

**When to consider Approach 3:** If dogfood must run unattended in CI with zero agent cooperation, or if product wants metered cost as a first-class CLI feature — separate feature/ADR.

**`needs_design: true`** — touches protocol contract, artifact paths under `.spur/run` and `docs/dogfood`, flag semantics for `--save`, and possibly super-coder consumer checks. Not a single-module one-liner.

## Design Summary

| Element | Choice |
|--------|--------|
| Goal | Every dogfood run leaves a report (complete or explicitly partial/aborted) |
| Live artifact | `.spur/run/dogfood/<run_id>.md` (append ledger live) |
| Operator artifact | Always also `docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md` |
| Partial policy | `status: running\|aborted\|complete`; incomplete sections marked, never invented |
| Terminal gate | Phase 4 finalize-or-abort checklist before skill stop; print footer + both paths |
| Cost | Ledger `~estimate` + method/confidence; optional ccusage/agent usage when present |
| Report content | Keep 6 sections; add frontmatter, Cost block, Repro; no full redesign |
| Enforcement | Skill MUST checklist + existing consumer `rg`; no new runner this pass |
| Out of scope | Per-step hard telemetry product, mandatory-feature dogfood gate (P3 design), full report redesign |

## Comprehensive review notes (issues found during discovery)

| ID | Severity | Issue | Suggested direction |
|----|----------|--------|---------------------|
| D1 | P1 | Report exists only in chat unless `--save`; mid-run death loses all | Live file + always promote (Approach 1) |
| D2 | P1 | Phase 4 is not a hard terminal gate; agent can stop after Execute | finalize-or-abort checklist |
| D3 | P2 | Ledger is “working memory” — contradicts “single source of truth” if not on disk | Disk ledger is SSOT; report assembles from file |
| D4 | P2 | Token estimates often vibes despite anti-fiction rule | Cost block + confidence; optional meters |
| D5 | P2 | `--save` optional confuses “did we get a report?” | Always write `docs/dogfood`; deprecate `--save` as required |
| D6 | P3 | Report template has no frontmatter/run-id — hard to correlate runs | YAML frontmatter |
| D7 | P3 | Cache-health P3 findings often `[unverifiable]` | Keep trend role; label confidence LOW for absolute cost |
| D8 | P3 | Thin command is fine; fat protocol must stay in skill — but command must document always-on paths | Update `dev-dogfood.md` args table |
| D9 | P3 | Stale command snapshot gotcha (skill gotcha #6) still bites dogfood-of-self | Keep; add report note when testee was edited same session |
| D10 | P4 | Historical non-conforming reports remain; banner pattern from 0184 is good | No mass rewrite; new contract going forward |
| D11 | Info | Orthogonal to mandatory-dogfood-for-feature-done (P3 design) | Coordinate later: that gate needs reliable artifacts |

## Next Steps

1. Operator confirms Approach 1 (or chooses 2/3).
2. Optional: `/sp:dev-plan` or `/sp:dev-brainstorm … --feature` to land a feature + AC, then decompose.
3. Implementation slice order (if Approach 1):
   - (a) Artifact open + live ledger append + status model
   - (b) Terminal finalize-or-abort + always `docs/dogfood` + footer paths
   - (c) Cost block multi-source + confidence
   - (d) Command/`--save` docs + consumer gate tweak
   - (e) Dogfood the dogfood skill itself (`/sp:dev-dogfood` on a small testee) to prove delivery
4. Defer Approach 2 scripts until (e) still shows format drift.
5. Keep P3 mandatory-dogfood design separate; link once reports are reliable.

---

## Spec self-review

- [x] No `TODO` / `TBD` placeholders in Design Summary
- [x] No internal contradiction with locked decision tree
- [x] Scope creep checked (Approach 3 deferred)
- [x] Ambiguity that would force decompose to guess: live dual-write cadence (every step vs batch) — **resolve in implement: every step, both files** unless performance hurts
- [x] `needs_design: true` recorded

**Generated by:** `/sp:dev-brainstorm` → `sp:brainstorm` (dev-brainstorm operation)  
**Research:** codebase-first (skill, templates, tasks 0125/0139/0184, historical reports); no external web claims requiring verification
