---
schema_version: 1
name: Built-in module icons resolve through ModuleIcon by id
status: todo
template: feature-impl
created_at: 2026-11-22T02:21:32.650Z
updated_at: "2026-11-22T04:07:23.115Z"
feature_id: A83

tags: ["A83"]
priority: P2
estimate_hours: 3
---

## 1428. Built-in module icons resolve through ModuleIcon by id

### Background

Implements: R2 — Built-in module icons resolve through ModuleIcon by module id; R3 — Downstream module icon declarations keep working unchanged.

ADR-133 (`docs/00_ADR.md:2307`) owns the icon contract. The downstream `bootstrap.modules[].icon` field is A8 public config (`packages/config/src/board-modules.ts:64`, required non-empty string) and must not break.

**Refine corrections (2026-11-21)**
- Background read "Implements: R2 R3 — ." and AC1 was blank → both now name the feature scenarios R2 and R3.
- "icon flow: modules/*/index.tsx → compose.ts:137 → LeftSidebar" → `compose.ts:137` (`entryMetadata`) only maps **downstream** descriptors. Built-in modules reach the sidebar straight from discovery (`apps/web/src/modules/discover.ts:44-55`). That guard `isWebModule` *requires* `typeof value.icon === 'string'`, so dropping the built-in field without relaxing the guard would silently drop every built-in module.
- Today's real defect is `search`. Its id has no vector branch in `ModuleIcon` (`apps/web/src/components/ModuleIcon.tsx:49-67`), so it renders the raw emoji `🔎` (`apps/web/src/modules/search/index.tsx:339`). The map also uses `features: '🎯'` while the descriptor says `🏷️`; the fallback map and descriptors disagree.
- The emoji-equality branches (`icon === '📡'` …) are what let a downstream module that declares a built-in emoji get the matching vector icon. Keep those as the downstream compatibility path. Only the id-keyed `fallbackEmojiMap` (used as sr-only text) is built-in-only.
- No `ModuleIcon` test exists. The compose tests (`apps/web/tests/modules/compose.test.ts:23,55,75`) cover downstream icon pass-through.

### Requirements

- [ ] R1. `WebModule.icon` becomes optional (`apps/web/src/modules/types.ts:7`), and the discovery guard (`discover.ts:49-50`) accepts a module with no `icon`, or with a string one.
- [ ] R2. The nine built-in descriptors (designs, features, history, observability, plans, projects, search, settings, tasks) drop their `icon:` emoji.
- [ ] R3. `ModuleIcon` resolves a vector icon by id for all nine built-in ids, adding `search` (Lucide `Search`). It renders a raw emoji `<span>` only when `icon` is set and matches neither a built-in id nor a known emoji.
- [ ] R4. sr-only text for `size="lg"` comes from an id → **label** map ("Search", "Tasks", …) instead of an emoji, because a screen reader announcing "📡" is noise. The `fallbackEmojiMap` is deleted.
- [ ] R5. A downstream declaration with `icon: '📡'` still renders `Radio`. A downstream declaration with any other string still renders that string. `bootstrap.modules[].icon` validation is unchanged.

Out of scope: changing the config schema, adding icon names (e.g. `icon: 'radio'`) to downstream config, and new Lucide icons for downstream modules.

### Acceptance Criteria

- [ ] AC1 — Built-in module icons resolve through ModuleIcon by module id
- [ ] AC2 — Downstream module icon declarations keep working unchanged

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T04:07:22.752Z

- **Closed: sr text.** Use a label, not an emoji. Emoji sr text was a holdover from emoji rendering, and ADR-133 makes vectors primary.
- **Closed: keep the emoji → vector compatibility.** Downstream configs in the wild declare built-in emoji. Removing the mapping would be a visible regression with no config change on their side (R3).

### Design

- **One table, not an if-chain.** `const BUILTIN: Record<string, { Icon: LucideIcon; label: string; emoji: string[] }>` keyed by module id. Resolution order:
  1. `BUILTIN[id]`;
  2. the entry whose `emoji` list includes `icon` (the downstream compatibility path);
  3. if `icon` is set, a `<span>` showing it;
  4. otherwise `Layers`.

  The emoji lists carry today's literals, including `🏷`/`🏷️`/`🎯` and `⚙`/`⚙️`, and `🔎` for search.
- **Type:** `readonly icon?: string` on `WebModule`. Downstream entries still always set it from the descriptor, because config requires it. Only built-ins omit it.
- **Guard:** `(!('icon' in value) || value.icon === undefined || typeof value.icon === 'string')`.
- **Frozen names:** `ModuleIcon` props are unchanged (`id`, `icon?`, `size?`, `className?`, `aria-hidden?`).
- **Anti-patterns:** no config schema change; no emoji in built-in descriptors; no second icon component.
- **Leaves for 1426/1427/1430:** every built-in shell header renders `<ModuleIcon id={moduleId} size="lg" />` with no `icon` prop. 1430 asserts there is no emoji text node in the sidebar.

### Plan

Premises (verified 2026-11-21):
- Icon branches: `apps/web/src/components/ModuleIcon.tsx:49-67`. Sidebar call: `LeftSidebar.tsx:200`.
- Discovery guard requires `icon`: `apps/web/src/modules/discover.ts:49-50`.
- Downstream schema: `packages/config/src/board-modules.ts:64`.

- [ ] 1. Failure modes to cover: a built-in without `icon` is dropped by discovery; search falls back to emoji; downstream `📡` loses its vector icon; downstream custom emoji is rewritten; sr text is an emoji.
- [ ] 2. Write failing tests in `apps/web/tests/components/module-icon.test.tsx`: every built-in id renders an `svg` and no emoji text; downstream `📡` renders the `Radio` svg; downstream `🦊` renders the text; `size="lg"` sr text is the label. Also add a test in `apps/web/tests/modules/discover*.test.ts` (or `compose.test.ts`) that a module without `icon` is accepted.
- [ ] 3. Implement R1 (type + guard), then R3/R4 (table), then R2 (drop the nine `icon:` lines).
- [ ] 4. Run `rg -n "icon: '" apps/web/src/modules/*/index.tsx` and confirm it is empty. Then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:22:12.866Z backlog → todo (system)

