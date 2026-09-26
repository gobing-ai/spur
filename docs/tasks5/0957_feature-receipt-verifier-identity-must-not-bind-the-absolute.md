---
schema_version: 1
name: Feature receipt verifier identity must not bind the absolute definition path
status: done
template: standard
created_at: 2026-09-26T00:09:10.239Z
updated_at: "2026-09-26T00:43:16.036Z"

done_forced: "true"
done_reason: "Implemented in-session before any pipeline run; inline run 88e5fdf6 closed failed-guard at precheck (implement requireDiff cannot re-certify existing diff; spur-check blocked by sandbox git-init tests unrelated to 0957). Evidence: verify PASS (.spur/run/0957-verdict.json, recorded), 21/21 receipt tests, bundled+source CLIs agree on D64. Operator-approved bypass."
---

## 0957. Feature receipt verifier identity must not bind the absolute definition path

### Background

Found while refining 0956 (D64 done gate). `validateFeatureVerificationReceipt` compared the verifier's absolute `sourcePath` as part of the identity check. The bundled CLI (`apps/cli/spur.js`) resolves the shared `feature-verification` definition from `apps/cli/config/workflows/`, while the source-local CLI resolves `config/workflows/`; the bytes are identical (same `definitionDigest`). A receipt recorded by one binary therefore always failed `L4.feature-receipt-contract` under the other, with a misleading message that printed two identical digests and said "the selected definition changed after the pass". This also hid the real finding (`L4.feature-receipt-stale`). The documented contract (`docs/design/workflow-execution-economy.md`) already specified name/layer/digest only — the code had drifted from it.

### Requirements

- [x] R1. Verifier identity check compares `name`, `layer` and `definitionDigest` only; `sourcePath` stays recorded as a diagnostic field.
- [x] R2. A contract-mismatch detail names the drifted identity fields.
- [x] R3. Regression test: identical definition resolved from a different install path validates; existing digest/command drift tests still reject.

### Acceptance Criteria

- [x] AC1 — A receipt whose verifier differs only in `sourcePath` validates `ok: true` (req: R1, R3)
- [x] AC2 — A receipt whose `definitionDigest`, `layer`, `name` or `verificationCmd` differs still rejects `contract-mismatch`, and the detail lists the drifted fields (req: R2, R3)
- [x] AC3 — Bundled `spur` and source-local CLI report the same receipt finding for D64 (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- `packages/app/src/workflow/feature-verification-receipt.ts` — identity check reduced to `['name', 'layer', 'definitionDigest']`, drifted fields appended to the detail; `sourcePath` doc comment marked diagnostic.
- `packages/app/tests/workflow/feature-verification-receipt.test.ts` — new test "same definition resolved from a different install path still validates" (fails on the pre-fix source, passes after).
- `docs/design/workflow-execution-economy.md` — contract-mismatch paragraph states `sourcePath` is diagnostic only.

Rationale: the content digest already binds the definition bytes and `layer` distinguishes project/registered/shared selection; the absolute path only encoded the install location.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

- `packages/app/src/workflow/feature-verification-receipt.ts:458` — identity check reduced to `['name', 'layer', 'definitionDigest']`, drifted fields appended to the detail; `sourcePath` doc comment marked diagnostic.
- `packages/app/tests/workflow/feature-verification-receipt.test.ts:530` — new test "same definition resolved from a different install path still validates" (fails on the pre-fix source, passes after).
- `docs/design/workflow-execution-economy.md:331` — contract-mismatch paragraph states `sourcePath` is diagnostic only.

Rationale: the content digest already binds the definition bytes and `layer` distinguishes project/registered/shared selection; the absolute path only encoded the install location.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/feature-verification-receipt.ts:458` compares only name/layer/definitionDigest; `sourcePath` remains in `FeatureVerifierIdentity` as a diagnostic field (`packages/app/src/workflow/feature-verification-receipt.ts:62`) |
| R2 | MET | `packages/app/src/workflow/feature-verification-receipt.ts:458` builds the drifted-field list appended to the contract-mismatch detail; asserted at `packages/app/tests/workflow/feature-verification-receipt.test.ts:521` |
| R3 | MET | `packages/app/tests/workflow/feature-verification-receipt.test.ts:530` path-only drift validates; digest drift `packages/app/tests/workflow/feature-verification-receipt.test.ts:520` and command drift `packages/app/tests/workflow/feature-verification-receipt.test.ts:245` still reject |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/workflow/feature-verification-receipt.test.ts:530` passes (21 pass / 0 fail); the same test fails against the pre-fix source (20 pass / 1 fail) |
| AC2 | MET | test | `packages/app/tests/workflow/feature-verification-receipt.test.ts:520`-`packages/app/tests/workflow/feature-verification-receipt.test.ts:521` digest drift rejects with detail ending `(definitionDigest)`; command drift `packages/app/tests/workflow/feature-verification-receipt.test.ts:245`; name/layer are in the same filter at `packages/app/src/workflow/feature-verification-receipt.ts:458` |
| AC3 | MET | command | after `bun run --filter @gobing-ai/spur build:bundle`, `spur feature check D64 --strict --as done --json` and `bun run apps/cli/src/index.ts feature check D64 --strict --as done --json` both report `L4.feature-receipt-stale` (previously bundled reported `L4.feature-receipt-contract`) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-26T00:38:13.540Z backlog → todo (system)
- 2026-09-26T00:38:13.755Z todo → wip (system)
- 2026-09-26T00:38:29.014Z wip → testing (system)
- 2026-09-26T00:43:15.651Z testing → done (system)

