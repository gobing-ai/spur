---
template: feature-impl
schema_version: 1
name: "bind structured-input tool calls in dev-brainstorm and brainstorm"
description: ""
status: done
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-08T23:04:24.460Z"
updated_at: "2026-07-08T23:12:49.878Z"
---

## 0229. bind structured-input tool calls in dev-brainstorm and brainstorm

### Background

The `sp:dev-brainstorm` command and `sp:brainstorm` skill both ask the operator clarifying
questions (discovery interview, ambiguous-input clarification). Both files already name
in `allowed-tools` / platform notes, and the `decision-brief.md` SSOT already mandates the
recommendation + option-score shape. But none of the three sites **binds** the rendered shape to a
structured-input tool call. An agent reading the current prose can comply by rendering a markdown
block (**Decision / Recommendation / Alternatives**) and waiting for a free-typed response — never
calling `AskUserQuestion` at all. The point is lost: options become text the user re-reads and
re-types, instead of a selectable list.

The gap is narrow: a binding directive that says "call the structured-input tool (when available)
with the decision-brief's contents as its option array; render markdown text only as fallback."
Three surgical edits close it — no structural rewrite, no new reference file, no platform
enumeration per site.

### Requirements

<!-- R-numbered list derived from the linked feature or refined task scope. -->

R1. `dev-brainstorm.md` Phase 1 must add a binding directive after the question-format block
(after line 78) mandating that when a structured-input tool (`AskUserQuestion` on Claude Code, the
equivalent tool on other platforms) is available, the agent invokes it with the recommended answer
as the pre-selected / recommended option. Plain-text rendering is the fallback only. The directive
must point to `decision-brief.md` for the content of each option (question, stakes,
recommendation, pros/cons). `plugins/sp/commands/dev-brainstorm.md:68-84`.

R2. `brainstorm/SKILL.md` core principle 1 ("Two Input Modes, Clarify Before Ideating", lines 80-86)
must add a half-sentence binding clause: when a structured-input tool is available, call it
directly with the decision-brief contents — do not render the brief's shape as markdown text and
then also call the tool (one rendering channel; tool wins). `plugins/sp/skills/brainstorm/SKILL.md:80-86`.

R3. `decision-brief.md` must add one binding clause: where a structured-input tool exists, render
the brief *as* the tool's option array — recommendation → `recommended` field, options → `options[]`,
scores / pros / cons folded into each option's description. Do not double-render (markdown text +
tool call) — pick one, tool wins. `plugins/sp/skills/spur-dev/references/decision-brief.md`.

R4. The edits must NOT change Phase 2 ideation, the `--wayfind` path, the `--task` / `--feature`
exits, or the platform-notes sections beyond a single half-sentence pointer ("or call your
platform's structured-input tool with the same options"). Scope is the three binding sites only.

R5. No new reference file. No new platform-equivalent enumeration per site (the existing platform
notes sections already handle "Claude Code vs other"; a single pointer suffices). No gating logic
on tool availability — the agent already knows its available tools; a static bifurcating instruction
covers the fallback.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature or do not leave placeholder AC here. -->

#### AC-1: dev-brainstorm.md binds the question format to a tool call

- **Given** `dev-brainstorm.md` is read
- **When** Phase 1's question-format section is inspected
- **Then** a directive mandates invoking the structured-input tool (when available) with the recommended answer as the pre-selected option
- **And** plain-text rendering is explicitly the fallback only
- **And** the directive points to `decision-brief.md` for option content

#### AC-2: brainstorm/SKILL.md principle 1 binds to a tool call

- **Given** `brainstorm/SKILL.md` is read
- **When** core principle 1 (lines 80-86) is inspected
- **Then** a clause says: when a structured-input tool is available, call it directly with the decision-brief contents
- **And** it prohibits double-rendering (markdown text + tool call)

#### AC-3: decision-brief.md mandates tool-call rendering where available

- **Given** `decision-brief.md` is read
- **When** the rules section is inspected
- **Then** a clause says: where a structured-input tool exists, render the brief as the tool's option array (recommendation → recommended field, options → options[], scores → option descriptions)
- **And** it prohibits double-rendering — pick one channel, tool wins

#### AC-4: scope is bounded to the three binding sites

- **Given** all three files after the edit
- **When** Phase 2 ideation, the `--wayfind` path, the `--task` / `--feature` exits, and platform-notes sections are inspected
- **Then** none of them have been structurally rewritten
- **And** platform-notes additions are limited to a single half-sentence pointer

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

**Q1: Why not rewrite the question-format section to lead with the tool-call shape first?**

A: Higher churn for the same outcome. The existing decision-brief SSOT already defines the *content*
shape; the missing piece is the *binding* — "call the tool, don't just render text." A binding
directive after the existing format block achieves the outcome without restructuring prose that's
already correct.

**Q2: Why no platform-equivalent enumeration per site?**

A: The three target files already have platform-notes sections that handle "Claude Code vs other."
Enumerating equivalents inline would duplicate that and create a third inconsistency (per AGENTS.md
R6 — surface conflicts, don't average them). A single pointer in each platform-notes section is
sufficient; the binding directive itself is platform-agnostic ("when a structured-input tool is
available").

**Q3: Why not add a runtime gate on tool availability?**

A: The agent already knows its own available tools; a static bifurcating instruction ("when
available, call; otherwise render text") is lighter than runtime detection logic and matches the
existing pattern in the platform-notes sections. Runtime gating would couple documentation to tool
introspection, which isn't where this belongs.

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

**Approach: three surgical binding directives, no structural rewrite.**

| Edit | File | Location | Shape |
|---|---|---|---|
| E1 | `plugins/sp/commands/dev-brainstorm.md` | after the question-format block (after line 78) | New short subsection: "Binding: when a structured-input tool (`AskUserQuestion` on Claude Code, equivalent on other platforms) is available, invoke it with the recommended answer as the pre-selected / recommended option. Render the markdown block above only as a fallback. Option content per `decision-brief.md`." |
| E2 | `plugins/sp/skills/brainstorm/SKILL.md` | end of core principle 1 (line 86) | Half-sentence: "When a structured-input tool is available, call it directly with the decision-brief contents — do not render the brief as markdown text and also call the tool; pick one channel (tool wins)." |
| E3 | `plugins/sp/skills/spur-dev/references/decision-brief.md` | new rule in the Rules section | "Where a structured-input tool exists, render the brief *as* the tool's option array — recommendation → `recommended` field, options → `options[]`, scores / pros / cons into each option's description. Do not double-render (markdown text + tool call) — pick one; the tool wins." |

**Invariants:**
- One rendering channel per question (tool wins, text is fallback).
- The decision-brief SSOT remains the content SSOT; the binding adds only the *channel* rule.
- No structural change to Phase 2, `--wayfind`, `--task`, `--feature`, or platform notes (beyond a
  half-sentence pointer already covered by the "or call your platform's structured-input tool"
  language in E1).

**Tradeoffs:**
- Static bifurcation over runtime gating — lighter, but relies on the agent reading its own tool
  availability. Acceptable: the same pattern already works in the platform notes.
- No new reference file — keeps the SSOT in `decision-brief.md`. Cost: the binding clause lives in
  three places, but each is one sentence pointing at the same SSOT.

**Impacted surfaces (3 files):**
1. `plugins/sp/commands/dev-brainstorm.md` — Phase 1 binding directive (R1).
2. `plugins/sp/skills/brainstorm/SKILL.md` — principle 1 binding clause (R2).
3. `plugins/sp/skills/spur-dev/references/decision-brief.md` — Rules section binding rule (R3).

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

- [x] **P1**: E1 — add binding directive to `dev-brainstorm.md` after line 78.
- [x] **P2**: E2 — add binding clause to `brainstorm/SKILL.md` principle 1 (line 86).
- [x] **P3**: E3 — add binding rule to `decision-brief.md` Rules section.
- [x] **P4**: Run `bun run lint` and `bun run typecheck` — verify clean.
- [x] **P5**: Run `bun test` — verify full suite passes (documentation-only; expect no failures).
- [x] **P6**: Run `spur task check 0229 --strict` — verify task passes strict check.
- [x] **P7**: Write Solution + Testing sections, transition to done.

### Solution

Three surgical binding directives added, one per target file. No structural rewrites; Phase 2
ideation, `--wayfind` path, `--task` / `--feature` exits, and platform-notes sections are untouched
beyond the bounded additions specified in R4.

| Edit | File:line | Change |
|---|---|---|
| E1 (R1) | `plugins/sp/commands/dev-brainstorm.md:79-85` | Inserted 7-line binding directive after the question-format code block close (line 78). Mandates invoking `AskUserQuestion` (or platform equivalent) with the recommended answer as the pre-selected option; markdown rendering is the fallback only; points to `decision-brief.md` for option content. |
| E2 (R2) | `plugins/sp/skills/brainstorm/SKILL.md:81-88` | Rewrote core principle 1 paragraph (was 6 lines, now 8) to incorporate the decision-brief SSOT pointer and the binding clause: "When a structured-input tool is available, call it directly with the decision-brief contents as its option array — do not render the brief as markdown text and also call the tool. One channel per question; the tool wins, markdown text is the fallback only." |
| E3 (R3) | `plugins/sp/skills/spur-dev/references/decision-brief.md:62-67` | Added 2-line rule "Tool-call rendering where available" to the Rules section: render the brief *as* the tool's option array (recommendation → `recommended` field, options → `options[]`, scores / pros / cons folded into each option's description); do not double-render; markdown template is fallback only. |

R4 (scope boundary) verified: no changes to Phase 2 ideation sections, `--wayfind` path,
`--task` / `--feature` exits, or platform-notes sections in any of the three files. The binding
clauses are additive to the existing prose and do not restructure surrounding sections.

R5 verified: no new reference file created; no per-site platform-equivalent enumeration added — the
existing platform-notes sections handle Claude Code vs other platforms; each binding directive is
platform-agnostic ("when a structured-input tool is available").

### Testing

Coverage: N/A (documentation-only change — 3 markdown files, no runtime code modified).

Verification gates:
- `bun run lint` (Biome + per-workspace `tsc --noEmit`) — clean, exit 0.
- `bun test ./apps/cli ./apps/server ./apps/web ./packages ./plugins` — 2499 pass / 0 fail / 6942 expect() calls across 176 files (matches baseline).
- `spur task check 0229 --strict` — PASS.

No tests added or modified (R5: no new reference file; documentation-only scope).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: H1 (spur-dev umbrella skill)
- `dev-brainstorm` command: `plugins/sp/commands/dev-brainstorm.md:68-84` (question-format block)
- `brainstorm` SKILL: `plugins/sp/skills/brainstorm/SKILL.md:80-86` (core principle 1)
- Decision-brief SSOT: `plugins/sp/skills/spur-dev/references/decision-brief.md` (Rules section)
- Related prior tasks: 0227 (three-dimensional review), 0228 (Review/Testing double-write fix)
- Skill-structure test (asserts decision-brief SSOT + 3-site references): `plugins/sp/tests/skill-structure.test.ts:698-711`

### History

- 2026-07-08 — created, refined via `/sp-dev-brainstorm` discovery interview (3 surgical edits scope confirmed).
- 2026-07-08T23:06:55.307Z todo → wip (system)
- 2026-07-08T23:12:44.494Z wip → testing (system)
- 2026-07-08T23:12:49.878Z testing → done (system)
