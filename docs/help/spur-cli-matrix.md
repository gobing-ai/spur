# Spur CLI — Noun × Verb Matrix

> Extracted from [`apps/cli/src/commands/`](file:///Users/robin/xprojects/spur-new/apps/cli/src/commands) on 2026-09-30.

## Legend

- **Compound nouns**: `spur <noun> <verb>`.
- **`self`** — the noun hosting the self-management verbs (`init`, `maintain`, `migrate`, `serve`, `status`). Its
  verbs mount the same command builders as the legacy standalone nouns.
- **Hidden legacy aliases** — the five former standalone nouns (`init`, `maintain`, `migrate`, `serve`, `status`)
  remain registered at the top level as hidden aliases over `spur self <verb>`. They keep working
  unchanged for existing scripts and workflow YAML, but are absent from `spur --help`.

---

## Compound Noun × Verb Matrix

| Verb \ Noun | agent | builder | decision | feature | history | message | projects | rule | self | task | workflow |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **add** |  |  | |  |  |  | ✅ |  |  |  |  |
| **advance** |  |  | | ✅ |  |  |  |  |  |  |  |
| **analyze** |  |  | |  | ✅ |  |  |  |  |  |  |
| **batch-create** |  |  | |  |  |  |  |  |  | ✅ |  |
| **bump-ver** |  | ✅ | |  |  |  |  |  |  |  |  |
| **cancel** |  |  | |  |  |  |  |  |  |  | ✅ |
| **check** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **clean** |  |  | |  |  |  | ✅ |  |  |  | ✅ |
| **continue** |  |  | |  |  |  |  |  |  |  | ✅ |
| **create** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **daily** |  |  | |  | ✅ |  |  |  |  |  |  |
| **deps** |  |  | |  |  |  |  |  |  | ✅ |  |
| **doctor** | ✅ |  | |  |  |  |  |  |  |  |  |
| **drop-tags** |  | ✅ | |  |  |  |  |  |  |  |  |
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
| **progress** |  |  | |  |  |  |  |  |  |  | ✅ |
| **record** |  |  | |  |  |  |  |  |  | ✅ |  |
| **refresh** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **refresh-roster** |  |  | |  |  |  |  |  |  | ✅ |  |
| **remove** |  |  | |  |  |  | ✅ |  |  |  |  |
| **reply** |  |  | |  |  | ✅ |  |  |  |  |  |
| **report** | ✅ |  | |  | ✅ |  |  |  |  |  |  |
| **reset** |  |  | |  | ✅ |  |  |  |  |  |  |
| **resolve** |  |  | |  |  |  |  |  |  | ✅ |  |
| **run** | ✅ |  | ✅ |  |  |  |  | ✅ |  |  | ✅ |
| **run-link** |  |  | |  |  |  |  |  |  | ✅ |  |
| **scaffold-tests** |  |  | |  |  |  |  |  |  | ✅ |  |
| **sections** |  |  | |  |  |  |  |  |  | ✅ |  |
| **send** |  |  | |  |  | ✅ |  |  |  |  |  |
| **serve** |  |  | |  |  |  |  |  | ✅ |  |  |
| **show** |  |  | ✅ | ✅ |  |  |  |  |  | ✅ | ✅ |
| **start** | ✅ |  | |  |  |  | ✅ |  |  |  |  |
| **status** | ✅ |  | ✅ |  |  |  |  |  | ✅ |  |  |
| **stop** | ✅ |  | |  |  |  | ✅ |  |  |  |  |
| **sync** |  |  | | ✅ |  |  |  |  |  |  |  |
| **trace** | ✅ |  | |  |  |  |  | ✅ |  |  | ✅ |
| **update** |  |  | | ✅ |  |  |  |  |  | ✅ |  |
| **usage** | ✅ |  | |  |  |  |  |  |  |  |  |
| **validate** |  |  | |  |  |  |  | ✅ |  |  | ✅ |
| **verdict** |  |  | |  |  |  |  |  |  | ✅ |  |
| **verifyall-aggregate** |  |  | |  |  |  |  |  |  | ✅ |  |
| **wait** | ✅ |  | |  |  |  |  |  |  |  |  |
| **watch** |  |  | |  |  | ✅ |  |  |  |  |  |
| **Verb count** | **12** | **2** | **4** | **9** | **5** | **4** | **6** | **4** | **5** | **19** | **9** |

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
| Unique verbs | **53** |
| Total noun×verb cells | **79** |

> [!NOTE]
> `task` has the richest surface at 19 verbs, followed by `agent` (12), then `feature` and `workflow` (9 each). `builder` (2 verbs: `bump-ver`, `drop-tags`) hosts the release plumbing promoted from `spur-dev`. `decision` (4 verbs: `list`, `run`, `show`, `status`) is the frozen decision-catalog transport (task 1093). Several verbs are shared across nouns — e.g., `list` (7 nouns), `run`/`show` (4 nouns each), `check`/`clean`/`create`/`migrate`/`refresh`/`start`/`stop`/`trace`/`update`/`validate` (2 nouns each). `self` (5 verbs) hosts every self-management operation.
