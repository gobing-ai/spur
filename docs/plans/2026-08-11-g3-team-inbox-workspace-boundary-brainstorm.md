---
title: G3 Team, Inbox, and Workspace boundary
date: 2026-08-11
status: approved
needs_design: true
feature: G3
task: '0197'
---

# G3 Team, Inbox, and Workspace boundary

## Overview

The current Board duplicates process visibility: Teams owns process lifecycle, terminals, and activity,
while Inbox per-agent tabs also stream stdout/stderr beside durable messages. The proposed G3 Workspace
entity would add a second roster and work-folder model even though `agent.team.<teamId>` already owns
`name`, `work_dir`, and `members`. The design must remove both duplications before implementation.

## Approaches

### 1. Team-scoped composition — recommended

Use `teamId` as the v1 workspace identity. Teams remains the operational control plane; Inbox becomes
durable-message-only; a Workspace Board module composes scoped views over the existing team, message,
and task APIs. No new workspace schema, service, API, or CLI noun.

- Pros: one roster/folder authority; smallest surface; preserves global Teams and Inbox modules.
- Cons: v1 cannot represent multiple teams sharing one workspace or one team spanning workspaces.
- Confidence: HIGH — existing config and service seams already provide the required identity and scope.

### 2. Thin Workspace record referencing Team

Add a workspace record containing `teamId` and presentation metadata, then compose existing views.

- Pros: preserves a distinct Workspace concept for later expansion.
- Cons: duplicates name/folder lifecycle immediately without a current requirement.
- Confidence: MEDIUM — technically straightforward, but speculative.

### 3. Independent Workspace entity

Keep the previous design: separate workspace roster, folder, lifecycle, service, API, CLI, and Board module.

- Pros: maximum future flexibility.
- Cons: two roster authorities, synchronization rules, a new public noun, and the largest blast radius.
- Confidence: LOW — it duplicates shipped Team capabilities and has no evidence-backed v1 need.

## Recommendation

Adopt approach 1. Remove process frames from Inbox; Teams exclusively owns Supervisor, Terminal, Process,
and Activity views. Workspace owns selection and scope only, rendering reusable scoped Teams, Inbox, and
Tasks views. The existing top-level Teams and Inbox modules remain global operational views.

## Design Summary

- **Identity:** `teamId` is the v1 workspace id; `agent.team.<teamId>.work_dir` is its git folder and
  `members` is its roster.
- **Teams:** roster, up/down, member start/stop, process list, terminal stdin/stdout, and lifecycle activity.
- **Inbox:** durable `inbox_messages` only: All, Supervisor messages, and per-agent conversation history.
  It does not open process streams or render stdout/stderr.
- **Workspace:** a Board composition module with Overview, Team, Inbox, and Tasks tabs. It passes `teamId`
  scope into existing views and owns no message delivery or process management.
- **Backend:** reuse TeamService, existing team/message endpoints, and task APIs. Add no WorkspaceService,
  workspace persistence, workspace routes, or `spur workspace` noun in v1.
- **UI reuse:** extract only scope-capable view props/hooks needed by two consumers; do not generalize the
  WebModule registry or create a plugin framework.
- **Non-goals:** multiple teams per workspace, cross-workspace messaging, workspace CRUD, permissions,
  remote workspaces, and concurrent workspace scheduling.
- **Migration:** G3 supersedes M4's unified message+process timeline decision; remove Inbox frame-stream
  code and its timeline merge tests while retaining Teams terminal/process coverage.

## Decision Record

Robin approved the following on 2026-08-11:

1. Message-only Inbox.
2. Workspace composes scoped views while global Teams and Inbox remain.
3. Team is the v1 workspace context; no separate Workspace entity.

## Evidence

- `packages/config/src/index.ts:201` — Team already owns `name`, `work_dir`, and `members`.
- `apps/web/src/modules/teams/tabs.ts:14` — Teams owns operational tabs and already removed Messages.
- `apps/web/src/modules/inbox/AgentTab.tsx:73` — Inbox currently duplicates process visibility.
- `docs/features/M4_inbox-board-module-unified-agent-message-plane-all-supervisor-per-agent-tabs.md:162`
  — durable message queue and process pipe are independent channels.
- `apps/web/src/modules/types.ts:4` — the registry requires only a component; optional scope props can stay
  internal to reusable views without changing module discovery.

## Self-review

- No unresolved decisions or placeholders.
- Scope is limited to the Teams/Inbox boundary and G3 implementation shape.
- The design introduces no new public command, config authority, transport, or persistence model.
