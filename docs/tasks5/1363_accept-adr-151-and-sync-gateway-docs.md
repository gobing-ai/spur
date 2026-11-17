---
schema_version: 1
name: Accept ADR-151 and sync gateway docs
status: done
template: feature-impl
created_at: 2026-11-17T00:06:29.308Z
updated_at: "2026-11-17T05:11:16.541Z"
feature_id: K4
priority: P3
tags:
  - docs
  - adr
estimate_hours: 2

dependencies: ["1357", "1358", "1359", "1360", "1361", "1362"]
done_forced: "false"
done_reason: unforced close
---

## 1363. Accept ADR-151 and sync gateway docs

### Background

Feature K4. ADR-151 and `docs/design/project-gateway.md` were written during planning as **Proposed**. After 1357–1362 land, the docs must match what shipped and ADR-151 moves to Accepted. Covers R11.

### Requirements

- [x] R11. ADR-151 is Accepted and matches the shipped surface (`self serve --gateway`, `self daemon <action>`, `projects add --prefix`); `docs/design/project-gateway.md` risk register rows carry their landing task and any deviations; `docs/design/project-switcher.md`, `docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/downstream-board-modules.md`, `docs/design/board-module-ui-kit.md` and the `spur-cli` self/projects references reflect the prefix contract, gateway and daemon; doc checks pass.

### Acceptance Criteria

- [x] AC1 — Architecture decision and size evaluation are recorded (req: R11)

Verification: `bun run spur-check-feature` (contract/drift checks) green; `rg -n "projects gateway|projects daemon|X-Forwarded-Prefix" docs plugins/sp` returns no live references (history notes excepted); `spur feature check K4 --json` pass. Artifact: the command outputs in `## Testing`.

### Q&A

- Docs-only task; no code. Use `sp:doc-evolve` for drift/sync; constitution untouched.
- If any task deviated from the design (e.g. fell back to `cssCodeSplit:false`), record it in the design and ADR Consequence, not in the task.

### Design

- `docs/00_ADR.md` ADR-151: Status → Accepted with date; reconcile Decision/Consequence with shipped behavior.
- `docs/design/project-gateway.md`: `updated_at`; §6 risk register — confirm each row's task; §5.1 note the final chunk-URL mechanism.
- `docs/design/project-switcher.md:33` Launchd row: keep the "superseded by ADR-151" pointer; add a short prefix/gateway paragraph in the registry section.
- `docs/03_ARCHITECTURE.md:187` gateway paragraph; `docs/04_DESIGN.md:73` index row (already K4).
- `plugins/sp/skills/spur-cli/references/self.md`, `serve.md`, `projects.md`: `self serve --gateway`, `self daemon`, `projects add --prefix`, `projects list` URL column (facade is the single parity authority per AGENTS.md).
- Portable doc changes also update init templates only if they touch template-owned sections (check `config/templates`).

### Plan

1. Diff shipped code against the design (surface, config keys, file names) and list deviations.
2. Update each owner doc above; run `sp:doc-evolve` drift check.
3. Run `bun run spur-check-feature`, the `rg` stale-reference gate, `spur feature check K4 --json`.

### Solution

| File | Lines | What / why |
| --- | --- | --- |
| `docs/00_ADR.md` | 2916-2950 | ADR-151 moves to **Accepted 2026-11-17** with the shipped surface recorded (`self serve --gateway`, `self daemon <install|uninstall|status>`, `projects add --prefix`, `projects list` URL column, `server.gateway.{port,allowedHosts}`, registry `prefix` + `resolveProjectPrefix`/`findPrefixCollisions`, `/api/projects` `prefix`/`url`, module-kit 1.1.0) and the IPv6/IPv4 probe consequence. |
| `docs/design/project-gateway.md` | 5, 111-125, 176-196 | `updated_at` 2026-11-17; §5.1 records that the chunk-URL mechanism landed as designed (relative chunks, no absolute preload helper ⇒ the `cssCodeSplit:false` fallback was unnecessary) and where the base-path implementation lives (components root, re-exported from `lib`); §6 confirms every risk row on its owning task and adds a **Shipped deviations** block: B10's two-tab browser proof replaced by deterministic scopedKey + single-stream checks, probes use `localhost` (not `127.0.0.1`) because the gateway binds `server.host`, and the pre-existing IPv4-only `allocatePort` band probe left as-is. |
| `docs/design/project-switcher.md` | 33, 222-229 | Launchd row now points at the shipped daemon (superseded by ADR-151) and a **Gateway navigation** paragraph documents `/<prefix>/board` on the gateway origin, the remote `host:port` path, and `/api/projects` `prefix`/`url`. |
| `docs/03_ARCHITECTURE.md` | 187-190 | One paragraph carries the full mechanism: prefix contract, `server.gateway` config, `spur self serve --gateway`, the LaunchAgent. |
| `plugins/sp/skills/spur-cli/references/projects.md` | 18-22, 66-88 | Verb map gains `--prefix` and the list URL, plus a **Gateway prefix** section: normalization, derivation, reserved segments, collision warning + 409, remote `null`, and the gateway-vs-per-port URL rule for `list`. |
| `plugins/sp/skills/spur-cli/references/self.md` + `serve.md` | (1362 wrote both) | `self daemon` section and the `--gateway` contract; this task verified they match the shipped flags. |
| `docs/04_DESIGN.md` | 73 | Index row already pointed at the gateway design; unchanged, verified. |
| `docs/design/downstream-board-modules.md` §6.9 + `docs/design/board-module-ui-kit.md` §6 | (1358 wrote both) | Verified they describe the shipped `basePath`/`withBase`/`resolveApiUrl` and kit 1.1.0. |

Docs-only: no code, config, template or constitution change. `config/templates` untouched (no template-owned section moved).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R11 — ADR-151 is Accepted and matches the shipped surface (`self serve --gateway`, `self daemon <action>`, `projects add --prefix`); `docs/design/project-gateway.md` risk-register rows carry their landing task and any deviations; `project-switcher.md`, `03_ARCHITECTURE.md`, `04_DESIGN.md`, `downstream-board-modules.md`, `board-module-ui-kit.md` and the `spur-cli` self/projects references reflect the prefix contract, gateway and daemon; doc checks pass | MET | `docs/00_ADR.md` ADR-151 Accepted; `docs/design/project-gateway.md`, `docs/design/project-switcher.md`, `docs/03_ARCHITECTURE.md`, `plugins/sp/skills/spur-cli/references/{self,projects,serve}.md` reflect shipped surface — Fresh 2026-11-16: `spur feature check K4 --strict` run below |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Architecture decision and size evaluation are recorded (req: R11) | MET | command | `spur feature check K4 --as done --strict --json` (batch shippable gate, this run) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Req | Status | Evidence |
| --- | --- | --- |
| R11 | MET | ADR-151 Accepted with the shipped surface + probe consequence (`docs/00_ADR.md:2916-2950`); gateway design updated (`docs/design/project-gateway.md:5,111-125,176-196`) with per-row landing tasks and a deviations block; switcher/architecture/reference docs updated (`docs/design/project-switcher.md:33,222-229`, `docs/03_ARCHITECTURE.md:187-190`, `plugins/sp/skills/spur-cli/references/projects.md:18-22,66-88`); `04_DESIGN.md`, `downstream-board-modules.md` §6.9, `board-module-ui-kit.md` §6 and `self.md`/`serve.md` verified |

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | command + static-ref | `spur feature check K4 --json` pass with zero findings; stale-reference gate returns only the two task files; `link-check` OK, `transition-shim-check` PASS, `script-contract-check` 0 violations |

Findings: none blocking. The ADR records the operator consent that authorized the three public surfaces.

Residual risk: prose-vs-behaviour drift is guarded only by the doc-parity gates (live verbs/flags documented) and `feature check`; no test asserts prose semantics.

**Disposition: PASS.**

### References

- Feature K4 R11; ADR-151; ADR-037; `docs/design/project-gateway.md`; `docs/design/project-switcher.md`; `docs/99_PROJECT_CONSTITUTION.md` (process).
- Depends on 1357–1362.

### History

- 2026-11-17T00:21:24.181Z feature_id Q → K4 (system)
- 2026-11-17T02:35:54.569Z todo → wip (system)
- 2026-11-17T02:37:51.859Z wip → testing (system)
- 2026-11-17T02:37:53.176Z testing → done (system)

