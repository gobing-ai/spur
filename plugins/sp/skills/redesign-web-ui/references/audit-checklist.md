# Audit checklist

Lookup for `sp:redesign-web-ui` Diagnose. Every hit becomes a findings-table row with `path:line`
evidence and an in-stack fix. Severity values (`a11y` / `fingerprint` / `polish`) and when to
apply each are defined in the skill's Diagnose step.

A category with no hits is recorded as `none`. Do not invent findings to fill the table.

---

## Typography

| Problem | In-stack fix | Severity |
|---|---|---|
| Browser default, Inter, Roboto, or Arial as the only face | Pick a display + body pair for *this* product's subject and cite why. Repeating Inter, or swapping Inter for Geist/Outfit/Satoshi with no subject reason, is still a default. | fingerprint |
| Headlines lack presence | Increase display size, tighten letter-spacing, reduce line-height so titles feel intentional. | fingerprint |
| Body line length unconstrained | Cap paragraph measure near 65 characters; raise line-height for reading blocks. | polish |
| Only 400 and 700 weights | Add 500/600 where hierarchy needs a middle step. | polish |
| Proportional figures in tables, prices, metrics | Tabular nums (`font-variant-numeric: tabular-nums`) or a monospace face for data. | polish |
| No tracking on display vs. labels | Negative tracking on large headers; slight positive tracking on small labels/small-caps. | polish |
| All-caps subheaders as the only accent | Sentence case, small-caps, or italic — one treatment, used sparingly. | fingerprint |
| Orphaned last words in headings | `text-wrap: balance` (headings) or `text-wrap: pretty` (body). | polish |

## Color and surfaces

| Problem | In-stack fix | Severity |
|---|---|---|
| Pure `#000` canvas or pure `#fff` only | Off-black / off-white or a tinted dark from the authority palette. | fingerprint |
| Oversaturated accents | Keep saturation in range with surrounding neutrals; one chromatic accent unless authority specifies more. | fingerprint |
| Mixing warm and cool gray families | One gray family, tinted with a consistent hue. | fingerprint |
| Purple/blue "AI gradient" (or cream+serif+terracotta, or acid-green-on-black used as a default) | Neutral bases + the authority accent. Those three looks are legitimate for some briefs; they are fingerprints when chosen without a subject reason. | fingerprint |
| Generic black `box-shadow` | Tint shadows to the surface hue. | polish |
| Perfectly even 45° linear fades | Radial, mesh, or a noise overlay — or no gradient. | fingerprint |
| Conflicting light sources across shadows | One implied light direction. | polish |
| A single inverted-color band in an otherwise consistent page | Same palette, shifted shade — or a full committed dark/light mode. | fingerprint |
| Empty flat sections that need presence | Texture, a restrained ambient gradient, or an existing product image. Use the project's image pipeline; do not inject random stock URLs. | polish |

## Layout

| Problem | In-stack fix | Severity |
|---|---|---|
| Everything centered and symmetrical | Offset, mixed aspect ratios, or left-aligned headers over centered content — when the content supports it. | fingerprint |
| Three equal card columns as the feature row | Asymmetric grid, 2-column zig-zag, or a single highlighted module. | fingerprint |
| `height: 100vh` full-screen sections | `min-height: 100dvh` (mobile browser chrome). | a11y |
| No max-width on reading/marketing content | Container ~1200–1440px with auto margins. Data-dense dashboards may stay full-bleed. | polish |
| Uniform radius on every element | Tighter radius on inner controls, softer on outer containers — or sharp, if authority is sharp. | polish |
| Missing whitespace on marketing pages | Increase spacing until groups read as groups. Dense is correct for data tables. | polish |
| Card CTAs / feature lists at uneven baselines | Align shared elements (title, price, list start, button) across the row. | polish |
| Optical vs. mathematical centering (icon-in-circle, play button) | 1–2px optical adjustment. | polish |

Do **not** treat "dashboard has a left sidebar" as a defect. Changing IA is out of scope.

## Interactivity and states

| Problem | In-stack fix | Severity |
|---|---|---|
| No hover on pointer-capable buttons/links | Background, border, or 1px translate — 150–250ms. | fingerprint |
| No active/pressed feedback | `scale(0.98)` or `translateY(1px)`. | polish |
| Instant transitions (`transition: none` on chrome) | 150–250ms on interactive chrome; leave data-dense tables snappy. | polish |
| Missing visible focus ring | Visible `:focus-visible` using the authority accent. Keyboard path is required. | a11y |
| Spinner-only loading | Skeleton that matches the layout shape. | polish |
| Blank empty states | A composed getting-started / zero-data view with one next action. | polish |
| Errors via `window.alert()` or no inline message | Inline field/form error in the product voice. | a11y |
| Buttons that go to `#` | Real href, or a disabled control with a reason. | a11y |
| No current-page indication in nav | Distinct active style. | a11y |
| Instant anchor jumps | `scroll-behavior: smooth` on the document, with reduced-motion fallback to instant. | polish |
| Animating `top` / `left` / `width` / `height` | Animate `transform` and `opacity`. | polish |

## Content

| Problem | In-stack fix | Severity |
|---|---|---|
| `Lorem ipsum` or `placeholder` copy | Real draft copy for this product. | fingerprint |
| "John Doe", "Jane Smith", "Acme Corp", "Nexus", "SmartFlow" | Contextual names. | fingerprint |
| Fake round metrics (`99.99%`, `$100.00`) | Organic figures, or label them as examples. | fingerprint |
| AI cliches: Elevate, Seamless, Unleash, Next-Gen, Game-changer, Delve, Tapestry, "In the world of…" | Plain, specific language. | fingerprint |
| "Oops!" / exclamation-mark success toasts | Direct: "Saved." / "Connection failed. Try again." | fingerprint |
| Title Case On Every Header | Sentence case, unless the brand guide says otherwise. | polish |
| Identical dates or avatars on every dummy person | Unique assets per distinct person, or drop the avatars. | fingerprint |

## Component patterns

| Problem | In-stack fix | Severity |
|---|---|---|
| Card = border + shadow + white fill on every block | Cards only when elevation encodes hierarchy; otherwise background or spacing. | fingerprint |
| Always one filled + one ghost button | Text/tertiary action when the second action is low emphasis. | polish |
| Pill "New"/"Beta" badges as decoration | Square badge, flag, or plain label — or remove. | polish |
| Accordion FAQ / 3-card testimonial carousel / 3-tower pricing as empty decoration | A layout that matches the actual content. Keep the pattern when it *is* the product's IA. | fingerprint |
| Modal for a single-field edit | Inline edit or a slide-over. | polish |
| Footer link farm (4+ columns of unused links) | Primary paths + real legal destinations the product already has. | polish |

## Iconography and media

| Problem | In-stack fix | Severity |
|---|---|---|
| Mixed icon sets / mixed stroke widths | Standardize on the set already in the dependency manifest. Do not add Phosphor/Heroicons/Lucide as a second library. | fingerprint |
| Rocket = Launch, shield = Security, as the only metaphors | Less obvious icons from the *same* set, or text. | polish |
| Missing favicon | Branded favicon in the project's existing public/asset pipeline. | polish |
| Random stock "team" photos | Real assets, a consistent illustration style, or no people photos. | fingerprint |

## Code quality (UI)

| Problem | In-stack fix | Severity |
|---|---|---|
| Non-semantic soup for nav/main/content | `<nav>`, `<main>`, `<article>`, `<aside>`, `<section>` where they match the role. | a11y |
| Inline styles mixed into a class-based system | Move the declaration into the project's styling system. | polish |
| Hardcoded px widths on fluid layouts | `%`, `rem`, `em`, `max-width`, or the system's spacing scale. | polish |
| Meaningful images with empty or `alt="image"` | Describe the image; decorative images get `alt=""` plus `role="presentation"` if needed. | a11y |
| `z-index: 9999` and friends | A documented z-scale on the theme. | polish |
| Missing `<title>`, description, or social meta | Fill from the product name and the page's job. | polish |
| Import not in the dependency manifest | Use an already-installed package, or stop and ask before adding one. | fingerprint |

## Completeness (product UI, not decoration)

| Problem | In-stack fix | Severity |
|---|---|---|
| No skip-to-content link | Visually hidden skip link targeting `<main>`. | a11y |
| Dead-end views with no way back | A back/close path that uses the existing router. | a11y |
| No custom 404 | Branded empty-route view with a path home. | polish |
| Forms without client-side required/format checks | Validate in the existing form library; keep server-side as source of truth. | a11y |
| Footer legal links that 404 | Point at real routes, or omit. | polish |
