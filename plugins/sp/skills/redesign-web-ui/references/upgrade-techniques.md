# Upgrade techniques

Optional moves for `sp:redesign-web-ui` Plan/Apply. Load this file only when a Diagnose finding
needs a technique from it.

Every technique here is **polish**. Accessibility and token authority always win. Honor
`prefers-reduced-motion: reduce` by disabling or replacing motion with an instant state change.

Product/app chrome (dashboards, settings, editors) stays restrained. Marketing/landing pages can
spend more on one signature moment. Spend boldness in **one** place.

---

## When a technique is in play

Use a technique when:

- The finding is `polish`, and
- The page type supports it (landing/marketing, or a single product moment), and
- The authority layer (`DESIGN.md` / theme) does not forbid it.

Skip the technique when:

- It requires a new animation library or a CSS-framework migration.
- It hijacks scroll (inertia/custom scrollbar physics) on a product UI.
- It would be the second signature moment on the same page.

---

## Typography

- **Variable-font weight/width** on hover or a short scroll range — one word or one heading, not every line.
- **Outlined-to-fill** on a display line that is the page's thesis.
- **Text as mask** only when a real, owned video/image sits behind it.

## Layout

- **Broken grid / overlap** — one element bleeds or overlaps on purpose; the rest stay on the grid.
- **Whitespace maximization** — one block gets aggressive negative space so it is the only focus.
- **Sticky stack** — sections pin and stack on scroll on a marketing long-scroll, not inside app chrome.
- **Split-screen scroll** — two panes moving in opposition; marketing only, and never the only way to reach content.

## Motion

- **Staggered entry** — small Y + opacity cascade on first paint of a group (40–80ms steps).
- **Spring on press** — interactive controls, not page load.
- **Scroll-driven reveal** — mask, wipe, or SVG draw tied to scroll *progress*, with a reduced-motion static end-state.

Do not add smooth-scroll inertia, scrolljacking, or a custom scrollbar on product UI. Native
`scroll-behavior: smooth` plus a reduced-motion instant fallback is the ceiling unless the operator
asks for more.

## Surfaces

- **Glass** — `backdrop-filter` plus a 1px inner border and a faint inner shadow; only over content
  that remains readable.
- **Spotlight border** — cursor-tracking edge light on one featured card.
- **Grain overlay** — `pointer-events: none`, fixed, very low contrast; skip on dense data tables.
- **Tinted shadows** — shadow hue matches the surface, not generic black.

---

## Signature test

After picking techniques, keep one memorable moment. If two techniques compete, drop the weaker
one. The surrounding UI stays quiet so the signature can read.
