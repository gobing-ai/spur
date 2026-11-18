---
schema_version: 1
name: Cross-project daily view through the gateway
status: todo
template: feature-impl
created_at: 2026-11-18T05:29:38.013Z
updated_at: "2026-11-18T06:12:27.574Z"
feature_id: K43
priority: P2
tags:
  - phase-2
  - protocol-surfaces
estimate_hours: 4

dependencies: ["1385"]
---

## 1402. Cross-project daily view through the gateway

### Background

`/sp:dev-daily` runs `spur history summary` for one project (`plugins/sp/commands/dev-daily.md:31`). `spur projects list --json` already reports each registered project's `name`, `prefix`, `port` and `running` without starting it. Each running project serves `/api/health` and `/api/events/history?since=&limit=` (`apps/server/src/modules/events/index.ts:327`).

**Refine corrections (2026-11-17)**
- "Read each project's health and events through the gateway" → a gateway request to a project prefix starts that project (`ensureUpstream`, `packages/app/src/services/project-gateway.ts:449`). Reading every project through it would wake stopped projects and could never report them as "stopped". → Use the registry's `running` state first. Read only running projects through the gateway. Stopped projects are marked `stopped` and never requested.
- "Surface choice has operator consent (HUB2)" → no "HUB2" task exists. The AGENTS.md consent rule covers nouns and verbs. → Add a flag on the existing verb: `spur history summary --all-projects`. No new noun or verb.
- "Gateway stays stateless; aggregation in the caller" → kept. The CLI aggregates, and the gateway is only a path.

### Requirements

- [ ] R1. `spur history summary --all-projects` lists registry entries with the same service `projects list` uses. A running project gets one `GET <gateway>/<prefix>/api/health` and one `GET <gateway>/<prefix>/api/events/history?since=<day start>&limit=50`, with a 3 s timeout each.
- [ ] R2. Each project is rendered with one status:
  - `ok`: health plus event counts by name prefix, with the five latest event summaries;
  - `stopped`: not running, so not requested;
  - `unreachable`: running but the request failed or timed out, with the cause;
  - `gateway-down`: every running project, when the gateway isn't answering.
- [ ] R3. The output is a "Projects" section in the same summary file, and with `--dry-run` it is printed. It excludes `--date` other than today (event reads are "since today"), and that combination fails as a usage error.
- [ ] R4. Remote registry entries are listed as `remote-not-proxied (ADR-151)` and never requested.
- [ ] R5. Update `/sp:dev-daily` and the `daily-summary` skill with one line on `--all-projects`.

### Acceptance Criteria

- [ ] AC1 — Daily summary spans all local projects (req: R1, R2, R3, R4, R5)

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
