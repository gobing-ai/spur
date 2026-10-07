---
name: fleet-join
description: >-
  Join a project fleet as a guest occupant and pull its work. Use when the operator asks to
  "join the fleet", "become a fleet guest", "pull fleet inbox work in this session", or when a
  session should receive fleet messages without being supervised. Runs `spur agent join`, then
  loops `spur agent wait --inbox`, and releases the lease with `spur agent leave`.
---
# fleet-join — a live session as a fleet guest (G73, task 1081)

A guest is a session that **pulls** work: it is neither supervised nor restarted, it is addressed
by concrete id only, and it never receives a stage (`requiresCapabilities` stages can never route
to it — a guest carries no attestation). Joining registers an occupant row plus a heartbeat lease;
leaving (or an expired lease) releases it and returns any claimed messages to `queued`.

## Join

```bash
spur agent join --role reviewer --json      # id defaults to <role>-g<n>
spur agent join --role coder --id my-session --json
```

Pick the role whose work this session can actually do. `--session-id` defaults to
`CLAUDE_CODE_SESSION_ID`, which is what the Stop hook matches against — without it the hook cannot
find this session, though the `wait --inbox` loop still works.

## Pull loop

`spur agent wait --inbox <id> --timeout 540000` returns **0** the moment queued work exists and
**1** on timeout. Each call heartbeats the lease, so a looping session stays joined. The Bash tool's
own ~10-minute limit is why the timeout stays under it: one bounded call per turn, re-armed after
the work is done.

1. `spur agent wait --inbox <id> --timeout 540000 --json` → exit 0 means work is waiting.
2. `spur message inbox --agent <id> --json` → read the messages.
3. Do the work the message asks for.
4. `spur message reply <msgId> "<result>"` → reply to each one.
5. Re-arm: go back to step 1 while the operator wants this session in the fleet.

## Leave

```bash
spur agent leave --json                     # the guest joined by this session
spur agent leave my-session --json           # an explicit id
```

Leaving releases the lease immediately. If the session dies without leaving, the lease expires and
the reconciler pass retires the guest — pending work is never lost, it returns to `queued`.

## Stop-hook delivery (opportunistic)

When the host fires a `Stop` hook and the host supports the block contract, the
`fleet-guest-stop` plugin hook delivers pending messages at turn end by replying
`{"decision":"block","reason":"Pending fleet messages: …"}` — only for a session whose id matches a
joined guest, never twice in one continued turn, and always fail-open. Claude Code supports this;
Codex `exec` on 0.160.0 does not deliver `Stop` at all (`docs/plans/2026-10-05-codex-guest-spike.md`),
so the pull loop above — not the hook — is what makes a guest work anywhere.

## Boundaries

- Guests are **not** supervised: do not expect restart, pid ownership, or `--drain` injection.
- Never dispatch a stage to a guest id: `spur agent run --spec <guest-id>` is refused on purpose.
- Never hold the write slot through a guest: the guest lease is the only heartbeat (R5).
