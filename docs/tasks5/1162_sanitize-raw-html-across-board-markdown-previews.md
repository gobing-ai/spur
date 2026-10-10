---
schema_version: 1
name: Sanitize raw HTML across Board Markdown previews
status: todo
template: feature-impl
created_at: 2026-10-10T07:30:27.598Z
updated_at: "2026-10-10T16:34:24.909Z"
feature_id: F7

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 5
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

- [ ] R1. Sanitize the final parsed Markdown HTML tree with installed DOMPurify before React renders it, consistently across all read and editor previews; preserve the dedicated Mermaid SVG sanitizer.
- [ ] R2. Remove executable elements/attributes and unsafe URLs while preserving ordinary Markdown, safe links, fenced code, supported safe HTML, plan/design heading anchors and sanitized Mermaid.
- [ ] R3. Prove the real rendering pipeline and caller wiring with task-local DOM regressions, including New Task; mocked preview components alone are insufficient.

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

1. [ ] R1/R3: add real-renderer isolated DOM regressions and demonstrate dangerous output before the fix; keep code-fence literals as positive controls.
2. [ ] R1: declare installed HAST utility dependencies; implement final synchronous DOMPurify bridge and shared markdownPreviewSafety props.
3. [ ] R1/R2: apply to all four direct readers and all three editor callers; preserve custom code/heading components and dedicated Mermaid sanitizer.
4. [ ] R2/R3: cover safe Markdown/HTML/links, table/checkbox/code, plan/design anchors, Mermaid and all unsafe payload classes; run caller wiring tests and isolated real-renderer suite from apps/web.
5. [ ] Run task gate; update owning surface prose if applicable; verify/review and record evidence before commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

