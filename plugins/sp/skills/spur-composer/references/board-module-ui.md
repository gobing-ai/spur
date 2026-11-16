# Board module UI — where the shell rules live

Read this before composing a `type: react` Board module (SKILL.md § Board module composition,
`compose`/`build` rows). It routes an author to the owners of the shell contract; it deliberately
restates none of them — a second copy of a rule is a second rule that drifts.

## Owners

| Question | Owner |
| --- | --- |
| What a module shell must look like — header anatomy, append-only tabs, density and width, empty/loading/diagnostic states, right panel, light/dark tokens | root [`DESIGN.md` § Product UI — Module Shell](../../../../../DESIGN.md#product-ui--module-shell-built-in-and-downstream-modules) |
| How a project declares, builds and loads a module — declaration schema, `webModule`, Vite externals, paths, trust and failure containment | [`downstream Board modules` §6 authoring guide](../../../../../docs/design/downstream-board-modules.md#6-authoring-guide) |
| What the host shares with a contribution — the UI-kit specifiers, exports, versioning, type-only declarations and failure diagnostic | [`Board module UI kit`](../../../../../docs/design/board-module-ui-kit.md) |

A rule that appears in two of those files is a conflict to resolve in the owning file, not something
to reconcile here.

## Composing a react module

1. **Decide it should exist** — a built-in module or an existing declaration already covering the
   need means no new module (SKILL.md `select` row).
2. **Read the shell contract first.** `DESIGN.md` is the normative UI owner: the header row and its
   four slots, the append-only `tabs.ts` contract, the `max-w-[1600px]` rail and its full-bleed body
   exception, the three content states, and the token rules that make one component correct in both
   themes.
3. **Start from the starter template** rather than a blank directory:
   [`templates/board-module/`](../templates/board-module/README.md). It carries the Vite library config
   (externalizing exactly the `imports` keys of the installed `web/board-runtime.json`), an entry
   exporting `webModule` from the kit, a scoped stylesheet for module-private content, and the
   paste-ready `module.yaml` declaration. Either way the module is project-owned and never climbs a
   shared layer.
4. **Build against the host, not a copy of it.** Shell primitives come from the UI-kit specifier the
   installed `board-runtime.json` advertises (see the satellite for the current specifier and
   exports); module-private content gets scoped CSS. Shipping Tailwind output or a copy of the host
   stylesheet is the drift this contract exists to prevent.
5. **Gate through the declaration**: stage `enabled: false`, restart `spur self serve`, confirm the
   preflight accepts the declaration and the route renders, then enable. The declaration contract
   and the preflight's failure behavior belong to the authoring guide, not here.

## Boundary

- Shell rules → `DESIGN.md`. Declaration/build/runtime rules → downstream §6. Kit contract →
  the satellite. This file adds only the routing between them.
- A module that needs a shell behavior the contract does not describe is a contract question:
  propose it in `DESIGN.md` (the UI authority) before writing look-alike CSS.
- Iframe contributions are not shell authors — their rules are `DESIGN.md` § Downstream frame and
  panel rules and downstream §6.7.
