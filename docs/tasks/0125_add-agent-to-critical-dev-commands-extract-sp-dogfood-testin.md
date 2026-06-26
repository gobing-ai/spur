---
template: meta
schema_version: 1
name: "Add --agent to critical dev-* commands + extract sp:dogfood-testing backbone skill"
description: ""
status: done
type: meta
profile: standard
feature_id: F
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-06-26T00:15:16.089Z"
updated_at: 2026-06-26T00:32:23.644Z
---

## 0125. Add --agent to critical dev-* commands + extract sp:dogfood-testing backbone skill

### Background
**Two-stream task.** A gap audit of `--agent` across the `/sp:dev-*` slash commands surfaced an
inconsistency, and addressing it for `dev-dogfood` is the right moment to graduate that command from
its sanctioned fat-file exception into a backbone skill.

## Stream 1 — `--agent` gap on critical commands

`rg -l '\-\-agent' plugins/sp/commands/dev-*.md` shows the flag on `dev-run`, `dev-verify`,
`dev-unit`, `dev-review` but **missing** on four commands the operator deems critical:
`dev-refine`, `dev-brainstorm`, `dev-dogfood`, `dev-plan`. (Non-critical `dev-gitmsg`,
`dev-handover`, `dev-fixall`, `dev-changelog` are accepted as-is — out of scope.)

**The catch — doc-only would be theater.** The four commands that *have* `--agent` get away with
command-only docs because their agent flows through `spur workflow run --vars` (run) or the
`code-verification` pipeline. But the model calls in `sp:spur-dev` and `sp:brainstorm` are **direct
`spur agent run`** invocations, and those calls are currently **bare** — they resolve `auto` and
ignore any forwarded `--agent`. Verified: both skills reference `spur agent run` (4 and 12 refs
respectively) but none thread an `--agent <name>` argument. So the fix has **two layers**: the
command flag/docs **and** a skill-layer instruction to forward `--agent` into those `spur agent run`
calls. Command-only ships a flag that silently does nothing (operator decision: do **both** layers).

## Stream 2 — extract `sp:dogfood-testing`, enhance report + monitor

`dev-dogfood.md` is the lone fat inline `sp:*` command — its own header declares this a "sanctioned,
**temporary** exception" and names the graduation path: "Once stable, the core graduates to an
`sp:dogfood` backbone skill and this file collapses to a thin wrapper." The protocol has now run
across tasks 0109–0114, 0124 — it is stable. Time to extract.

Operator scope for the extraction (taken as the chance to enhance, not a lift-and-shift):

1. **Extract** the 4-phase protocol into a new fat skill **`sp:dogfood-testing`** under
   `plugins/sp/skills/dogfood-testing/` (`SKILL.md` + `references/` satellites, matching the
   `code-verification`/`spur-dev` layout). Collapse `dev-dogfood.md` to a thin `Skill()` wrapper.
2. **Fix `--agent`** for dogfood with **testee-scoped** semantics: `--agent` sets the agent the
   **testee** runs under (forwarded into the testee invocation), not the driver (the driver is always
   the current session). This is distinct from the other three commands' standard semantics and needs
   its own prose so it is not misused.
3. **Report template** — turn the report into a **well-designed, template-backed** artifact rich
   enough that an end user can act on it to fine-tune the testee: stable sections, per-finding
   severity + file:line + recommended action, and a clear PASS/PARTIAL/FAIL rationale. Ship the
   template as a `references/` asset, not inline prose.
4. **Monitor + ledger** — tighten the methodology so the captured signal is **accurate enough to
   drive testee refinement**: precise per-step ledger (attempts, outcome, fix, finding, token/cache
   estimate, wall-clock), honest `~estimate` labeling, and a cache-health rule that flags tuning
   candidates. Make "live ledger, assembled-not-reconstructed" enforceable in the skill text.

**Decisions locked (operator, 2026-06-25):**
- Both layers for Stream 1 (commands **and** skill threading) — no doc-only theater.
- `dev-dogfood` `--agent` = testee-scoped.
- Stream 2 is an extract-**and-enhance**, covering report template + monitor/ledger upgrades.

**Out of scope:** `--agent` on the four non-critical commands; any `app`/`domain`/`cli` TS code;
new CLI verbs; changes to how `spur agent run` itself resolves agents (the resolution already exists
— we only forward the selector).

**Authority refs:** `plugins/sp/commands/dev-verify.md` (the canonical `--agent` block to copy for
Stream 1); `plugins/sp/commands/dev-dogfood.md` header (the sanctioned graduation path);
`plugins/sp/skills/code-verification/` (backbone-skill layout reference).
### Plan
- [ ] **`plugins/sp/commands/dev-refine.md`** — add `--agent <name|inherit|auto>` to argument-hint +
      Arguments table + an "Agent override" prose block, copied verbatim from `dev-verify.md` for
      consistency. Flag passes through the existing `Skill(skill="sp:spur-dev", args="refine $ARGUMENTS")`.
- [ ] **`plugins/sp/commands/dev-plan.md`** — same standard `--agent` block; flag passes through
      `args="plan $ARGUMENTS"`. (Sits alongside the `--design`/`--auto` flags from 0124.)
- [ ] **`plugins/sp/commands/dev-brainstorm.md`** — same standard `--agent` block; flag passes
      through to `sp:brainstorm`. (Heaviest LLM user — most to gain.)
- [ ] **`plugins/sp/skills/spur-dev/references/dev-operations.md`** *(added by baseline dogfood — P1)* —
      the operations SSOT lists `--agent` for unit/review/verify/run (ops 1–4) but **not** refine (op 5,
      line 39), plan (op 6, line 40), brainstorm (op 12, line 46). Add `--agent <name|inherit|auto>` to
      those three Inputs cells + their per-op detail blocks, or command docs drift from the catalog.
- [ ] **`plugins/sp/skills/spur-dev/SKILL.md` + references** — add a short "Honor `--agent`" note:
      when `--agent <name>` is present, forward it to every `spur agent run` call
      (`spur agent run … --agent <name>`); absent → bare/`auto` as today. Touch the planning-workflow
      AC-generation call and any refine model call. This is what makes Stream 1 real, not theater.
- [ ] **`plugins/sp/skills/brainstorm/SKILL.md` + references** — same "Honor `--agent`" note on its
      research/synthesis `spur agent run` delegations.
- [ ] **`plugins/sp/skills/dogfood-testing/SKILL.md` (new)** — extract the 4-phase protocol
      (Plan → Execute+fix → Monitor → Report) from `dev-dogfood.md` into a fat backbone skill. Fat-skill
      frontmatter (name, description with triggers, metadata: author/version/platforms/interactions/modes).
- [ ] **`plugins/sp/skills/dogfood-testing/references/report-template.md` (new)** — the well-designed
      report template (Stream 2.3): fixed sections (Testee, Execution Summary, What We Did, Issues
      [Fixed/Unresolved], Findings [P1–P4 + file:line + recommended action], Summary Footer). Rich
      enough for the user to fine-tune the testee from the report alone.
- [ ] **`plugins/sp/skills/dogfood-testing/references/monitor-ledger.md` (new)** — the monitor
      methodology + ledger spec (Stream 2.4): per-step columns, live-not-reconstructed rule, honest
      `~estimate` labeling, cache-health finding rule (<50% aggregate / <40% per-step → P3).
- [ ] **`plugins/sp/skills/dogfood-testing/SKILL.md` (agent scoping section)** — the testee-scoped
      `--agent` semantics (Stream 2.2): `--agent` forwards into the **testee** invocation, driver stays
      current session; worked example (`/sp:dev-run … --agent codex`).
- [ ] **`plugins/sp/commands/dev-dogfood.md`** — collapse from fat inline to a thin wrapper:
      `Skill(skill="sp:dogfood-testing", args="$ARGUMENTS")`. Keep argument-hint + Arguments table +
      the repo-mutation safety warning; add `--agent` (testee-scoped) row. Remove the inline 4-phase
      body and the "fat-file exception" note (no longer an exception).
- [ ] **Doc sync (constitution T3/§4.5):** `04_DESIGN.md` — update the `/sp:dev-*` surface rows for the
      new `--agent` flags and the dogfood thin-wrapper change; `AGENTS.md` CLI-surface block if the
      dev-* flag listing is enumerated there. Detail-first satellite if warranted (command-contract +
      new-skill change → seam).
- [ ] **AC1 — flag present.** `dev-refine`, `dev-plan`, `dev-brainstorm` each expose
      `--agent <name|inherit|auto>` in argument-hint + Arguments table + prose, matching `dev-verify`.
- [ ] **AC2 — flag is real (not theater).** `sp:spur-dev` and `sp:brainstorm` instruct forwarding
      `--agent` into their `spur agent run` calls; a grep shows no remaining bare call on the documented
      model-invocation path that should honor it.
- [ ] **AC3 — backbone skill exists + discovers.** `plugins/sp/skills/dogfood-testing/SKILL.md` present
      with valid fat-skill frontmatter; auto-discovered as `sp:dogfood-testing`.
- [ ] **AC4 — dev-dogfood is a thin wrapper.** `dev-dogfood.md` delegates via `Skill()`, the inline
      4-phase body is gone, the "fat-file exception" note is removed, behavior is preserved.
- [ ] **AC5 — dogfood `--agent` is testee-scoped + documented.** `--agent` forwards into the testee;
      prose explicitly distinguishes driver vs testee with a worked example.
- [ ] **AC6 — report template shipped + referenced.** `report-template.md` exists; the skill points at
      it; the template carries per-finding severity + file:line + recommended action.
- [ ] **AC7 — monitor/ledger spec shipped.** `monitor-ledger.md` exists with per-step columns, the
      live-ledger rule, `~estimate` labeling, and the cache-health finding rule.
- [ ] **AC8 — dogfood the result.** Run `/sp:dev-dogfood` (now thin → `sp:dogfood-testing`) against one
      of the newly-`--agent`'d commands and produce a report via the new template — proving the
      extraction + report + ledger work end-to-end. (Baseline run done pre-fix:
      `docs/dogfood/2026-06-25-dev-refine-0125-baseline-dogfood.md`.)
- [ ] **AC9 — catalog parity (added by dogfood).** `dev-operations.md` lists `--agent` on
      refine/plan/brainstorm, matching the command docs (no SSOT drift).
- [ ] **Coherence + gate:** `--agent` wording identical across the 3 standard commands; dogfood prose
      self-consistent; `bun run lint` + `bun run test` clean.

**Verification:** no automated tests for doc/skill prose — verification is the AC dry-run + a real
dogfood pass (AC8) + the standard gate. Order: Stream 1 commands → catalog → Stream 1 skill threading →
Stream 2 skill extraction → thin-wrapper collapse → doc sync → AC8 dogfood.
### Solution

Skill-prose change (no compiled surface). Stream 1 (--agent) + Stream 2 (dogfood extraction).

| Site | Change |
|------|--------|
| `plugins/sp/commands/dev-refine.md` | `--agent <name\|inherit\|auto>` in arg-hint + Arguments row + "Agent override" prose. |
| `plugins/sp/commands/dev-plan.md` | Same `--agent` block (alongside 0124's `--design`/`--auto`). |
| `plugins/sp/commands/dev-brainstorm.md` | Same `--agent` block; prose at the Phase-2 delegation. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:39,40,46` | Catalog rows for refine/plan/brainstorm gain `--agent` (+ detail blocks). **P1 from baseline dogfood.** |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:28` | dogfood reclassified: fat-file exception → thin `Skill()` over `sp:dogfood-testing`. |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md` | New "Honor `--agent`" canonical rule — thread the selector into every `spur agent run` (the anti-theater fix, AC2). |
| `plugins/sp/skills/spur-dev/references/planning-workflow.md` | Pointer at the AC-generation `spur agent run` site → cross-cutting Honor rule. |
| `plugins/sp/skills/brainstorm/SKILL.md` | "Honor `--agent`" note on its research/synthesis delegations. |
| `plugins/sp/skills/dogfood-testing/SKILL.md` (new) | Fat backbone skill: 4-phase protocol, testee-scoped `--agent`, gotchas (incl. stale-snapshot from AC8 dogfood). |
| `plugins/sp/skills/dogfood-testing/references/report-template.md` (new) | Enhanced report: fixed sections, verdict rule, findings with severity + file:line + recommended action; mandatory footer; task-sink L3 rule. |
| `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md` (new) | Live-ledger rule, column contract, token/cache `~estimate` heuristic, cache-health finding rule, worked example. |
| `plugins/sp/commands/dev-dogfood.md` | Collapsed fat inline → thin `Skill(skill="sp:dogfood-testing")` wrapper; testee-scoped `--agent` row; fat-file note removed. |
| `docs/04_DESIGN.md §7.8` | Count updated: 9 `Skill()`-backed + 4 inline; dogfood → `sp:dogfood-testing`. |
| `docs/design/dev-agent-flag-and-dogfood-skill.md` (new) + `docs/04_DESIGN.md §0` | Design satellite (authored via 0124's Step 5.5) + index row, detail-first order. |

**Dogfood-driven:** baseline run (pre-fix) surfaced the P1 catalog gap → folded into Plan as AC9.
AC8 run (post-fix, via the NEW `sp:dogfood-testing` + new report template) verified the whole chain
and surfaced the stale-command-snapshot P2 → folded into the skill's gotchas.

### Testing
**Coverage: N/A** — skill/command doc change, no compiled surface. Verified by two real dogfood runs + AC dry-run + the full gate.

**Acceptance criteria:**

- [x] **AC1 — flag present.** dev-refine/plan/brainstorm each expose `--agent <name|inherit|auto>` (arg-hint + table + prose), matching dev-verify. Verified: count 4 each.
- [x] **AC2 — flag is real (not theater).** `cross-cutting.md` §Honor `--agent` + `brainstorm/SKILL.md` instruct forwarding into `spur agent run`; planning-workflow points at it. No bare call left on the documented synthesis path.
- [x] **AC3 — backbone skill exists + discovers.** `plugins/sp/skills/dogfood-testing/SKILL.md` present, valid fat-skill frontmatter, auto-discovered (no plugin.json edit).
- [x] **AC4 — dev-dogfood is thin.** Delegates `Skill(skill="sp:dogfood-testing")`; inline 4-phase body + fat-file note removed; behavior preserved.
- [x] **AC5 — dogfood `--agent` testee-scoped + documented.** §Testee-scoped agent distinguishes driver vs testee with a worked example.
- [x] **AC6 — report template shipped + referenced.** `report-template.md` exists; SKILL points at it; per-finding severity + file:line + recommended action.
- [x] **AC7 — monitor/ledger spec shipped.** `monitor-ledger.md` exists: column contract, live-ledger rule, `~estimate` heuristic, cache-health rule.
- [x] **AC8 — dogfood the result.** Two runs: baseline (`2026-06-25-dev-refine-0125-baseline-dogfood.md`, pre-fix, found the P1) and post-fix (`2026-06-25-dev-refine-0125-agent-dogfood.md`, via the new skill + new template). Both produced reports.
- [x] **AC9 — catalog parity.** `dev-operations.md` lists `--agent` on refine/plan/brainstorm (3/3 rows).
- [x] **Coherence:** `--agent` wording identical across the 3 standard commands; dogfood prose self-consistent.

**Gate:** `bun run lint` clean · `bun run test` 1826 pass / 0 fail · index/satellite invariant holds (new satellite = 1 ref).

**Open follow-up (P2, non-blocking):** fix-mode dogfood that actually executes a threaded `spur agent run --agent <name>` synthesis call, to smoke-test the CLI accepts the value end-to-end (this run was observe-only).
### References

### History
- 2026-06-26T00:21:49.023Z todo → wip (system)
- 2026-06-26T00:32:18.366Z wip → testing (system)
- 2026-06-26T00:32:23.644Z testing → done (system)
