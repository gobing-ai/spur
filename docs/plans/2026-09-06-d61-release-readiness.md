# D61 pre-release readiness — 2026-09-06

**Shippable: PASS.** All 13 D61 tasks are done and retain PASS requirement/AC verdicts.
Fresh strict-core checks pass for all 13 without findings; strict feature verification passes
from both source and the rebuilt CLI. No version bump, publication or release was performed.

## Final corrections

- **0766:** commit `7fe75daa` fixes the last uncovered design condition: an unavailable optional
  Git fog comparison now reports `SKIPPED` on stderr. The existing callback was forwarded through
  the audit service and CLI; JSON stdout, severity policy and required-check failures are unchanged.
  The CLI regression failed before the fix and passes afterward. Surface docs were synchronized.
- **0772:** D61 Notes now separate current closure from the historical planning snapshot that still
  said implementation was pending and 0766 was todo. This report replaces the prior uncommitted-tree
  handoff; the operator committed that implementation as `5692bc2b3`.

## Fresh verification

| Check | Result |
| --- | --- |
| `bun run spur-check` after the diagnostic fix | PASS: 7458 tests, 0 failures, 416 files; lint, all seven workspace typechecks, 44 precheck + 2 postcheck rules |
| `SPUR_WORKFLOW_RUN_ACTIVE=1 bun run test` | PASS: 7458 tests; actual nested-workflow refusal remains tested |
| CLI task + JSON-envelope inventory suites | PASS: 172 tests; skipped diagnostic does not corrupt JSON stdout |
| Corpus/fog service suite | PASS: 25 tests, including missing refs, shallow/non-Git repositories and historical graduation |
| `bun run test-cf` | PASS: 1 test |
| Root build, final web build and CLI bundle build | PASS; web chunk-size advisory only |
| `npm pack --dry-run --json` | PASS: 365 packaged files, all 11 canonical workflow YAMLs; no retired corpus/composition snapshots or regenerators |
| Source/bundle identity and JSON compatibility fixture | PASS: 11/11 definitions byte-match with quoted version "1"; JSON fixture retained |
| `check-marketplace-version` | PASS: marketplace/plugin/package versions agree |
| All 13 task strict-core checks | PASS, no findings |
| D61 strict check, source and rebuilt CLI | PASS, no findings |
| D61 tracked-evidence fallback with an absent verdict directory | PASS, no findings; not dependent on local verdict JSONs |
| Baseline classification record | All 299 unique keys have class, rationale and migration action; a=0, b=125, c=174 |
| `git diff --check` | PASS |

The normal full gate and inherited-marker suite cover the task evidence targets: completion policy
(0765), explicit audit and caller migration (0766/0774), live composition and digest consumers
(0767/0775), identity/progress/async-resume (0768), all owned workflow success/failure contracts
(0769–0772), evidence recovery (0776), and environment/preflight/mutation-policy safeguards (0777).
Historical intermediate baseline/loader retention remains evaluated at the original migration
commits; restoring production suppression assets would violate the final contract.

The unrelated BoardLayout edit appeared and was committed as `35a3266d9` during verification.
It was preserved and excluded from D61 commits. Its 16 focused tests passed afterward, followed by
a fresh web build and CLI bundle rebuild; no browser-level acceptance is claimed for that separate change.

## Explicit limits, not hidden release claims

- The real source-local audit with an intentionally unavailable `--since` ref returned exit 1:
  **436 errors, 433 warnings, zero baselined findings**. Stderr explicitly identified the skipped
  optional comparison. Those historical corpus errors remain outside D61's affected repair scope;
  D61 readiness does not mean the entire historical corpus is clean.
- [Matched measurements](2026-09-06-d61-matched-measurements.md) are labeled reconstructed
  projections/fixture-backed shell executions. Missing original captures were not fabricated.
  No model cost/token savings, statistically reliable speedup or real-model terminal coverage is claimed.
- Existing `implementAgent=auto` behavior remains the committed configured role/tier/usable-executor
  selection with capability attestation, not session-model inheritance. No new order was introduced.
  D9 fast-route activation remains explicitly outside D61 scope.
- The classification report and detailed command logs remain machine-local under `.spur/run/`, as
  the task design requires. Tracked Testing sections and these dated reports preserve the conclusions
  and provenance. The existing dogfood ledger/report and the fresh tracked-evidence check were retained.

Evidence: `.spur/run/d61-release-{final-gate,marker-test,cf,build,final-web-build,final-bundle}.log`,
`d61-release-pack.json` (prepack text precedes the JSON array), `d61-release-task-checks.jsonl`,
`d61-release-tracked-evidence.json`, and `d61-release-audit.{json,stderr}`.
Task 0766's fix was recorded through `task verdict` and `task record`; no corpus file was directly edited.
