---
schema_version: 1
name: Sanitize raw HTML across Board Markdown previews
status: done
template: feature-impl
created_at: 2026-10-10T07:30:27.598Z
updated_at: "2026-10-10T23:56:15.392Z"
feature_id: F7

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1162-verdict.json
---

## 1162. Sanitize raw HTML across Board Markdown previews

### Background

MDEditor.Markdown renders unsanitized raw HTML, including unsandboxed iframe srcdoc containing executable same-origin scripts Evidence: `apps/web/src/modules/task-kanban/MarkdownBody.tsx:165`; callers `apps/web/src/modules/task-kanban/TaskDetail.tsx:528` and `apps/web/src/modules/features/FeatureDetail.tsx:805`. Review a71c confirmed this using safe DOM render of an iframe srcdoc payload; emitted dangerous DOM confirmed, browser script execution not attempted. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- Installed @uiw/react-md-editor 4.1.1 resolves react-markdown-preview 5.2.1. Its index.js installs rehypeRaw before rewrite/attrs/user plugins/prism; preview.js uses an identity URL transform and pluginsFilter over the final plugin array. A caller-supplied rehypePlugins sanitizer alone is not guaranteed to be last.
- Current read paths also include NewTaskPanel's direct Markdown preview and WorkflowsView via MarkdownBody. Editor paths are TaskDetail, FeatureDetail and NewTaskPanel via previewOptions; plan/design are read-only surfaces. Cover all of these, not only the original two readers.
- Existing markdown-body tests exercise primitives and mock Mermaid, while task/feature/plan/design/NewTask tests commonly mock MDEditor. Those cannot prove full-pipeline sanitization. Add an isolated real-renderer suite; no browser script execution is required to establish dangerous DOM absence.
- DOMPurify 3.4.11 is direct; hast-util-to-html 9.0.5 and hast-util-from-html 2.0.3 are already installed transitively. Promote these two existing utilities to explicit web dependencies for the small DOMPurify/HAST bridge; do not hand-roll HTML serialization or add a second sanitizer.

### Requirements

- [x] R1. Sanitize the final parsed Markdown HTML tree with installed DOMPurify before React renders it, consistently across all read and editor previews; preserve the dedicated Mermaid SVG sanitizer.
- [x] R2. Remove executable elements/attributes and unsafe URLs while preserving ordinary Markdown, safe links, fenced code, supported safe HTML, plan/design heading anchors and sanitized Mermaid.
- [x] R3. Prove the real rendering pipeline and caller wiring with task-local DOM regressions, including New Task; mocked preview components alone are insufficient.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given task, feature, plan and design Markdown with iframe srcdoc, script, event handlers and javascript links
  When each read or editor preview renders the content
  Then dangerous elements and executable attributes are absent from the resulting DOM

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given ordinary Markdown and Mermaid fixtures
  When the existing supported operation executes
  Then Normal Markdown, safe links, fenced code and sanitized Mermaid render correctly and unsafe raw HTML cannot execute
```

### Q&A

- Closed: DOMPurify remains the single sanitizer; bridge its HTML result back into HAST with two already-installed standard utilities made explicit dependencies.
- Closed: append after the final rehype list using pluginsFilter; an ordinary rehypePlugins entry is too early.
- Closed: include New Task and editor previews; plan/design have no editor mode. Keep Mermaid's separate SVG sanitizer.
- Closed: verify resulting DOM without executing attack scripts, using real renderer tests isolated from global module mocks.

### Design

**Frozen mechanism.** Add apps/web/src/lib/markdown-safety.ts exporting markdownPreviewSafety (shared preview props) and rehypeSanitizeMarkdown (a synchronous unified plugin). The plugin serializes the final HAST with hast-util-to-html.toHtml, calls DOMPurify(window).sanitize with USE_PROFILES:{html:true}, FORBID_TAGS:['style'], FORBID_ATTR:['style'], then parses the clean fragment with hast-util-from-html.fromHtml(...,{fragment:true}) and replaces root.children. Keep the default URI restrictions; do not enable ALLOW_UNKNOWN_PROTOCOLS, extra executable tags/attrs or raw passthrough. No unsafe HTML enters the live document during this conversion. A pluginsFilter callback appends this plugin to the END of the received rehype list, returning remark lists unchanged. This is after the installed library's raw parser, attr rewrite, highlighting and any built-in final raw insertion. Do not rely on the misleading skipHtml prop or on URL transform defaults. The final sanitized HAST is the only input to React components.

**Reach.** Spread markdownPreviewSafety on MarkdownBody, DesignMarkdownBody, PlanMarkdownBody and NewTaskPanel's direct MDEditor.Markdown; pass it via previewOptions on TaskDetail, FeatureDetail and NewTaskPanel MDEditor editors. Preserve existing components/code renderers, light/dark wrapper props, source/frontmatter handling and plan/design heading slug tracking. WorkflowsView inherits MarkdownBody's fix. MermaidBlock still sanitizes its separately generated SVG with sanitizeMermaidSvg before injection; HTML-only sanitizer runs before the custom code renderer, so it must not sanitize away subsequently generated Mermaid SVG. No toolbar/editor value/save/API changes.

**Dependencies / ownership.** Add exact installed hast-util-to-html 9.0.5 and hast-util-from-html 2.0.3 to apps/web/package.json and update the lockfile through Bun; these are existing installed utilities, not a new sanitizer or home-grown parser. Root DESIGN.md applies; maintain layout/styles/accessibility. If owning Board design prose states HTML trust, update that surface contract; no architectural/new UI feature redesign. 1163 touches unrelated project-terminal UI.

**Tests.** Add apps/web/tests/modules/task-kanban/markdown-safety.test.tsx with happy-dom registered before dynamic imports and the REAL MDEditor renderer, not a module mock. Use isolated test process execution where other suites' Bun module mocks would replace the renderer. Assert absence of iframe/srcdoc, script, object/embed, event attributes, javascript/vbscript URLs (including mixed case/entities), dangerous SVG/MathML raw payloads and style payloads in final DOM. Include Markdown-generated links as well as raw anchors and malformed nesting. Assert harmless headings, safe https/relative links, bold/list/table/checkbox output, literal dangerous-looking text inside code fences and preserved language classes. Test actual MarkdownBody, PlanMarkdownBody, DesignMarkdownBody and NewTask read preview; real editor preview modes for TaskDetail/FeatureDetail/NewTask may mock RPC/outer context only. Keep caller tests checking safety preview props, but those supplement the real pipeline tests. Retain Mermaid sanitation and add real-pipeline Mermaid routing with mocked Mermaid generation only, plus plan/design anchor consistency. No scripts actually execute in fixtures.

**Non-goals.** No CSP/auth redesign, remote-image privacy policy, new Markdown dialect, browser automation platform or unsafe HTML compatibility escape hatch. The deliberate compatibility change is removal of unsafe HTML/styles; ordinary Markdown and dedicated Mermaid stay supported.

### Plan

1. [x] R1/R3: add real-renderer isolated DOM regressions and demonstrate dangerous output before the fix; keep code-fence literals as positive controls.
2. [x] R1: declare installed HAST utility dependencies; implement final synchronous DOMPurify bridge and shared markdownPreviewSafety props.
3. [x] R1/R2: apply to all four direct readers and all three editor callers; preserve custom code/heading components and dedicated Mermaid sanitizer.
4. [x] R2/R3: cover safe Markdown/HTML/links, table/checkbox/code, plan/design anchors, Mermaid and all unsafe payload classes; run caller wiring tests and isolated real-renderer suite from apps/web.
5. [x] Run task gate; update owning surface prose if applicable; verify/review and record evidence before commit.

### Solution

Change map (paths repo-relative; one anchor per row):

| Change | Location |
| --- | --- |
| New sanitizer seam — serialize the final HAST with `hast-util-to-html`, run the one DOMPurify instance over it (`USE_PROFILES:{html:true}`, `FORBID_TAGS:['style']`, `FORBID_ATTR:['style']`, default URI restrictions), re-parse the clean fragment with `hast-util-from-html` and replace `root.children` | `apps/web/src/lib/markdown-safety.ts:14` |
| Shared preview props — `pluginsFilter` appends the sanitizer to the END of the rehype list the preview builds; remark lists pass through untouched | `apps/web/src/lib/markdown-safety.ts:30` |
| Board read preview spreads the shared props (WorkflowsView inherits) | `apps/web/src/modules/task-kanban/MarkdownBody.tsx:171` |
| Plan read preview spreads the shared props (slug tracker and code renderer untouched) | `apps/web/src/modules/plans/PlanMarkdownBody.tsx:51` |
| Design read preview spreads the shared props | `apps/web/src/modules/designs/DesignMarkdownBody.tsx:51` |
| New Task editor pane gets the shared props via `previewOptions` | `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:73` |
| New Task direct read preview spreads the shared props | `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:82` |
| Task body editor pane gets the shared props via `previewOptions` | `apps/web/src/modules/task-kanban/TaskDetail.tsx:525` |
| Feature body editor pane gets the shared props via `previewOptions` | `apps/web/src/modules/features/FeatureDetail.tsx:802` |
| Promote the two already-installed HAST utilities to explicit web dependencies (9.0.5 / 2.0.3, no other dependency added) | `apps/web/package.json:26` |
| Lockfile refreshed through Bun (the six workspace `0.4.0`→`0.4.1` lines are stale-lock reconciliation Bun performed, not a dependency change) | `bun.lock` |
| Test-only happy-dom workarounds: restore `Node.prototype.nodeName` for element nodes and a spec-behaving `NodeIterator`, so DOMPurify walks the tree as it does in a browser instead of stopping after its first removal | `apps/web/tests/dompurify-happy-dom.ts:17` |
| Module unit tests at the mirrored path (`require-corresponding-test`), deliberately DOM-free so they cannot mutate process-global DOM state: shared props append the sanitizer last, leave the caller list unmutated, return remark lists unchanged | `apps/web/tests/lib/markdown-safety.test.ts:10` |
| Design-pinned AC entry — asserts the isolated real-render privacy probe ran every expected regression and that the probe produced real assertion volume | `apps/web/tests/modules/task-kanban/markdown-safety.test.tsx:56` |
| AC1 real-renderer regressions (own Bun process): MarkdownBody, PlanMarkdownBody, DesignMarkdownBody, New Task read preview, real editor pane, FeatureDetail editor pane | `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:126` |
| AC2 real-renderer regressions: ordinary Markdown, safe/relative links, list/table/checkbox, fenced code with language class, plan+design heading anchors, Mermaid routing with `sanitizeMermaidSvg` | `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:192` |
| Plugin-level HAST sanitizer assertions (moved out of the DOM-free mirrored test): drops iframe/script/onerror/javascript:/style, keeps headings, safe links, code and checkbox inputs | `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:242` |
| TaskDetail caller wiring — editor pane receives the shared props | `apps/web/tests/modules/task-kanban/task-detail.test.tsx:197` |
| NewTask caller wiring — editor pane and read preview receive the shared props | `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx:275` |

**Why this shape.** DOMPurify stays the single sanitizer and the HAST round trip is the only bridge, exactly as frozen. Appending through `pluginsFilter` is the one hook that runs *after* the installed library's `rehypeRaw`, rewrite/attrs plugins, caller plugins, highlighting and its own final raw insertion — a plain `rehypePlugins` entry is too early. No `skipHtml`/URL-transform reliance, no `ALLOW_UNKNOWN_PROTOCOLS`, no extra tags/attrs, no raw passthrough. Mermaid keeps its separate `sanitizeMermaidSvg`; the HTML-only sanitizer runs before the custom code renderer, so Mermaid SVG generated afterwards is untouched.

**Why the probe is a separate process.** Sibling suites register a process-global `mock.module('@uiw/react-md-editor', …)` stub and Bun's last registration wins for the whole run, so a real-renderer suite cannot live in the same process. `markdown-safety-pipeline.tsx` deliberately does not match the `*.test`/`*.spec` pattern, so the aggregate runner never collects it; `markdown-safety.test.tsx` spawns it with `bun test --isolate … --reporter=junit` (120 s bound), reads the JUnit report and asserts exit code, test count, failure count, the exact expected regression names and a floor on assertions run — a probe that silently stopped rendering fails the suite instead of passing vacuously. Every DOM-touching assertion (including the happy-dom shims and the DOMPurify behaviour checks) therefore lives inside that child process; `tests/lib/markdown-safety.test.ts` stays DOM-free so its global-state mutation cannot reach sibling suites like `mermaid-sanitize.test.ts`.

**Known limits.** `<svg><script>…</script></svg>` cannot be asserted through this DOM: happy-dom's removal path detaches the parse root, so DOMPurify drops the remainder of that block in-process; the SVG payload used for the SVG class (`<svg onload>` + `xlink:href="javascript:"`) and the MathML payload carry the same guarantee. The workarounds above are test-only; production renders in a browser, which has neither happy-dom defect.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Sanitizer seam `apps/web/src/lib/markdown-safety.ts:14` serializes the final HAST, runs DOMPurify over it with `USE_PROFILES:{html:true}` + `FORBID_TAGS:['style']` + `FORBID_ATTR:['style']` and default URI restrictions, then re-parses the clean fragment with `fromHtml` and replaces `root.children`; shared props appending via `pluginsFilter` at `apps/web/src/lib/markdown-safety.ts:30`. All 7 MDEditor render sites wired: `apps/web/src/modules/task-kanban/MarkdownBody.tsx:171` (WorkflowsView inherits via `apps/web/src/modules/settings/WorkflowsView.tsx:420`), `apps/web/src/modules/plans/PlanMarkdownBody.tsx:51`, `apps/web/src/modules/designs/DesignMarkdownBody.tsx:51`, `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:73`, `apps/web/src/modules/task-kanban/NewTaskPanel.tsx:82`, `apps/web/src/modules/task-kanban/TaskDetail.tsx:525`, `apps/web/src/modules/features/FeatureDetail.tsx:802`. Dedicated Mermaid sanitizer retained at `apps/web/src/modules/task-kanban/MarkdownBody.tsx:22` and used at `apps/web/src/modules/task-kanban/MarkdownBody.tsx:73`. `grep -rn dangerouslySetInnerHTML apps/web/src` returns no matches. |
| R2 | MET | Real-renderer positives `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:195` (headings, bold, https + relative links, list, table, checkbox), `:209` (fenced `code.language-ts` keeps its class, literal `<script>` text stays inert), `:217` (plan/design `h1#overview` / `h2#overview-1` anchors), `:228` (mermaid fence still routes to MermaidBlock and the mock's unsafe SVG comes back with no `onload`). Plugin-level keeps assert `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:262`. Removal proven at `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:243` (drops iframe/script/onerror/javascript:/style, no `style=`). |
| R3 | MET | Orchestrator `apps/web/tests/modules/task-kanban/markdown-safety.test.tsx:56` spawns the isolated real-renderer probe and pins exit code 0, the exact 12 probe names, 0 failures and an assertions>100 floor so a non-rendering probe cannot pass vacuously. Probe renders real components at `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:128` (mocks limited to mermaid generation and FeatureDetail's RPC layer). Caller wiring asserted at `apps/web/tests/modules/task-kanban/task-detail.test.tsx:197` and `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx:275`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Reproducing edge case is safe (req: R1, R3) | MET | test | Isolated real-renderer probe `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:128-192` renders task/plan/design/New-Task-props/editor/FeatureDetail-editor previews against the iframe-srcdoc/script/onerror/javascript:/vbscript:/entity/event-attr/style fixture and asserts no dangerous node; fresh run this turn: 12 pass / 0 fail / 1203 expect() calls. |
| Scenario: AC2 — Existing behavior remains supported (req: R2, R3) | MET | test | Isolated probe `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:194-241` asserts ordinary Markdown, safe + relative links, list/table/checkbox, fenced `code.language-ts`, plan/design heading anchors and Mermaid routing with the dedicated SVG sanitizer all render; the same fixture run proves unsafe raw HTML yields no executable DOM; fresh run: 12 pass / 0 fail / 1203 expect() calls. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

- **Review Report — 1162**
- **Scope:** `git diff HEAD` + untracked files in this worktree (12 modified + 5 new; sanitizer seam `apps/web/src/lib/markdown-safety.ts`, 7 wiring sites in 6 modules, 4 test files, `apps/web/package.json` + `bun.lock`, 1 out-of-surface test-isolation repair)
- **Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
- **Verdict:** PASS
- **Confidence:** HIGH (verdict-level). Per-claim levels and their verification, plus the test that would falsify each, are below.

**Confidence verification**

| Claim | Level | Verification | Falsifier |
|-------|-------|--------------|-----------|
| R1-R3 are satisfied in this tree (verdict) | HIGH | Three independent evidence classes agree: fresh isolated real-renderer probe green (12 tests / 1203 assertions, `markdown-safety-pipeline.tsx`), an independent negative control reproduced by this review (same XSS fixture rendered without `markdownPreviewSafety` put `iframe` + `srcdoc` back in the DOM, so the green probe is non-vacuous), and a static reach audit finding all 7 `MDEditor` render sites wired with no other raw-HTML sink | A real preview surface found rendering markdown without `markdownPreviewSafety`, or a probe assertion that still passes with the props removed |
| `pluginsFilter` is the hook that runs *after* the final `rehypeRaw`/highlight stages | HIGH | Read from the installed package source, not docs: `@uiw/react-md-editor@4.1.1` `dist/mdeditor.js` calls `pluginsFilter('rehype', rehypePlugins)` on the array it built after `rehypePlugins.push(rehypeRaw)` | Upstream rebuild/upgrade that moves `pluginsFilter` before those pushes — re-verify the dist call order on every `@uiw/react-md-editor` bump |
| Sanitization behaves identically in a real browser | MEDIUM | Only inferred: DOM assertions run under happy-dom, which needs two test-only DOMPurify shims (`apps/web/tests/dompurify-happy-dom.ts`) to walk the tree as a browser does; no browser execution was performed (deliberately, per the task's no-script-execution rule) | Load the AC1 fixture set in a real browser and diff the resulting DOM against the probe's expectations |
| The recorded full-gate PASS applies to the tree as reviewed | MEDIUM | Relied on the pipeline's own artifact — `.spur/run/1162-test-gate.log` (`10869 pass / 0 fail`, `proof-digest: sha256:e882586b...`) — and this review did not re-run it (host-wide lock; stage instructions). This review's own section write also advances the task-content half of the proof digest, so only the verify stage's re-certification binds the post-review tree | Recompute the proof-input fingerprint over the post-review tree and compare with the logged digest — an expected mismatch here would be caused by this write, not by a stale gate |
| The out-of-surface test repair is the correct fix, not a masked failure | HIGH | Root cause read directly: `packages/app/src/services/agent-service.ts:855` folds `countUnattributedInlineStages(this.ctx.cwd)` into the doctor envelope, i.e. live `<cwd>/.spur/run/*-attribution.jsonl` scratch, while the frozen fixture expects an empty attribution set; the temp-cwd change matches the neighbouring `ruleProject()` pattern and the file passes fresh (25 pass / 0 fail) | Doctor's envelope found to embed the cwd itself (it does not), or the temp cwd suppressing a real doctor defect rather than scratch dependence |


**Findings (ranked)**

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | functional | The New Task *direct read preview* is exercised through its exact props (`<MDEditor.Markdown source={XSS} {...markdownPreviewSafety} />`) rather than by rendering `NewTaskPanel` itself; component-level wiring is proven separately by the mocked caller test. Combined, both halves of R3 are proven — the real-pipeline probe just does not render that one component end-to-end. | `apps/web/tests/modules/task-kanban/markdown-safety-pipeline.tsx:145`; `apps/web/tests/modules/task-kanban/new-task-panel.test.tsx:275` | ACCEPTED |
| 2 | P4 (advisory) | usability | `DOMPurify(window)` is called unguarded, so any future non-client render would throw `window is not defined`. Safe today: the app root is `client:only`, and this mirrors the existing `sanitizeMermaidSvg` pattern in the same module tree. | `apps/web/src/lib/markdown-safety.ts:17`; `apps/web/src/pages/index.astro:28`; `apps/web/src/modules/task-kanban/MarkdownBody.tsx:24` | ACCEPTED |
| 3 | P4 (advisory) | efficiency | Each preview render serializes the whole final HAST, runs DOMPurify over the string, then re-parses it back (`toHtml` → `sanitize` → `fromHtml`), with no memoization. Linear in body size and not measured; the library already rebuilds its plugin array per render, so no new caching seam was introduced. | `apps/web/src/lib/markdown-safety.ts:14` | ACCEPTED |
| 4 | P4 (advisory) | correctness | Out-of-declared-surface test repair, judged on merits: **correct and minimal.** `agentDoctor`'s service cwd moved from `process.cwd()` to a fresh temp dir because `doctor`'s envelope reads live scratch (`<cwd>/.spur/run/*-attribution.jsonl`) while the frozen `json-raw-baseline` fixture expects an empty attribution set — i.e. the old test passed/failed on unrelated run scratch. It matches the existing `ruleProject()` pattern. Residual nit: the temp dir is never removed (same as the pre-existing `createNodeFileSystem(mkdtemp(...))` call it sits next to). | `packages/app/tests/services/json-envelope-adoption.test.ts:86`; root cause `packages/app/src/services/agent-service.ts:855` | ACCEPTED |

**Functional Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — final parsed tree sanitized with installed DOMPurify before React renders, all read + editor previews, Mermaid sanitizer preserved | MET | Sanitizer seam `apps/web/src/lib/markdown-safety.ts:14` (serialize → `DOMPurify(window).sanitize` with `USE_PROFILES:{html:true}`, `FORBID_TAGS:['style']`, `FORBID_ATTR:['style']`, default URI restrictions → `fromHtml(...,{fragment:true})` replaces `root.children`). Shared props + `pluginsFilter` append at `:30`. Reach audit: 7 call sites, all `MDEditor` renders in `apps/web/src` — `MarkdownBody.tsx:171` (WorkflowsView inherits via `WorkflowsView.tsx:420`), `PlanMarkdownBody.tsx:51`, `DesignMarkdownBody.tsx:51`, `NewTaskPanel.tsx:73`, `NewTaskPanel.tsx:82`, `TaskDetail.tsx:525`, `FeatureDetail.tsx:802`; `grep dangerouslySetInnerHTML apps/web/src` → none. Append-is-last confirmed against installed `@uiw/react-md-editor@4.1.1` dist: `pluginsFilter('rehype', rehypePlugins)` is invoked on the array after `rehypePlugins.push(rehypeRaw)`. Dedicated Mermaid path untouched: `MarkdownBody.tsx:22` → `:73` |
| R2 — executable elements/attributes and unsafe URLs removed; ordinary Markdown, safe links, fenced code, anchors, sanitized Mermaid preserved | MET | Real-renderer positives `markdown-safety-pipeline.tsx:194` (headings, bold, `https://` + relative links, list, checkbox, table), `:205` (fenced `code.language-ts` keeps its class, literal `<script>` text inert), `:213` (plan/design `h1#overview` / `h2#overview-1`), `:224` (mermaid fence still routes to `MermaidBlock` and the mock's unsafe SVG comes out with no `onload`); plugin-level keeps `:261`. Deliberate narrowed compatibility (dropping unsafe HTML and all `style`) is recorded as a design decision, not a regression |
| R3 — real pipeline + caller wiring proven by task-local DOM regressions incl. New Task | MET | Isolated real-renderer probe `markdown-safety-pipeline.tsx` (module mocks limited to mermaid generation and FeatureDetail's RPC layer) behind the orchestrator at `markdown-safety.test.tsx:56`, which pins exit code, exact probe names and an assertion floor so a non-rendering probe cannot pass vacuously; caller-wiring props asserted at `task-detail.test.tsx:197` and `new-task-panel.test.tsx:275`. See finding 1 for the one surface proven by composition rather than one end-to-end render |

**Fresh evidence run by this review (2026-10-10, this worktree)**

- `bun test tests/modules/task-kanban/markdown-safety.test.tsx tests/lib/markdown-safety.test.ts` (cwd `apps/web`) → `3 pass, 0 fail, 5 expect() calls`
- `bun test --isolate --reporter=junit ./tests/modules/task-kanban/markdown-safety-pipeline.tsx` (cwd `apps/web`) → `12 pass, 0 fail, 1203 expect() calls`, JUnit `<testsuites tests="12" assertions="1203" failures="0">`
- Independent negative control (throwaway probe, since deleted): real `MDEditor.Markdown` rendered with the same XSS fixture and **without** `markdownPreviewSafety` → `iframe: true | srcdoc: true` present in the DOM, i.e. the green probe above is not vacuous
- `bun run typecheck` (cwd `apps/web`) → clean (`tsc --noEmit`, no output)
- `bun test packages/app/tests/services/json-envelope-adoption.test.ts` → `25 pass, 0 fail`
- Full project gate NOT re-run by this review (a fresh run takes the host-wide lock); the pipeline's own `test-recheck` log records `10869 pass / 0 fail` with `proof-digest: sha256:e882586bc05dc6be703f7ac8b15767b67073ad9562fb3f07b7c16864ef15fa76` (`.spur/run/1162-test-gate.log`)

**Residual risk**

- No P1–P3 findings; all four P4 rows are deliberate, documented choices (ACCEPTED), so nothing here is left open to repair.
- Production runtime is not covered by these tests: happy-dom needs two test-only DOMPurify shims (`apps/web/tests/dompurify-happy-dom.ts`) to walk the tree as a browser does. A browser-only behaviour difference in DOMPurify's removal path would not be caught by CI — mitigated by using stock DOMPurify with default restrictions and no custom config beyond `FORBID_TAGS`/`FORBID_ATTR:['style']`.
- One payload class is not directly assertable through this DOM: `<svg><script>…</script></svg>` — happy-dom's removal path detaches the parse root, so the assertion covers the `srcdoc`/`script`/`onerror`/`javascript:` classes instead. Documented in the task's Known limits.
- `### Testing` still holds its placeholder comment (`docs/tasks5/1162_sanitize-raw-html-across-board-markdown-previews.md:101`) — expected, since this review stage runs before the pipeline's verify stage; verification must record its own evidence there.

**Next:** proceed to verify; record the run commands and outcomes in `### Testing` and keep the P4 rows dispositioned as ACCEPTED.

### References

`apps/web/src/modules/task-kanban/MarkdownBody.tsx:165`; callers `apps/web/src/modules/task-kanban/TaskDetail.tsx:528` and `apps/web/src/modules/features/FeatureDetail.tsx:805`

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 4.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T07:30:31.613Z backlog → todo (system)
- 2026-10-10T17:14:33.240Z todo → wip (system)
- 2026-10-10T18:20:29.655Z wip → testing (system)
- 2026-10-10T18:20:46.879Z testing → done (system)

