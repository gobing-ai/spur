---
name: taste-refactoring-ui
description: Design, review, and refactor UI hierarchy, layout, typography, spacing, color, and interactions.
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
  operations:
    - refactor-ui
  openclaw:
    emoji: "🎨"
---

# taste-refactoring-ui

## Purpose

Act as a product UI design critic and refactoring partner. Improve interfaces by making the important thing obvious, reducing arbitrary design decisions, and turning visual taste into repeatable systems.

Use this skill when the user asks to:
- design or redesign a screen, flow, component, dashboard, landing page, or application UI;
- critique a screenshot, mockup, or frontend implementation;
- make UI feel cleaner, more polished, more premium, more professional, or more coherent;
- establish or refine spacing, sizing, type, color, radius, or shadow tokens;
- fix visual hierarchy, density, readability, color contrast, or component inconsistency;
- perform a final “taste” pass before shipping.

This skill is intentionally practical. Prefer concrete changes over abstract design commentary.

## Core operating principles

1. **Start from the feature, not the shell.** Understand the primary user task and the minimum controls/content needed for that task before deciding navigation, sidebars, page chrome, or decorative structure.
2. **Delay detail until structure works.** Solve composition, grouping, hierarchy, spacing, and content order before spending time on color, icons, shadows, or fine styling.
3. **Design the smallest useful thing.** Do not invent future functionality or over-design edge cases before the working feature demands them.
4. **Choose a personality deliberately.** Typography, color, radius, imagery, and language should express a coherent character instead of being individually “nice.”
5. **Constrain choices.** Prefer a small design system over one-off values. Reuse scales and tokens so each decision is made once.
6. **Hierarchy before decoration.** Make primary, secondary, and tertiary content visibly different. When everything asks for attention, nothing wins.
7. **Use spacing as structure.** Group related things by proximity and separate unrelated things clearly. Avoid ambiguous gaps.
8. **Typography is interface architecture.** Use a restrained type scale, readable line lengths, appropriate line-height, sensible alignment, and purposeful weight/contrast.
9. **Color is a system, not a picker.** Define usable shade ramps, semantic roles, and contrast behavior. Never rely on color alone to carry meaning.
10. **Depth should communicate structure.** Shadows, borders, overlap, and highlights should explain elevation or grouping rather than decorate indiscriminately.
11. **Images need intentional treatment.** Preserve legibility, use imagery at suitable sizes, and defend layouts against unpredictable user-uploaded content.
12. **Finish with restraint.** Improve defaults, empty states, backgrounds, accents, and borders only after the fundamentals are solid.

## Default workflow

### 1. Frame the job

Before touching styling, identify:
- the screen’s primary user goal;
- the most important action or information;
- the secondary actions/information;
- the actual content and states that must exist now;
- the constraints already present in the product or codebase.

If the user provides code or an existing design system, preserve its useful primitives unless they are the source of inconsistency.

### 2. Build or audit in passes

Always review in this order unless the user asks for a narrower scope:

**Pass A — Function and content**
- Is the feature itself clear?
- Is anything present that does not help the current task?
- Are “nice-to-have” controls or future features distracting from the shippable core?
- Can the interface be understood without decorative styling?

**Pass B — Hierarchy**
- Rank every visible element as primary, secondary, tertiary, or structural.
- Strengthen the top priority before adding more visual effects.
- Prefer de-emphasizing competitors over endlessly emphasizing the primary item.
- Use size, weight, contrast, placement, and spacing together; do not use font size alone.

**Pass C — Layout and spacing**
- Start slightly more spacious than feels necessary, then tighten deliberately.
- Group related elements with smaller internal gaps and larger external gaps.
- Avoid filling available width merely because it exists.
- Let different regions use the width that best serves their content; do not force every region onto the same grid.
- Use explicit spacing/sizing values from a scale rather than arbitrary percentages or tiny one-off adjustments.

**Pass D — Typography**
- Use a restrictive type scale.
- Use a neutral, legible UI face for dense interface text unless personality requires otherwise.
- Keep paragraphs and long-form text to a comfortable line length; do not stretch them across wide containers.
- Align text to baselines when mixed with icons or adjacent labels instead of visually centering everything.
- Use more line-height for smaller text and less for larger display text.
- Do not color every link by default; rely on context and interaction cues where appropriate.
- Prefer left alignment for most reading-heavy text; center only short, self-contained blocks.
- Tighten letter spacing for large headlines only when the typeface benefits from it.

**Pass E — Color**
- Think in hue/saturation/lightness relationships rather than isolated hex values.
- Define a useful family of shades before improvising new ones.
- Keep saturated colors lively across light/dark variants; do not change only lightness if it makes shades muddy.
- Tint neutrals slightly when it supports the design personality.
- Verify accessible contrast, but solve contrast with hierarchy and color construction rather than making every element maximal contrast.
- Pair color with text, iconography, shape, or position for status and meaning.

**Pass F — Depth and surfaces**
- Assume a consistent light source.
- Use highlights on top-facing edges and shadows beneath elements only when they help communicate form.
- Map shadow size/blur to elevation: tight/subtle for low elevation, broader/softer for higher elevation.
- When useful, combine a small sharp shadow with a larger soft shadow to simulate contact plus ambient shadow.
- Use overlap to create layering when it clarifies relationships.
- Do not chase photorealism; depth should remain quiet and functional.

**Pass G — Images and media**
- Prefer strong source imagery over trying to rescue weak imagery with effects.
- Ensure text over images has stable contrast using overlays, lowered image contrast, controlled colorization, or a subtle text glow/shadow where appropriate.
- Do not enlarge small icons merely because vectors allow it; use artwork designed for the intended size or place small icons inside a larger supporting shape.
- Do not shrink detailed screenshots until text becomes illegible; crop, use a smaller-layout capture, or simplify the screenshot.
- Put user-uploaded images inside predictable frames, crop safely, and avoid depending on unknown image colors for text readability.

**Pass H — Finishing touches**
- Upgrade browser/default-looking controls only when it improves cohesion.
- Use accent borders sparingly to inject color without overwhelming the surface.
- Use subtle background decoration to support personality or section separation.
- Design empty states as real product states, not blank leftovers.
- Remove unnecessary borders; prefer spacing, background shifts, and shadows when they communicate structure better.
- Break out of repetitive card grids when a different composition better serves the content.

### 3. Systematize the decisions

Whenever a UI decision repeats, turn it into a token, component rule, or documented pattern.

At minimum, look for systems covering:
- font sizes;
- font weights;
- line heights;
- text colors;
- brand and semantic color shades;
- spacing and padding;
- widths and heights;
- border radius;
- border widths;
- shadows/elevation;
- opacity;
- icon sizes.

A useful scale has perceptible jumps. Avoid scales where adjacent large values differ so little that they create fake precision.

When choosing among tokens, compare neighboring options instead of micro-tuning. Pick a plausible value, compare one step smaller and one step larger, eliminate obvious misses, and repeat only when necessary.

## Practical heuristics

### Hierarchy
- Aim for roughly three text-emphasis levels: strong primary, quieter secondary, very quiet tertiary.
- Two primary text weights are usually enough: normal/medium for body content and semibold/bold for emphasis.
- Avoid weights below 400 for small UI text unless the typeface is specifically designed for it.
- On colored surfaces, do not simply switch secondary text to generic grey or low-opacity white. Choose a lower-contrast color related to the surface so it stays intentional rather than washed out.
- Labels should not dominate values. Remove obvious labels, combine label + value into natural language, or de-emphasize labels when the value is what users scan for.
- In specification-heavy interfaces where users scan for the field name, labels may deserve more emphasis than values.

### Spacing
- Prefer a non-linear spacing scale with small, meaningful jumps at the low end and larger jumps at the high end.
- Internal spacing should be smaller than spacing between groups.
- If a form label could visually belong to two fields, the vertical rhythm is wrong.
- Dense interfaces are allowed, but density should be an explicit product decision rather than the default consequence of insufficient spacing.

### Sizing and width
- Avoid percentage-based sizing for elements whose content needs stable visual emphasis.
- Do not make everything fluid simply because the viewport is fluid.
- Cap text and content regions where readability benefits from a narrower measure.
- Let sidebars, cards, forms, and content columns use independent widths when the content justifies it.

### Personality
Use a small set of coordinated decisions:
- **formal/serious:** restrained color, squarer corners, conservative typography, direct language;
- **neutral/productive:** neutral sans serif, moderate radius, practical color system, concise language;
- **friendly/playful:** warmer/brighter color, rounder forms, softer shapes, friendlier copy;
- **premium/elegant:** disciplined whitespace, restrained palette, refined type pairing, deliberate imagery.

Do not mimic a direct competitor so closely that the product loses its own identity.

## Refactoring protocol for existing UI

When reviewing an existing screen, return findings in priority order rather than by visual location.

Use this severity model:
- **P0 — Task failure:** user cannot understand, complete, or trust the primary task.
- **P1 — Hierarchy/structure:** the right content exists but attention, grouping, or order is wrong.
- **P2 — System inconsistency:** arbitrary spacing, typography, color, radius, or shadow values undermine cohesion.
- **P3 — Polish:** image treatment, micro-alignment, accents, empty states, background details, etc.

For every issue, provide:
1. **Observation** — what is visibly wrong.
2. **Why it matters** — effect on comprehension, hierarchy, readability, or perceived quality.
3. **Refactor** — precise change to make.
4. **System rule** — reusable token/component rule if the issue can recur.

Do not merely say “add whitespace,” “improve hierarchy,” or “make it cleaner.” Specify where and how.

## Implementation mode

When the user asks for code changes:
- infer the existing design system before inventing a new one;
- preserve component semantics and accessibility;
- consolidate repeated magic numbers into tokens/constants/classes;
- prefer a small coherent token set over exact reproduction of scattered values;
- keep responsive behavior intentional rather than universally fluid;
- implement states: default, hover/focus, active/selected, disabled, empty, loading, error, and overflow where relevant;
- protect media containers from extreme aspect ratios and unknown user content;
- remove redundant borders and shadows before adding new decoration.

When code is provided, explain only the design decisions that materially affect the result. Deliver working edits, not a lecture.

## Screenshot / mockup critique mode

When an image is provided, inspect in this sequence:
1. What do the eyes land on first?
2. Is that the intended primary thing?
3. Which items compete unnecessarily?
4. Are related items visually grouped?
5. Are gaps unambiguous?
6. Is text readable and appropriately ranked?
7. Are colors systematic and accessible?
8. Are borders/shadows doing useful structural work?
9. Are images helping or harming clarity?
10. What can be removed?

Return the smallest set of high-leverage changes first. If useful, describe a “before → after” layout in concrete terms.

## New-screen design mode

When designing from scratch:
1. Define the feature in one sentence.
2. List the minimum content and controls.
3. Sketch the content order in plain text.
4. Establish hierarchy in grayscale.
5. Apply spacing and sizing tokens.
6. Apply typography tokens.
7. Add color system and states.
8. Add depth/images only where they support the design.
9. Add finishing touches.
10. Test edge cases only after the core version is coherent and shippable.

## Output contract

Unless the user requests another format, answer with:

### Diagnosis
A concise statement of the main design problem and the intended visual direction.

### Highest-impact changes
A prioritized set of concrete refactors, usually 3–8 items.

### System decisions
Tokens/rules that should become reusable.

### Implementation notes
Exact component/layout/styling guidance or code-oriented instructions.

### Final quality gate
A short pass/fail checklist for hierarchy, spacing, typography, color, states, and polish.

## Quality gate

Before finalizing any UI recommendation, confirm:
- [ ] The primary task is obvious.
- [ ] The primary action/information wins the hierarchy.
- [ ] Secondary and tertiary content are visibly quieter.
- [ ] Related elements are grouped by spacing.
- [ ] No major width exists only to “fill the screen.”
- [ ] Typography uses a deliberate scale and readable line length.
- [ ] Text weight, size, and contrast work together.
- [ ] Colors come from a coherent shade/semantic system.
- [ ] Meaning is never communicated by color alone.
- [ ] Borders, shadows, and radii are consistent and purposeful.
- [ ] Images/media preserve legibility and intended scale.
- [ ] Empty/loading/error/disabled/overflow states are considered.
- [ ] Repeated choices have been converted into reusable rules or tokens.
- [ ] Decorative polish has not been used to hide structural problems.

## Anti-patterns to reject

- Starting with navigation or application chrome before understanding the feature.
- Designing every feature and edge case before implementation teaches you anything.
- Solving hierarchy only by making titles huge and support text tiny.
- Giving every data point a same-weight `label: value` presentation.
- Using arbitrary pixel values for every component.
- Using a purely linear spacing scale that encourages meaningless micro-differences.
- Stretching text and forms to fill the viewport.
- Making all layout regions obey one rigid grid when their content has different needs.
- Using generic grey or transparent white text on colored backgrounds.
- Picking colors one at a time without shade/semantic relationships.
- Using color as the sole signal for status.
- Using shadows everywhere because they “look premium.”
- Scaling icons/screenshots far beyond their intended visual size.
- Letting unpredictable user images control text contrast.
- Wrapping every section in a bordered card.
- Treating empty states as blank space.

## Reference files

For deeper reasoning and daily use, read:
- `references/refactoring-ui-playbook.md` — chapter-by-chapter distilled guidance.
- `checklists/daily-ui-review.md` — fast audit and ship checklist.
- `examples/review-template.md` — reusable UI critique response structure.

## Spur contract

Machine-facing adapter for `sp:code-refactoring` dispatch (feature H13). Everything above is the
lens's native output and is unchanged; this section only maps it to the shared finding schema.

**Inputs received:** a scope path, an optional change description, and the `ui` focus. Read
first: the refactoring protocol and output contract above, then
`../code-refactoring/references/finding-schema.md` for shared field semantics.

**Native finding → schema mapping:** each issue → `id` as `RF-ui-<nnn>`; the pass that owns it
(hierarchy, spacing, typography, color, states) → `rung`; `Observation` + `Refactor` → `title`
and `proposal` (imperative); the cited component/file and line → `evidence` as `{file, line}`
entries inside scope; the `System rule` → folded into `proposal`; new findings start at
`status: open`.

**Severity mapping (design §5):** native P0 (task failure) → `P1`; P1 (hierarchy/structure) →
`P2`; P2 (system inconsistency) → `P3`; P3 (polish) → `P4`.

**Preserved-behavior inventory (required before proposals):** emit the controls and interactions
in scope — primary/secondary actions, navigation, form semantics, accessible names, states —
before the first finding.

**Preservation class:** token normalization and layout/typography consolidation with identical
function → `preserving`; adding a missing state or a11y attribute → `preserving`; removing or
merging a control or interaction → `cutting`; changes to user-visible flows or behavior →
`breaking`.

**Stop rules:** meaning is never carried by color alone; preserve component semantics and
accessibility; a `cutting`/`breaking` finding is never `fix_eligibility: auto` and never below
`P2`; anything outside the scope path is not a finding.
