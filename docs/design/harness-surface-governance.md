# Harness surface governance

**Area:** the composition measures (shell actions, shell guards, agent.run), their warn and error
tiers and enforcement posture, and the four-surface script placement table with dated
operator-consent applications.
**Status:** authority landed (ADR-069 amendment + promotion, ADR-051 amendment); advisory tooling is
sibling tasks 0614/0615; consent record updated by task 0695 on 2026-08-27. The ADR-115 tiers in §1
are accepted (feature I21; §4 consent of 2026-09-10). The §2 `plugins/sp/scripts` row records the
ADR-065 `repo-only` sub-category of that surface (conflict-audit repair, 2026-09-15).
**Authority:** derived; ADR-069 (composition measures), ADR-115 (composition budgets, enforcement
posture), ADR-051 (surface boundary, consent gate), ADR-065 (plugin-script entrypoint contract,
cross-referenced), ADR-043 (slash-command preference). On conflict, `00_ADR.md` wins (lower number
wins on content, constitution §4.1).

---

## 1. Composition measures (ADR-069 R1–R3, ADR-115)

### 1.1 Measures

- **Unit — logical command (ADR-115):** a `shell` `command` split on newline, `;`, `&&` and `||`,
  skipping blank segments, `#` comments and bare structure tokens (`then`, `else`, `fi`, `do`,
  `done`, `esac`, `{`, `}`, `(`, `)`, `;;`). A pipeline counts once. ADR-069 split on newline and
  `;` only, so `&&` chains hid whole programs.
- **Scope:** every state-hook `shell` action (`onEnter`/`onExit`), every shell transition guard and
  every `agent.run` action of the definition being validated. The ADR-069 guard exemption ends.
- **Fix vocabulary (closed):** the five owner options recorded in
  `docs/design/workflow-shell-ownership.md` — (a) public `spur` verb, (b) application service,
  (c) least-privilege built-in action kind, (d) workflow-relative external extension,
  (e) deliberately-stays-shell exception with a `#` reason. Option (e) applies only inside the
  warn band; above a cap the program moves to (a)–(d).
- **agent.run:** a non-slash `input` is the ADR-043 preference made detectable; the fix moves the
  operation behind a centralized agent skill or slash command.

### 1.2 Tiers

| Element | Clean | Warn (advisory) | Error |
| --- | --- | --- | --- |
| `shell` action | ≤5 logical commands | 6–10 | >10, or `command` >800 chars |
| Shell transition guard | ≤3 | 4–5 | >5 |
| `agent.run` `input` | slash-led, ≤1000 chars | non-slash (severity by raw length: <200 low, ≤1000 medium) | >1000 chars, slash-led or not |
| `agent.run` output check | `expectFile` or `requireDiff` declared | neither declared | — |

Measured 2026-09-10 across the 11 shared definitions:

| Element | n | Warn | Error |
| --- | --- | --- | --- |
| `shell` action | 84 | 17 | 27 (25 by commands, 2 by characters) |
| Shell transition guard | 99 | 12 | 2 |
| `agent.run` input | 22 | 9 non-slash | 3 |
| `agent.run` output check | 22 | 7 | — |

The warn threshold (>5) was calibrated by task 0613 and frozen by task 0614 (2026-08-21).

**Ratchet.** Lowering a number changes this table, the validator constant and the taught reference
(`workflow-fit-and-tuning.md` §3) together. Raising one needs an ADR-115 amendment with measured
evidence, like a `pipeline-budgets` raise.

### 1.3 Posture (ADR-115 amends ADR-069)

1. Warn-level findings never change a `workflow validate` exit status, never block a run and are
   not in `spur-check` / `spur-check-new`.
2. An error-level finding makes `workflow validate` exit 1 and fails the `spur-check`
   shared-workflow composition gate over `config/workflows/*.yaml`. The composition ladder's
   validate gate therefore stops promotion (`spur-artifact-evolution.md` §7).
3. No composition finding blocks `workflow run`, `run --dry-run` or `continue`. Findings are
   computed on the validate path only, so an adopting project's workflows keep running after an
   upgrade and surface their findings the next time they are validated.

Runtime budgets (step duration, idle gaps, cache hits) are not validate findings; `sp:spur-doctor`
judges them from step profiles ([workflow composition](workflow-composition-contract.md#composition-budgets-adr-115)).

## 2. Four-surface script placement (ADR-051 R4 amendment)

| Surface | Hosts | Selection condition |
| --- | --- | --- |
| `apps/cli/src/commands` | public `spur` verbs | a Spur **end user** runs it on any Spur-managed project — each addition needs the consent gate |
| `scripts/commands` | internal spur-dev commands | **Spur self-dev only** — packaging/release, building Spur, monorepo gates (one module per command, `bundle-*`-style naming, test sibling) |
| `package.json` scripts | repo-wide developer entrypoints | a **repo developer** invokes it by name (`bun run …`); it composes existing binaries, adds no logic, and its name is the contract |
| `plugins/sp/scripts` | plugin-shipped scripts and their repo-only gate siblings | the action must run on **agent machines that only have the plugin**, or validates that shipped surface as a repo-only gate — entrypoint contract owned by ADR-065 (`.mjs` twins, declaration in `config/plugin-scripts.json`, no repo-relative paths; `repo-only` entries stay on `bun` and are monorepo/gate-only, [configuration contracts §2.6](configuration-contracts.md#26-plugin-script-contract-manifest--gate-task-0600-adr-065)), cross-referenced, not restated |

Decision procedure for a new script: identify the **audience** (end user / self-dev / repo
developer / plugin-only agent machine / plugin-surface gate); the audience selects the surface; only
the first surface crosses the consent gate.

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
| 2026-09-10 | 0822, 0826 | `spur workflow validate` adds a finding `level` (`warn`/`error`) and the measure kinds `shell-chars`, `guard-lines`, `agent-run-chars` and `agent-run-output`, and exits 1 on any error-level finding; `bun run spur-check` gains the shared-workflow composition gate | Make the ADR-115 caps enforceable at authoring time. Warn stays advisory; an error-level finding fails validate and the gate but never blocks a run. Operator consent 2026-09-10 (feature I21). |
| 2026-09-12 | 0846, 0847 | `spur projects migrate [path]` — new verb under the existing `projects` noun. `--dry-run` (default; previews and writes nothing) previews the conversion; `--apply` converts the single resolving `agent.team.<id>` roster to `.spur/fleet.json` (backup of a differing prior file, then an atomic write); `--json` for both modes. Exit `2` when conflicts block the run | Convert legacy team rosters and generated specs to project fleet declarations with verbatim spec-id preservation (feature G64). End-user audience on any Spur-managed project; no other noun owns config-plus-spec conversion. Rejected shapes recorded at the gate: a top-level `spur migrate` noun (collides with the hidden `self migrate` alias; `spur self migrate` owns SQL schema migrations) and a `spur fleet` noun (0835 already rejected one). Operator consent granted in the G64 runall session. |
| 2026-09-13 | 0848 | `spur agent start <spec-id>` and `spur agent stop <spec-id>` (new verbs); `--assignee <spec-id>` on `spur task update` (new flag); `spur agent list --specs` merges live run status from the server (observable-output change; new `--server <url>` flag on that verb) | Give every `spur team` capability a home under its owning noun before the noun retires (feature G64, R1/R6), so no function is deleted with the command. `agent` owns spec process lifecycle; `task` owns task frontmatter. Rejected shapes recorded at the gate: keeping a `spur team` noun with fewer verbs, and a new `spur fleet` noun (0835 already rejected one). Operator consent granted in the G64 runall session. |
| 2026-09-14 | G64 cutover (dev-idea direct cleanup) | `spur team` noun removed (all six verbs; `team-noun-retired` shim deleted); `spur agent create`, `agent edit` and `agent delete` removed; `spur agent loop` hidden from `--help` and its legacy `--agent <id>` addressing dropped (`--spec <id>` only) | Close the G64 cutover: every team capability already had an owning-noun home (0848), and specs are materialized from the fleet declaration at serve start, so CLI spec authoring was a second, unvalidated write path. `loop` is supervisor-internal (`SupervisorService` spawns it with `--spec`). Operator consent granted in the 2026-09-14 dev-idea evaluation. |
| 2026-09-15 | 0856 | `spur projects migrate [path]` (and its `--dry-run` / `--apply` flags) removed — the 2026-09-12 grant above is superseded; `spur projects migrate` is now an unknown command with no shim or alias | The verb existed only to convert an `agent.team` roster into `.spur/fleet.json`, and G65 retires both carriers: `agent.team` is deleted by 0857 and the fleet is declared under `agent.fleet`. No registered project carries a roster to convert, so the conversion has no subject and a tombstone would be unobservable surface. `spur task migrate` and the hidden `spur self migrate` alias are different verbs and stay. Operator consent granted in the 2026-09-14 G65 idea-eval. |
| 2026-09-17 | 0892 | `spur agent usage` — new verb under the existing `agent` noun. `--dry-run` (prints would-be executor changes; writes nothing), `--source <name>` (default `codexbar`), `--json`. One run-once pass: capture provider usage, record `owner: quota` availability observations, drain them through the single availability writer; an external scheduler (cron/launchd) owns invocation — `spur serve` never runs it (asserted by test) | Refresh executor availability from provider quota data per `session-pinned-dispatch.md` §3.4 (feature B6): one run-once command instead of a serve-side poller, per the no-hidden-automation posture. Rejected shape recorded at the gate: `spur agent doctor --refresh-usage` (doctor is read-only readiness; mutation belongs to an explicit producer verb). Operator consent granted at the B6 design approval, 2026-09-17 (ADR-051). |
| 2026-09-23 | 0930 | `spur workflow trace` adds `--timeout <ms>` (requires `--follow`; positive-integer milliseconds, else `VALIDATION_FAILED`): a non-terminal run at the deadline — including the `Run not found` retry window — stops the follow with one checkpoint line naming run id + last observed status and exits 1; the run is never cancelled or relaunched | Give batch drivers/watchers one caller deadline per watch (`spur workflow trace <run-id> --follow --timeout 600000`), replacing the ambiguous "10 minutes or 20 polls" guidance. Flag on an existing verb reusing `SHARED_OPTIONS.timeout` (prior art: `spur message send --wait`); no new verb, no output-shape change beyond the checkpoint line. Operator consent recorded in the task Q&A 2026-09-22/23 (feature H53). |

The 2026-08-21 grant changes only refresh breadth selection. It does not change the `## Tasks` marker format,
the deterministic global `INDEX.md` regeneration, or lifecycle status; those shapes are in
`lifecycle-projection-integrity.md`.

## 5. Known follow-ups (none open)

Both 0613 follow-ups closed by task 0614 (2026-08-21): the shell-ownership doc's
`learning-capture:onEnter:1` key is re-keyed to `doc-sync:onEnter:1` with the frozen-rule measure
(7 lines, GLUE), and the threshold is frozen at `>5` in the ADR-069 amendment with the
steady-state record (0 shell findings, 25 suppressed, 8 agent.run findings across all 10
`config/workflows/*.yaml`).
