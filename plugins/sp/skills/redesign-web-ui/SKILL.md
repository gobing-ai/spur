---
name: redesign-web-ui
description: "Upgrade an existing website or app UI past generic AI defaults without rewriting the stack. Triggers: \"redesign this UI\", \"make it look premium\", \"generic AI design\", \"polish this page\", \"restyle the web app\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - pipeline
    - reviewer
  pipeline_steps:
    - scan
    - diagnose
    - plan
    - apply
    - verify
  operations:
    - redesign
  openclaw:
    emoji: "🎨"
see_also:
  - sp:code-implementation
  - sp:code-review
  - sp:source-driven-development
---

# redesign-web-ui — existing-UI visual upgrade

This is a **technique** skill: it edits presentation. Specific product copy stays; placeholder copy
becomes real draft text. Information architecture, routing, and data behavior stay unless the
operator widens the scope.

## When to use

- Redesign or restyle an existing page, app shell, or component set.
- Make an existing UI look premium / high-end rather than templated.
- Strip generic AI design fingerprints (Inter-only type, purple-blue gradients, three equal feature cards).
- Polish a page that feels unfinished (missing hover, focus, loading, empty, or error states).
- Restyle a web app in place without a framework migration.

## When not to use

- **Greenfield visual identity with no existing UI** — there is nothing to upgrade; design from the brief.
- **IA or navigation restructure** — out of scope unless the operator asks.
- **Stack migration** — swapping CSS frameworks or component libraries.
- **Non-UI work** — APIs, CLI, schemas, backend.
- **Inventing legal or compliance surfaces** — privacy pages, terms, cookie banners. Link only
  destinations the product already has.

## Authority (read before changing tokens)

Resolve visual authority in this order. A lower layer never overrides a higher one. Cite the source
on every token change.

1. **Repository-root `DESIGN.md`** — if it exists, it is the UI SSOT (palette, type, surfaces, motion,
   density). Read it. Use its tokens by name.
2. **Existing theme / CSS variables / Tailwind theme** — the live token file the app already compiles.
3. **This skill's audit heuristics** — only for axes the two layers above leave free.

`docs/04_DESIGN.md` owns non-UI surfaces (commands, flags, DTOs). It is not this skill's authority.

Framework and CSS API facts (Tailwind v3 vs v4, styled-components APIs, browser features): verify
with source for the pinned version via `sp:source-driven-development`. Cross-check against docs
before changing config.

## Pipeline

Run in order. Later steps consume the previous step's artifact. Stop after Diagnose when the
operator asked only for an audit.

### Step 1 — Scan

Read the target UI and its styling entrypoints. Record, with evidence:

| Field | Evidence |
|---|---|
| Framework | manifest / entry file |
| Styling system | Tailwind v3/v4, CSS modules, vanilla, styled-components, … |
| Token source | `DESIGN.md`, CSS variables, `tailwind.config`, theme file |
| Scope | routes, layouts, and shared components that will render the change |

Done when every row has a path (or `none — proceed on heuristics`).

### Step 2 — Diagnose

Walk [references/audit-checklist.md](references/audit-checklist.md). Emit a findings table. Every
row must cite `path:line`. No finding, no change. Cite the reference row you matched.

```markdown
| ID | Pattern | Severity | Evidence | In-stack fix |
|----|---------|----------|----------|--------------|
| F1  | …       | a11y \| fingerprint \| polish | `file:line` | … |
```

Severity:

- **a11y** — focus, skip-link, alt, contrast, reduced-motion, keyboard path. Visible focus is required. Fix these.
- **fingerprint** — generic AI look that fights this product. Fix unless a higher authority specifies it.
- **polish** — optional quality. Apply when it does not fight the authority or the product type.

Done when every checklist category has been considered and every hit is a table row (or the
category is marked `none`).

### Step 3 — Plan

Order the findings by the Fix Priority below. State the typefaces, palette, and one signature
choice, each cited to authority or to a subject-specific reason. Optional motion and layout
upgrades live in [references/upgrade-techniques.md](references/upgrade-techniques.md) — load that
file only when a finding needs a technique from it.

The plan should list every **a11y** and **fingerprint** finding. Always cite the token source.
Done when both are present.

### Step 4 — Apply

Work in the existing styling system. Targeted upgrades, not a rewrite.

Fix Priority:

1. Accessibility
2. Token alignment to authority
3. Typography and color fingerprints
4. Hover, focus, active, loading, empty, error
5. Layout, spacing, max-width
6. Generic component cliches
7. Motion that serves the product (and honors `prefers-reduced-motion`)

Before any new import, read the project's dependency manifest. Before editing Tailwind config,
validate the installed major version against its docs.

Done when every planned **a11y** and **fingerprint** row is reflected in the diff, or explicitly
deferred with a one-line reason.

### Step 5 — Verify

Confirm with evidence, not assertion. See **Verification** below.

## Hard constraints

- Keep the current framework and styling library.
- Preserve existing functionality; a visual change that breaks a flow is a failed run.
- Keep the diff reviewable — small, targeted edits over a greenfield restyle.
- Prefer the project's existing icon set, font loader, and image pipeline over new dependencies.
- Honor `prefers-reduced-motion` for every motion addition.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll migrate to a nicer component library while I'm here." | Stack change is out of scope. Upgrade what is already compiled. |
| "DESIGN.md is just a mood board — I'll pick better colors." | Root `DESIGN.md` is authority. Cite its tokens; do not invent a parallel palette. |
| "A full rewrite is faster than patching these class names." | Rewrites drop states, a11y, and behavior. Patch in place; the audit is the map. |
| "I'll add stock photos / a new icon library for polish." | New assets and libraries are fingerprints of their own. Use the project's pipeline. |
| "Legal links and a cookie banner will make it feel finished." | Invented compliance UI is worse than omission. Link only destinations the product already has. |
| "A screenshot of the happy path is enough." | Verify behavior, shared routes, empty/error/focus, and both viewports when layout changed. |

## Red Flags

- Diff introduces a second CSS framework or a new icon/font package without a dependency-file check.
- Palette or typeface that contradicts repository-root `DESIGN.md`.
- Finding with no `path:line` evidence.
- Custom scroll hijacking or inertia scroll on a product UI.
- Claimed "done" with no visual verification evidence (or no statement of what could not be verified).
- Placeholder copy (`Lorem ipsum`, "John Doe", "Acme Corp") left in the shipped UI.

## Verification

After Apply, ensure each box has evidence (command output, screenshot, or `file:line`), not assertion:

- [ ] Every **a11y** and **fingerprint** finding is fixed or deferred with a reason.
- [ ] Token changes cite `DESIGN.md`, the live theme file, or a subject-specific reason (source named).
- [ ] Existing tests still pass; new imports exist in the dependency manifest.
- [ ] Shared layouts/components that consume the changed tokens still render consistently — cross-check each route that shares them.
- [ ] Browser (or closest substitute): golden path + empty/error/focus; desktop and mobile viewports when layout or spacing changed.
- [ ] `prefers-reduced-motion` still disables added motion.
- [ ] Document what could not be verified (no browser tools → say so; do not claim visual QA).

## See also

- **`sp:source-driven-development`** — verify framework/CSS API facts against the pinned version before editing config.
- **`sp:code-implementation`** — owns feature implementation; this skill owns the visual upgrade pass.
- **`sp:code-review`** — review the visual diff for regressions and out-of-scope stack changes.
