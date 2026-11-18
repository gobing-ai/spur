---
schema_version: 1
name: Cross-project daily view through the gateway
status: done
template: feature-impl
created_at: 2026-11-18T05:29:38.013Z
updated_at: "2026-11-18T09:57:37.268Z"
feature_id: K43
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 4

dependencies: ["1385"]
done_forced: "false"
done_reason: unforced close
---

## 1402. Cross-project daily view through the gateway

### Background

`/sp:dev-daily` runs `spur history summary` for one project (`plugins/sp/commands/dev-daily.md:31`). `spur projects list --json` already reports each registered project's `name`, `prefix`, `port` and `running` without starting it. Each running project serves `/api/health` and `/api/events/history?since=&limit=` (`apps/server/src/modules/events/index.ts:327`).

**Refine corrections (2026-11-17)**
- "Read each project's health and events through the gateway" → a gateway request to a project prefix starts that project (`ensureUpstream`, `packages/app/src/services/project-gateway.ts:449`). Reading every project through it would wake stopped projects and could never report them as "stopped". → Use the registry's `running` state first. Read only running projects through the gateway. Stopped projects are marked `stopped` and never requested.
- "Surface choice has operator consent (HUB2)" → no "HUB2" task exists. The AGENTS.md consent rule covers nouns and verbs. → Add a flag on the existing verb: `spur history summary --all-projects`. No new noun or verb.
- "Gateway stays stateless; aggregation in the caller" → kept. The CLI aggregates, and the gateway is only a path.

### Requirements

- [x] R1. `spur history summary --all-projects` lists registry entries with the same service `projects list` uses. A running project gets one `GET <gateway>/<prefix>/api/health` and one `GET <gateway>/<prefix>/api/events/history?since=<day start>&limit=50`, with a 3 s timeout each.
- [x] R2. Each project is rendered with one status:
  - `ok`: health plus event counts by name prefix, with the five latest event summaries;
  - `stopped`: not running, so not requested;
  - `unreachable`: running but the request failed or timed out, with the cause;
  - `gateway-down`: every running project, when the gateway isn't answering.
- [x] R3. The output is a "Projects" section in the same summary file, and with `--dry-run` it is printed. It excludes `--date` other than today (event reads are "since today"), and that combination fails as a usage error.
- [x] R4. Remote registry entries are listed as `remote-not-proxied (ADR-151)` and never requested.
- [x] R5. Update `/sp:dev-daily` and the `daily-summary` skill with one line on `--all-projects`.

### Acceptance Criteria

- [x] AC1 — Daily summary spans all local projects (req: R1, R2, R3, R4, R5)

Test layer: e2e with fixture projects and a real gateway handler (no handler mocks).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T06:12:27.573Z

- **Surface?** A flag on `spur history summary`, not a new verb, so no consent gate.
- **Read stopped projects' databases directly?** No. That crosses project ownership, and "stopped" is the signal the operator wants.
- **Past dates?** Not supported. The events API reads "since", so a historical cross-project view would need persisted per-day data, which is out of scope (stateless gateway).

### Design

**WHAT.** A flag-gated section builder in the history-summary service. It takes injected `listProjects` and `fetch` seams (ADR-021) and does no new storage.

**WHY.** The registry already knows running state, so checking it first avoids the gateway's start-on-demand side effect. Per-project reads go through stable gateway paths. A project that stops between the list and the fetch may be restarted by the gateway: `// ponytail: list→fetch race can wake a just-stopped project; accept, or read upstream ports directly if it matters.`

**WHERE.**
- the `spur history summary` command module and its app service
- `packages/app/src/services/` (summary builder)
- `plugins/sp/commands/dev-daily.md`
- `plugins/sp/skills/daily-summary/SKILL.md`

**Anti-patterns.**
- Never start a project to summarize it.
- No gateway-side aggregation endpoint.
- No raw DB reads of other projects.

### Plan

- [ ] Step 1 (test first, R1-R4): an e2e with three fixture projects behind a real gateway handler: one running with events, one stopped, one running whose upstream refuses. Assert the statuses, and that the stopped project's upstream was never started. Add a unit case for a remote entry, and one for `--date yesterday --all-projects` giving a usage error.
- [ ] Step 2: implement the builder and the flag.
- [ ] Step 3 (R5): docs, then `bun run spur-check`.

### Solution

**Change map.**

- `packages/app/src/services/projects-summary.ts` (new) — `collectProjectsView(input)` with injected
  `listProjects` and `fetchImpl` seams (ADR-021): the registry is read FIRST, so a stopped local project
  is reported `stopped` and never requested (a gateway read would start it), a non-local entry is
  `remote-not-proxied` (ADR-151), and only running locals are read — one `GET <gateway>/<prefix>/api/health`
  and one `GET <gateway>/<prefix>/api/events/history?since=<day start>&limit=50`, each under a 3 s
  budget. One gateway probe decides `gateway-down` for every running project; a failed or timed-out
  read makes the row `unreachable` with the cause (timeouts are named, not blank).
  `eventCounts` are counted by name prefix (highest first), `latest` is the five newest events.
- `packages/app/src/services/daily-summary.ts` — `--all-projects` (parsed, usage-documented), the
  `projects` field on `DailySummary`, the `## Projects` table plus a `### Latest events` list in
  `generateMarkdown`, and `collectProjectsSection` wiring the registry/gateway port from
  `buildConfigFromEnv`. A past `--date` with the flag is a usage error (exit 2) before any collection,
  because the event read is "since today".
- `apps/cli/src/commands/history/summary.ts` — the `--all-projects` flag, forwarded to the app argv
  (no new noun or verb, so no consent gate).
- `docs/design/history-cli-contracts.md` — the state table, the two reads, the budget, the today-only
  rule and the known list→fetch race.
- `plugins/sp/commands/dev-daily.md`, `plugins/sp/skills/daily-summary/SKILL.md` — one usage line each.

**Rationale.** The registry already knows `running`, so checking it first is what makes "stopped"
observable at all and guarantees the summariser never wakes a project. Everything else stays where it
already lives: the gateway is a path, the events endpoint is unchanged, and the aggregation sits in the
CLI's app layer with seams a test can drive.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `collectProjectsView` (`packages/app/src/services/projects-summary.ts:60`) lists registry entries via the injected `listProjects`, then for each running LOCAL project issues exactly `GET <gateway>/<prefix>/api/health` and `GET <gateway>/<prefix>/api/events/history?since=<day start>&limit=50`, each under `PROJECTS_VIEW_TIMEOUT_MS` = 3 s (`:47`, `:120-146`). Tests: `projects-summary.test.ts` through the real gateway handler. |
| R2 | MET | Five states, one per row: `ok` with `eventCounts` by name prefix and the five latest events (`countByPrefix`, `toSummary`), `stopped` for `port <= 0` (never requested), `unreachable` with the cause for a failed/timed-out read, `gateway-down` for every running project when one gateway probe fails (`probeGateway`), and `remote-not-proxied` for non-local entries. Tests: 5 cases covering every state, including the 502 cause and the timeout. |
| R3 | MET | `--all-projects` adds `projects` to `DailySummary` and a `## Projects` table plus `### Latest events` to `generateMarkdown` (printed by `--dry-run`, which prints the whole markdown); a past `--date` with the flag returns exit 2 with the reason BEFORE any collection (`daily-summary.ts`, `runDailySummary`). Tests: 4 cases in `daily-summary.test.ts` (flag parse, usage error, section render per state, absence without the flag). |
| R4 | MET | `isLocalHost` is checked first; a remote entry becomes `{ state: 'remote-not-proxied', prefix: null }` and is never requested — asserted with an empty `ensureUpstream` log in `projects-summary.test.ts`. |
| R5 | MET | `plugins/sp/commands/dev-daily.md` usage line + the flag's behaviour, and `plugins/sp/skills/daily-summary/SKILL.md` (example + CLI line); `docs/design/history-cli-contracts.md` gained the state table, the two reads, the budget, the today-only rule and the known race. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Fixture projects behind the REAL gateway handler with REAL upstream listeners (no handler mocks): ok + stopped + unreachable + remote-not-proxied + gateway-down + budget cut-off, plus the flag's usage error and section rendering. |
| AC1 | MET | command | `(cd packages/app && bun test tests/services/{projects-summary,daily-summary}.test.ts)` → 78 pass / 0 fail; `(cd apps/cli && bun test tests/commands/history/)` → 74 pass / 0 fail; `task gate 1402 light` → PASS; `bunx biome check` and `bunx tsc --noEmit` clean. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-18T09:44:41.124Z todo → wip (system)
- 2026-11-18T09:57:35.770Z wip → testing (system)
- 2026-11-18T09:57:37.264Z testing → done (system)

