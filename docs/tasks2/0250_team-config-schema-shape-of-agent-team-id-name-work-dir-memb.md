---
template: standard
schema_version: 1
name: "Team config schema: shape of agent.team.<id> (name, work_dir, members) + member reference form"
description: ""
status: done
type: task
profile: standard
feature_id: M
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-14T04:28:57.672Z"
updated_at: "2026-07-14T05:59:39.019Z"
---

## 0250. Team config schema: shape of agent.team.<id> (name, work_dir, members) + member reference form

### Background
**Wayfinder ticket (grilling)** for feature M — the ROOT of the roster branch.

Today the "team" concept is split across two namespaces: `agent.executors[]` (flat named
`{name,agent,model}` presets in `.spur/config.yaml`) and `.spur/agents/<id>.yaml` specs (each with
`workspace`/`purpose`/inbox identity). DD-1 locked *roster in config → materialize specs*. This
ticket fixes the exact `agent.team.<id>` schema that everything else materializes from.

Root of the roster branch — **no prerequisites** (frontier). It unblocks the downstream materialization
and lifecycle tickets. See `packages/config/src/index.ts` (`AgentExecutorConfigSchema`) and `.spur/config.yaml`.
### Requirements
R1. Zod + JSON-schema shape for `agent.team.<id>: { name, work_dir, members }` (kept in sync per the config schema convention).
R2. Member reference form: bare executor-name (`- claude`) vs object (`{ executor, id?, purpose?, autonomy?, model?, command? }`). Recommend allowing both — a string shorthand expands to `{ executor: <name> }`.
R3. How `work_dir` relates to each generated spec's `workspace` (default: member workspace = team `work_dir`).
R4. `autostart` at team and/or member level — wire the config the supervisor already references in its error string (`team.autostart`).
R5. Validation: member ids unique within a team; each `executor` must resolve to an entry in `agent.executors`.
R6. Backward-compat: existing `agent.executors` + `.spur/agents/*` stay valid with no `agent.team` block present.
### Acceptance Criteria

<!-- Given/When/Then scenarios or a checklist derived from Requirements. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**YAML (authoring surface):**

```yaml
agent:
  team:
    devops-01:                     # <teamId> — the map key
      name: "Dev Ops 01"
      work_dir: "~/xprojects/spur-new"
      autostart: true              # team default (optional)
      members:
        - claude                   # shorthand ≡ {executor: claude}
        - executor: omp-zai        # object form — per-member overrides
          purpose: "reviewer"
          autostart: false
        - codex
```

**Zod (`packages/config/src/index.ts`):**

```ts
export const TeamMemberConfigSchema = z.union([
  z.string().min(1),                          // shorthand → { executor }
  z.object({
    executor: z.string().min(1),
    id: z.string().min(1).optional(),
    purpose: z.string().optional(),
    workspace: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    autonomy: z.string().optional(),
    systemPrompt: z.string().optional(),
    command: z.array(z.string().min(1)).optional(),
    autostart: z.boolean().optional(),
  }),
]);

export const TeamConfigSchema = z.object({
  name: z.string().min(1),
  work_dir: z.string().min(1),
  autostart: z.boolean().optional(),
  members: z.array(TeamMemberConfigSchema).min(1),
}).superRefine((team, ctx) => {
  const seen = new Set<string>();
  team.members.forEach((m, i) => {
    const ref = typeof m === 'string' ? { executor: m } : m;
    const id = ref.id ?? ref.executor;        // 0251 finalizes the id rule
    if (seen.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate team member id: ${id}`, path: ['members', i] });
    seen.add(id);
  });
});

// AgentConfigSchema gains one optional field:
//   team: z.record(z.string(), TeamConfigSchema).optional(),
```

**Materialization mapping (member → `AgentSpec`) — consumed by 0252:**

| `AgentSpec` field | Source |
|---|---|
| `id` / `name` | `<teamId>-(member.id ?? executor)` — **always prefixed** (finalized by 0251; supersedes the earlier bare-`member.id` draft) |
| `type` | resolved `executor.agent`, else raw agent (R5) |
| `workspace` | `expandTilde(member.workspace ?? team.work_dir)` |
| `purpose` | `member.purpose ?? "${team.name} member (${executor})"` |
| `config.model` | `member.model ?? executor.model` |
| `config.autonomy` / `config.systemPrompt` | member override, if set |
| `command` | `member.command` (supervisor reads `spec.command`) |
| `autoStart` | `member.autostart ?? team.autostart ?? false` |
| `tags` | `["team:<teamId>"]` (drives workspace-peer grouping + `buildIdentity`) |
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Resolved via grilling** (3 forks confirmed) — this fixes the `agent.team.<id>` schema; the concrete
Zod/YAML lives in **### Design**.

| Fork | Decision |
|---|---|
| Member list | `members:` with **string-or-object union** (drafted `executors:` renamed to avoid clashing with top-level `agent.executors` = preset pool) |
| Executor resolution | **Executors-first, raw-agent fallback** — resolve against `agent.executors[].name`, else a raw canonical agent type, error if neither |
| Autostart | **Team default + per-member override** — effective = `member.autostart ?? team.autostart ?? false` |

**Requirements resolution:**
- **R1 — Shape:** `agent.team` = `Record<teamId, TeamConfig>` (same record idiom as `agent.default-by-phase`). `teamId` is the map key; `name` is the human label.
- **R2 — Member ref form:** `string | object`; a bare string `"claude"` normalizes to `{ executor: "claude" }`. Object form carries per-member overrides.
- **R3 — work_dir ↔ workspace:** each member's `spec.workspace = member.workspace ?? team.work_dir`, tilde-expanded at load (the draft used `~/…`).
- **R4 — Autostart:** maps to `AgentSpec.autoStart` per generated spec via the effective rule above.
- **R5 — Resolution rule (fixed here; executed in 0252):** `executor` resolves against `agent.executors` by name → `{agent, model}`; unmatched → treat the ref as a raw canonical agent type (`claude`/`codex`/`omp`); neither → config error.
- **R6 — Backward-compat:** `team` is optional; absent = today's behavior unchanged. `agent.executors` and `.spur/agents/*` are untouched.

**Validation at config-load (superRefine):** `members` ≥ 1; member ids unique within a team (id derived as `member.id ?? executor` when shorthand); `name` + `work_dir` non-empty.

**Grounding (where this lands):**
- `packages/config/src/index.ts:123` — `AgentConfigSchema`; add the optional `team` field + the two new schemas here.
- `packages/config/src/index.ts:107` — `AgentExecutorConfigSchema`; the resolution target for a member's `executor` (R5).
- `packages/app/src/services/team-service.ts:304` — `createAgentSpec`; the materialization sink `spur team up` (0252) calls.
- `packages/app/src/services/supervisor-service.ts:252` — `resolveCommand` reads `spec.command`, so a member's `command` override must reach the spec.

**Hands off to:**
- Identity ticket (0251, now closed) — **finalized** the canonical member id as `<teamId>-(member.id ?? executor)`, always prefixed. This SUPERSEDES the bare-`member.id` derivation drafted here: an explicit `member.id` becomes the *local* part, never the whole id (prevents cross-team collision on the flat `.spur/agents/` namespace).
- Materialization ticket — consumes the member→AgentSpec mapping in **### Design**.
- Lifecycle ticket — consumes team/member autostart, and is now unblocked (its only blocker was this ticket).
### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-14T04:39:56.253Z todo → wip (system)
- 2026-07-14T04:49:01.187Z wip → testing (system)
- 2026-07-14T04:49:03.723Z testing → done (system)
