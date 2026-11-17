# Spur CLI — Noun × Verb Matrix

> Extracted from [`apps/cli/src/commands/`](file:///Users/robin/xprojects/spur-new/apps/cli/src/commands) on 2026-09-30.

## Legend

- **Compound nouns**: `spur <noun> <verb>`.
- **`self`** — the noun hosting the self-management verbs (`exec`, `init`, `install`, `maintain`, `migrate`,
  `search`, `serve`, `status`, `uninstall`). `install --daemon` installs the macOS LaunchAgent that keeps the project gateway
  on. Five of them mount the same command builders as the legacy standalone nouns; `exec` runs the
  project's `builder.actions` / `builder.preset` binding; `search` is the hybrid rg/zg search transport.
- **Hidden legacy aliases** — the five former standalone nouns (`init`, `maintain`, `migrate`, `serve`, `status`)
  remain registered at the top level as hidden aliases over `spur self <verb>`. They keep working
  unchanged for existing scripts and workflow YAML, but are absent from `spur --help`.

---

## Compound Noun × Verb Matrix

| Verb \ Noun | agent | builder | decision | feature | history | message | projects | rule | self | task | workflow |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Verb count** | **10** | **14** | **5** | **11** | **15** | **6** | **6** | **4** | **10** | **24** | **17** |
| **add** |   |   |   |   |   |   | ✅ |   |   |   |   |
| **advance** |   |   |   | ✅ |   |   |   |   |   |   |   |
| **analyze** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-assert-clean** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-check** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-digest** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-paths** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-probe** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-publish** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-refresh** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **anatomy-stamp** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **batch-create** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **batch-plan** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **batch-plan-children** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **build-binaries** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **build-cli** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **build-server** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **bundle-config** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **bundle-web** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **bump-ver** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **cancel** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **check** |   |   |   | ✅ |   |   |   |   |   | ✅ |   |
| **clean** |   |   |   |   |   |   | ✅ |   |   |   | ✅ |
| **commit-guard-check** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **commit-guard-stage** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **commit-guard-start** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **continue** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **cost** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **create** |   |   |   | ✅ |   |   |   |   |   | ✅ |   |
| **daily** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **deps** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **diffstat** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **doctor** | ✅ |   |   |   |   |   |   |   |   |   |   |
| **dogfood-gate** | ✅ |   |   |   |   |   |   |   |   |   |   |
| **dogfood-validate-report** | ✅ |   |   |   |   |   |   |   |   |   |   |
| **drop-tags** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **exec** |   |   |   |   |   |   |   |   | ✅ |   |   |
| **gate** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **handoff** |   |   |   | ✅ |   |   |   |   |   |   |   |
| **import** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **inbox** |   |   |   |   |   | ✅ |   |   |   |   |   |
| **init** |   |   |   |   |   |   |   |   | ✅ |   |   |
| **install** |   |   |   |   |   |   |   |   | ✅ |   |   |
| **join** |   |   |   |   |   |   |   |   |   |   |   |
| **leave** |   |   |   |   |   |   |   |   |   |   |   |
| **list** | ✅ |   | ✅ | ✅ |   |   | ✅ | ✅ |   | ✅ | ✅ |
| **maintain** |   |   |   |   |   |   |   |   | ✅ |   |   |
| **migrate** |   |   |   |   |   |   |   |   | ✅ | ✅ |   |
| **move** |   |   |   | ✅ |   |   |   |   |   |   |   |
| **outcome** |   |   | ✅ |   |   |   |   |   |   |   |   |
| **path** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **persist-check** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **persist-out** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **pr-check** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **pr-open** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **pr-review** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **pr-status** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **preflight** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **profile** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **progress** |   |   |   |   |   |   |   |   |   |   | ✅ |
| **publish** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **read** |   |   |   |   |   | ✅ |   |   |   |   |   |
| **record** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **refresh** |   |   |   | ✅ |   |   |   |   |   | ✅ |   |
| **refresh-roster** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **remove** |   |   |   |   |   |   | ✅ |   |   |   |   |
| **reply** |   |   |   |   |   | ✅ |   |   |   |   |   |
| **report** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **reset** |   |   |   |   | ✅ |   |   |   |   |   |   |

| **resolve** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **run** | ✅ |   | ✅ |   |   |   |   | ✅ |   |   | ✅ |
| **run-link** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **scaffold-tests** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **search** |   |   |   |   |   |   |   |   | ✅ |   |   |
| **sections** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **send** |   |   |   |   |   | ✅ |   |   |   |   |   |
| **serve** |   |   |   |   |   |   |   |   | ✅ |   |   |
| **show** |   |   | ✅ | ✅ |   | ✅ |   |   |   | ✅ | ✅ |
| **show-branches** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **start** | ✅ |   |   |   |   |   | ✅ |   |   |   |   |
| **status** | ✅ |   | ✅ |   |   |   |   |   | ✅ |   |   |
| **stop** | ✅ |   |   |   |   |   | ✅ |   |   |   |   |
| **summary** |   |   |   |   | ✅ |   |   |   |   |   | ✅ |
| **sync** |   |   |   | ✅ |   |   |   |   |   |   |   |
| **timeline** |   |   |   |   | ✅ |   |   |   |   |   |   |
| **trace** | ✅ |   |   |   |   |   |   | ✅ |   |   | ✅ |
| **uninstall** |   |   |   |   |   |   |   |   | ✅ |   |   |
| **update** |   |   |   | ✅ |   |   |   |   |   | ✅ |   |
| **usage** | ✅ |   |   |   |   |   |   |   |   |   |   |
| **validate** |   |   |   |   |   |   |   | ✅ |   |   | ✅ |
| **verdict** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **verify** |   |   |   | ✅ |   |   |   |   |   |   |   |
| **verifyall-aggregate** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **verify-pack** |   | ✅ |   |   |   |   |   |   |   |   |   |
| **wait** |   |   |   |   |   |   |   |   |   |   |   |
| **watch** |   |   |   |   |   | ✅ |   |   |   |   |   |
| **wrapup** |   |   |   |   |   |   |   |   |   | ✅ |   |
| **Verb count** | **10** | **14** | **5** | **11** | **15** | **6** | **6** | **4** | **9** | **24** | **17** |

## Hidden Legacy Aliases

The five former standalone nouns stay registered over the same builders as `spur self <verb>` — hidden
from the top-level help listing, still fully functional for scripts and workflow YAML.

| Legacy noun | Canonical | Description |
|---|---|---|
| `spur init` | `spur self init` | Scaffold a Spur project |
| `spur maintain` | `spur self maintain` | Run database maintenance |
| `spur migrate` | `spur self migrate` | Run CLI schema migrations |
| `spur serve` | `spur self serve` | Start local web server |
| `spur status` | `spur self status` | Show project / Git status |

## Summary

| Metric | Count |
|---|---|
| Total nouns | **16** |
| Compound nouns (with verbs) | **11** |
| Hidden legacy aliases | **5** |
| Unique verbs | **94** |
| Total noun×verb cells | **121** |

> [!NOTE]
> `task` has the richest surface at 24 verbs, followed by `workflow` (17, including the flat `commit-guard-start`/`commit-guard-stage`/`commit-guard-check` transport, the flat WT-4 `persist-out`/`persist-check` landing verbs, the `summary`/`profile` measurements and `cost`), `history` (15, including the flat `anatomy-<op>` verbs), `agent` (10, including `dogfood-gate`/`dogfood-validate-report`; the four fleet plumbing verbs `join`/`leave`/`wait`/`report` are hidden from help per ADR-148) and `feature` (11). Their nested spellings (`workflow commit-guard <op>`, `agent dogfood <op>`, `history anatomy <op>`, `task batch-plan task-children`) were removed in task 1290. `builder` (14 verbs) hosts the release plumbing promoted from `spur-dev`, the flat PR-review verbs and — from A93 — the six artifact verbs `build-cli`, `build-server`, `build-binaries` (`--source-root <dir>`) plus `bundle-config`, `bundle-web` and `verify-pack`, which absorbed the repository build/staging scripts behind the shipped surface. `decision` (5 verbs: `list`, `outcome`, `run`, `show`, `status`) is the decision-catalog transport (task 1093; `outcome` by task 1263). Several verbs are shared across nouns — e.g., `list` (7 nouns), `run`/`show` (4 nouns each), `check`/`clean`/`create`/`migrate`/`refresh`/`start`/`stop`/`trace`/`update`/`validate` (2 nouns each). `self` (10 verbs) hosts every self-management operation, including the `exec` action runner, the `search` hybrid rg/zg query verb, the `install` machine-setup verb (A93, which also installs the gateway LaunchAgent with `--daemon`), the `uninstall` remover and the `status` readiness aggregate that reports the LaunchAgent's state (K4).
