# Feature tree restructure map

**Status:** accepted seed from audit **0356** (2026-07-28)  
**Consumer:** `/sp:dev-featurechange` (dry-run / apply)  
**Hierarchy rules:** `plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md`  
**Map feature:** F31 (under F3 Feature management CLI)

Do **not** re-scan the whole tree for dogfood — apply from this file.

## Schema

| Column | Meaning |
| --- | --- |
| `old_id` | Current feature id |
| `disposition` | `keep` \| `reparent-under:<parent>` \| `merge-into:<id>` \| `rename-only` \| `archive` |
| `new_parent` | Target parent when disposition is reparent (else `—`) |
| `expected_new_id` | Predicted id after `spur feature move` (verify with `--dry-run`) |
| `rationale` | One-line why |
| `conf` | H / M / L |
| `task_edge_notes` | Task `feature_id` cascade notes |
| `docs_root_refs` | Touch root `docs/*.md` when applying? |

## Completeness inventory (every root A–R)

| old_id | name | status | disposition | new_parent | expected_new_id | conf | rationale | task_edge_notes | docs_root_refs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | Foundation | active | **keep** | — | A | H | Platform layer; children A1/A2 fit | none | no |
| B | Agent execution | active | **keep** | — | B | H | `spur agent` runner; reject merge with H | none | no |
| C | Rules | active | **keep** | — | C | H | MECE CLI noun | none | no |
| D | Workflows | active | **keep** | — | D | H | MECE CLI noun; receives P | tasks under P rewire after P moves | maybe after P |
| E | History | active | **keep** | — | E | H | MECE CLI noun | none | no |
| F | Planning | active | **keep** | — | F | H | Planning SSOT; receives Q,R; F31 already under F3 | tasks under Q/R rewire after moves | maybe after Q/R |
| G | Collaboration | active | **keep** | — | G | H | message/team CLI backbone; not Teams board | none | no |
| H | Agent integration | active | **keep** | — | H | H | plugins/sp; receives N,O | tasks under N/O rewire after moves | maybe after N/O |
| I | sp plugin hands-off ready | done | **keep** | — | I | M | Done historical epic; optional later under H | none | no |
| J | Observabilities board module | active | **keep** | — | J | H | Board observability shell; receives K,L | tasks under K/L rewire after moves | maybe after K/L |
| K | Observability System Events Table Redesign | done | **reparent-under:J** | J | *dry-run* (e.g. J1) | H | System Events tab UX slice of J | `spur feature move` updates feature_id edges | yes if root docs cite K |
| L | System Events Payload and Wiring Enrichment | verifying | **reparent-under:J** | J | *dry-run* (e.g. J2) | H | Same tab diagnostics as J/K | same | yes if root docs cite L |
| M | Teams board + declarative teams | active | **keep** | — | M | H | Board product over G backbones | none | no |
| N | sp plugin next-layer UX | verifying | **reparent-under:H** | H | *dry-run* (e.g. H4) | H | Plugin UX continuation of H | same | yes if root docs cite N |
| O | sp plugin token-efficient architecture | verifying | **reparent-under:H** | H | *dry-run* (e.g. H5) | H | Architecture of H plugin | same | yes if root docs cite O |
| P | workflow run observability | verifying | **reparent-under:D** | D | *dry-run* (e.g. D1) | M | Object is workflow run CLI/engine | same | yes if root docs cite P |
| Q | AC-verifiable execution + gates | done | **reparent-under:F** | F | *dry-run* (e.g. F9) | M | Planning validation capability | same | yes if root docs cite Q |
| R | Feature status feedback loop | active | **reparent-under:F** | F | *dry-run* (e.g. F next free) | M | Corpus status is planning | R1/R2 cascade with R | yes if root docs cite R |

**Non-root already correct**

| old_id | disposition | notes |
| --- | --- | --- |
| F31 | **keep** | Restructure kit under F3 (was errant root S → F31) |
| F81 | **keep** | Child of F8 — positive hierarchy example |
| A1,A2,B1,B2,F1–F8,G1–G3,H1–H3,M1–M3,R1,R2 | **keep** | Move only if parent moves (cascade) |

## Rejected merges (do not apply as merge-into)

| Proposal | Ruling | Why |
| --- | --- | --- |
| B ∪ H | reject | Runner vs plugins/sp — Goals differ |
| J ∪ K body-merge | reject | Use reparent K (and L) under J |

## Recommended apply order

1. **Wave 1 (H conf):** `K → J`, `L → J`  
2. **Wave 2 (H conf):** `N → H`, `O → H`  
3. **Wave 3 (M conf — confirm if needed):** `P → D`, `Q → F`, `R → F`  
4. Optional rename-only: J title grammar (“Observability”); shorten M name  

Each step: `spur feature move <id> --parent <p> --dry-run` then apply; then `spur feature refresh`; `spur feature check`.

## Source

- Audit: `docs/tasks3/0356_audit-feature-roots-a-r-evidence-backed-merge-reparent-keep-.md`  
- Hierarchy rules: `plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md`
