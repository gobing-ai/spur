# How to Customize Project Modules on the Spur Board

> Add your own modules to the Spur Board of **your** project — a compiled React tool, or an existing
> web app embedded by URL — without forking or editing the installed `@gobing-ai/spur` package. You
> declare modules in `.spur/config.yaml`; `spur self serve` validates them, serves their assets, and
> the Board renders them next to the built-in modules.

This guide is for downstream users of an installed Spur. To change a **built-in** Board module inside
the Spur repository, see [How to Add a UI Module to the Spur Board](./how_to_add_a_new_ui_module.md)
instead. The authoritative contract is the
[downstream Board modules design](../design/downstream-board-modules.md#6-authoring-guide); this
guide is the walkthrough.

```text
.spur/config.yaml ──▶ spur self serve (preflight: schema, ids, assets, runtime version)
  bootstrap.modules        │
                           ├── GET /api/board/modules   catalog the Board reads at load
                           ├── GET /modules/<id>/*      your built assets (read-only, no-store)
                           ▼
                     /board/modules/<id>   your module, in the Board sidebar and workspace
```

---

## 1. Pick a module type

| Type | Use when | You provide | Integration |
| --- | --- | --- | --- |
| `iframe` | You already run a web app (docs site, dashboard, internal tool) that allows being framed | An absolute `http(s)` URL | Display only: no shared theme, context, routing or messaging |
| `react` | You want a native panel inside the Board, optionally with a right-panel contribution | A prebuilt ESM entry + CSS in your project | Shares the Board's React, React DOM and React Router instances |

Start with `iframe` if the app already exists. Use `react` when the module should feel native.

---

## 2. Quick start: embed an existing app (`iframe`)

Add one declaration to your project's `.spur/config.yaml` (`spur self init` already seeded an empty
`modules: []` under `bootstrap`; keep any other keys you have):

```yaml
bootstrap:
  modules:
    - id: team-docs
      name: Team docs
      icon: "📚"
      type: iframe
      url: https://docs.example.test/
```

Restart the server and reload the browser:

```bash
spur self serve
```

`Team docs` appears in the Board sidebar at `/board/modules/team-docs`. If the frame stays blank,
the app refuses framing (see [Troubleshooting](#7-troubleshooting)); the **Open externally** link
always works.

---

## 3. Quick start: build a native module (`react`)

### 3.1 Project layout

Keep the module source anywhere in your project; only its **built output** is declared:

```text
your-project/
├── .spur/config.yaml
└── board/team-board/
    ├── package.json
    ├── vite.config.ts
    ├── src/index.tsx
    ├── src/team-board.css
    └── dist/              ← build output; this is what Spur serves
        ├── index.js
        └── index.css
```

### 3.2 Dependencies

React is supplied by the Board at runtime, so React is a **build/type-time** dependency only. Pin it
to the Board's version, which the installed package records in `web/board-runtime.json`
(`reactVersion`, `reactDomVersion`, `reactRouterVersion`; 19.2.1 / 19.2.1 / 7.11.0 at the time of
writing):

```bash
cd board/team-board
bun add -d vite @vitejs/plugin-react typescript react@19.2.1 @types/react @gobing-ai/spur
```

`@gobing-ai/spur` is needed only for the `@gobing-ai/spur/board` **type** export; it is never
bundled.

### 3.3 The entry

The entry exports exactly one thing — `webModule`. Name, icon and ordering live in YAML, not here.

```tsx
// src/index.tsx
import type { BoardModuleContribution } from '@gobing-ai/spur/board';
import { useState } from 'react';
import './team-board.css';

function TeamBoard() {
    const [count, setCount] = useState(0);
    return (
        <section className="team-board">
            <h1>Team board</h1>
            <button type="button" onClick={() => setCount(count + 1)}>
                Clicked {count} times
            </button>
        </section>
    );
}

function TeamBoardPanel() {
    return <aside className="team-board-panel">Notes for the selected item</aside>;
}

export const webModule: BoardModuleContribution = {
    apiVersion: 1,
    component: TeamBoard,
    rightPanelComponent: TeamBoardPanel, // optional
};
```

Rules the Board enforces: `apiVersion` must be `1`; `component` must be a component; do **not** call
`createRoot` — the Board mounts your component. The Board shares its React instance but **not** its
context objects, so bring your own context providers inside your component.

### 3.4 Vite library build

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Must match the `imports` keys of the installed web/board-runtime.json exactly. These resolve
// to the Board's own instances through its import map; bundling a copy breaks hooks.
const BOARD_PROVIDED = [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
    'react-router',
    'react-router/dom',
];

export default defineConfig({
    plugins: [react()],
    // Library mode does not replace process.env.NODE_ENV for bundled third-party code.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
        outDir: 'dist',
        lib: {
            entry: 'src/index.tsx',
            formats: ['es'],
            fileName: () => 'index.js',
            cssFileName: 'index',
        },
        rollupOptions: { external: BOARD_PROVIDED },
    },
});
```

```bash
bunx vite build      # → dist/index.js, dist/index.css
```

Everything not in `BOARD_PROVIDED` (date libraries, chart libraries, your own code) must be
**bundled** into `dist/` — the Board resolves no other bare imports. Lazy-loaded chunks are fine;
they are served from the same directory.

### 3.5 Declare it

Paths are relative to the project root (the directory `spur self serve` runs in, or `--cwd`), not
your shell's current directory:

```yaml
bootstrap:
  modules:
    - id: team-board
      name: Team board
      icon: "🧭"
      type: react
      directory: board/team-board/dist
      entry: index.js
      styles: [index.css]
      order: 10
```

Restart `spur self serve`, reload, and open `/board/modules/team-board`.

---

## 4. Field reference

| Field | Types | Required | Meaning |
| --- | --- | --- | --- |
| `id` | both | yes | Must match `^[a-z][a-z0-9-]*$`. Becomes the route `modules/<id>` and the asset prefix `/modules/<id>/`. |
| `name` | both | yes | Display name (non-empty). |
| `icon` | both | yes | Sidebar icon, usually an emoji (non-empty). |
| `type` | both | yes | `react` or `iframe`. |
| `sidebarLabel` | both | no | Shorter sidebar text than `name`. |
| `description` | both | no | Tooltip / descriptive text. |
| `order` | both | no | Finite number; sidebar position relative to other modules. |
| `enabled` | both | no | Defaults to `true`. `false` keeps the declaration validated but loads nothing. |
| `directory` | `react` | yes | Built asset directory, project-relative. |
| `entry` | `react` | yes | Entry file inside `directory`. |
| `styles` | `react` | no | Stylesheets inside `directory`, applied in order before the module renders. |
| `url` | `iframe` | yes | Absolute `http(s)` URL with no embedded credentials. |

Declarations are strict: an unknown field, or a field belonging to the other type (for example
`url` on a `react` module), is a configuration error. There is no nested `web:` or `source:` object.

Ids may not duplicate each other or collide with a built-in Board module or a retired route —
currently `observability`, `history`, `plans`, `designs`, `features`, `tasks`, `projects`,
`settings`, `workspace`, `inbox`, `teams`. The authoritative list is `reservedModules` in the
installed `web/board-runtime.json`; check it after upgrading Spur.

---

## 5. Develop, verify, change

1. **Stage safely.** Add the declaration with `enabled: false`. It is still validated (id shape,
   duplicates, collisions) but needs no built assets, so a typo surfaces before any code runs.
2. **Build** (`react` only) into the declared `directory`.
3. **Enable** with `enabled: true` (or delete the line) and **restart** `spur self serve`. Startup
   fails with a message naming `bootstrap.modules[<index>]`, the id and the reason when a declaration
   is invalid, an enabled asset is missing or escapes its directory, or the installed Board cannot
   host the module's contribution API version.
4. **Verify** the catalog and the module:

   ```bash
   curl -s http://localhost:3000/api/board/modules     # your module is listed
   curl -sI http://localhost:3000/modules/team-board/index.js   # 200, JavaScript MIME, no-store
   ```

   Then open `http://localhost:3000/board/modules/team-board`.
5. **Change** anything — the YAML or a rebuild — then restart and reload. There is no file watcher or
   hot reload; assets are served `no-store`, so a reload always picks up the new build.

`spur self serve --json` is only a port/URL probe; it starts nothing and does **not** run the module
preflight.

---

## 6. Trust and limits

- **Trusted code only.** Loading a `react` entry evaluates its code inside the Board page. Declare only
  modules you trust. Failures after load are contained: a module that fails to load or throws while
  rendering shows a diagnostic on its own route, and the built-in modules stay usable.
- **No backend entry.** Spur never imports or starts downstream server code. A module may call the
  existing Spur API; your own backend is yours to run.
- **Scoped CSS.** Use class names you own; no global resets or shell-wide Tailwind output — your CSS
  shares the page with the Board.
- **Frames are not a sandbox.** Spur frames the URL verbatim, sets no `sandbox`, sends no messages and
  does not proxy or start the app. Browser framing, mixed-content, cookie and popup rules all apply;
  another localhost port is a different origin. Switching away unmounts the frame.
- **Local server only.** Modules load in the local `spur self serve` Board. The Cloudflare Worker
  deployment does not load project modules.
- **One project per server.** Each project's server serves its own catalog and assets.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `spur self serve` exits with `bootstrap.modules[N] ("id"): …` | Invalid declaration, duplicate/reserved id, or missing/escaping asset | Fix the named field; check paths are relative to the project root |
| Startup error about the Board runtime / contribution API | The installed Board cannot host the declared modules (old or custom `dist/web`) | Upgrade `@gobing-ai/spur`, or remove a custom `server.webDistPath` override |
| Module row shows a diagnostic instead of the tool | `webModule` missing, `apiVersion` not `1`, `component` not a component, or the entry/style failed to load | Check the export and the browser console; confirm `/modules/<id>/index.js` returns JavaScript |
| "Invalid hook call" / two Reacts | A React package was bundled instead of externalized | Externalize exactly the `imports` keys of `web/board-runtime.json` |
| Bare-import resolution error in the console | A dependency outside the Board's import list was left external | Bundle it into `dist/` |
| Banner above the workspace about the catalog | The Board could not read `/api/board/modules` | Check the server log; built-in modules keep working |
| Iframe stays blank | The app sends `X-Frame-Options` / CSP `frame-ancestors`, or HTTPS/HTTP mixed content | Allow framing from the Board origin in that app, or use **Open externally** |
| Change not visible | Config and builds are read once at startup | Restart `spur self serve` and reload the browser |

---

## See also

- [Downstream Board modules design §6](../design/downstream-board-modules.md#6-authoring-guide) —
  the authoritative contract
- [`spur self serve`](./cmd_serve.md) — server flags (`--port`, `--host`, `--cwd`, `--no-open`)
- [How to Add a UI Module to the Spur Board](./how_to_add_a_new_ui_module.md) — built-in modules
  inside the Spur repository
