---
schema_version: 1
name: "Fix typesafe decision maker failing every call with TypeError: Body already used"
status: todo
template: issue
created_at: 2026-11-22T05:35:46.158Z
updated_at: "2026-11-22T05:38:52.388Z"

---

## 1436. Fix typesafe decision maker failing every call with TypeError: Body already used

### Background

Captured from the creation title: "Fix typesafe decision maker failing every call with TypeError: Body already used".

### Requirements

- [ ] R1. The typesafe maker answers failure-class decisions in task-pipeline instead of falling back. Evidence from .spur/spur.db decision_logs: 83 of 92 typesafe workflow calls ended outcome=fallback reason=error with error 'TypeError: Body already used'. All were decision_id=failure-class, caller=workflow, maker_source=config-decision (config.yaml makers.failure-class: typesafe). They ran 2026-10-19 to 2026-11-18 and averaged 273 ms each, so an HTTP round trip happened before the failure.
- [ ] R2. Find the root cause in the ts-libs ai-decision typesafe driver (packages/ai-decision/src/typesafe-driver.ts) or the TypeSafe SDK it wraps. Unverified hypothesis: a Response body is consumed twice, either by SDK retry re-sending a used Request body or by response/error handling reading the body after it was already read. Reproduce with 'spur decision run failure-class --maker typesafe' before changing code.
- [ ] R3. Add a regression test in ts-libs ai-decision that fails without the fix, for example an injected fetch whose response or retry path triggers the double read.
- [ ] R4. If the defect is in the third-party SDK, work around it at the driver seam (for example the injected fetch) and record the SDK version and an upstream reference.

- [ ] R5. Align the typesafe driver with the current TypeSafe API spec, not only the SDK. Checked 2026-11-21: `@typesafe-ai/sdk` 0.7.0 (published 2026-10-14) is both the pinned version (ts-libs `packages/ai-decision/package.json:57`, resolved in both repos) and npm `latest`, so there is no SDK upgrade to take. The live spec (https://api.typesafe.ai/openapi.json, info.version 0.2.0) and the model changelog (https://docs.typesafe.ai/changelog.md) define `GET /v1/models`, `POST /v1/systemone` with body `{model, state, questions, assets}`, question types choice/score/noul/box, and two request headers, `TypeSafe-Danger-Zone-Long-Context` and `TypeSafe-Danger-Zone-Images`.
- [ ] R6. Pin the model explicitly and let config override it. The current models are `jev-1.14.0` (Box questions plus images) and `jev-1.13.0`, and the docs use the `jev-latest` alias (https://docs.typesafe.ai/models.md). Today the driver forwards `config.model` only when set, and `~/.config/spur/config.yaml` sets none, so the model is whatever the SDK or server defaults to. Record the model actually served (`SystemOneResponse.model`) in the decision log so drift is visible.
- [ ] R7. Spec gaps found in SDK 0.7.0 (unverified beyond grep of `dist/index.mjs`): it has no support for the `TypeSafe-Danger-Zone-*` headers. It does have `assets` and `box`. Decide whether long context is needed for large `failure-class` evidence (default limits are 64k per request and 32k per question). If it is, send the header through the SDK per-request `headers` option. Do not fork the SDK.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

Not yet confirmed; reproduce first (R2).

Leading hypothesis, from reading SDK 0.7.0 `dist/index.mjs`: on every response, `bufferResponse` (around line 821) drains `response.clone().body` while also taking and releasing a reader on the original body. `parseBody` (around line 1111) then calls `res.text()` on the original. Bun's handling of clone() plus a locked-then-released original body may mark the original as used, which would raise `TypeError: Body already used` after a successful round trip. That matches the ~273 ms average duration. Check whether the failure is Bun-specific (run the same call under Node) and whether it happens on every response or only on error and retry paths.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
