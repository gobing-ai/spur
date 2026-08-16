---
name: Project Constitution
doc: 99_PROJECT_CONSTITUTION
owns: PROCESS — how the key files are maintained
authority: authoritative-on-process
version: 1.3.2
created_at: 2026-05-31T17:30:43.643Z
updated_at: 2026-08-15T00:00:00.000Z
---

# Project Constitution — How to Organize the Project

## 1. What this is & what this is not

This is the **constitution** for the project's key files: an accumulated, machine-maintained set
of rules and lessons for running the same file structure across different projects and
cooperating with multiple coding agents (Claude Code, Codex, Gemini CLI, pi, omp, Antigravity,
OpenCode, OpenClaw, Hermes, Grok, ...).

- One copy lives in every project at `docs/99_PROJECT_CONSTITUTION.md`.
- It is **byte-identical across projects** except the Lessons sections (§8) and the tool-binding
  column (§3). When it improves in one project, propagate to the others — forks are drift.
- It contains **zero project-specific facts** — no project command names, package names, feature
  states, or decisions. Project facts live in the numbered docs this file governs. If you find a
  project fact here, that itself is drift: move it to its owning doc.

This is **not** a project review summary, a technical review list, or a product-design
reflection.

Audience: humans and coding agents equally. Every rule below is written to be checkable — an
agent should be able to verify compliance mechanically, not interpret intent.

## 2. Authority model

Two axes that cannot collide:

| Axis | Question | Winner |
|------|----------|--------|
| **Content** | What is true about the project? | Lower number wins: `00_ADR` is binding on *decisions*; `01_PRD` is authoritative on *scope*; `02`–`05` are derived |
| **Process** | How are the key files maintained? | **This file** |

They cannot conflict because this file holds no project content (§1 rule 3).

**Why this file is numbered 99, not 00:** "lower number wins" is a *content* rule, and this file
plays on the other axis. The out-of-band number is the visible signal that the constitution sits
outside the content chain — renumbering it into the chain (e.g. as `00`) would re-entangle the
two axes and force a renumber of every content doc, invalidating the dense web of cross-pointers
(`03 §12`-style references baked into append-only ADR text) for a purely aesthetic gain. Do not
renumber.

**Content conflict rule:** when two docs disagree, fix the **authoritative** doc first (with a
dated amendment if it is append-only), then the derived doc, then `AGENTS.md` — and flag the
drift in the commit message or task. Never average two conflicting statements into a third.

## 3. Shared tools

Tools are bound by **role**; roles are permanent, bindings evolve. This table is the only
project-variable section besides Lessons — update the binding when the toolchain migrates.

| Role | Current binding | Notes |
| ------ | ----------------- | ------- |
| Spec lifecycle — tasks | `tasks` CLI (WBS markdown task files) → migrating to `spur task` | Task files are tool-owned; edit through the tool, never the Write tool |
| Spec lifecycle — features | `ftree` (feature markdown files) → migrating to `spur feature` | Same tool-owned rule |
| Delivery harness | `spur` (constraint rules, workflows, agent runner, history analytics) | Quality gates are self-hosted through it where possible |
| Agent-facing wrappers | per-project plugin dir (e.g. `plugins/sp/`) | **Fat Skills, thin others:** skills are the SSOT for agent-facing behavior and may be arbitrarily rich; slash commands and subagents are thin wrappers of skills (every agent supports skills; command/subagent support varies) |

## 4. Common file layout

### 4.1 The doc map (canonical template)

Each project's `AGENTS.md` embeds an instantiated copy of this table (§4.4). A fact lives in
**one** doc; other docs link to it, never restate it.

| Doc | Owns the question | Authority | Read / edit when |
| ----- | ------------------- | ----------- | ------------------ |
| `docs/00_ADR.md` | **WHY** — which cross-cutting decision was made, and the one-line reason | **Authoritative** (wins all content) | Read before any structural change; add a dated entry before diverging from a decision |
| `docs/01_PRD.md` | **WHAT** — product vision, users, scope (in / out / deferred) | **Authoritative on scope** | Read before adding a command/feature; edit when scope changes |
| `docs/02_ROADMAP.md` | **WHEN** — phases, current vs deferred, sequencing | Derived | Read to place work in a phase; edit when phase status changes |
| `docs/03_ARCHITECTURE.md` | **HOW** — module boundaries, data flow, runtime model, invariants, rationale-in-depth | Derived (ADR wins) | Read before cross-module/seam/schema work; edit when boundaries or mechanisms change |
| `docs/04_DESIGN.md` | **SURFACE** — concrete shapes: every CLI command, flag, config key, env var, table, DTO; **index over `docs/design/<slug>.md`** (§4.5) | Derived | Read/edit when changing a non-UI command, flag, env var, or schema — same commit |
| `DESIGN.md` (repo root) | **UI/UX SURFACE** — visual design, color tokens, typography, component specs, layout, micro-animations, accessibility | **Authoritative for UI/UX when present** | Read/edit when planning or implementing UI/UX visual changes (dynamically supported; ignored when absent) |
| `docs/05_FEATURES.md` | **STATUS** — feature decomposition + state (✅ done / 🔶 partial / ⏳ planned / 💤 deferred); **index over `docs/features/<id>_<slug>.md`** (§4.5) | Derived | Read to find a feature's state; edit when a feature's status changes |
| `docs/99_PROJECT_CONSTITUTION.md` | **PROCESS** — how the files above are maintained | **Authoritative on process** | Read before editing any doc above; edit per §6.8 |
| `AGENTS.md` (repo root) | **ENTRY** — how agents work in this repo: stack, commands, gates, conventions + the instantiated doc map | Derived (from 99 + 00/01/04) | Read first every session; regenerate factual blocks from code (§6.7) |

**Routing — put each fact in its owning doc, link from the rest:**

- Decision + one-line reason → `00`. Rationale/mechanism in depth → `03`.
- Scope (in/out/deferred) → `01`. Mechanism / data flow / invariants → `03`.
- UI/UX visual design, design tokens, component specs & accessibility → `DESIGN.md` (when present; otherwise follow established project UI conventions).
- Non-UI command/flag/config/schema/DTO shapes → `04`. Phase timing → `02`. Feature status → `05`.
- If you are writing *how it's built* or *why* inside `00`/`01`/`02`, it belongs in `03`/`04`.

### 4.2 Working layers (outside the authority chain)

| Location | Purpose | Rules |
| ---------- | --------- | ------- |
| `docs/plans/YYYY-MM-DD-<topic>.md` | Dated working documents: research, triage, design discussions, decision records-in-progress | They **record**, they do not **govern**. Once concluded, immutable except dated correction sections. Decisions they reach must be promoted into `00`–`05` to take effect |
| `docs/tasks/` | Task files | Tool-owned (§3). Never edited with raw file writes |
| other `docs/` folders | Optional scratch (analysis, refactor notes, ...) | Nothing in the authority chain may depend on them |

`docs/design/` and `docs/features/` are **not** scratch — they are the satellite layers of `04` and
`05` and are governed by §4.5.

### 4.3 Standard frontmatter (the doc's machine-readable contract)

Every numbered doc (`00`–`05`, and `99` itself) opens with YAML frontmatter carrying its doc-map
row plus bookkeeping — so an agent learns the doc's contract from the file head without loading
the doc map, and tooling can validate it:

```yaml
---
doc: 03_ARCHITECTURE
owns: HOW — module boundaries, data flow, runtime model, invariants
authority: derived            # authoritative | authoritative-on-scope | authoritative-on-process | derived
version: 1.1.0
derived_from: [00_ADR, 01_PRD]   # omit for 00
owner: <name>
updated_at: YYYY-MM-DD
read_before: cross-module, seam, or schema work
edit_rules: 99 §6.4
sync: [T1]                    # §5 trigger IDs that obligate touching this doc
---
```

Rules:

1. The frontmatter **is** the instantiated copy of this file's §4.1 row — `owns`/`authority`
   must match it verbatim in meaning; the §7 audit checks this. On mismatch, §4.1 wins.
2. `edit_rules` points to the owning §6 subsection — rules are never restated in frontmatter
   (pointers over prose, §6.0).
3. Bump `version` (minor) on any substantive edit; always refresh `updated_at` in the same edit.
   A doc whose `updated_at` predates a change it should reflect is drift — repair per §7.
4. Frontmatter replaces the legacy bold header block (`**Version:** …` lines); a doc carrying
   both is drift.
5. Doc **bodies do not restate** their own authority or the conflict rule ("when this conflicts
   with the ADR, the ADR wins") — frontmatter `authority` and §2 own that. Preamble
   restatements are drift.

### 4.4 AGENTS.md synchronization

- `AGENTS.md` is the **per-project instantiation**: the §4.1 table (instantiated), plus
  project-specific stack, commands, verification gates, and conventions.
- This file is the canonical template; when §4.1 or §5 changes here, re-sync `AGENTS.md` in the
  same change.
- `AGENTS.md` may **add** project facts; it may never **contradict** the numbered docs. On
  contradiction, the numbered doc wins — fix `AGENTS.md`.

### 4.5 Index + satellite docs (`04`/`05` and their folders)

Two derived docs are **index pages** over a folder of per-item **satellite** files. The index holds
the headline rows + pointers; each satellite holds one item's detail. This keeps the index readable
(loaded every session) while detail scales without bloating it.

| Index doc | Satellite folder | Satellite file name | Satellite ownership |
|-----------|------------------|---------------------|---------------------|
| `docs/04_DESIGN.md` | `docs/design/` | `docs/design/<slug>.md` | Hand-maintained derived doc (§6.5) |
| `docs/05_FEATURES.md` | `docs/features/` | `docs/features/<feature-id>_<slug>.md` | **Tool-owned** (§3 — `spur feature`/`ftree`); satellites *and* the index region are written by the tool, never by raw file writes |

Rules (both axes):

1. **The index is the single entry point.** A reader starts at `04`/`05`; every satellite is
   reachable from exactly one index row. A satellite with no index row, or an index row with no
   satellite, is drift (§7 audit).
2. **One item per satellite.** `<slug>` (design) / `<feature-id>_<slug>` (features) is the grep
   anchor (§6.0 rule 6) — stable once chosen; renaming is a rename of the file *and* its index row in
   the same change.
3. **Detail lives only in the satellite; the index carries pointer + status only.** The index never
   restates a satellite's body (§6.0 rule 2). For `05`, a row is `<id> <status> <name> → pointer`;
   for `04`, an index row names the surface area and points at its `docs/design/<slug>.md`.
4. **The index is regenerable for `05`** (tool-written) and **hand-curated for `04`** — but in both
   cases the satellite is the source of truth and the index is derived from it. Never edit `05`'s
   generated index region by hand; never let a `04` index row diverge from its satellite.
5. **Edit order is fixed (§5 T9): detail first, then index.** Write/update the satellite, then update
   the index row — in the **same change**. Updating the index before the detail exists creates a
   pointer to nothing; the reverse leaves the detail unindexed. For tool-owned features, "update the
   index" is running the tool's refresh (e.g. `spur feature refresh`), not a manual edit.

## 5. Sync triggers — same-commit obligations

The root cause of stale key files is *unsynchronized success*: code ships, docs don't hear about
it. Each trigger below has a stable ID (referenced by doc frontmatter `sync:` lists, §4.3) and
names the docs that must be touched **in the same commit / same change**:

| ID | When this happens | Touch (same change) |
| ---- | ------------------- | --------------------- |
| T1 | New cross-cutting decision, or reversal of one | `00` **first** (dated entry), then `03` mechanism, `01` if scope shifts |
| T2 | A code change would contradict an existing ADR | **Stop.** Add the superseding/amending ADR entry first — never silently diverge |
| T3 | Command, flag, config key, env var, schema, or DTO added/changed | `04` + the `AGENTS.md` surface block |
| T4 | A feature ships or changes state | its `05` row; a new `01` scope row if it is new surface |
| T5 | A phase completes, reorders, or gains items | `02` (update the bullet to the *real, shipped name* of the deliverable) |
| T6 | Scope added / cut / deferred | `01`; placement in `02` |
| T7 | The doc map or process changes | this file → re-sync `AGENTS.md` (§4.4) → propagate to sibling projects |
| T8 | A multi-wave batch is planned | schedule "doc sync" as an **explicit work item** — same-commit discipline does not survive on memory alone |
| T9 | A design or feature item is added/changed | the satellite **first** (`docs/design/<slug>.md` or `docs/features/<id>_<slug>.md`), **then** its index row in `04`/`05` — same change (§4.5 rule 5) |
| T10 | A corpus check rule is added or tightened (a new `L*` finding code, or an existing one raised to `error`) | run `bun run corpus-check` and reconcile the fallout **in the same change**: fix the newly-failing tasks/features, or add each to `config/corpus-baseline.json` with a reason and a date |

**T10 — why it exists.** Corpus checks run *once*, at a transition, against the rules that existed
that day. Nothing re-validates afterwards, so tightening a rule silently converts previously-legal
closed work into non-compliant work — with no event anywhere. Task 0368 closed 2026-07-28; the rule
that now flags it landed 2026-08-01 (`f373e90b`). Four days apart, invisible for ten.

`bun run corpus-check` (wired into `spur-check`) makes that fallout loud, so the only remaining
question is *where* it gets reconciled. The answer is the tightening commit itself: its author knows
why the rule changed, and the blast radius is smallest before anyone rebases onto it. Deferring the
reconciliation means the next unrelated contributor inherits a red gate they did not cause and
cannot judge.

The baseline is deliberately two-sided — an unlisted error fails the gate, **and** a listed entry
that no longer reproduces fails it too. Without that second half the file rots into a silent
suppression list, which is the same invisible debt in a new place. Delete an entry the moment its
finding is fixed.

## 6. Edit principles per file

### 6.0 Writing rules (all key files)

Token economy is a design goal: these files are read by LLM agents at session start, every
session, across every project — a redundant sentence is paid for thousands of times. Precise
**and** concise; precision wins when they conflict.

1. Declarative, information-dense sentences. No filler, no marketing adjectives, no hedging, no
   narrative buildup.
2. A fact lives once — link or point (`see 03 §12`) instead of restating, both in-file and
   cross-file. Restatement is the largest token sink in a doc system, bigger than any tone rule.
3. Tables for enumerable facts; prose only where reasoning is needed.
4. Front-load: rule first, elaboration after — readers (human or agent) may only take the head.
5. Define a term once, then reuse it verbatim. Synonyms read as new concepts to a machine.
6. Headings and IDs (`ADR-NNN`, `T1`–`T8`, `§6.x`, feature rows) are grep targets and
   cross-reference anchors — never rename casually.
7. **Concise never beats correct.** If brevity creates ambiguity, add the missing words: tokens
   saved in reading are lost many times over in a misexecuted run.

These rules are stated once, here. Per-file sections below and doc frontmatter inherit them via
pointer — restating them per file would violate rule 2.

### 6.1 `docs/00_ADR.md`

Entry template:

```markdown
## ADR-NNN: <Decision title, outcome-shaped>

**Status:** Accepted | Accepted (design) | Superseded by ADR-MMM | Skipped · **Date:** YYYY-MM-DD

**Decision.** <What was decided — the smallest complete statement of the choice.>

**Why.** <One line. The single strongest reason.>

**Detail:** <pointer into 03/04/plans — depth never lives here.>
```

1. **One decision per entry.** If a draft contains a principle *and* a deferred design *and* a
   mechanism choice *and* implementation tips — split it: decision(s) here, mechanism in `03`,
   shapes in `04`, tips nowhere (they are implementation guidance, not decisions).
2. **ADR = decision + one-line reason.** No Zod patterns, no lock details, no code idioms.
3. **Append-only.** Never renumber, never delete, never rewrite history. Corrections are dated
   `**Amendment (YYYY-MM-DD)**` blocks inside the entry; reversals are **new entries** that name
   what they supersede, while the old entry's Status becomes `Superseded by ADR-MMM`.
4. **Numbering:** next free integer, one sequence per repo. A burned/skipped number gets a stub
   entry (`Status: Skipped`) so the gap is audit-clean and never reused.
5. **`Accepted (design)`** means decided but not built — readers must be able to tell decided
   from shipped.
6. **Before any code that contradicts an ADR:** the superseding entry lands first (§5 row 2).
7. **Retrofit rule:** the entry template binds **new entries and amendments only**. Historical
   entries are never restructured to match it — append-only beats stylistic consistency. The
   non-entry preamble is normal editable text.
8. **Amendments record the decision delta.** An `**Amendment**` block records *what changed about the
   decision* — the new choice and its one-line reason — plus a `Detail:` pointer for mechanism.
   Implementation file paths, detailed semantics, and multi-paragraph rationale belong in `03`/`04`,
   not in the amendment body. If an amendment would carry more than a few lines of non-decision text,
   the mechanism has leaked in; link it instead of inlining it.

### 6.2 `docs/01_PRD.md`

1. Owns vision, users, principles, scope. **No mechanism** (→ `03`), **no timing** (→ `02`),
   **no shapes** (→ `04`).
2. **Every shipped surface has a scope row.** When a command/capability ships, its row enters
   the in-scope table in the same change — shipped-but-unlisted is the most common drift.
3. Scope states are explicit: *in (committed)* / *supporting* / *deferred (needs design
   reconfirmation)* / *out of scope*. A deferred item carries the condition that would
   reactivate it.
4. Surface beyond the committed set is **not ported/built speculatively** — re-confirm the need
   first and record the evidence pointer (a dated plans doc, usage data) in the entry that
   admits it.
5. **Scope tables carry membership only** — no delivery-status columns (`05` owns status; a
   status column in `01` is a guaranteed drift magnet). Likewise, quantitative gate values
   (coverage thresholds, etc.) live with their enforcement config — point to the gate, never
   restate the numbers.

### 6.3 `docs/02_ROADMAP.md`

1. Derived: it may **sequence** facts from `00`/`01`/`05` but never introduce new ones.
2. Every phase has a goal sentence, checkbox items, and an explicit **Exit:** criterion.
3. Markers: `[x]` done · `[~]` partial · `[ ]` pending. `[x]`/`[~]` carry a one-line evidence
   note (what shipped, where).
4. When a deliverable lands under a different name than planned, rewrite the bullet to the real
   name — a roadmap that tracks dead names reads as undelivered work.
5. Phases gate on the previous one. Insert sub-phases (`1.5`) rather than renumbering existing
   ones.

### 6.4 `docs/03_ARCHITECTURE.md`

1. Describes the **current** architecture. Future/accepted designs are allowed only in sections
   explicitly titled `(accepted design — ADR-NNN; not yet built)`.
2. Owns module boundaries, data flow, runtime model, invariants, and rationale-in-depth. Not
   schemas/signatures (code and `04`), not decisions (`00`).
3. Write invariants as **enforceable statements** — phrased so a constraint rule or a reviewer
   can check them mechanically.
4. When a migration replaces a mechanism (parser, dispatcher, bootstrap), update the module
   descriptions in the same change — stale module lists survive multiple releases unnoticed.
5. On conflict with `00`: the ADR wins; fix here and flag.

### 6.5 `docs/04_DESIGN.md` + `docs/design/<slug>.md`

`04` is the **index page** over the `docs/design/` satellites (§4.5). The index carries the surface
map + pointers; each `docs/design/<slug>.md` holds one surface area's detailed design.

1. **Same-commit rule:** any change to a command, flag, config key, env var, table, or DTO
   updates `04` (and its satellite) in that commit (§5 T3/T9). In batch planning, doc sync is an
   explicit scheduled item.
2. **Detail-first edit order (§4.5 rule 5 / T9):** write or update the `docs/design/<slug>.md`
   satellite first, then update its `04` index row — never the reverse. A new surface area gets a
   new satellite + a new index row in the same change.
3. Prefer **generated** artifacts over hand-maintained ones (e.g. OpenAPI from the contract);
   never hand-write what can be derived — and never let a derivable artifact be edited by hand.
4. Shapes only. Rationale lives in `00`/`03`. **Behavioral notes are shapes** ("resolving zero
   rules exits 1" — keep); justifications are not ("...because a silent gate is the worst
   failure mode" — cut, or point to `00`/`03`). This applies to satellites too — they hold
   *detailed shapes*, not rationale.
5. Command signatures are **transcribed from the code registrations**, never from memory or from
   an older doc revision — a signature is a factual block in the §6.7 sense.
6. The index never restates a satellite's body (§6.0 rule 2): an `04` row names the surface area,
   its status, and points at `docs/design/<slug>.md`. `<slug>` is a stable grep anchor (§6.0 rule 6).

### 6.6 `docs/05_FEATURES.md` + `docs/features/<feature-id>_<slug>.md`

`05` is the **index page** over the `docs/features/` satellites (§4.5). Both the satellites and `05`'s
generated index region are **tool-owned** (§3 — `spur feature`/`ftree`): edit through the tool, never
with raw file writes.

1. One index row per deliverable, each with a concrete **acceptance** check, status from the legend
   (✅ done · 🔶 partial · ⏳ planned · 💤 deferred), and a pointer to its
   `docs/features/<feature-id>_<slug>.md` satellite.
2. The satellite + its index row change in the **same change** that ships or re-scopes the feature
   (§5 T4/T9).
3. **Detail-first edit order (§4.5 rule 5 / T9):** update the feature satellite first (via the tool),
   then refresh the index (e.g. `spur feature refresh`) — never hand-edit the generated index region,
   and never update the index ahead of the detail.
4. **Never trust a row you have not verified.** Before citing or building on a status, check it
   against code — status rows rot silently in both directions (done-but-⏳ and ⏳-but-claimed).
5. `05` keeps headline rows + pointers; the full decomposition lives in the satellite files.
   `<feature-id>` is the stable grep anchor (§6.0 rule 6); renaming is a tool operation, not a raw
   edit.

### 6.7 `AGENTS.md`

1. Factual blocks that mirror code — the command surface, the workspace layout, tool versions —
   are **regenerated from code**, never edited from memory. Verify with the actual registrations
   (e.g. list the CLI's registered nouns/verbs) before writing the block.
2. Keep it lean: link to the owning doc instead of restating its facts. `AGENTS.md` repeats only
   what an agent needs in the first 30 seconds of a session.
3. Surfaces that are decided-but-unbuilt are flagged as planned with their ADR pointer, and
   marked "do not invoke as if they exist".
4. Re-synced whenever this file changes the map or process (§4.4).

### 6.8 This file (`99`)

1. **No project facts** — ever (§1). Tool bindings (§3) and Lessons (§8) are the only
   project-variable content.
2. Structure and principles change only on operator request; Lessons sections are
   machine-appendable per the §8 protocol without asking.
3. When this file improves in one project, **propagate the improvement to sibling projects** —
   it is one constitution with N copies, not N constitutions.

## 7. Drift control

**Drift** = reality (code, shipped behavior) disagreeing with what a key file says, or two key
files disagreeing with each other.

**Repair protocol** (always this order):

1. Fix the **authoritative** doc — for append-only files, by dated amendment, never rewriting.
2. Then the derived docs that restate or sequence it.
3. Then `AGENTS.md`.
4. Flag what drifted and why in the commit message / task — a silent fix hides the systemic
   cause.

**Audit cadence:** at every phase exit, and before designing any large batch, run the drift
audit:

- [ ] List the real CLI/tool surface from code; diff against `AGENTS.md`'s surface block and
      `00`'s committed-surface entries.
- [ ] For every `05` row marked ✅/🔶, spot-check the acceptance against code; for every ⏳, check
      it didn't quietly ship.
- [ ] For every shipped surface, confirm a `01` scope row exists.
- [ ] Check `02`'s current phase bullets name things that actually exist (no dead names).
- [ ] Check `03`'s module descriptions against the real file tree of each app/package.
- [ ] Confirm `04` covers every command/flag/config/schema that exists.
- [ ] For `04`/`05` (§4.5): every index row points to an existing satellite, and every satellite
      (`docs/design/<slug>.md`, `docs/features/<id>_<slug>.md`) has exactly one index row — no orphan
      satellites, no dangling pointers.
- [ ] Confirm `AGENTS.md`'s doc map matches §4.1 of this file.
- [ ] Confirm each doc's frontmatter matches its §4.1 row and its `updated_at` is plausible
      against recent commits (§4.3).

Findings are repaired via the protocol above, and anything systemic becomes a Lesson (§8) — or,
if it recurs, a new rule in §6.

## 8. Lessons learned per file

**Append protocol (machine-maintained):**

- Format: `- [YYYY-MM-DD] <project>: <lesson — what went wrong / what to do instead>`
- Threshold is **low** — when in doubt, append. Check for an existing equivalent first; bump its
  date instead of duplicating.
- **Promotion rule:** a lesson that recurs or hardens into practice is promoted into a §6 rule
  (or a §5 trigger) and removed from this section. Lessons are the inbox; §5/§6 are the law.
  Promotion is the only sanctioned deletion.
- Lessons carry project provenance because this file is copied across projects — a lesson from
  one project is a warning, not yet a law, for the others.

### Lessons for `docs/00_ADR.md`

- [2026-08-14] spur-new: Feature E6 (0557–0559) shipped run→session correlation, a provenance
  semantics reversal (cwd-substring `detectProvenance` deleted upstream), and the cost-path
  repointing with no `00` entry — the scheduled doc-sync hop retrofitted ADR-059/060. A decision
  that reverses a shipped mechanism (T1/T2) belongs in `00` in the implementing change, not at
  wrapup.
- [2026-08-13] spur-new: The B2 role-selector delta (0536) amended ADR-033 (stage routing) but left ADR-047 — the ADR that owns the `--agent` table — untouched until the wrapup added a cross-amendment. A decision delta that changes a value domain owned by *another* ADR must cross-amend the owner in the same change; grep the ADRs that own the surface, not just the ADR you are extending.
- [2026-08-12] spur-new: Draft ADRs that bundled a principle + a deferred design + a mechanism
  choice + implementation tips had to be unbundled on operator review. Split before proposing,
  not after (now §6.1 rules 1–2). Recurred on ADR-057 first draft (occupant/run/wait stuffed into
  Decision; false Amends of ADR-052). Slim Decision to the law; mechanism stays in `03`/`04`;
  Amends only when the prior decision actually changes.
- [2026-06-11] spur-new: Shipped commands drifted past the ADR's committed-surface list for
  weeks with no entry — repaired by dated amendment. The §5 trigger table exists because of
  this.
- [2026-06-11] spur-new: An ADR number was burned by confusion with a sibling repo's ADR
  sequence; the gap was later documented as a `Skipped` stub. One sequence per repo, stub the
  gaps (now §6.1 rule 4).

### Lessons for `docs/01_PRD.md`

- [2026-06-12] spur-new: The PRD's coverage bar (85/90) contradicted the enforcement config
  (90/90 in `bunfig.toml`) — two sources for one number. Quantitative gate values are now
  pointed-to, never restated (§6.2 rule 5).
- [2026-06-12] spur-new: The scope table carried a delivery-status column duplicating `05` —
  removed; scope = membership only (§6.2 rule 5).

- [2026-06-11] spur-new: A whole capability group (team mode) shipped with zero scope rows —
  discovered only during an unrelated review. "Every shipped surface has a scope row" (§6.2
  rule 2) exists because of this.
- [2026-08-12] spur-new: The team-coordination membership row still said `start|stop` stubs after
  the supervisor shipped. Scope rows must name the live verb set (`up|down|start|stop`), not the
  Phase-N nickname from the intake ticket.
- [2026-06-11] spur-new: The "deferred until need re-confirmed" clause earned its keep — a large
  surface expansion was admitted only after an evidence-based usage review, which made the scope
  decision defensible item-by-item.

### Lessons for `docs/02_ROADMAP.md`

- [2026-06-11] spur-new: A planned deliverable shipped under a different command name and the
  roadmap bullet kept the dead name — reading as undelivered. Rewrite bullets to real names at
  delivery time (§6.3 rule 4).

### Lessons for `docs/03_ARCHITECTURE.md`

- [2026-08-16] spur-new: The B2 role→tier→executor two-layer contract (0535–0542) shipped with the mechanism documented only in `04 §2.1` (surface) — 03 had no executor-selection section at all until the wrapup added §19. Recurred on B3/0572: §19 existed but kept asserting the **deleted** `roles.md` regex parse — ADR-061 (SSOT moved to `DEFAULT_AGENT_ROLES`) landed with no 03 mechanism sync, so the wrapup had to rewrite Layer 1. A surface rewrite that changes *how resolution works* is a §6.4 rule 4 mechanism replacement, not just a T3 flag list: schedule the 03 mechanism block in the same change — and when the mechanism section already exists, re-read it against the diff, not just "add a section".
- [2026-06-11] spur-new: The module list still described a hand-rolled parser two ADRs after it
  was replaced — stale module descriptions survive migrations silently (§6.4 rule 4).
- [2026-06-12] spur-new: A wildcard dependency edge (`apps/* ──► packages/{…}`) hid three real
  per-app differences and masked a dead manifest dep. Draw boundary diagrams per-app and verify
  against the manifests.
- [2026-06-12] spur-new: The runtime diagram showed the CLI calling engines directly, bypassing
  the `packages/app` service layer the code actually routes through — a diagram can contradict an
  accepted boundary for weeks. When an ADR canonizes a boundary, re-derive every diagram that
  depicts it.
- [2026-06-11] spur-new: Accepted-but-unbuilt design text reads as current architecture unless
  the section title says otherwise — always flag `(accepted design — not yet built)` (§6.4
  rule 1).
- [2026-07-19] spur-new: A verify run certified task 0282 `done` citing `evidence:134` anchors
  that resolve to a *different ticket's* content, with R4/R5 marked MET on material absent from
  the deliverable — caught only by a `--force` re-audit that re-read every cited line. Verify
  must confirm each `file:line` anchor names the requirement's subject (not merely exists)
  before writing a MET row (filed as task 0299, P2).

### Lessons for `docs/04_DESIGN.md`

- [2026-08-16] spur-new: Task 0572 (B3) scheduled a doc-sync item (R4) that covered ADR-061 + the config-file comments but shipped **no `04` edits**: the new `agent.roles` config key had no surface row (T3), five `04` passages kept asserting the deleted roles.md CLI parse, and ADR-061's `Detail:` pointer "`04` `agent.roles`" resolved to nothing until the wrapup. A doc-sync item that names only the ADR + config files misses the derived surface: enumerate `04` (and `03`, `AGENTS.md`) in the item; when a synced `04` section exists, diff its mechanism claims against the change, not just "add a row".

- [2026-08-15] spur-new: An E6 verify answer embedded Gherkin bodies in AC row ids (`Scenario: R4 — … (Given … / Then …)`), which `spur task verdict --from-answer` preserved verbatim — the scenario gate flagged `L4.scenario-unverified` despite a PASS verdict and needed post-hoc surgery on the answer artifact (0561). The gate now strips a trailing parenthetical as a backstop, but the authoring contract stays: AC row id = exactly the scenario title, body lives in the task's Acceptance Criteria block (ac-style-guide).
- [2026-08-13] spur-new: The 0538 R2 wrapup text claimed the JSON workflow schemas reject a role-less `agent.run` step — the schemas contain no `role` key; the gate is `WorkflowService.validate`'s post-schema walk plus `AgentRunActionRunner`'s dispatch guard. A 04 edit that names an enforcement surface must be checked against the actual file (the JSON schema) before writing — "the schema fails" is a factual claim about a specific artifact, not a summary of the code comment.
- [2026-06-11] spur-new: The same-commit sync rule was honored only when "doc sync" was made an
  explicit scheduled item in the batch plan. Discipline-by-memory fails; schedule it (§5 last
  row).
- [2026-06-12] spur-new: A command signature documented four flags the code does not register
  (they had moved onto the agent spec), and a `spur version` command that never existed —
  signatures are transcribed from registrations, never recalled (§6.5 rule 4).
- [2026-06-12] spur-new: A paragraph describing a **superseded** ADR's mechanism (per-command
  `helpText()` renderers) survived two doc passes after the superseding ADR landed, directly
  contradicting the section above it. When an ADR is superseded, grep the derived docs for its
  mechanism vocabulary in the same change.
- [2026-08-04] spur-new: A UI/UX web module (Inbox, 0422) shipped with its *visual* design
  correctly routed to root `DESIGN.md`, but the module's **system-boundary surface** — module
  registration (`id`/`route`/`order`), the two-channel message plane, the shared
  `process-stream` lib — was never recorded in `04`/`03`/ADR until a follow-up doc-evolve pass.
  A UI change still carries non-UI surface facts (§4.1 routing) that `DESIGN.md` does not cover.
  When a UI module ships, check for system-boundary surface and record it in `04`/`03`/ADR in
  the same change (ADR-042 repaired this in a follow-up).
- [2026-08-05] spur-new: A recorded 04 design premise (`task_run_links` "needs a WorkflowService
  run-start hook") was silently reversed by a code change (`spur task record` auto-walking the
  `done` transition and auto-creating the run-link, task 0436 R4) — a §5 T1/T2 obligation with no
  same-change ADR. The premise only read as "resolved" in 04, not as a decision. Repair: new
  ADR-048 in the wrapup. A design premise in 04 that a code change reverses needs an ADR in the
  same change, not just an edited follow-up note.
- [2026-08-10] spur-new: A real-data verification probe (task 0505) ran a full-mode write against
  the 1.7 GB history DB without `--dry-run` first, deleting one pre-existing antigravity
  row+ledger+checkpoint before the frozen pre-probe snapshot caught it — real-data writes need a
  backup + `--dry-run` pass before any mutation, and `--mode full` deletes stale rows by design
  (authoritative reconciliation, 0504).

### Lessons for `docs/05_FEATURES.md`

- [2026-06-11] spur-new: Multiple rows were stale in both directions at once — engines listed
  ⏳-to-publish long after they shipped, and a config filename from two migrations ago. Statuses
  are claims, not facts: verify against code before citing (§6.6 rule 3); audit at phase exits
  (§7).
- [2026-06-12] spur-new: A ✅ row described a flag surface that a later refactor had moved
  elsewhere (run-level identity flags → agent specs) — the row stayed green while its acceptance
  text went false. A ✅ row's *acceptance text* rots independently of its status; spot-check both
  (§7 audit).
- [2026-08-08] spur-new: The entire §6 History section was stale after feature E1 shipped — 7 sources (now 10), no forensic ETL, no `--source all` fan-out, no `daily`/`analyze`/`report` pipeline, no scheduling, no versioned artifact. A ✅ status row stayed green while its acceptance text was 4 features behind. When a feature ships a capability group, audit every `05` row in that section in the same wrapup (§7 audit).
- [2026-08-13] spur-new: `01` and `05` still called `spur team start|stop` “Phase 4 stubs” after G2 tasks 0195/0207–0210 were `done` and `04` already documented the live verbs. Recurred when G4 wave 1 (0529) shipped while `05` stayed ⏳ and `02` left the wave-1 box unchecked. A 💤/`stubs`/`⏳` label in an index outlives the satellite. When a supervision/CLI slice ships, update `01` membership and `05` status in the same wrapup — and `feature refresh`/`sync` the leaf — or the next planning pass will reinvent the supervisor.

### Lessons for `AGENTS.md`

- [2026-06-11] spur-new: The command-surface block was missing 11 shipped verbs across 4 nouns;
  it had been edited from memory. Regenerate factual blocks from code registrations, never from
  recall (§6.7 rule 1).
- [2026-08-09] spur-new: R5/R6 (one-writer + commit-per-task) landed in the monorepo `AGENTS.md`
  and `cross-cutting.md` but not the portable `config/templates/AGENTS.md` that `spur init` seeds —
  new projects missed the coordination rule until a follow-up pass. When a convention change has
  portable reach, propagate it to the template in the same change, or it silently forks the derived
  `AGENTS.md` surface (§4.4 / §6.7).

### Lessons for this file (`99`)

- [2026-06-18] spur-new: The index+satellite pattern (§4.5, §6.5/§6.6, T9) was added to Spur's copy
  only. **Outstanding propagation (§6.8 rule 3):** apply the same §4.5/§4.1/§5-T9/§6.5/§6.6/§7 changes
  to sibling projects' constitutions (superskill, ts-libs) so the one-constitution-N-copies invariant
  (§1) holds — until then, Spur's copy is ahead, not forked.
- [2026-06-18] spur-new: First §4.5 audit found `04`/`05` had orphan satellites (no index rows) and a
  competing tool-generated `features/INDEX.md`. Fixed by adding index sections that point at the
  satellites; `05` points at the tool's `INDEX.md` (tool keeps owning it). **§4.5 rule 2 caveat
  learned:** existing satellite filenames are load-bearing grep anchors referenced across *tool-owned
  tasks* and *immutable plans* — renaming them to bare `<slug>.md` would strand those backward
  pointers (which raw edits may not touch). Index existing files under their current names; apply the
  `<slug>.md` convention to **new** satellites only. Retroactive renames need a tool-driven migration,
  not raw rewrites.
- [2026-08-16] spur-new: Three wrapup tasks (0506–0508) landed substantive doc edits — an ADR-047
  amendment, a `03` §6.3 projection, and three `04` surface notes — all verify-PASSed, none bumping
  the §4.3 frontmatter `version`/`updated_at`; the wrapup contract-verify caught it. Recurred on
  0572: ADR-061 landed in-tree with `00` still at `version 1.19.0` / `updated_at 2026-08-15`.
  Frontmatter bookkeeping is part of the same edit as the body change, not a follow-up pass.
- [2026-08-15] spur-new: An E3 wrapup placed a real-data measurement record (`0548-measurement.md`)
  in the `docs/design/` satellite layer with no `04 §0` index row — §4.5 orphan drift, and a
  classification error: measurements/evidence records are dated working documents (`docs/plans/`),
  not surface-area designs. The 2026-06-18 orphan lesson covered naming anchors, not layer
  classification. When a wrapup produces an evidence record, route it to `docs/plans/YYYY-MM-DD-*`,
  never the satellite layer.

## 9. Bootstrapping a new project

Checklist to instantiate this structure in a fresh repo:

1. Copy this file verbatim to `docs/99_PROJECT_CONSTITUTION.md`; empty the §8 lessons of
   other projects' entries or keep them as inherited warnings (recommended: keep).
2. Update §3 bindings if the new project's toolchain differs.
3. Create `docs/00_ADR.md` with the §4.3 frontmatter and `ADR-001` recording the founding
   decision (stack, structure, the why).
4. Create `docs/01_PRD.md`: vision paragraph, users, principles table, scope tables (in /
   supporting / deferred / out).
5. Create `docs/02_ROADMAP.md` with Phase 0 and its exit criterion.
6. Create `docs/03_ARCHITECTURE.md`: topology, dependency boundary, runtime model — current
   state only.
7. Create `docs/04_DESIGN.md` (may start near-empty) and `docs/05_FEATURES.md` (legend + first
   rows).
8. Create root `AGENTS.md`: instantiated §4.1 doc map, stack/layout, commands, verification
   gate, conventions. Symlink `CLAUDE.md` (and equivalents) to it.
9. Wire the §3 tools (spec lifecycle, harness) per their own docs.
10. First-session rule for any agent: read `AGENTS.md` → this file → `00`/`01` before touching
    anything.
