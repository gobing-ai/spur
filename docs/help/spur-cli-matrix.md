# Spur CLI — Noun × Verb Matrix

> Extracted from [`apps/cli/src/commands/`](file:///Users/robin/xprojects/spur-new/apps/cli/src/commands) on 2026-08-20.

## Legend

- **Standalone nouns** (`init`, `migrate`, `serve`, `status`): no sub-verbs — the noun itself is the command.
- **Compound nouns** (all others): `spur <noun> <verb>`.

---

## Compound Noun × Verb Matrix

| Verb \ Noun | agent | feature | history | message | projects | rule | task | team | workflow |
|---|---|---|---|---|---|---|---|---|---|
| **add** | | | | | ✅ | | | | |
| **advance** | | ✅ | | | | | | | |
| **analyze** | | | ✅ | | | | | | |
| **assign** | | | | | | | | ✅ | |
| **batch-create** | | | | | | | ✅ | | |
| **cancel** | | | | | | | | | ✅ |
| **check** | | ✅ | | | | | ✅ | | |
| **clean** | | | | | | | | | ✅ |
| **continue** | | | | | | | | | ✅ |
| **create** | ✅ | ✅ | | | | | ✅ | | |
| **daily** | | | ✅ | | | | | | |
| **delete** | ✅ | | | | | | | | |
| **deps** | | | | | | | ✅ | | |
| **doctor** | ✅ | | | | | | | | |
| **down** | | | | | | | | ✅ | |
| **edit** | ✅ | | | | | | | | |
| **import** | | | ✅ | | | | | | |
| **inbox** | | | | ✅ | | | | | |
| **list** | ✅ | ✅ | | | ✅ | ✅ | ✅ | | ✅ |
| **loop** | ✅ | | | | | | | | |
| **migrate** | | | | | | | ✅ | | |
| **migrate-anchors** | | | | | | | ✅ | | |
| **move** | | ✅ | | | | | | | |
| **path** | | | | | | | ✅ | | |
| **record** | | | | | | | ✅ | | |
| **refresh** | | ✅ | | | | | ✅ | | |
| **refresh-roster** | | | | | | | ✅ | | |
| **remove** | | | | | ✅ | | | | |
| **reply** | | | | ✅ | | | | | |
| **report** | | | ✅ | | | | | | |
| **resolve** | | | | | | | ✅ | | |
| **run** | ✅ | | | | | ✅ | | | ✅ |
| **run-link** | | | | | | | ✅ | | |
| **scaffold-tests** | | | | | | | ✅ | | |
| **sections** | | | | | | | ✅ | | |
| **send** | | | | ✅ | | | | | |
| **show** | | ✅ | | | | | ✅ | | |
| **start** | | | | | ✅ | | | ✅ | |
| **status** | | | | | | | | ✅ | |
| **stop** | | | | | ✅ | | | ✅ | |
| **sync** | | ✅ | | | | | | | |
| **trace** | | | | | | ✅ | | | ✅ |
| **up** | | | | | | | | ✅ | |
| **update** | | ✅ | | | | | ✅ | | |
| **validate** | | | | | | ✅ | | | ✅ |
| **verdict** | | | | | | | ✅ | | |
| **verifyall-aggregate** | | | | | | | ✅ | | |
| **wait** | ✅ | | | | | | | | |
| **watch** | | | | ✅ | | | | | |
| **Verb count** | **8** | **9** | **4** | **4** | **5** | **4** | **18** | **6** | **7** |

## Standalone Nouns (no sub-verbs)

| Noun | Description |
|---|---|
| `init` | Scaffold a Spur project |
| `migrate` | Run CLI schema migrations |
| `serve` | Start local web server |
| `status` | Show project / Git status |

## Summary

| Metric | Count |
|---|---|
| Total nouns | **13** |
| Compound nouns (with verbs) | **9** |
| Standalone nouns | **4** |
| Unique verbs | **43** |
| Total noun×verb cells | **65** |

> [!NOTE]
> `task` has the richest surface at 18 verbs, followed by `feature` (9) and `agent` (8). Several verbs are shared across nouns — e.g., `list` (6 nouns), `create`/`run` (3 nouns each), `check`/`show`/`update`/`start`/`stop`/`trace`/`validate`/`refresh` (2 nouns each).
