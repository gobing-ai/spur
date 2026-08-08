---
name: wayfinder
description: "Chart a multi-session investigation map when the destination is too foggy to spec in one session. Creates a spur feature as the map, decomposes specifiable questions into spur tasks, and resolves them one at a time until the route becomes visible. Triggers: wayfind, chart a course, multi-session investigation, --wayfind."
license: Apache-2.0
version: 1.0.0
created_at: 2026-07-06
updated_at: 2026-07-06
type: technique
platform: sp
tags: [wayfinding, investigation, multi-session, fog-of-war, map, exploration, workflow-core]
metadata:
  author: sp
  platforms: "claude-code,codex,antigravity,opencode,openclaw"
  category: workflow-core
  interactions:
    - reviewer
    - pipeline
  severity_levels:
    - high
    - medium
    - low
  pipeline_steps:
    - chart
    - resolve
see_also:
  - sp:brainstorm
  - sp:spur-dev
  - sp:spur-cli
  - sp:code-implementation
  - sp:spec-decomposition
---

# sp:wayfinder — Multi-Session Investigation Map

When a loose idea is too big and foggy to spec in one session, wayfinding charts a persistent map of investigation tickets and resolves them one at a time until the route to the destination becomes visible.

**Key distinction:**
- **`sp:brainstorm`** = Ideation: generate approaches when the destination IS clear enough to decompose
- **`sp:wayfinder`** = Wayfinding: chart a map when the destination ITSELF is foggy — the spec is the destination, not the input
- **`sp:spur-dev`** = Execution: drive tasks through the pipeline once they're specifiable
- **`sp:spec-decomposition`** = Decomposition: break a clear spec into tasks

## Overview

sp's standard flow is brainstorm → spec → decompose → implement — it assumes the destination is clear enough to decompose. Wayfinder handles the case where **the spec itself is the destination**, requiring multiple sessions of investigation to even write. It charts the way as a **spur feature** (the map) with child **spur tasks** (investigation tickets), then resolves them one at a time until the route is clear.

The destination varies per effort — it might be a spec to hand off, a decision to lock before planning starts, or a change made in place like a data-structure migration. Naming it is the first act of charting; it shapes every ticket.

## When to Use

Activate sp:wayfinder when:

| Trigger Phrase | Description |
|----------------|-------------|
| "wayfind" / "chart a course" | User explicitly requests wayfinding |
| "this is too big to spec" | The idea exceeds one session's capacity |
| "multi-session investigation" | User expects multiple sessions to reach clarity |
| "find the way to X" | Destination is named but the route is unknown |
| "explore the solution space" | Open-ended exploration before committing |
| `--wayfind` flag on `/sp:dev-brainstorm` | Power-user skip straight to charting |

**NOT for:**
- A clear spec that just needs decomposition (use `sp:spec-decomposition` instead)
- A well-understood problem needing solution options (use `sp:brainstorm` instead)
- A single-session fix or feature (use `sp:spur-dev` instead)
- Pure research without a destination (use `spur agent run` for research instead)

## Core Principles

### 1. The Map Is a Spur Feature — but decisions are not tasks

The map is a `spur feature` — its description IS the map body. sp already has the nouns (feature, task, dependency graph, WBS, status lifecycle), so no new data model is needed.

**Only executable investigations become `spur task` children.** A task file is work to be done, not a question to be answered — see [`../spur-dev/references/cross-cutting.md`](../spur-dev/references/cross-cutting.md) § What belongs in a task file. Apply its test to every candidate:

| Candidate | Where it lives |
|---|---|
| Research, prototype, inventory, measurement — an implementer can execute it and produce an artifact | **`spur task`** child of the map |
| A decision needing the operator's judgment — "decide X", "choose A or B", "what should the contract be" | **`## Open questions`** on the map body, never a task |

A decision filed as a task sits in the feature's Tasks table looking like queued work, gets handed to an implementing agent, and is either stalled on or invented. Resolve open questions in conversation with the operator; record the answer in **`## Decisions so far`**; then create tasks for whatever work the answer implies.

**Shippable destinations:** If the map destination is a **shippable implementation** (code lands, not design-doc-only), research and prototype tickets alone are not “feature done.” After investigation tickets close, graduate implement work into tasks; close the map only when `/sp:dev-verifyall --feature <id> --fix all` reports **`Shippable: PASS`** (or use `--skip-shippable` only for deliberate non-ship audits). Per-task research PASS is not enough — see `sp:code-verification` Step 13.

### 2. The Destination Fixes the Scope

The destination is a one-line statement of what reaching the end of this map looks like — the spec, decision, or change this effort is finding its way to. Every session orients to it before choosing a ticket. Scope is fixed by the destination: work beyond it is out of scope, not fog.

### 3. One Ticket Per Session

**Never resolve more than one ticket per session.** Multiple tickets in one session defeat the purpose — deliberate, bounded investigation steps. This pairs naturally with sp's batch execution model: the batch driver can loop over frontier tickets one per session.

### 4. Claim Before Work

A session claims a ticket by transitioning it to `wip` (`spur task update <wbs> wip`) **before any work begins**. This prevents concurrent sessions from colliding on the same ticket.

### 5. Refer by Name

Every map and ticket has a name — its title. In everything the operator reads, refer to it by WBS + title, never by a bare WBS number. A wall of bare numbers is illegible; names read at a glance.

### 6. The Map Is an Index, Not a Store

The map lists decisions made and points at the tickets that hold their detail. A decision lives in exactly one place — its ticket — so the map never restates it, only gists it and links.

## Process

Two modes. Either way, **never resolve more than one ticket per session.**

### Chart the Map

Invoked when the operator has a loose idea and the destination itself is foggy. Charting IS one session's work — do not also resolve tickets.

0. **Branch first.** `git checkout -b wayfind/<destination-slug>` before touching the map. A session is what spans the fog edit and the tickets it graduates into — routinely separate commits — so the branch point is the only boundary that contains both. The `corpus.ungraduated-fog` gate measures `merge-base(origin/main, HEAD)..(working tree)`, which means it **cannot fire at all** on work done directly on the default branch. That is exactly how the 2026-08-07 incident shipped.
1. **Name the destination.** Run a discovery interview (one question at a time, always with a recommendation) to pin down what this map is finding its way to — the spec, decision, or change. The destination fixes the scope, so it's settled first.
2. **Map the frontier breadth-first.** Fan out across the whole space rather than deep on any one thread, surfacing open decisions and the first steps takeable now. Use the decision-brief format for each HITL choice (see `../spur-dev/references/decision-brief.md`).
3. **Create the map as a spur feature.** `spur feature create "<destination>"`. The feature description carries:
   - **## Destination** — the one-line destination statement
   - **## Notes** — domain context, skills every session should consult, standing preferences. Fog and scope cuts live **under** Notes as `###` subsections, not as standalone `##` sections — the `corpus.ungraduated-fog` gate matches `### Not yet specified` and `### Out of scope` (nested under Notes), so a top-level `##` heading the gate cannot see is a defect, not a style preference.
   - **## Open questions** — sharp decisions that need the operator's judgment. These are **never tasks**. Each carries the question, why only the operator can settle it, and what it blocks. Resolved in conversation, then moved to Decisions so far.
   - **## Decisions so far** — empty on creation; populated as questions and tickets resolve (one line each: the decision, or WBS + title + one-line gist)
   - **### Not yet specified** — the fog of war: in-scope questions you can sense but can't yet phrase sharply enough to ticket. Nest under `## Notes`.
   - **### Out of scope** — work consciously ruled beyond this destination. Nest under `## Notes`.
4. **Create child tasks only for executable investigations.** `spur task create "<title>" --feature <feature-id>` for each sharp question **an implementer can answer without the operator** — research, prototype, inventory, measurement. Anything needing the operator's judgment goes to **## Open questions** instead. Ticket types (see below) determine which skill resolves the tasks.
5. **Wire blocking edges.** After all tickets exist (they need IDs before they can reference each other), set dependencies via `spur task update`. Wiring sorts tickets into the frontier (open, unblocked, unclaimed) and the blocked.
6. **Populate the fog.** Everything you can't yet specify stays in **### Not yet specified** — sketch it as loosely or as fully as the view allows. Don't pre-slice fog into ticket-sized pieces; one patch may graduate into several tickets, or none.
7. **Stop.** Charting is one session's work.

### Work Through the Map

Invoked when a map already exists (operator provides the feature ID). A ticket is **optional** — without one, pick the next frontier ticket, not the operator's preference.

0. **Branch first.** `git checkout -b wayfind/<wbs>-<slug>`, for the same reason as charting: steps 6 and 7 below remove fog from the map, and the gate that checks the removal was paid for measures the branch, not the commit. On the default branch the check silently passes no matter what you delete.
1. **Load the map** — the feature description (the low-res view), not every task body. Read the destination and Decisions-so-far to orient.
2. **Pick the first frontier ticket.** Query: `spur task list --feature <id> --status todo` — the first open, unblocked, unclaimed task. If the operator named one, use it instead.
3. **Claim it.** `spur task update <wbs> wip` — before any work.
4. **Resolve it per its type.** Zoom as needed: read related or closed ticket bodies on demand. Consult the skills the feature's **## Notes** block names.

   | Ticket Type | Resolution method | Records |
   |---|---|---|
   | **Research** | Fact-finding, doc reading, API exploration. Delegate to `sp:brainstorm` or deep-research via `spur agent run`. | Linked summary as a task artifact |
   | **Prototype** | Cheap, rough, concrete artifact to react to — an outline, stub, or rough implementation via `sp:code-implementation`. | Linked prototype as a task artifact |
   | **Task** | Literal manual work — nothing to prototype or research. Moving data, provisioning access. | Checklist in task body; resolved when done |

   An open question from the map is **not** resolved this way. It is settled with the operator in
   conversation (`AskUserQuestion` where available) and recorded straight into **## Decisions so far**
   — no task is claimed, and it does not consume the session's one ticket.

5. **Record the resolution.** Post the answer in the task body, then `spur task update <wbs> done`. Append one line to the map's **## Decisions so far**: `- [<WBS> <title>](path) — <one-line gist of the answer>`.
6. **Graduate fog into new tickets.** Any fog the answer has made specifiable becomes fresh child tasks (create-then-wire). Clear each graduated patch from **### Not yet specified** so it lives only as its new ticket. Doing half of this — deleting the fog without creating the ticket — destroys the only record the work was ever identified, so `corpus-check` fails the branch (`corpus.ungraduated-fog`) unless the removal is matched by a new/re-parented ticket or a line in **### Out of scope**.
7. **Rule out mis-scoped tickets.** If the answer reveals a ticket sits beyond the destination, close it and add one line to **### Out of scope** (the gist + why it's out of scope, linking the closed ticket). A scope boundary is not a step on the route — it stays out of **## Decisions so far**.
8. **Stop after ONE ticket.** Never resolve more than one per session.

### Ticket Types

Each ticket carries its type in the task body or a tag, signaling which skill resolves it. **Every type here is executable by an implementer** — that is what makes it a task at all. Decisions are not on this list; they live in the map's `## Open questions`.

| Type | Label | Resolved by | When to use |
|------|-------|-------------|-------------|
| Research | `wayfinder:research` | `sp:brainstorm` / `spur agent run` | Knowledge outside the current working directory is required |
| Prototype | `wayfinder:prototype` | `sp:code-implementation` (rough take) | "How should it look/behave?" is the key question |
| Task | `wayfinder:task` | Manual checklist | Literal work with nothing to decide, prototype, or research |

### Fog of War

The map is **deliberately incomplete**: don't chart what you can't yet see. Beyond the live tickets lies the fog of war — the dim view of decisions and investigations you can tell are coming but can't yet pin down, because they hang on questions still open. Resolving a ticket clears the fog ahead of it, graduating whatever's now specifiable into fresh tickets.

The map's **### Not yet specified** section (nested under `## Notes`) is where that dim view is written down: the suspected question, the area to revisit later. It's the undiscovered frontier toward the destination — everything here is in scope, just not sharp enough to ticket.

**Ask, merge, ticket, or fog?** Sharpness alone does not earn a ticket — a ticket costs a whole session, so it must also need one *and* be worth one on its own. Apply the tests in this order:

1. **Ask now when** the question is sharp **and the operator already holds the answer** — a preference, a scope call, a ruling only they can make. These are decision briefs, not investigations. Put them to the operator in the charting session (`AskUserQuestion` where available), record the answer directly in **## Decisions so far**, and never create a ticket. A ticket here buys nothing and costs a session.
2. **Merge when** the question is sharp and needs real work, **but a sibling ticket's session would answer it anyway** — same files, same sources, same body of evidence, or one is unreadable without the other. Cohesion beats sharpness: two sharp questions answered by one investigation are **one ticket**. See [`../spur-dev/references/cross-cutting.md`](../spur-dev/references/cross-cutting.md) § Task sizing.
3. **Ticket when** the question is sharp, answering it needs real work, no sibling covers it, **and an implementer can execute it without the operator** — research, a prototype, a codebase inventory, a measurement. Blocked-but-sharp still tickets.
3b. **Open question when** it is sharp and needs deciding but the operator holds the judgment and is not available right now. It goes to the map's **## Open questions**, never to a task. This is test 1's deferred form: the answer still comes from the operator, just in a later session.
4. **Not yet specified when** you can't yet phrase the question sharply. Don't pre-slice the fog into ticket-sized pieces: it's coarser than a ticket, and one patch may graduate into several tickets, or none, once the frontier reaches it.

Three failure modes this prevents:

- Charting a map, then watching the operator answer half the tickets in their next message. Those were briefs mis-filed as tickets (test 1) — consolidate them and record the answers.
- Charting a map the operator sends back as over-sliced. Those were cohesive investigations split across tickets (test 2). Splitting one body of evidence across several sessions is worse than merging: each session re-derives the same context, and no session sees the whole picture.
- Filing a decision as a task (test 3 vs 3b). It then sits in `spur task list` looking like queued work; an implementing agent picks it up and either stalls or invents the decision and calls it done. Task files are work to be done, not questions to be answered.

**Sanity check before creating the tickets:** count them. A first cut above ~5 is a signal, not a plan — re-run test 2 across every pair before writing anything. Prefer the coarser map; a ticket that turns out to hold two questions can be split when the frontier reaches it, but a session spent on a fragment is spent.

**Not yet specified** excludes what's already decided (Decisions so far), what's already a live ticket, and what's out of scope.

### Out of Scope

Fog only ever gathers toward the destination. The destination fixes the scope, so work beyond it is out of scope — it isn't fog, and it doesn't belong in **### Not yet specified**. It gets its own **### Out of scope** section on the map (nested under `## Notes`): work consciously ruled out of this effort.

Out-of-scope work never graduates — the frontier stops at the destination — so it returns only if the destination is redrawn, and then as a fresh effort, not a resumption.

Ruling something out of scope is a scoping act, not a step on the route. When a ticket that already exists turns out to sit past the destination, close it and leave one line in **### Out of scope**: the gist plus why it's out of scope, linking the closed ticket.

## Invocation

### From `/sp:dev-brainstorm` (semi-automatic escalation)

At the end of the discovery interview (Phase 1), the brainstorm command runs a **scope check**: "Can this be spec'd in one session, or is the destination itself still foggy?" If foggy, it offers wayfinding as the escalation path:

> *"This is a multi-session investigation. Want me to chart a wayfinder map so we can work through it one decision at a time?"*

The operator confirms before wayfinding begins — never silently escalate. The `--wayfind` flag on `/sp:dev-brainstorm` skips the prompt and enters wayfinding directly.

### Direct invocation

The operator invokes this skill directly: `Skill(skill="sp:wayfinder", args="<loose idea or feature ID>")`. If the argument is a feature ID, enter "Work through the map" mode. Otherwise, enter "Chart the map" mode.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I can spec this now if I just think hard enough." | A foggy destination isn't a thinking-harder problem — it's a missing-information problem. Chart the map and resolve one ticket to get the first missing piece. |
| "Let me resolve a few tickets while I'm here — it's efficient." | Multiple tickets in one session defeat the purpose. Each resolution clears fog that changes what the next ticket should ask. Stop after one. |
| "The fog section is vague — skip it and just create tickets for what's clear." | The fog IS the value. It tells the next session (or another operator) where the effort is headed and what's suspected but not yet sharp. An empty fog section hides the known-unknowns. |
| "I'll auto-escalate to wayfinding when the topic looks big." | Scope judgment needs human confirmation. A 30-minute quick-answer need might touch a big domain without requiring a multi-session map. Always ask. |
| "The map feature description is just boilerplate — the tasks are what matter." | The map is the orienting artifact every session loads first. Without a clear destination and running Decisions-so-far log, each session re-derives context from scratch. |
| "I'll pre-slice the fog into ticket stubs so the map looks more complete." | Pre-sliced fog is noise — it creates tickets for questions you can't yet phrase, which wastes time and may point the wrong direction once earlier tickets resolve. |
| "Making it a task gives the decision a WBS, a status, and a place in the queue." | Those are exactly the reasons not to. A decision with a WBS looks like queued work to every agent and dashboard that reads the corpus, and an implementer handed it will invent the answer rather than stall. The map's **## Open questions** gives it a home without pretending it is executable. |
| "More tickets make the map look thorough." | A ticket costs a session. If the operator answers it in their next message, it was a decision brief mis-filed as a ticket — ask those during charting and record them in Decisions so far. |
| "These are two distinct questions, so they're two tickets." | Distinctness is not the test — cohesion is. If one investigation's evidence answers both, they're one ticket. A map is judged by how few sessions reach the destination, not by how many questions it enumerates. |
| "I'll ticket the secondary sources now and handle the primary ones downstream." | Backwards. The sources or files the operator cares most about belong in the *first* discovery ticket. Deciding a contract on evidence from the peripheral cases is how a map ends up re-derived later. |

## Red Flags

- Resolving more than one ticket in a single session.
- Charting or resolving directly on the default branch — the `corpus.ungraduated-fog` gate is branch-scoped, so on `main` fog can be deleted with no ticket and nothing complains.
- Creating a map without a destination statement — the destination fixes scope; without it, every ticket is unbounded.
- Auto-escalating to wayfinding without operator confirmation (except under `--wayfind`).
- An empty or missing **### Not yet specified** section when the destination was described as foggy — fog that isn't written down is fog the next session can't see.
- Skipping the claim step (`spur task update <wbs> wip`) before work — concurrent sessions may collide.
- Pre-slicing fog into ticket stubs before the questions are sharp.
- Ticketing a question the operator could answer on the spot — a preference or scope ruling is a decision brief, not an investigation ticket.
- A ticket whose deliverable is a decision ("decide X", "choose A or B", "what should the contract be"). Task files are work to be done; that belongs in **## Open questions**.
- Two tickets that would read the same files or the same sources to answer — that is one investigation split in two.
- A discovery ticket that omits the operator's primary subjects while a downstream ticket covers them.
- A first cut above ~5 tickets that was written without re-checking every pair for cohesion.
- Referring to tickets by bare WBS number instead of WBS + title.
- Treating wayfinding as a replacement for brainstorming — wayfinding is for when the destination ITSELF is foggy, not for generating options toward a clear destination.

## Verification

### Charting verification

- [ ] The session ran on its own branch, not the default branch (`git branch --show-current`).
- [ ] Destination is a single, concrete sentence (not a paragraph, not a vague noun phrase).
- [ ] Map feature exists (`spur feature show <id>` returns clean).
- [ ] Feature description has all six sections: Destination, Notes, Open questions, Decisions so far (empty), Not yet specified, Out of scope.
- [ ] No task's deliverable is a decision — every ticket is executable by an implementer without the operator. Decisions sit in **## Open questions**.
- [ ] Every specifiable question has a child task with a sharp, answerable question in its body.
- [ ] Blocking edges are wired (tasks that depend on others list them in their dependency graph).
- [ ] No ticket pre-slices fog — every ticket's question is precise enough to answer in one session.
- [ ] No two tickets would be answered by the same investigation — every pair passed the cohesion test (§ Fog of War, test 2).
- [ ] The operator's primary subjects are covered by a frontier ticket, not deferred behind one.

### Resolution verification

- [ ] The session ran on its own branch, not the default branch (`git branch --show-current`).
- [ ] Exactly one ticket was resolved this session.
- [ ] The ticket was claimed (`wip`) before work began.
- [ ] The resolution is recorded in the task body (not just a status transition — the answer is written down).
- [ ] The map's **## Decisions so far** has one new line: WBS + title + one-line gist.
- [ ] Any graduated fog was removed from **### Not yet specified** and created as new child tasks.
- [ ] Any mis-scoped tickets were closed and recorded in **### Out of scope**.

## Reference Files

- **`../spur-dev/references/decision-brief.md`** — Decision-brief format for HITL choices during charting
- **`../spur-dev/references/cross-cutting.md`** — Verification-before-completion rule (one-ticket-per-session discipline)
- **`../spur-dev/references/execution-batch.md`** — Batch execution model (pairs with one-ticket-per-session loop)

## Platform Notes

### Claude Code

- Use `Skill(skill="sp:brainstorm", args="dev-brainstorm --context ...")` for research tickets
- Use `Skill(skill="sp:code-implementation", ...)` for prototype tickets
- Use `AskUserQuestion` to settle the map's open questions — they are conversations, not tickets
- Use `Bash` with `spur` CLI for all task/feature operations
- Use `AskUserQuestion` for the scope-check confirmation

### Other Platforms

- Delegate research via `spur agent run`
- Delegate task/feature operations via `spur` CLI
- Charting and resolution protocol is platform-agnostic
- Output format is platform-agnostic markdown

---

**Remember:** Wayfinding is about finding the way, not charging at the destination. Chart deliberately. Resolve one ticket at a time. The map is the shared artifact that survives session boundaries — keep it current.
