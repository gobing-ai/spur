---
schema_version: 1
name: Sanitize raw HTML across Board Markdown previews
status: todo
template: feature-impl
created_at: 2026-10-10T07:30:27.598Z
updated_at: "2026-10-10T07:30:31.613Z"
feature_id: F7

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 5
---

## 1162. Sanitize raw HTML across Board Markdown previews

### Background

MDEditor.Markdown renders unsanitized raw HTML, including unsandboxed iframe srcdoc containing executable same-origin scripts Evidence: `apps/web/src/modules/task-kanban/MarkdownBody.tsx:165`; callers `apps/web/src/modules/task-kanban/TaskDetail.tsx:528` and `apps/web/src/modules/features/FeatureDetail.tsx:805`. Review a71c confirmed this using safe DOM render of an iframe srcdoc payload; emitted dangerous DOM confirmed, browser script execution not attempted. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

### Requirements

- [ ] R1. Apply the existing installed HTML sanitizer through the full Markdown pipeline consistently for read previews and editor previews, preserving the dedicated Mermaid sanitization
- [ ] R2. Normal Markdown, safe links, fenced code and sanitized Mermaid render correctly and unsafe raw HTML cannot execute
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

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

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Apply the existing installed HTML sanitizer through the full Markdown pipeline consistently for read previews and editor previews, preserving the dedicated Mermaid sanitization Chosen direction follows the existing local seams. Reject sanitizing only Mermaid or relying on React escaping while rehypeRaw recreates HTML. Targets: apps/web/src/modules/task-kanban/MarkdownBody.tsx and editor preview options; DesignMarkdownBody.tsx; PlanMarkdownBody.tsx; affected Markdown render tests. Out of scope: new dependencies, API authentication redesign, changing the Markdown authoring format.

### Plan

1. Add a failing regression for AC1 using safe DOM render of an iframe srcdoc payload; emitted dangerous DOM confirmed, browser script execution not attempted.
2. Implement the chosen direction in apps/web/src/modules/task-kanban/MarkdownBody.tsx and editor preview options; DesignMarkdownBody.tsx; PlanMarkdownBody.tsx; affected Markdown render tests.
3. Run affected web Markdown and editor tests from its workspace and confirm AC1 plus existing happy paths; run the project gate.

Read DESIGN.md before UI changes. Confirm installed sanitizer availability and configure plugin ordering so raw HTML is sanitized after parsing. Test the actual rendering pipeline, not only a sanitizer helper.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`apps/web/src/modules/task-kanban/MarkdownBody.tsx:165`; callers `apps/web/src/modules/task-kanban/TaskDetail.tsx:528` and `apps/web/src/modules/features/FeatureDetail.tsx:805`

### History

- 2026-10-10T07:30:31.613Z backlog → todo (system)

