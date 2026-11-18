# Batch report — tasks 1384, 1385, 1395, 1396, 1397, 1402

Command: `/sp-dev-runall --tasks 1384,1385,1395,1396,1397,1402 --auto --agent inline --next --worktree --wrap`
Branch: `sp/dev-runall-1384-1402-ec36` · worktree `/Users/robin/xprojects/spur-new-dev-runall-1384-1402-ec36`
Base: `main@fbbabe6bb` · Mode: sequential (per-task `task-pipeline.yaml` in the host session)

## Verdicts

| WBS | Feature | Outcome | Pipeline run | Gate | Review |
| --- | --- | --- | --- | --- | --- |
| 1384 | K42 | done | `893446f9` | light PASS | PASS |
| 1385 | K42 | done | `bbb3511f` | light PASS | PASS |
| 1395 | G91 | done | `39769349` | light PASS (after 1 remediation) | PASS |
| 1396 | G91 | done | `8886b37b` | light PASS | PASS |
| 1397 | G91 | done | `18ba0e2b` | light PASS | PASS |
| 1402 | K43 | done | `799175a7` | light PASS (after 1 remediation) | PASS |

Batch run `dev-runall-1384-1402-ec36`. Full gate on the final tree:
`spur self exec check` → **PASS** (12,729 tests / 865 files, 0 fail, post-check rules clean).

## What shipped

- **1384** Structured gateway event log: `onEvent` seam in the handler, a rotating JSONL sink
  (5 MiB cap, `.1` rotation, report-once), per-OS path composed in the CLI, design §4.3.
- **1385** Health counters: closure-local `requests`/`status4xx`/`status5xx`/`upstreamRestarts[prefix]`
  counted at the response boundary, additive `/api/health.counters`, and a machine-scoped `gateway`
  section in `spur self status` with one counters line.
- **1395** Project-addressed fleet members: `project`+`member`+`authEnv` on `FleetMemberSchema`,
  per-dispatch resolution to the gateway card URL, `x-forwarded-host`/`x-forwarded-prefix` from the
  gateway, card origin honoring them, doctor row showing the resolved URL.
- **1396** Delegated receipts: `A2aMemberTransport.refresh(runId)` (one `task get`, never a send),
  `spur agent trace` refreshing per render and rendering member/task/state/branch/refresh-error.
- **1397** Two delegation workflows (`delegate-upstream-fix`, `delegate-install-sync`) that name a
  member, tag both ends (`delegated-from:` / `delegated-to:`) and parse the `WBS:` reply line; plus the
  real fix that made them work — an A2A member now receives the prompt TEXT, not an unreadable local
  pointer.
- **1402** `spur history summary --all-projects`: registry-first cross-project view through the
  gateway with `ok`/`stopped`/`unreachable`/`gateway-down`/`remote-not-proxied`, a `## Projects`
  section, and a usage error for a past date.

## Incidents and decisions

- **1384 review misfire**: the first review certificate carried an AC row marked `PARTIAL` with
  `static-ref` evidence. `task-verdict.ts` downgrades exactly that to `evidence-rule-failed`, the
  review status became `FAIL`, and the pipeline correctly ran to `failed` (retry-exhausted). Recovery
  was a fresh pipeline run with a corrected certificate — the code never changed.
- **`--answer yes` is required at the approval decision point** even under `--auto`; `--yes` only skips
  the CLI confirmation. Passing `--answer-text` alone is refused headless (0901 R3).
- **Gate remediations** (1395, 1402): `every-export-has-tsdoc` and a coverage shortfall, both fixed at
  the cause (documented exports, extracted resolver seam).
- **Repo-wide gate findings fixed in-batch**: `apps/cli` self-status e2e section-key list (the `gateway`
  section), the two help-docs parity trees for `--all-projects`, and the 1311 migration-ownership
  evidence — the last one because a `package.json` script edit flips it to `no-go` in a tree with the
  bundled CLI, so the e2e is invoked through `scripts/spur-dev.ts` instead.
- **Known gaps recorded, not hidden**: `server.gateway.port` has no env mapping (K41) so the resolver
  falls back to 3000; a registry display name that differs from the target's own slug mints a different
  remote instance id; the delegation e2e uses B's serve card rather than the project address because
  B's own serve resets its registry `port` to 0 at startup.

## Verification artefacts

- Per-task: `.spur/run/<wbs>-review.status`, `-verdict.json`, `-gate.log`, `-check-receipt.json`
- E2E receipts: `docs/reports/a2a-two-install-e2e-receipt.json` (9/9),
  `docs/reports/delegate-workflow-e2e-receipt.json` (3/3)
- Wrap: `wrapup-pipeline` run `11c15ced` → done; learnings captured
  (`.spur/run/11c15ced-…-wrapup-learnings.md`), `docs/04_DESIGN.md` rows updated.
