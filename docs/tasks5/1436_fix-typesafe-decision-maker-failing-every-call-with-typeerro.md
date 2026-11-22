---
schema_version: 1
name: "Fix typesafe decision maker failing every call with TypeError: Body already used"
status: done
template: issue
created_at: 2026-11-22T05:35:46.158Z
updated_at: "2026-11-22T19:46:40.507Z"

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: 1
done_forced: "false"
done_reason: unforced close
---

## 1436. Fix typesafe decision maker failing every call with TypeError: Body already used

### Background

From 2026-10-19 the typesafe maker failed almost every call with `TypeError: Body already used`, in this repo (`failure-class` workflow decisions) and in knowledge-kit (`kk-seo-*`). The bug and its fix live upstream in ts-libs, released as 0.8.4. What remains is Spur-side adoption, proof and model-pin documentation.

### Requirements

- [x] R1. Root cause found (2026-11-21), see Root Cause. 83 of 92 typesafe `failure-class` workflow calls in this repo's `.spur/spur.db`, plus 35 calls in knowledge-kit, fell back with `TypeError: Body already used`.
- [x] R2. Fixed upstream at the driver seam: `@gobing-ai/ts-ai-decision` 0.8.4 (ts-libs `packages/ai-decision/src/typesafe-driver.ts`, `streamBackedFetch`). No SDK fork; SDK `@typesafe-ai/sdk` 0.7.0 is still npm latest.
- [x] R3. Upstream regression test: ts-libs `packages/ai-decision/tests/typesafe-driver.test.ts`, "buffered (non-stream) fetch bodies are answered". It fails with `Body already used` without the fix.
- [x] R4. Adopt 0.8.4 in Spur. Root `package.json` catalog pins `ts-ai-runner`, `ts-ai-decision` and `ts-decision-fm` at 0.8.4 and `bun.lock` is updated (operator ran `bun install`, uncommitted). Rebuild the bundled CLI so the installed `spur` binary carries the fix.
- [x] R5. End-to-end proof in this repo: `spur decision run failure-class --param wbs=<wbs> --maker typesafe --json` with the bundled binary returns `source: model`, `reason: accepted`, and no `error`. Run it against a temporary `DATABASE_URL` and save the JSON as a repeatable artifact.
- [x] R6. Pin the TypeSafe model through the SDK's own env var, not code. SDK 0.7.0 resolves `TYPESAFE_DEFAULT_MODEL` and falls back to `jev-latest` (`dist/index.mjs:552,905`). Do NOT pin through a catalog `model:` field: the hub forwards it to whichever maker runs, and `ts-decision-clef` treats a per-call `model` as its own selector (`decision-clef/src/driver.ts:224`). Document the variable in a comment beside `maker: typesafe` in `config/config.global.yaml:168` and next to `TYPESAFE_API_KEY` in `docs/design/cli-contracts.md:1220`.
- [x] R7. Spec alignment check (live spec https://api.typesafe.ai/openapi.json v0.2.0) needs no code. The driver sends `{model, state, questions}` to `POST /v1/systemone`. The `TypeSafe-Danger-Zone-Long-Context` header is not needed: the largest recorded `failure-class` input is ~2.1 KB against a 64k per-request limit. Record this disposition and the evidence in Solution.

### Acceptance Criteria

```gherkin
Scenario: AC1 — the typesafe maker answers failure-class instead of falling back (req: R4, R5)
  Given the bundled `spur` binary built against `@gobing-ai/ts-ai-decision` 0.8.4 and `TYPESAFE_API_KEY` set
  When `spur decision run failure-class --param wbs=1436 --maker typesafe --json` runs with `DATABASE_URL` pointing at a temporary database
  Then the result has `source` `model`, `reason` `accepted`, and no `error` field

Scenario: AC2 — no new Body-already-used fallbacks in the decision log (req: R4, R5)
  Given AC1's temporary database
  When `decision_logs` rows for maker `typesafe` are queried
  Then no row has an error containing `Body already used`

Scenario: AC3 — the served model is pinnable without code (req: R6)
  Given `TYPESAFE_DEFAULT_MODEL=jev-1.13.0` in the environment
  When AC1's command runs
  Then the decision is accepted
  And `config/config.global.yaml` and `docs/design/cli-contracts.md` document `TYPESAFE_DEFAULT_MODEL` next to the `typesafe` maker

Scenario: AC4 — spec alignment recorded (req: R7)
  Given the live TypeSafe OpenAPI spec v0.2.0
  When the task closes
  Then Solution records that no driver change and no Danger-Zone header is needed, with the input-size evidence
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-22T07:05:31.132Z

- Q: Where does the fix live? A: Upstream in ts-libs, released as 0.8.4 by the operator on 2026-11-21. Spur only adopts it; no Spur source change is needed for the bug itself.
- Q: Log the model that actually served each decision (old R6 part 2)? A: Deferred. The driver drops `SystemOneResult.model` on purpose (ts-libs task 0072 R8), so this needs a ts-libs answer-metadata API change plus a `decision_logs` column. That is feature-sized and cross-repo, so it is out of scope here; file it as a follow-up idea.
- Q: Long-context Danger-Zone header? A: Not needed now (R7 evidence). Revisit only if `failure-class` starts carrying unbounded gate output.

#### Q&A entry — 2026-11-22T07:45:18.077Z

- Q: Was the deferred served-model logging filed? A: Yes, as backlog feature S ("Record the TypeSafe model that served each decision", `docs/features/S_record-the-typesafe-model-that-served-each-decision.md`). 1436 stays unlinked to a feature: it is a standalone upstream-adoption fix.
- Re-verify 2026-11-22: upstream R3 test re-run in ts-libs `packages/ai-decision` (`bun test tests/typesafe-driver.test.ts` → 16 pass, 0 fail).

### Design

Adoption plus configuration only. Keep the operator's existing `package.json` and `bun.lock` changes and commit them with this task. Do not add a Spur-side fetch wrapper: the registry's built-in `typesafe` maker cannot be overridden (`ts-ai-decision` `registry.ts:162` rejects duplicate names), and the upstream fix already covers every caller.

### Plan

1. `git status --short`: commit only `package.json`, `bun.lock` and this task's files. Leave the unrelated `docs/features/A82_*` and `docs/features/INDEX.md` changes alone.
2. Confirm the install: `node_modules/.bun/@gobing-ai+ts-ai-decision@0.8.4*/…/dist/typesafe-driver.js` contains `streamBackedFetch`.
3. Rebuild the CLI: `(cd apps/cli && bun link)` then `bun run --filter @gobing-ai/spur build:bundle`.
4. AC1 and AC2: run the bundled `spur` against `DATABASE_URL=$TMPDIR/t1436.db`. Save the JSON and the sqlite query output to `docs/tasks5/` evidence (or the task's Testing section) as the repeatable artifact.
5. AC3: document `TYPESAFE_DEFAULT_MODEL` in `config/config.global.yaml:168` and `docs/design/cli-contracts.md:1220`, then rerun AC1 with `TYPESAFE_DEFAULT_MODEL=jev-1.13.0`.
6. AC4: write the R7 disposition into Solution.
7. Run `bun run spur-check`, then commit: `fix(decision): adopt ts-ai-decision 0.8.4 typesafe body fix (1436)`.

### Root Cause

Confirmed 2026-11-21. In SDK 0.7.0, `bufferResponse` (`dist/index.mjs:821`) drains `response.clone()` and also takes and releases a reader on the original body. `parseBody` (`:1111`) then calls `res.text()` on the original. On Bun 1.4.3, when the body is already buffered rather than streaming, as a real fetch reply often is, that release leaves it marked used. Every call then threw `TypeError: Body already used`: successes, 400s and 401s alike, so HTTP errors also lost their typed mapping.

Repro: the bare SDK with a fake fetch that returns `new Response(jsonString)` fails, and the same payload as a `ReadableStream` succeeds. ts-libs fixtures were all stream-backed (`tests/helpers/sdk-fetch.ts`), which is why the suite missed it.

Fix (ts-ai-decision 0.8.4): the driver wraps fetch, buffers the bytes, and returns a fresh stream-backed Response. Live check with ts-libs source on 2026-11-21 (3 calls each): accepted, `DecisionRequestError` 400 for an unknown model, `DecisionAuthError` 401 for a bad key. Spur source CLI with 0.8.4 installed: `failure-class` accepted, value `stop`, confidence 0.88, 239 ms. The installed bundled `spur` still failed, because its bundle predates the bump (R4).

### Solution

Adoption + configuration; no Spur-side driver change.

| Change | Where | Why |
| --- | --- | --- |
| Catalog pins `ts-ai-runner` / `ts-ai-decision` / `ts-decision-fm` at 0.8.4 (+ `bun.lock`) | `package.json:32,33,35` | 0.8.4 carries the upstream `streamBackedFetch` fix at the driver seam. Lands in the base commit `6b4db06b4`; this run adds no further resolution change. |
| Bundled CLI rebuilt against 0.8.4 | `apps/cli/spur.js` (generated, not tracked) | The installed binary predated the bump, so it still raised `Body already used`. `bun run --filter @gobing-ai/spur build:bundle` then `(cd apps/cli && bun link)` makes the installed `spur` the fixed bundle: `grep -c streamBackedFetch apps/cli/spur.js` → 2. |
| `TYPESAFE_DEFAULT_MODEL` documented beside the maker | `config/config.global.yaml:166-171` | The model is an SDK environment decision, not project config (R6). |
| `TYPESAFE_DEFAULT_MODEL` documented beside `TYPESAFE_API_KEY` | `docs/design/cli-contracts.md:1220-1226` | Same reason, from the consumer side; names why a catalog `model:` field is wrong (the hub forwards it to every maker and `ts-decision-clef` treats it as its own selector). |
| Repeatable proof artifacts | `docs/tasks5/artifacts/1436/` (`README.md`, `ac1-*.json`, `ac2-*.txt`, `ac3-*.json`, `ac4-input-size.txt`) | AC1–AC3 receipts plus the R7 input-size evidence. |

No fetch wrapper was added in Spur: the registry's built-in `typesafe` maker cannot be overridden
(`ts-ai-decision` `registry.ts:162` rejects duplicate names) and the upstream fix already covers
every caller.

**R7 disposition — spec alignment needs no code (AC4).** The driver sends `{model, state, questions}`
to `POST /v1/systemone` (live spec https://api.typesafe.ai/openapi.json v0.2.0). No driver change is
required, and the `TypeSafe-Danger-Zone-Long-Context` header is not needed: the largest recorded
`failure-class` input in this repo's decision log is 2085 B across 86 calls
(`docs/tasks5/artifacts/1436/ac4-input-size.txt`) against a 64k per-request limit. Revisit only if
`failure-class` starts carrying unbounded gate output.

Deferred and recorded in Q&A: logging the model that actually served each decision (the driver
drops `SystemOneResult.model` by design, so it needs a ts-libs API change plus a `decision_logs`
column).

#### Forced verification — 2026-11-22

Rebuilt the CLI and verified the installed `spur` resolves to that current bundle; `verification-receipt.json` records its actual path and SHA-256. The adopted catalog and lockfile remain 0.8.4, SDK 0.7.0; the npm registry still reports SDK 0.7.0. No package resolution or upstream source edit was needed.

The upstream driver regression suite passes all 16 tests. A separate SDK-only counterfactual reproduces `Body already used` with a buffered Response and succeeds with the same payload streamed, corroborating the driver-seam fix without editing upstream code or adding a Spur fetch wrapper.

Fresh isolated-database calls through the rebuilt installed bundle both returned source=model, reason=accepted and no error: default SDK model resolution and TYPESAFE_DEFAULT_MODEL=jev-1.13.0. The isolated database has exactly two accepted typesafe rows and zero Body already used errors. The published AC artifacts and verification-receipt.json are refreshed from those actual results; no provider key is persisted. Existing model-pin documentation and the separately filed feature S are retained.

Spec alignment was rechecked against https://api.typesafe.ai/openapi.json (0.2.0): POST /v1/systemone takes model/state/questions. https://docs.typesafe.ai/models#context-length documents 64k per-request and 32k per-question TOKEN limits. The current read-only failure-class input observation is 86 rows, max 2085 SQLite characters / 2115 UTF-8 bytes, with 83 historical Body already used errors. These are stored-input measurements, not an exact full-wire token count. Both live fixture calls accepted without adding a long-context header, so no driver/header change is needed for this bounded workload.

The original 83/92 and 35-call counts describe the earlier diagnosis, not immutable current totals; they are not re-certified as current statistics. Later historical rows in other projects do not invalidate the fresh isolated zero-error proof or authorize changing those projects. No upstream or knowledge-kit files were edited.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Root cause is confirmed by the installed SDK counterfactual: buffered Response throws Body already used and identical streamed payload succeeds. @batch `.spur/run/verify-1436-sdk-repro.json` lines 1-15 records the actual reproduction; `docs/tasks5/artifacts/1436/ac4-input-size.txt:1` preserves fresh read-only historical measurements. Original diagnosis totals are dated observations, not asserted as current immutable counts. |
| R2 | MET | `package.json:32` pins the three adopted libraries at 0.8.4; `bun.lock:218` resolves the fixed release. Upstream @ts-libs `packages/ai-decision/src/typesafe-driver.ts` lines 61-73 and 121-135 wraps the fetch at the driver seam. Installed SDK remains 0.7.0 and the npm registry agrees; no SDK fork or Spur-side driver wrapper was added. |
| R3 | MET | Upstream @ts-libs `packages/ai-decision/tests/typesafe-driver.test.ts` lines 352-370 contains the buffered-response regression. Fresh upstream run: 16 pass. The separate SDK counterfactual proves the failure without the stream seam, without editing upstream sources. |
| R4 | MET | `docs/tasks5/artifacts/1436/verification-receipt.json:1` records the rebuilt installed bundle path and SHA-256 and accepted live calls. Both the local bundle and installed spur resolve to the fixed build containing streamBackedFetch; package catalog and lock remain 0.8.4. |
| R5 | MET | `docs/tasks5/artifacts/1436/ac1-decision-run.json:1` and `docs/tasks5/artifacts/1436/ac1-installed-binary.json:1` are fresh bundled-native results: source=model, reason=accepted, no error. `docs/tasks5/artifacts/1436/verification-receipt.json:1` includes the isolated DB and exactly two accepted log rows, zero Body already used errors. |
| R6 | MET | `config/config.global.yaml:169` and `docs/design/cli-contracts.md:1222` document SDK-owned TYPESAFE_DEFAULT_MODEL beside the maker/key and reject catalog-level model pinning. Installed @typesafe-ai/sdk `dist/index.mjs` lines 552 and 905 resolve the variable then jev-latest. `docs/tasks5/artifacts/1436/ac3-model-pin.json:1` proves the specified jev-1.13.0 pin accepted; served-model telemetry remains separately filed as S. |
| R7 | MET | Full repository gate PASS: @batch `.spur/run/run_5cd020af-b6e3-42d0-883a-aa1d54e908f5-feature-verification.log` lines 1-786. Fix-pass artifacts: @batch `.spur/run/1436-verify-answer.txt` lines 1-40 and `.spur/run/1436-verdict.json` lines 1-95; raw evidence under `.spur/run/verify-1434-1436-` and `.spur/run/verify-1436-`. Live https://api.typesafe.ai/openapi.json (0.2.0) and https://docs.typesafe.ai/models#context-length were checked. Task Solution and `docs/tasks5/artifacts/1436/ac4-input-size.txt:1` record model/state/questions, 2115 UTF-8 bytes versus 2085 characters for stored input, token-based limits, and accepted live calls without adding a long-context header. No driver/header change is needed for this bounded fixture; byte counts are not claimed as exact full-wire token counts. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — the typesafe maker answers failure-class instead of falling back (req: R4, R5) | MET | command | `docs/tasks5/artifacts/1436/ac1-installed-binary.json:1` and `docs/tasks5/artifacts/1436/verification-receipt.json:1` — actual installed bundled call accepted. |
| AC2 — no new Body-already-used fallbacks in the decision log (req: R4, R5) | MET | command | `docs/tasks5/artifacts/1436/ac2-decision-logs.txt:1` and `docs/tasks5/artifacts/1436/verification-receipt.json:1` — two fresh accepted rows, zero body-use errors. |
| AC3 — the served model is pinnable without code (req: R6) | MET | command | `docs/tasks5/artifacts/1436/ac3-model-pin.json:1`, `config/config.global.yaml:169`, `docs/design/cli-contracts.md:1222` — specified SDK env pin accepted and documented. |
| AC4 — spec alignment recorded (req: R7) | MET | command | `docs/tasks5/artifacts/1436/ac4-input-size.txt:1`; task Solution records current primary sources and no new header/driver requirement. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- ts-libs commits: decision-fm 1008 classification `51b112a6`; typesafe body fix, released together as 0.8.4.
- SDK: `@typesafe-ai/sdk` 0.7.0, `dist/index.mjs:821` (bufferResponse), `:1111` (parseBody), `:552,905` (TYPESAFE_DEFAULT_MODEL).
- Spec: https://api.typesafe.ai/openapi.json (v0.2.0), https://docs.typesafe.ai/models.md, https://docs.typesafe.ai/changelog.md.
- Related cleanup: knowledge-kit `plugins/kk/tests/smart-seo-decisions.test.ts` now isolates `DATABASE_URL` (test noise in its decision log).

### History

- 2026-11-22T07:12:30.048Z todo → wip (system)
- 2026-11-22T07:15:19.445Z wip → testing (system)
- 2026-11-22T07:15:20.883Z testing → done (system)

