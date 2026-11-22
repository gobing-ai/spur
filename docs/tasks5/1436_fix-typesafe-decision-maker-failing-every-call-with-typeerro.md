---
schema_version: 1
name: "Fix typesafe decision maker failing every call with TypeError: Body already used"
status: done
template: issue
created_at: 2026-11-22T05:35:46.158Z
updated_at: "2026-11-22T07:15:20.887Z"

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

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Root cause recorded in the task's Root Cause section; the failure signature is reproducible from the decision log (`83` of `86` `failure-class` rows carry `Body already used`, `docs/tasks5/artifacts/1436/ac4-input-size.txt`). |
| R2 | MET | Catalog pins `@gobing-ai/ts-ai-decision` 0.8.4 (`package.json:33`) plus `ts-ai-runner`/`ts-decision-fm` 0.8.4 (`package.json:32,35`), resolved in `bun.lock:478`. No SDK fork: `@typesafe-ai/sdk` stays 0.7.0 in that lock entry. |
| R3 | MET | Upstream regression test lives in ts-libs (`packages/ai-decision/tests/typesafe-driver.test.ts`, "buffered (non-stream) fetch bodies are answered"); the fix it guards is present in the installed artifact — `grep -c streamBackedFetch apps/cli/spur.js` → 2. |
| R4 | MET | Bundle rebuilt against 0.8.4 and linked (`(cd apps/cli && bun link)`); the installed `spur` resolves to the rebuilt bundle and answers instead of falling back (`docs/tasks5/artifacts/1436/ac1-installed-binary.json`). |
| R5 | MET | `spur decision run failure-class --param wbs=1436 --maker typesafe --json` on a temporary `DATABASE_URL` returns `source: model`, `reason: accepted`, no `error` (`docs/tasks5/artifacts/1436/ac1-decision-run.json`, `:ac1-installed-binary.json`); `decision_logs` has zero `Body already used` rows (`:ac2-decision-logs.txt`, `:ac1-installed-binary-logs.txt`). |
| R6 | MET | `TYPESAFE_DEFAULT_MODEL` documented beside the maker (`config/config.global.yaml:168-171`) and beside `TYPESAFE_API_KEY` (`docs/design/cli-contracts.md:1220-1226`), with the reason a catalog `model:` field is wrong. |
| R7 | MET | Spec disposition recorded in the task's Solution: no driver change, no `TypeSafe-Danger-Zone-Long-Context` header, largest recorded input 2085 B against a 64k limit (`docs/tasks5/artifacts/1436/ac4-input-size.txt`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `docs/tasks5/artifacts/1436/ac1-decision-run.json` and `:ac1-installed-binary.json` — `source: model`, `reason: accepted`, no `error` |
| AC2 | MET | command | `docs/tasks5/artifacts/1436/ac2-decision-logs.txt`, `:ac1-installed-binary-logs.txt` — `Body already used` count 0 |
| AC3 | MET | command | `docs/tasks5/artifacts/1436/ac3-model-pin.json` (accepted, 0.96) plus the two doc anchors named in R6 |
| AC4 | MET | command | `sqlite3 .spur/spur.db "select count(*), max(length(...)) from decision_logs where decision_id='failure-class'"` → `86\|2085` (`docs/tasks5/artifacts/1436/ac4-input-size.txt`, 2085 B vs the 64k limit) and `spur task show 1436 --json` returns a Solution carrying the R7 disposition ("R7 disposition", "Danger-Zone", "2085" all present) |
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

