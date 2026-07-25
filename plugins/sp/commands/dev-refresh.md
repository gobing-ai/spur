---
description: Refresh feature status by feature ID, task WBS, or batch sweep via spur feature sync
argument-hint: "[<feature-id|wbs>] [--all] [--auto]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Refresh

Wraps the **sp:spur-dev** skill.

## Usage

/sp:dev-refresh [<feature-id|wbs>] [--all] [--auto]

## Implementation

- Single feature (`<feature-id>`): `Skill(skill="sp:spur-dev", args="refresh <feature-id> $ARGUMENTS")` — runs `spur feature sync <id> --dry-run --json` to preview derivation proposal, asks for confirmation (in interactive mode), then applies `spur feature sync <id> --json`.
- Task WBS (`<wbs>`): `Skill(skill="sp:spur-dev", args="refresh <wbs> $ARGUMENTS")` — resolves linked feature; if unlinked, runs feature-link-helper to propose or persist skip (`feature_link_declined: true`), then syncs.
- Batch sweep (`--all`): `Skill(skill="sp:spur-dev", args="refresh --all $ARGUMENTS")` — sweeps orphan tasks via link-helper + `spur feature sync --all --json` across features with summary report.
- Unattended (`--auto`): Forward-only auto-apply for status syncs; orphan link proposals queued to `.spur/run/dev-refresh-report.txt`.
