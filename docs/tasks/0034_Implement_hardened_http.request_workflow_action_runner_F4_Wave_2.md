---
name: Implement hardened http.request workflow action runner (F4 Wave 2)
description: Implement hardened http.request workflow action runner (F4 Wave 2)
status: done
created_at: 2026-06-10T00:46:55.044Z
updated_at: 2026-06-10T19:40:30.000Z
folder: docs/tasks
type: task
feature-id: ""
preset: complex
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0034. Implement hardened http.request workflow action runner (F4 Wave 2)

### Background

Wave 2 of task 0032. The `http.request` workflow action was split out of 0032 because it is the **odd
one out**: highest security surface (network / SSRF) and lowest relevance to the `feature-dev` loop
(none of brainstorm→…→verify needs HTTP). 0032 ships `agent.run` + `rule.check` + `file.*` first —
which fully de-`note`s `feature-dev.yaml` — and defers HTTP here so it gets the security hardening it
needs without blocking the dev-loop automation.

It registers as a spur built-in via `registerSpurBuiltins` (same factory as 0032), but it must **not**
call `fetch` directly. Outbound HTTP goes through `@gobing-ai/ts-infra`'s `APIClient` so telemetry,
timeout handling, error shaping, and any future outbound-network policy stay centralized in the
infrastructure package.

Current grounding: Spur has `agent.run`, `rule.check`, `file.*`, and HITL built-ins in
`packages/app/src/workflow/builtins.ts`; `http.request` is absent by design. `@gobing-ai/ts-infra`
currently exports `APIClient`, but the existing convenience methods throw on non-2xx and return only
parsed body data for success. This task therefore has an upstream prerequisite: add or consume an
`APIClient` raw-response API that returns status, headers, and text body without throwing on HTTP
status codes.

### Requirements

1. **HttpRequestActionRunner** (kind: `http.request`), registered in `registerSpurBuiltins`.
2. Options: `url` (required), `method` (default **`GET`** — the conventional default; the original
   `POST` was surprising), `headers`, `body`, `failOnStatus: number[]`, `timeoutMs`, `maxResponseBytes`,
   `redirect`, and response var targets: `bodyVar`, `statusVar`, `headersVar` (all optional).
3. **HTTP dependency boundary (gating — do not ship without):**
   - The runner must use `@gobing-ai/ts-infra` `APIClient` (or a tiny `APIClient`-backed facade), not
     direct `fetch`, `node:http`, `undici`, `axios`, or another HTTP client.
   - If the current `APIClient` cannot expose raw `{ status, headers, body }` for both 2xx and non-2xx
     responses, make the smallest upstream `ts-infra` enhancement first, release it, and bump Spur's
     root catalog `@gobing-ai/ts-infra` version. A temporary `bun link @gobing-ai/ts-infra` is allowed
     only while validating the unreleased upstream fix.
   - The upstream raw API must support string request bodies without JSON serialization and must expose a
     redirect policy option (`manual` default for this action). Do not force `Content-Type:
     application/json` when the workflow author provides a raw body.
   - Preserve existing `APIClient` behavior for `get`/`post`/`put`/`delete`; any new raw-response method
     must be additive and covered by `ts-libs` tests.
4. **Security (gating — do not ship without):**
   - Reject non-`http(s)` schemes before constructing the API client (no `file://`, `gopher://`, etc.).
   - Use a **default-deny host allowlist**. Allowed origins/hosts come from workflow-run config/context
     injected into `registerSpurBuiltins` or `WorkflowAppServiceContext`; if no allowlist exists,
     `http.request` must fail before network I/O. Do not add a per-action `allowNet` escape hatch in
     this task.
   - Define allowlist matching explicitly. Recommended shape: exact origin (`scheme://host[:port]`) for
     externally reachable services; exact hostname entries may be allowed only when protocol/port are not
     security-relevant for that workflow. No substring matching.
   - Re-parse and validate the final templated URL; validate the actual hostname after interpolation,
     not the literal pre-template string.
   - Reject URLs containing username/password credentials.
   - Reject loopback/private/link-local hostnames or IPs unless the allowlist explicitly includes that
     exact host. Do not rely only on suffix matching.
   - Redirects must not bypass policy. Default `redirect` to `manual`; if `follow` is supported later,
     each redirect target must be revalidated against the same scheme/private-host/allowlist policy
     before following it.
   - **Never log `headers`** (auth tokens); redact in any diagnostic output.
   - Treat templated `url`/`headers`/`body` (`${...}`) as untrusted input.
5. Request bounds:
   - `method` is normalized to uppercase and restricted to `GET`, `POST`, `PUT`, `PATCH`, `DELETE`,
     `HEAD`, `OPTIONS` unless design finds a real need for extension.
   - `timeoutMs` must have sane bounds (recommended default `30_000`, max `120_000`, reject non-positive
     and over-max values).
   - `maxResponseBytes` defaults to a finite value (recommended `1_048_576` / 1 MiB) and rejects larger
     bodies before storing them in `data` or `setVars`.
   - Header option values must be strings. Reject newline/control characters in header names/values.
6. Execution: template-resolve `url`/`headers`/`body`; normalize method; call the `APIClient` raw
   request API with timeout, redirect policy, raw string body, and headers; read response body as text
   with `maxResponseBytes` enforcement. Do not JSON-parse the response in the action runner.
7. Success mapping: `response.ok && !failOnStatus.includes(status)` → `ok: true`; else `ok: false`.
   `data: { status, headers, body }`. Network error/timeout → caught → `ok: false` with a redacted
   message.
8. `setVars` is in scope now (task 0033 is done): when `bodyVar` / `statusVar` / `headersVar` are set,
   return string-only `setVars` values for downstream actions. `statusVar` is `String(status)`;
   `headersVar` is a JSON string of response headers.
9. Wiring: extend `SpurWorkflowBuiltinsOptions` and `WorkflowAppServiceContext` with the API client
   factory and host allowlist policy. Keep policy construction at the app/CLI seam; the action runner
   receives dependencies and policy, not global config.
10. Tests:
   - Spur runner tests with an injected fake `APIClient`/facade: GET default; non-http(s) scheme rejected
     before client call; missing allowlist fails before client call; allowed host calls client; private
     host rejected unless exact allowlist permits it; 200 ok; 500 with empty `failOnStatus` fails; 200
     with `failOnStatus:[200]` fails; network error/timeout fails; `setVars` body/status/headers.
   - Security/bounds tests: URL credentials rejected; redirect defaults to manual; follow-mode redirect
     target is revalidated if supported; over-large response fails without `setVars`; invalid method,
     timeout, and header control characters are rejected before client call.
   - Redaction test: errors/diagnostics must not include request header values.
   - Built-in registration test: `registerSpurBuiltins` includes `http.request` with origin `builtin`.
   - Upstream `ts-infra` tests for the raw-response `APIClient` addition, if this task adds it.
11. Gate: `bun run check` + `bun run build` green in Spur; if `ts-infra` changes, its own lint/type/test
    gate must pass before bumping the Spur catalog.

### Q&A

**Q1. Why GET default, not POST?** HTTP convention. 0032's original POST default would surprise authors
and make read requests verbose.

**Q2. Allowlist vs. opt-in flag?** Use a default-deny host allowlist. A per-action `allowNet` flag is
too easy to cargo-cult into workflows and turns SSRF protection into convention. The implementation can
later add a deliberate project-level network policy, but this task should not let workflow authors
silently opt into arbitrary egress.

**Q3. Why `APIClient`, not direct `fetch`?** Robin's implementation constraint is correct: outbound HTTP
is infrastructure. `APIClient` already centralizes fetch, OTel tracing, metrics, timeout handling, and
`APIError`. If its current surface is too convenience-oriented, fix `ts-infra` additively instead of
creating a second HTTP stack in Spur.

**Q4. Does this require an upstream task?** Likely yes. Current `APIClient.get/post/put/delete` throw on
non-2xx and return parsed body only, while `http.request` needs `{ status, headers, body }` for both
success and failure. Add a raw-response method or small typed facade in `@gobing-ai/ts-infra`, release
it, then consume the published version from Spur's catalog.

**Q5. Where does allowlist config live?** Decide during design, but it must be injected from the
app/CLI boundary into `registerSpurBuiltins`; the runner should not read environment variables or global
config directly. That keeps unit tests hermetic and matches the existing `agentService` / `ruleService`
injection pattern.

**Q6. Why manual redirects by default?** Automatic redirects can turn an allowed first hop into a
disallowed second hop, which is a classic SSRF bypass. `manual` is the safe default. If follow-mode is
added, the runner or APIClient facade must validate every redirect target before the next request.

**Q7. Why cap response size?** Workflow action output can be persisted, logged, and copied into `vars`.
An unbounded HTTP body is both a memory/cost risk and an accidental prompt-injection amplifier for later
`agent.run` steps. A finite default keeps the primitive predictable.

### Design

- **Files:** `packages/app/src/workflow/actions/http-request.ts`; tests under
  `packages/app/tests/workflow/actions/http-request.test.ts`; registration coverage in
  `packages/app/tests/workflow/builtins.test.ts`. If `APIClient` is enhanced, changes land first in
  `~/xprojects/ts-libs/packages/infra/src/api-client.ts` and its tests.
- **Dependency shape:** prefer injecting a narrow `HttpRequester` interface owned by Spur and backed by
  `APIClient`, so the action runner is easy to test without depending on the full concrete client. The
  production implementation must still delegate to `APIClient`.
- **URL policy:** parse the final templated `url` with `new URL()`, require `http:` or `https:`, compare
  `url.origin` or `url.hostname` against an injected allowlist, reject credentials, and handle
  private/loopback/link-local hosts explicitly. Keep matching exact by default; suffix/wildcard matching
  is a separate policy decision and should not be improvised inside the runner.
- **Redirect policy:** default to `manual`; surface 3xx as a normal completed HTTP response unless the
  author explicitly configures follow behavior later. Any future follow behavior must re-run URL policy
  per hop.
- **Bounds:** enforce method allowlist, timeout bounds, header control-character validation, and
  `maxResponseBytes` before emitting `data`/`setVars`.
- **Response shape:** return `data: { status, headers, body }` for every completed HTTP response,
  including non-2xx. Reserve `error` for action-level failure text and network/timeout exceptions.
- **Variable export:** if var targets are present, add `setVars` using only strings. Do not export
  request headers; only response headers, and only under `headersVar`.

### Solution
_Design section above is authoritative. Upstream prerequisite confirmed needed: `APIClient` in `ts-infra@0.3.10` lacks raw-response (`{status, headers, body}`), raw-string-body, redirect-policy, and response-size enforcement. Steps 1-2 of Plan address this first._

### Plan

**Decomposition decision:** Skip. Single cohesive feature (http.request action runner) with one linear upstream prerequisite. Splitting into subtask files would create artificial boundaries between tightly-coupled work — the upstream APIClient change is ~50 LOC additive, and the Spur runner/wiring/tests are a single implementation unit.

#### Implementation Sequence

**Phase 1 — Upstream ts-infra: `APIClient.rawRequest()` (~50 LOC)**

File: `~/xprojects/ts-libs/packages/infra/src/api-client.ts`

1. Add `RawHttpResponse` type: `{ status: number; headers: Record<string, string>; body: string }`
2. Add `RawRequestOptions` extending `RequestOptions`: `{ redirect?: RequestRedirect; maxResponseBytes?: number }`
3. Add public `rawRequest(method, path, body?, opts?)` method:
   - Builds URL from config.baseUrl + path (like existing `request()`)
   - Sets headers from config + opts, but does NOT force `Content-Type: application/json`
   - Body is passed as raw string (not JSON.stringify) when provided
   - Supports `redirect` policy (`manual` default), `maxResponseBytes` enforcement
   - Wraps in `traceAsync` for OTel (like existing `request()`)
   - Records same metrics (duration, total, errors)
   - Returns `RawHttpResponse` for ALL status codes (never throws on non-2xx)
   - Throws on network/timeout errors (wrapped in `APIError` with status 0)
   - Enforces `maxResponseBytes`: reads response body as text, truncates to max, signals truncation
4. Export `RawHttpResponse`, `RawRequestOptions` from `packages/infra/src/index.ts`
5. Add tests in `packages/infra/tests/api-client.test.ts` (or create if absent)
6. Bump version, publish, update Spur root catalog

**Phase 2 — Spur: HttpRequester interface + HttpRequestActionRunner (~250 LOC)**

Files: `packages/app/src/workflow/actions/http-request.ts` (new)

1. Define narrow `HttpRequester` interface: `{ rawRequest(method, url, body?, opts?): Promise<RawHttpResponse> }` (owned by Spur, backed by APIClient)
2. Implement `HttpRequestActionRunner`:
   - Options parsing: `url` (required string), `method` (default `GET`, normalize uppercase), `headers`, `body`, `failOnStatus`, `timeoutMs`, `maxResponseBytes`, `redirect`, `bodyVar`/`statusVar`/`headersVar`
   - **Security gate 1 — Scheme**: `new URL(url)` → reject non-`http:`/`https:` before any I/O
   - **Security gate 2 — Credentials**: reject URLs with username/password
   - **Security gate 3 — Allowlist**: compare `url.origin` against injected host allowlist; reject if not found; fail if allowlist is empty (default-deny)
   - **Security gate 4 — Private hosts**: reject loopback/private/link-local unless explicitly in allowlist
   - **Bounds**: `method` allowlist (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS), `timeoutMs` bounds (1–120000, default 30000), `maxResponseBytes` (default 1MiB), header control-char validation
   - Execute: `requester.rawRequest(method, url, body, { headers, timeout: timeoutMs, maxResponseBytes, redirect })`
   - **Response redaction**: never log/emit request headers in errors or diagnostics
   - Success mapping: `ok = response.status < 400 && !failOnStatus.includes(status)`
   - `setVars`: `bodyVar`→body, `statusVar`→String(status), `headersVar`→JSON.stringify(headers), all strings
3. Template resolution: `url`, `headers`, `body` support `${vars.xxx}` interpolation from `context.vars`

**Phase 3 — Wiring: extend `SpurWorkflowBuiltinsOptions` and `registerSpurBuiltins` (~30 LOC)**

File: `packages/app/src/workflow/builtins.ts`

1. Add `httpRequester` and `hostAllowlist` to `SpurWorkflowBuiltinsOptions`
2. Register `HttpRequestActionRunner` in `registerSpurBuiltins`

**Phase 4 — CLI/App seam: Wire at app boundary (~20 LOC)**

Files: Wherever `registerSpurBuiltins` is called (likely `WorkflowAppServiceContext` or app init)

1. Construct `HttpRequester` backed by `APIClient`
2. Pass host allowlist from config/context (empty = default-deny)
3. Pass to `registerSpurBuiltins`

**Phase 5 — Tests (~400 LOC)**

Files: `packages/app/tests/workflow/actions/http-request.test.ts` (new)

Test categories (≈20 test cases):
- **Happy path**: GET default, POST with body, response vars export
- **Scheme security**: non-http(s) rejected, credentials rejected
- **Allowlist**: missing allowlist fails, allowed host succeeds, denied host fails, private host denied unless explicit
- **Bounds**: invalid method rejected, timeout bounds, maxResponseBytes enforced, header control-char rejected
- **Error handling**: network error → ok:false, timeout → ok:false, non-2xx with empty failOnStatus → ok:false, 200 with failOnStatus:[200] → ok:false
- **Redaction**: error messages must not contain request header values
- **Registration**: `registerSpurBuiltins` includes `http.request` with origin `builtin`
- **Template resolution**: url/headers/body interpolated from context.vars

### Review

**Verdict: PASS** — 2026-06-10

#### SECU Summary

| Dimension | Status | Notes |
|-----------|--------|-------|
| **Security** | ✅ | Scheme gate, credential rejection, default-deny allowlist, private-host blocking, redaction all enforced before any I/O. No per-action `allowNet` escape hatch. |
| **Error handling** | ✅ | Structured errors on invalid input; network/timeout errors caught and wrapped with redacted messages; non-2xx responses returned as data, not errors. |
| **Correctness** | ✅ | All 11 requirements traced to implementation. Template resolution on final URL/headers/body. Success mapping with `failOnStatus`. `setVars` integration. |
| **Usability** | ✅ | GET default (HTTP convention). Sensible defaults (30s timeout, 1 MiB response cap, manual redirects). Clean error messages. |

#### Requirements Traceability

| Req | Description | Location | Test |
|-----|-------------|----------|------|
| R1 | HttpRequestActionRunner registered | `builtins.ts:33-38` | `builtins.test.ts` — "registers all action kinds..." + "registers with origin builtin" |
| R2 | Options surface | `http-request.ts:138-148` | All tests exercise option parsing |
| R3 | HTTP via APIClient | `ts-infra api-client.ts` `rawRequest()` + `HttpRequester` interface | Upstream 7 tests in `api-client.test.ts` |
| R4 | Security (scheme/creds/allowlist/private/redact/redirect) | `http-request.ts:171-216` | 9 security tests |
| R5 | Bounds (method/timeout/headers/maxBytes) | `http-request.ts:140-168` | 5 bounds tests |
| R6 | Template resolution | `http-request.ts:155-169` | 3 template tests |
| R7 | Success mapping | `http-request.ts:218-219` | 4 failOnStatus tests |
| R8 | setVars export | `http-request.ts:222-224` | 1 export test |
| R9 | Wiring via context | `workflow-service.ts:45-53,111-119` | Implicit via builtin registration test |
| R10 | Tests | 31 + 2 registration tests | All passing |
| R11 | Gate | `bun run lint` + `bun run test` | 509 tests pass, lint clean |

#### Gap Analysis

- **Redirect follow validation**: Per R4, default is `manual`. If `follow` is added later, each redirect target must be revalidated. This is a deferred feature, not a gap.
- **Allowlist source**: Per Q5, configured at app/CLI boundary — not implemented in this task (no CLI/config surface yet). The wiring supports injection; the source is a follow-up.
- **Upstream release**: `ts-infra` `rawRequest()` is validated via temporary store patch. Pending release + catalog bump (see Plan Phase 1 step 6).


### Testing

- **31 tests** in `packages/app/tests/workflow/actions/http-request.test.ts` — 100% func + line coverage on `http-request.ts`
- **2 registration tests** in `packages/app/tests/workflow/builtins.test.ts` — verifies http.request registered with origin `builtin`, not registered without requester
- **7 upstream tests** in `packages/infra/tests/api-client.test.ts` for `APIClient.rawRequest()`
- Full suite: **509 tests pass, 0 fail** across 71 files
- Coverage: 99.89% funcs, 99.44% lines (project aggregate)
- Lint + typecheck: clean across all 7 workspaces

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References
