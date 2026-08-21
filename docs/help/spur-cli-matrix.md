# Spur CLI — Noun × Verb Matrix

> Extracted from [`apps/cli/src/commands/`](file:///Users/robin/xprojects/spur-new/apps/cli/src/commands) on 2026-08-20.

## Legend

- **Compound nouns**: `spur <noun> <verb>`.
- **`self`** — the noun hosting the self-management verbs (`init`, `migrate`, `serve`, `status`). Its
  verbs mount the same command builders as the legacy standalone nouns.
- **Hidden legacy aliases** — the four former standalone nouns (`init`, `migrate`, `serve`, `status`)
  remain registered at the top level as hidden aliases over `spur self <verb>`. They keep working
  unchanged for existing scripts and workflow YAML, but are absent from `spur --help`.

---

## Compound Noun × Verb Matrix

| Verb \ Noun | agent | builder | feature | history | message | projects | rule | self | task | team | workflow |
|---|---|---|---|---|---|---|---|---|---|---|
| **add** | | | | | ✅ | | | | | |
| **advance** | | ✅ | | | | | | | | |
| **analyze** | | | ✅ | | | | | | | |
| **assign** | | | | | | | | | ✅ | |
| **batch-create** | | | | | | | | ✅ | | |
| **bump-ver** | | ✅ | | | | | | | | |
| **cancel** | | | | | | | | | | ✅ |
| **check** | | ✅ | | | | | | ✅ | | |
| **clean** | | | | | | | | | | ✅ |
| **continue** | | | | | | | | | | ✅ |
| **create** | ✅ | ✅ | | | | | | ✅ | | |
| **daily** | | | ✅ | | | | | | | |
| **delete** | ✅ | | | | | | | | | |
| **drop-tags** | | ✅ | | | | | | | | |
| **deps** | | | | | | | | ✅ | | |
| **doctor** | ✅ | | | | | | | | | |
| **down** | | | | | | | | | ✅ | |
| **edit** | ✅ | | | | | | | | | |
| **import** | | | ✅ | | | | | | | |
| **inbox** | | | | ✅ | | | | | | |
| **init** | | | | | | | ✅ | | | |
| **list** | ✅ | ✅ | | | ✅ | ✅ | | ✅ | | ✅ |
| **loop** | ✅ | | | | | | | | | |
| **migrate** | | | | | | | ✅ | ✅ | | |
| **migrate-anchors** | | | | | | | | ✅ | | |
| **move** | | ✅ | | | | | | | | |
| **path** | | | | | | | | ✅ | | |
| **record** | | | | | | | | ✅ | | |
| **refresh** | | ✅ | | | | | | ✅ | | |
| **refresh-roster** | | | | | | | | ✅ | | |
| **remove** | | | | | ✅ | | | | | |
| **reply** | | | | ✅ | | | | | | |
| **report** | | | ✅ | | | | | | | |
| **resolve** | | | | | | | | ✅ | | |
| **run** | ✅ | | | | | ✅ | | | | ✅ |
| **run-link** | | | | | | | | ✅ | | |
| **scaffold-tests** | | | | | | | | ✅ | | |
| **sections** | | | | | | | | ✅ | | |
| **send** | | | | ✅ | | | | | | |
| **serve** | | | | | | | ✅ | | | |
| **show** | | ✅ | | | | | | ✅ | | |
| **start** | | | | | ✅ | | | | ✅ | |
| **status** | | | | | | | ✅ | | ✅ | |
| **stop** | | | | | ✅ | | | | ✅ | |
| **sync** | | ✅ | | | | | | | | |
| **trace** | | | | | | ✅ | | | | ✅ |
| **up** | | | | | | | | | ✅ | |
| **update** | | ✅ | | | | | | ✅ | | |
| **validate** | | | | | | ✅ | | | | ✅ |
| **verdict** | | | | | | | | ✅ | | |
| **verifyall-aggregate** | | | | | | | | ✅ | | |
| **wait** | ✅ | | | | | | | | | |
| **watch** | | | | ✅ | | | | | | |
| **Verb count** | **8** | **2** | **9** | **4** | **4** | **5** | **4** | **4** | **18** | **6** | **7** |

## Hidden Legacy Aliases

The four former standalone nouns stay registered over the same builders as `spur self <verb>` — hidden
from the top-level help listing, still fully functional for scripts and workflow YAML.

| Legacy noun | Canonical | Description |
|---|---|---|
| `spur init` | `spur self init` | Scaffold a Spur project |
| `spur migrate` | `spur self migrate` | Run CLI schema migrations |
| `spur serve` | `spur self serve` | Start local web server |
| `spur status` | `spur self status` | Show project / Git status |

## Summary

| Metric | Count |
|---|---|
| Total nouns | **15** |
| Compound nouns (with verbs) | **11** |
| Hidden legacy aliases | **4** |
| Unique verbs | **47** |
| Total noun×verb cells | **71** |

> [!NOTE]
> `task` has the richest surface at 18 verbs, followed by `feature` (9) and `agent` (8). `builder` (2 verbs: `bump-ver`, `drop-tags`) hosts the release plumbing promoted from `spur-dev`. Several verbs are shared across nouns — e.g., `list` (6 nouns), `create`/`run` (3 nouns each), `check`/`show`/`update`/`start`/`stop`/`trace`/`validate`/`refresh` (2 nouns each). `self` (4 verbs) hosts every self-management operation.
