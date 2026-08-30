# Harness surface governance

**Area:** the two detectable composition measures (shell / agent.run), the advisory-only posture, and
the four-surface script placement table with dated operator-consent applications.
**Status:** authority landed (ADR-069 amendment + promotion, ADR-051 amendment); advisory tooling is
sibling tasks 0614/0615; consent record updated by task 0695 on 2026-08-27.
**Authority:** derived; ADR-069 (composition measures, advisory posture), ADR-051 (surface boundary,
consent gate), ADR-065 (plugin-script entrypoint contract, cross-referenced), ADR-043 (slash-command
preference). On conflict, `00_ADR.md` wins (lower number wins on content, constitution §4.1).

---

## 1. Composition measures (ADR-069 R1–R3)

### 1.1 Shell measure

- **Unit:** non-comment shell line of a `shell` action's `command` (split on newline and `;`),
  counted per action in `config/workflows/*.yaml` state hooks (`onEnter`/`onExit`).
- **Report:** an action above the threshold is **to-be-enhanced**, never a validation failure.
- **Fix vocabulary (closed):** the five owner options recorded in
  `docs/design/workflow-shell-ownership.md` — (a) public `spur` verb, (b) application service,
  (c) least-privilege built-in action kind, (d) workflow-relative external extension,
  (e) deliberately-stays-shell exception.
- **Threshold status: deliberately unfrozen.** Measured on this tree (2026-08-21, task 0613):

  | Disposition | n | min | median | max |
  | --- | --- | --- | --- | --- |
  | SIMPLE | 7 | 1 | 1 | 2 |
  | GLUE | 36 | 1 | 2 | 19 |
  | EXT | 9 | 4 | 6 | 10 |
  | POLICY | 4 | 2 | 22 | 32 |
  | DUAL | 1 | 43 | 43 | 43 |

  58 state-hook shell programs total (all 58 classified programs join a disposition; the
  transition-guard bulk exception stays outside the measure per the ownership doc's ruling). Flag
  rates: **>3→30, >4→25, >5→21, >6→18, >8→14**. `>5` is the candidate: it flags every
  qualityGateCmd-class compound (POLICY 22–32) and the DUAL program while never touching SIMPLE
  (≤2) — trivial glue is never flagged at ≥3. Task 0614 calibrates against the full dispositions and
  freezes the number; the ADR records it after that.

### 1.2 agent.run measure

- **Trigger:** a **non-slash `input`** on an `agent.run` action reports the action as
  to-be-enhanced (ADR-043 preference made detectable).
- **Severity:** raw prompt length sets the reported severity **only** — it never triggers a report.
- **Fix:** move the operation behind a centralized agent skill or slash command.

### 1.3 Advisory posture (binding)

Composition findings:

1. never change a `workflow validate` exit status;
2. never block a workflow run;
3. are **not** added to `spur-check` / `spur-check-new`.

They surface as advisory output of `workflow validate` (task 0614) and in the taught references
(task 0615).

## 2. Four-surface script placement (ADR-051 R4 amendment)

| Surface | Hosts | Selection condition |
| --- | --- | --- |
| `apps/cli/src/commands` | public `spur` verbs | a Spur **end user** runs it on any Spur-managed project — each addition needs the consent gate |
| `scripts/commands` | internal spur-dev commands | **Spur self-dev only** — packaging/release, building Spur, monorepo gates (one module per command, `bundle-*`-style naming, test sibling) |
| `package.json` scripts | repo-wide developer entrypoints | a **repo developer** invokes it by name (`bun run …`); it composes existing binaries, adds no logic, and its name is the contract |
| `plugins/sp/scripts` | plugin-shipped scripts | the action must run on **agent machines that only have the plugin** — entrypoint contract owned by ADR-065 (`.mjs` twins, declaration in `config/plugin-scripts.json`, no repo-relative paths), cross-referenced, not restated |

Decision procedure for a new script: identify the **audience** (end user / self-dev / repo
developer / plugin-only agent machine); the audience selects the surface; only the first surface
crosses the consent gate.

## 3. Consent record (ADR-051 R5 amendment, feature A3)

Operator consent granted 2026-08-20 for the feature's six public-surface changes:

| Change | Task | Surface shape |
| --- | --- | --- |
| `spur self` noun (aggregates `init`/`migrate`/`serve`/`status` legacy standalone verbs) | 0616 | new public noun |
| `spur builder` noun (`bump-ver`, `drop-tags` promoted from spur-dev) | 0617 | new public noun |
| `--fix` on `spur task check` / `spur feature check` | 0619 | new flag on existing verbs |
| `spur workflow show` (mermaid FSM renderer) | 0620 | new public verb |
| `spur agent doctor` AUTH-column removal | 0621 | observable-output change of existing verb |
| `workflow validate` composition advisory output | 0614 | observable-output change, advisory-only (ADR-069 R3) |

Each landing task cites this record; none re-litigates the gate. The 2026-08-16 amendment precedent
(consent gate covers observable output changes of existing verbs) applies to rows 5–6.

**No-further-promotion rule (0617).** The `spur builder` noun is **frozen at exactly the two
promoted verbs** (`bump-ver`, `drop-tags`) — this consent record is scoped to that pair and to
nothing else. No additional `spur-dev` verb may be promoted onto `builder`, and no further
spur-dev → public-noun promotion of any kind may ride this record. Every future promotion needs
its **own** consent-gate entry (audience + surface + justification) exactly like the rows above;
without one, the command stays internal under `scripts/commands/`.

## 4. Subsequent consent applications

| Date | Task | Public change | Granted scope and reason |
| --- | --- | --- | --- |
| 2026-08-21 | 0625 | `spur feature refresh` adds `--all`; a bare invocation now exits 2 unless `--feature <id>` is supplied | Require an explicit one-feature or all-feature breadth token. The A3 wrap-up's bare refresh rewrote unrelated D3/D5/D6/E5 rosters, so implicit global mutation is no longer an acceptable default. |
| 2026-08-27 | 0695 | `spur workflow show` adds `--format <mermaid\|todo>` (mermaid stays default; `todo` is a declared-step checklist projection) and `--json` (machine envelope for both formats) | Extend the existing read-only `show` verb for feature D7 per the idea-evaluation gate. Rejected shapes recorded at the gate: a boolean `--todo` flag and a separate `spur workflow todo` verb (flag-not-action); no output caching. |
| 2026-08-29 | 0719 | New root-level global option `--no-logo` (feature A31): listed once in top-level help, accepted before or after nested noun/verb tokens; suppresses only the startup ASCII logo. Exact-token `--json`/`--quiet`/`--silent` auto-suppression preserved and made explicit via the `shouldRenderBanner()` composition-root seam | Give scripts and agents an explicit decoration opt-out without forcing machine mode. Observable-output change is limited to the startup banner: no verb signatures, JSON envelopes, exit codes, or command-owned banners change. |

The 2026-08-21 grant changes only refresh breadth selection. It does not change the `## Tasks` marker format,
the deterministic global `INDEX.md` regeneration, or lifecycle status; those shapes are in
`lifecycle-projection-integrity.md`.

## 5. Known follow-ups (none open)

Both 0613 follow-ups closed by task 0614 (2026-08-21): the shell-ownership doc's
`learning-capture:onEnter:1` key is re-keyed to `doc-sync:onEnter:1` with the frozen-rule measure
(7 lines, GLUE), and the threshold is frozen at `>5` in the ADR-069 amendment with the
steady-state record (0 shell findings, 25 suppressed, 8 agent.run findings across all 10
`config/workflows/*.yaml`).
