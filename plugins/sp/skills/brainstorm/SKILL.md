---
name: brainstorm
description: "Structured ideation workflow for generating solution options with trade-offs, confidence scoring, and delegation to research and task creation skills. Triggers: brainstorm ideas, explore solutions, consider options, research approaches, multiple solution options with trade-offs."
license: Apache-2.0
version: 1.0.0
created_at: 2026-03-25
updated_at: 2026-03-25
type: technique
platform: sp
tags: [brainstorm, ideation, solution-generation, trade-offs, workflow-core]
metadata:
  author: cc-agents
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
    - input
    - ideate
    - output
see_also:
  - cc:anti-hallucination
  - sp:spur-tasks
---

# sp:brainstorm — Structured Ideation Workflow

Generate solution options with trade-offs, recommendations, and confidence scoring. Delegates research to specialized skills.

**Key distinction:**
- **`sp:brainstorm`** = Ideation: generate approaches with trade-offs
- **research** = verify and synthesize information (delegate via `spur agent run`)
- **`sp:spur-dev`** = Task creation: structured task breakdown (planning half)
- **`cc:anti-hallucination`** = Verification: source-first claim validation

## Overview

The `sp:brainstorm` skill generates multiple solution approaches with explicit trade-offs, confidence scoring, and source citations. It follows a structured 3-phase workflow: Input parsing, Ideation with research delegation, and structured Output. Unlike pure research or bare task creation, brainstorm focuses on ideation—generating and comparing options before committing to a solution path.

## Quick Start

```typescript
// Trigger: "I need to add real-time collaboration. What are my options?"
// Brainstorm generates 2-3 approaches with trade-offs, delegates research and task creation
```

**3-Phase Workflow:**

```
1. INPUT    → Parse (file path or issue description), extract context
2. IDEATE   → Generate approaches with trade-offs (delegate research via spur agent run)
3. OUTPUT   → Structured markdown, optional task delegation
```

## When to Use

Activate sp:brainstorm when:

| Trigger Phrase | Description |
|----------------|-------------|
| "brainstorm ideas" | User wants multiple solution options |
| "explore solutions" | User wants to evaluate alternatives |
| "consider options" | User wants trade-off analysis |
| "research approaches" | User wants evidence-backed options |
| "what are my options?" | User wants multiple solutions |
| "how should I approach X?" | User wants recommendation with reasoning |

**NOT for:**
- Pure research (use `spur agent run` for research instead)
- Task creation without ideation (use `sp:spur-dev` instead)
- Fact-checking or verification only (use `cc:anti-hallucination` instead)
- Task file operations (use `sp:spur-tasks` instead)

## Core Principles

### 1. Two Input Modes

```
IF input contains "/" or "\" AND ends with ".md":
    → Treat as file path → read and extract context
ELSE:
    → Treat as issue description → use directly
```

### 2. Clarify Before Ideating

Use `AskUserQuestion` for ambiguous or insufficient input:

**Clarification triggers:**
- Input < 20 characters
- Missing Background or Requirements (if from task file)
- Undefined technical terms
- Multiple valid interpretations

**Format:** One question at a time, prefer multiple choice options.

### 3. Delegate Research

Don't implement research directly. Delegate to specialized skills:

```
For verification → cc:anti-hallucination
For synthesis → `spur agent run`
```

### 4. Generate 2-3 Approaches

Always generate multiple options:

```
Approach 1: [Name] ⭐ Recommended
  - Description: 2-3 sentences
  - Trade-offs: Pros / Cons
  - Confidence: HIGH/MEDIUM/LOW
  - Sources: [Citations]

Approach 2: [Name]
  [... same structure ...]

Approach 3: [Name]
  [... same structure ...]
```

### 5. Confidence Scoring

| Level | Score | Criteria |
|-------|-------|----------|
| **HIGH** | >90% | Direct quote from official docs (2025+), verified today |
| **MEDIUM** | 70-90% | Synthesized from multiple sources |
| **LOW** | <70% | Uncertain, needs verification, flag for review |

**Always cite sources with dates:**
```markdown
**Source**: [URL]
**Verified**: YYYY-MM-DD
**Confidence**: HIGH
```

### 6. Task Delegation

When user confirms approach, delegate task creation:

```
// Pseudocode: Delegate to sp:spur-dev for structured task breakdown
Skill("sp:spur-dev", args: "convert <approach> to tasks")

// Then use sp:spur-tasks for file creation
Bash: spur task batch-create decomposition.json   # bare JSON array (see sp:spur-tasks)
```

## Workflow

### Phase 1: Input Processing

**Goal:** Parse and validate input, extract context

**Input detection:**
1. Check if path → read file, parse YAML frontmatter
2. Extract Background, Requirements sections
3. Validate non-empty content

**Clarification:**
- Use `AskUserQuestion` for ambiguous input
- One question at a time
- Prefer multiple choice

### Phase 2: Ideation (Research + Generation)

**Goal:** Generate 2-3 solution approaches with trade-offs

**Research delegation:**
```
1. Invoke cc:anti-hallucination for verification protocol
2. Use `spur agent run` for research + synthesis
3. Generate approaches based on verified information
```

**Approach structure:**
```markdown
### Approach N: [Descriptive Name] ⭐ (if recommended)

**Description:** 2-3 sentences explaining the approach

**Trade-offs:**
- **Pros:**
  - Advantage 1
  - Advantage 2
- **Cons:**
  - Disadvantage 1
  - Disadvantage 2

**Implementation Notes:**
- Key technical considerations
- Dependencies or prerequisites

**Confidence:** HIGH/MEDIUM/LOW
**Sources:** [Citations with dates]
```

### Phase 3: Output

**Goal:** Format and deliver structured results

**Output sections:**
1. **Overview** — Context and problem summary (100-150 words)
2. **Approaches** — 2-3 options with trade-offs (200-300 words each)
3. **Recommendations** — Recommended approach with reasoning
4. **Next Steps** — Potential task items

**Interactive delivery:**
```
1. Show Overview → "Does this capture the problem?"
2. Show Approaches → "Any clarifications on these options?"
3. Show Recommendations → "Ready for task creation?"
```

**File saving:**
```
docs/plans/YYYY-MM-DD-<topic>-brainstorm.md
```

## Tool Selection

| Research Need | Delegate To | Notes |
|--------------|-------------|-------|
| Verification protocol | `cc:anti-hallucination` | Source-first validation |
| Information synthesis | `spur agent run` | Multi-source consolidation |
| Task breakdown | `sp:spur-dev` | Structured tasks |
| Task file creation | `sp:spur-tasks` | WBS assignment, kanban |

## Error Handling

| Phase | Error | Action |
|-------|-------|--------|
| Input | File not found | Clear error, suggest checking path |
| Input | Empty content | Ask for clarification |
| Ideation | Tool unavailable | Continue with available, note reduced confidence |
| Output | Save fails | Display output, suggest manual save |
| Tasks | CLI fails | Report error, suggest manual creation |

## Anti-Hallucination Integration

sp:brainstorm delegates verification to cc:anti-hallucination:

**Protocol:**
1. **CHECK** — Does this claim need verification?
2. **SELECT** — Best tool for information type
3. **SEARCH** — Execute verification
4. **CITE** — Include source with date
5. **SCORE** — Assign confidence level

**Confidence levels:**
- **HIGH**: Direct quote from official docs (2025+)
- **MEDIUM**: Synthesized from multiple sources
- **LOW**: Uncertain, flag for review

## Common Pitfalls

| Pitfall | Prevention |
|---------|------------|
| Skipping clarification | Always validate input clarity before ideation |
| Single approach only | Always generate 2-3 options with trade-offs |
| Missing confidence scoring | Cite sources and assign confidence to each approach |
| Over-ideating | Limit to 3 approaches; delegate deeper research |
| Skipping task delegation | Offer task creation after user confirms approach |
| Ignoring graceful degradation | Continue with available tools if research tools fail |

## Best Practices

- **Input first** — Clarify before generating to avoid rework
- **Delegate research** — Use specialized skills, don't reimplement
- **Evidence-based** — Always cite sources with dates
- **Trade-off clarity** — Make pros/cons explicit for each approach
- **Interactive delivery** — Show sections incrementally, confirm understanding
- **Concrete next steps** — Convert recommendations to actionable tasks

## Reference Files

- **`references/workflows.md`** — Detailed 3-phase workflow with examples and templates
- **`examples/ideation-example.md`** — Complete example with TypeScript/Bun implementation

## Platform Notes

### Claude Code

- Use `AskUserQuestion` for clarification prompts
- Use `Skill` to delegate to research skills
- Use `Bash` with `tasks` CLI for task creation

### Other Platforms

- Delegate research via `spur agent run`
- Delegate tasks via `sp:spur-dev`
- Output format is platform-agnostic markdown

---

## Planned scenario-specific commands (candidates — not yet shipped)

Today's skill is deliberately generic. Per the delivery-doc §7.2 disposition (I05), `sp:brainstorm`
gains a set of **scenario-specific slash commands** with targeted customization in a later batch
(names finalized at Stage D). Recorded here so the candidate set isn't lost; no commands ship now.

| Candidate command | Scenario it specializes for |
|---|---|
| `sp:brainstorm-arch` | Architecture/design-tradeoff exploration (coupling, scaling, blast radius) |
| `sp:brainstorm-fix` | Bug root-cause hypotheses → ranked fix approaches |
| `sp:brainstorm-feature` | Feature-shaping: scope options + AC sketches feeding `sp:spur-dev` |
| `sp:brainstorm-stack` | Library/dependency selection with evidence-backed trade-offs |
| `sp:brainstorm-refactor` | Refactor strategy options for a shallow/over-coupled module |

Each would be a thin wrapper invoking this skill with a pre-seeded scenario frame (ADR-016 test
applies per candidate when the batch is built — ship only those that convert non-deterministic
intent into a reliable sequence, not bare forwarders).

---

**Remember:** Ideation ≠ Research. Generate approaches with trade-offs. Delegate verification to `cc:anti-hallucination`. Delegate synthesis/research to `spur agent run`. Delegate task creation to `sp:spur-dev`.
