# Refactoring UI — Operational Playbook

This is a concise operational distillation of the source material, organized by the book’s major sections.

## 1. Starting from scratch

### Start with a feature, not a layout
Design actual functionality before global shell decisions. The shell should emerge from the needs of the features, not the reverse.

### Detail comes later
Explore structure in low fidelity. Grayscale is useful because it forces hierarchy to be carried by spacing, size, and contrast. Treat early wireframes as disposable.

### Don’t design too much
Work in short design → implementation cycles. Build the smallest useful version first. Do not imply functionality that is not ready to ship.

### Choose a personality
Personality is built from concrete choices: typeface, color, border radius, imagery, and language. Keep these choices coherent.

### Limit your choices
Predefine scales and tokens. Use process-of-elimination between neighboring values instead of endless micro-adjustment. Systematize recurring low-level choices.

## 2. Hierarchy is everything

### Not all elements are equal
A polished interface makes relative importance obvious. Primary, secondary, and tertiary elements should not compete equally.

### Size isn’t everything
Use weight and contrast to create hierarchy so headings do not become oversized and support text does not become unreadably small.

### Don’t use grey text on colored backgrounds
The real goal is lower contrast, not “grey.” Choose text colors that harmonize with the surface instead of simply applying grey or low opacity.

### Emphasize by de-emphasizing
If an important item still does not stand out, quiet its competitors before adding more emphasis.

### Labels are a last resort
Remove labels where format/context already explains the value. Combine label + value into natural language when possible. When labels are necessary, style them according to the user’s scan target.

### Separate visual hierarchy from document hierarchy
Semantic markup and visual appearance are different concerns. Keep accessible/semantic structure while styling visual importance appropriately.

### Balance weight and contrast
Heavy visual elements may need lower contrast; low-contrast elements may need more weight. Use these as counterbalances.

### Semantics are secondary
Buttons, links, and actions do not all need the same visual treatment. Style according to action priority, while preserving correct semantics and interaction behavior.

## 3. Layout and spacing

### Start with too much white space
It is easier to tighten a spacious design than to rescue a cramped one. Density can be valid, but make it intentional.

### Establish a spacing and sizing system
Use a scale with perceptible, non-linear jumps. Fine differences matter more at small sizes than large sizes.

### You don’t have to fill the whole screen
Use max widths and intrinsic content dimensions. Empty space is not wasted space when it improves comprehension.

### Grids are overrated
Do not force unrelated sections to line up to one universal grid. Use the local structure the content needs.

### Relative sizing doesn’t scale
Avoid overusing relative percentages for things that need stable emphasis or readable dimensions. Use intentional widths and breakpoints.

### Avoid ambiguous spacing
Spacing must make relationships obvious. A gap should clearly say whether two things belong together or apart.

## 4. Designing text

### Establish a type scale
Use a small, predefined scale instead of pixel-by-pixel typography.

### Use good fonts
For UI, prioritize families designed for legibility at small sizes. Popular, well-tested neutral sans-serifs are safe defaults; use personality faces intentionally.

### Keep your line length in check
Long lines are hard to read. Limit prose width even on wide screens.

### Baseline, not center
Text and icons often look more natural when aligned optically/baseline rather than mechanically center-aligned.

### Line-height is proportional
Small text generally needs more line-height; large headlines can use tighter line-height.

### Not every link needs a color
Context and interaction styling may be enough. Too many colored links create noise.

### Align with readability in mind
Left-align most multi-line text. Center alignment is better suited to short isolated blocks.

### Use letter-spacing effectively
Uppercase text can benefit from added tracking. Large headlines in wide-spaced UI fonts may benefit from tighter tracking. Do not try to turn display faces into body faces by spacing alone.

## 5. Working with color

### Ditch hex for HSL
Thinking in hue, saturation, and lightness makes relationships between colors easier to reason about.

### You need more colors than you think
A useful palette needs multiple shades for text, surfaces, borders, hover states, fills, and semantic feedback.

### Define your shades up front
Create ramps for key colors and neutrals before styling individual elements.

### Don’t let lightness kill your saturation
Lighter/darker colors often need saturation and sometimes hue adjustments to stay rich and natural.

### Greys don’t have to be grey
Slightly tinted neutrals can give the interface more character and cohesion.

### Accessible doesn’t have to mean ugly
Use contrast deliberately and employ multiple tones/weights rather than making everything equally dark.

### Don’t rely on color alone
Pair color with copy, icons, shapes, borders, or placement so status remains understandable without color perception.

## 6. Creating depth

### Emulate a light source
Use consistent highlights and shadows so surfaces feel physically coherent.

### Use shadows to convey elevation
Shadow size and softness should map to distance from the base surface and can help direct focus.

### Shadows can have two parts
A realistic UI shadow can combine a tight contact shadow with a broader ambient shadow.

### Even flat designs can have depth
Borders, background shifts, highlights, and overlap can create separation without large shadows.

### Overlap elements to create layers
Controlled overlap can communicate relationships and produce stronger composition.

## 7. Working with images

### Use good photos
Source quality matters more than effects.

### Text needs consistent contrast
Text over images must remain readable regardless of image variation. Use overlays, contrast reduction, colorization, or subtle text glow/shadow as tools.

### Everything has an intended size
Do not enlarge small-detail icons until they look chunky. Do not shrink dense screenshots until content becomes unreadable. Crop or redesign the presentation.

### Beware user-uploaded content
Expect arbitrary aspect ratios, colors, and quality. Use fixed frames, cropping, safe contrast regions, and fallbacks.

## 8. Finishing touches

### Supercharge the defaults
Default controls can often be improved with coherent radius, typography, iconography, spacing, and state styling.

### Add color with accent borders
Thin, intentional accents can introduce brand color without turning large surfaces into saturated blocks.

### Decorate your backgrounds
Subtle shapes, patterns, gradients, or illustrations can add personality, but they should remain subordinate to content.

### Don’t overlook empty states
Use empty states to teach the next action, set expectations, or explain what will appear there.

### Use fewer borders
When possible, create separation with spacing, surface color, or depth instead of boxing everything in.

### Think outside the box
Do not default every section to a rectangular card. Allow imagery, backgrounds, overlap, or asymmetrical composition when they better serve the content.

## 9. Leveling up

The larger lesson is to build visual judgment through deliberate observation, comparison, and repetition. Collect good patterns, notice why they work, and turn recurring insights into reusable systems rather than isolated tricks.
