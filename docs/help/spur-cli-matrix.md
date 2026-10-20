# Spur CLI — Noun × Verb Matrix

> Extracted from [`apps/cli/src/commands/`](file:///Users/robin/xprojects/spur-new/apps/cli/src/commands) on 2026-09-30.

## Legend

- **Compound nouns**: `spur <noun> <verb>`.
- **`self`** — the noun hosting the self-management verbs (`exec`, `init`, `maintain`, `migrate`, `serve`,
  `status`). Five of them mount the same command builders as the legacy standalone nouns; `exec` runs the
  project's `builder.actions` / `builder.preset` binding.
- **Hidden legacy aliases** — the five former standalone nouns (`init`, `maintain`, `migrate`, `serve`, `status`)
  remain registered at the top level as hidden aliases over `spur self <verb>`. They keep working
  unchanged for existing scripts and workflow YAML, but are absent from `spur --help`.

---

## Compound Noun × Verb Matrix

| Verb \ Noun | agent | builder | decision | feature | history | message | projects | rule | self | task | workflow |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Verb count** | **13** | **8** | **5** | **11** | **8** | **4** | **6** | **4** | **6** | **25** | **15** |
| **add** |  |  | |  |  |  | ✅ |  |  |  |  |
| **advance** |  |  | | ✅ |  |  |  |  |  |  |  |
| **analyze** |  |  | |  | ✅ |  |  |  |  |  |  |
| **anatomy** |  |  | |  | ✅ |  |  |  |  |  |  |
| **batch-create** |  |  | |  |  |  |  |  |  | ✅ |  |
| **batch-plan** |  |  | |  |  |  |  |  |  | ✅ |  |
| **bump-ver** |  | ✅ | |  |  |  |  |  |  |  |  |
| **cancel** |  |  | |  |  |  |  |  |  |  | ✅ |
| **check** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **clean** |  |  | |  |  |  | ✅ |  |  |  | ✅ |
| **commit-guard** |  |  | |  |  |  |  |  |  |  | ✅ |
| **continue** |  |  | |  |  |  |  |  |  |  | ✅ |
| **cost** |  |  | |  |  |  |  |  |  |  | ✅ |
| **create** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **daily** |  |  | |  | ✅ |  |  |  |  |  |  |
| **deps** |  |  | |  |  |  |  |  |  | ✅ |  |
| **diffstat** |  |  | |  |  |  |  |  |  | ✅ |  |
| **dogfood** | ✅ |  | |  |  |  |  |  |  |  |  |
| **doctor** | ✅ |  | |  |  |  |  |  |  |  |  |
| **drop-tags** |  | ✅ | |  |  |  |  |  |  |  |  |
| **exec** |  |  | |  |  |  |  |  | ✅ |  |  |
| **gate** |  |  | |  |  |  |  |  |  | ✅ |  |
| **handoff** |  |  | | ✅ |  |  |  |  |  |  |  |
| **import** |  |  | |  | ✅ |  |  |  |  |  |  |
| **inbox** |  |  | |  |  | ✅ |  |  |  |  |  |
| **init** |  |  | |  |  |  |  |  | ✅ |  |  |
| **join** | ✅ |  | |  |  |  |  |  |  |  |  |
| **leave** | ✅ |  | |  |  |  |  |  |  |  |  |
| **list** | ✅ |  | ✅ | ✅ |  |  | ✅ | ✅ |  | ✅ | ✅ |
| **maintain** |  |  | |  |  |  |  |  | ✅ |  |  |
| **migrate** |  |  | |  |  |  |  |  | ✅ | ✅ |  |
| **migrate-anchors** |  |  | |  |  |  |  |  |  | ✅ |  |
| **move** |  |  | | ✅ |  |  |  |  |  |  |  |
| **path** |  |  | |  |  |  |  |  |  | ✅ |  |
| **pr-check** |  | ✅ | |  |  |  |  |  |  |  |  |
| **pr-open** |  | ✅ | |  |  |  |  |  |  |  |  |
| **pr-review** |  | ✅ | |  |  |  |  |  |  |  |  |
| **pr-status** |  | ✅ | |  |  |  |  |  |  |  |  |
| **preflight** |  |  | |  |  |  |  |  |  | ✅ |  |
| **profile** |  |  | |  |  |  |  |  |  |  | ✅ |
| **outcome** |  |  | ✅ |  |  |  |  |  |  |  |  |
| **persist-check** |  |  | |  |  |  |  |  |  |  | ✅ |
| **persist-out** |  |  | |  |  |  |  |  |  |  | ✅ |
| **progress** |  |  | |  |  |  |  |  |  |  | ✅ |
| **publish** |  | ✅ | |  |  |  |  |  |  |  |  |
| **record** |  |  | |  |  |  |  |  |  | ✅ |  |
| **refresh** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **refresh-roster** |  |  | |  |  |  |  |  |  | ✅ |  |
| **remove** |  |  | |  |  |  | ✅ |  |  |  |  |
| **reply** |  |  | |  |  | ✅ |  |  |  |  |  |
| **report** | ✅ |  | |  | ✅ |  |  |  |  |  |  |
| **reset** |  |  | |  | ✅ |  |  |  |  |  |  |
| **residual** |  |  | |  |  |  |  |  |  | ✅ |  |
| **resolve** |  |  | |  |  |  |  |  |  | ✅ |  |
| **run** | ✅ |  | ✅ |  |  |  |  | ✅ |  |  | ✅ |
| **run-link** |  |  | |  |  |  |  |  |  | ✅ |  |
| **scaffold-tests** |  |  | |  |  |  |  |  |  | ✅ |  |
| **sections** |  |  | |  |  |  |  |  |  | ✅ |  |
| **send** |  |  | |  |  | ✅ |  |  |  |  |  |
| **serve** |  |  | |  |  |  |  |  | ✅ |  |  |
| **show** |  |  | ✅ | ✅ |  |  |  |  |  | ✅ | ✅ |
| **show-branches** |  | ✅ | |  |  |  |  |  |  |  |  |
| **start** | ✅ |  | |  |  |  | ✅ |  |  |  |  |
| **status** | ✅ |  | ✅ |  |  |  |  |  | ✅ |  |  |
| **stop** | ✅ |  | |  |  |  | ✅ |  |  |  |  |
| **summary** |  |  | |  | ✅ |  |  |  |  |  | ✅ |
| **sync** |  |  | | ✅ |  |  |  |  |  |  |  |
| **timeline** |  |  | |  | ✅ |  |  |  |  |  |  |
| **trace** | ✅ |  | |  |  |  |  | ✅ |  |  | ✅ |
| **update** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **usage** | ✅ |  | |  |  |  |  |  |  |  |  |
| **validate** |  |  | |  |  |  |  | ✅ |  |  | ✅ |
| **verdict** |  |  | |  |  |  |  |  |  | ✅ |  |
| **verify** |  |  | | ✅ |  |  |  |  |  |  |  |
| **verifyall-aggregate** |  |  | |  |  |  |  |  |  | ✅ |  |
| **wait** | ✅ |  | |  |  |  |  |  |  |  |  |
| **watch** |  |  | |  |  | ✅ |  |  |  |  |  |
| **wrapup** |  |  | |  |  |  |  |  |  | ✅ |  |
| **Verb count** | **13** | **8** | **5** | **11** | **8** | **4** | **6** | **4** | **6** | **25** | **15** |

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
| Unique verbs | **78** |
| Total noun×verb cells | **105** |

> [!NOTE]
> `task` has the richest surface at 25 verbs, followed by `agent` (13), `workflow` (15, including the `commit-guard` transport, the flat WT-4 `persist-out`/`persist-check` landing verbs, the `summary`/`profile` measurements and `cost`) and `feature` (11). `builder` (8 verbs: `bump-ver`, `drop-tags`, `publish`, `show-branches`, `pr-check`, `pr-open`, `pr-review`, `pr-status`) hosts the release plumbing promoted from `spur-dev` and the flat PR-review verbs (the deprecated `pr <op>` pass-through stays registered but hidden from `--help`, so it is not a matrix cell). `decision` (5 verbs: `list`, `outcome`, `run`, `show`, `status`) is the decision-catalog transport (task 1093; `outcome` by task 1263). Several verbs are shared across nouns — e.g., `list` (7 nouns), `run`/`show` (4 nouns each), `check`/`clean`/`create`/`migrate`/`refresh`/`start`/`stop`/`trace`/`update`/`validate` (2 nouns each). `self` (6 verbs) hosts every self-management operation, including the `exec` action runner.
