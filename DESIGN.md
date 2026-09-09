---
version: alpha
name: Spur UI Design
description: "Spur visual and interaction design: dark surfaces, a restrained lavender accent, shared tokens, components and accessibility."

colors:
  primary: "#5e6ad2"
  on-primary: "#ffffff"
  primary-hover: "#828fff"
  primary-focus: "#5e69d1"
  ink: "#f7f8f8"
  ink-muted: "#d0d6e0"
  ink-subtle: "#8a8f98"
  ink-tertiary: "#62666d"
  canvas: "#010102"
  surface-1: "#0f1011"
  surface-2: "#141516"
  surface-3: "#18191a"
  surface-4: "#191a1b"
  hairline: "#23252a"
  hairline-strong: "#34343a"
  hairline-tertiary: "#3e3e44"
  inverse-canvas: "#ffffff"
  inverse-surface-1: "#f5f6f6"
  inverse-surface-2: "#f6f7f7"
  inverse-ink: "#000000"
  brand-secure: "#7a7fad"
  semantic-success: "#27a644"
  semantic-overlay: "#000000"

typography:
  display-xl:
    fontFamily: Linear Display
    fontSize: 80px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -3.0px
  display-lg:
    fontFamily: Linear Display
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.10
    letterSpacing: -1.8px
  display-md:
    fontFamily: Linear Display
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -1.0px
  headline:
    fontFamily: Linear Display
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.20
    letterSpacing: -0.6px
  card-title:
    fontFamily: Linear Display
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: -0.4px
  subhead:
    fontFamily: Linear Display
    fontSize: 20px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: -0.2px
  body-lg:
    fontFamily: Linear Text
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: -0.1px
  body:
    fontFamily: Linear Text
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: -0.05px
  body-sm:
    fontFamily: Linear Text
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0
  caption:
    fontFamily: Linear Text
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.40
    letterSpacing: 0
  button:
    fontFamily: Linear Text
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.20
    letterSpacing: 0
  eyebrow:
    fontFamily: Linear Text
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.30
    letterSpacing: 0.4px
  mono:
    fontFamily: Linear Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.50
    letterSpacing: 0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 96px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-primary-pressed:
    backgroundColor: "{colors.primary-focus}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-tertiary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-inverse:
    backgroundColor: "{colors.inverse-canvas}"
    textColor: "{colors.inverse-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  pricing-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  pricing-card-featured:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  feature-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  product-screenshot-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: 24px
  testimonial-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 32px
  customer-logo-tile:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 16px
  text-input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  text-input-focused:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  pricing-tab-default:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 6px 14px
  pricing-tab-selected:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 6px 14px
  cta-banner:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.lg}"
    padding: 48px
  changelog-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: 24px 0
  status-badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 8px
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    height: 56px
  footer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-subtle}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: 64px 32px
---

## Overview

Spur uses a near-black canvas, a four-step charcoal surface ladder, hairline borders and a
restrained lavender accent. The frontmatter is the token and component-value reference;
the sections below define usage and interaction. Non-UI contracts belong in
[04 Design](docs/04_DESIGN.md), document maintenance in the constitution.
The inherited marketing variants are a visual vocabulary, not a requirement to build marketing pages.

## Colors

> Source pages: linear.app (home), /intake, /pricing, /contact/sales, /build.

### Brand & Accent

Use primary for brand marks, primary actions, links and focus; primary-hover and primary-focus
provide interaction states. Reserve brand-secure for muted security branding.

### Surface

Canvas is the base; surface-1 through surface-4 express increasing lift. Hairline variants
separate nested regions. Inverse tokens are for isolated inverse controls, not an implied light theme.

### Text

Use ink for primary content, ink-muted for secondary information, ink-subtle for metadata,
and ink-tertiary for disabled content. Validate readable contrast in the actual component.

### Semantic

Use semantic-success for success state and semantic-overlay for scrims. Pair state colors with
text or icons; do not introduce competing decorative accents.

## Typography

### Font Family

- **Linear Display** — Linear's custom display sans; fallback `SF Pro Display, -apple-system, system-ui, Segoe UI, Roboto`. Carries display-xl through subhead.
- **Linear Text** — Linear's custom text sans (a slightly different cut tuned for body sizes); same fallback stack. Carries body sizes, button labels, captions.
- **Linear Mono** — Linear's custom mono; fallback `ui-monospace, SF Mono, Menlo`. Used for code snippets in product screenshots and for status / ID tokens.

The marketing surface treats Display and Text as one continuous voice; the family change is silent.

### Hierarchy

Use the typography frontmatter: display tokens for headings, body tokens for prose,
caption for metadata, eyebrow for taxonomy and mono for code or identifiers.

### Principles

- **Aggressive negative tracking on display** (-3.0px at 80px ≈ 4% of size).
- **Single voice from display to body.** Display-xl at 600 → body at 400 — same family, narrower weights.
- **Eyebrow uses positive tracking** (+0.4px) — contrast against the negative-tracked display marks the eyebrow as taxonomy.
- **Mono only in code contexts.** Linear Mono lives inside product screenshots — not on marketing chrome.

### Note on Font Substitutes

Use the declared system fallback stacks when the named fonts are unavailable.
A different font requires visual verification; the design does not require a new dependency.

## Layout

### Spacing System

- **Base unit**: 4px.
- **Tokens (front matter)**: `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 96px.
- Card interior padding: `{spacing.lg}` 24px on feature/pricing cards; `{spacing.xl}` 32px on testimonial cards; `{spacing.xxl}` 48px on CTA banners.
- Pill button padding: 8px vertical · 14px horizontal — Linear's compact button spec.
- Form input padding: 8px vertical · 12px horizontal.

### Grid & Container

- Max content width sits around 1280px.
- Card grids are 3-up at desktop, 2-up at tablet, 1-up at mobile.
- Pricing tier grid is 3-up; comparison strip below shows checkmarks per tier.
- Product screenshot panels span full content width — they're the protagonist.

### Whitespace Philosophy

The dark canvas IS the whitespace. Sections separate by lift onto surface-1 panels, not by gaps in white. Within a panel, generous `{spacing.lg}` 24px gaps between content blocks; `{spacing.section}` 96px between sections.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| 0 (flat) | No shadow, no border | Default for body type, hero text, footer |
| 1 (charcoal lift) | `{colors.surface-1}` background on canvas, 1px `{colors.hairline}` | Default cards, product panels |
| 2 (surface-2 lift) | `{colors.surface-2}` background, 1px `{colors.hairline-strong}` | Featured pricing card, hovered cards |
| 3 (surface-3 lift) | `{colors.surface-3}` background | Sub-nav, dropdown menus |
| 4 (focus ring) | 2px `{colors.primary-focus}` outline at 50% opacity | Focused input, focused button |

Linear's depth is carried by surface ladder + hairline borders. The brand resists drop shadows on dark almost entirely.

### Decorative Depth

- **Product UI screenshots** dominate as decorative depth.
- **No atmospheric gradients, no spotlight cards.**
- **Subtle white edge highlight** on the top edge of lifted panels — gives the dark surface a faint "pixel rendered" feel.

## Shapes

### Border Radius Scale

Use the rounded frontmatter: xs/sm for chips and tags, md for controls, lg for cards,
xl for screenshot panels, xxl for occasional banners, pill for toggles/status, full for avatars.

### Photography & Illustration Geometry

- Product UI screenshots dominate; they sit in `{rounded.xl}` 16px tiles with `{spacing.lg}` 24px outer padding.
- Customer logo tiles render at small sizes (~24px logo height) on `{colors.canvas}` with no border.
- Avatar circles in testimonial cards use `{rounded.full}` at 32–40px sizes.

## Components

### Buttons

Use the frontmatter variants: primary for the main action, secondary for supporting actions,
tertiary for plain text controls and inverse for isolated emphasis. Keep hover, pressed and
keyboard-focus states distinct; use md corners rather than pills.

### Pricing Tabs

The optional pricing variants are pill toggles; selection uses a surface lift.
They do not imply a pricing-page commitment.

### Cards & Containers

Use feature-card for general panels, product-screenshot-card for captures, testimonial-card
for quotes and customer-logo-tile for logos. Optional pricing-card/featured and cta-banner
variants use the same surface ladder. Values live in the component frontmatter.

### Inputs & Forms

Use text-input and text-input-focused values from the frontmatter. Focus retains the input
surface and adds the focus outline. Provide labels and accessible error messages.

### Status & Build Page

Use changelog-row for version/change lists and status-badge for concise state labels.
These are component variants, not required product pages.

### Navigation

Use the top-nav tokens for a compact navigation bar. Keep branding, navigation and actions
visually distinct; responsive collapse follows the rules below.

### Footer

Use footer tokens for a secondary link grid when a footer is needed.

## Product UI — System Events

The System Events surface is a dense diagnostic table, not a marketing screenshot. It still uses
the shared canvas/surface/hairline/type tokens above.

- Desktop defaults are Time, Severity, Event, Summary, Correlation, and
  Outcome. Agent, Producer, Action, and Actor are optional through the Columns disclosure; the
  ordered selection persists under `spur:observability:columns:v1`, invalid storage falls back to
  defaults, and at least one column stays visible. Producer shows only package / subsystem.
  Project name/root remain in expanded detail as forensic context.
- Time, Severity, Event, Summary, Correlation, Outcome, and Agent are sortable over the loaded page.
  Producer, Action, and Actor are visibility-only. Expanded detail spans the active desktop column
  count; compact rendering remains fixed at two columns.
- Missing or unusable projected fields render as `-`, not the word `unavailable`.
- Severity uses icon + text; color is supplemental and limited to semantic state.
- Event names use mono type. Summary is the primary prose cell and truncates to one line with the
  complete value in the semantic tooltip.
- Event-name tooltip uses `surface-3`, a strong hairline, mono value rows, a 400 px minimum when
  space permits, and a viewport-bounded maximum. Hover and keyboard focus open the same content;
  pinning makes it selectable for copy; Escape and outside activation close it.
- The tooltip title is `eventName · correlator`, using the best available
  entity/run/execution/action/job identity and falling back to the persisted history-row id.
  Copy/pin instructions live in a muted footer; hover and pinned modes use their own guidance.
- Agent remains a single truncated identity string; a missing executor is a blank
  cell (not `-`). It is optional after Outcome in the canonical customizable column order.
  Correlation, Action, and Agent truncate like Summary; complete values stay in the tooltip.
  Compact (≤639 px) stacks Summary, Correlation, Action, and Agent under the event name and still
  omits opaque ids from those stacked cells. Shapes: `docs/design/system-events-human-table.md`.
- Expanded detail owns raw redacted JSON and lower-value catalog metadata. The tooltip owns what
  happened, why it matters, and the next safe action.
- Below 640 px, collapse to Time + Event and stack summary, producer/correlation, outcome, and action
  under the event name and Agent. No horizontal information loss may require
  color interpretation.

## Do's and Don'ts

### Do

Use the canvas and surface ladder, restrained accents, readable typography and visible
keyboard focus. Product UI should prioritize diagnostic content.

### Don't

Do not use lavender as decorative panel fill, atmospheric gradients, competing bright accents,
pill-shaped primary CTAs or pure black in place of the canvas token.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Desktop-XL | 1440px | Default desktop layout |
| Desktop | 1280px | Card grid 3-up maintained |
| Tablet | 1024px | Card grid 3-up → 2-up |
| Mobile-Lg | 768px | Pricing comparison becomes accordion; nav hamburger |
| Mobile | 480px | Single-column; display-xl scales 80px → ~36px |

### Touch Targets

- CTAs hold ≥40px tap height across viewports.
- Pricing tab pills hold ≥36px tap height; touch viewports grow to ≥44px.
- Form inputs hold ≥44px tap target on touch.

### Collapsing Strategy

- **Top nav**: links collapse to hamburger below 768px.
- **Card grids**: 3-up → 2-up at 1024px → 1-up below 768px.
- **Pricing comparison**: per-tier accordion below 768px.
- **Display type**: `{typography.display-xl}` 80px scales toward `{typography.display-md}` 40px on mobile.

### Image Behavior

- Product UI screenshots maintain aspect ratio and never crop.
- Customer logos in the marquee may collapse from 6-up to 3-up below 768px.

## Iteration Guide

Use an existing component/token before adding a variant. Verify affected viewports, keyboard
interaction, focus, contrast and reduced-motion behavior with the project’s available UI checks.
Update this file when the shared design contract changes; keep delivery receipts in task records.

## Known Gaps

The inherited token set does not fully specify form validation/error states or a complete
light theme. Resolve those contracts when implementing the affected UI; do not infer them from
inverse-control tokens. Use documented system font fallbacks when named fonts are unavailable.
