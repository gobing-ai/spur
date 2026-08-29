---
doc: design/environment-improvement-lens
feature_id: I9
owns: SURFACE — plugin-level environment-improvement mapping and its two report projections
authority: derived (ADR wins on conflict)
updated_at: 2026-08-29
---

# Environment-improvement lens

**Area:** `plugins/sp/references/environment-lens.md` mapping SSOT; `sp:dogfood-testing` report §6; `sp:history-anatomy` report section 9.
**Status:** built (ADR-084/085; feature I9).
**Authority:** decisions in `00` (ADR-084 ownership, ADR-085 present-don't-apply); mechanism in `03 §22`; this satellite owns shapes. History-anatomy report/cache contracts remain [`history-anatomy.md`](history-anatomy.md). Dogfood protocol remains `sp:dogfood-testing@1.2` in `plugins/sp/skills/dogfood-testing/references/report-template.md`.

Baseline: `docs/plans/2026-08-26-retro-skills-brainstorm.md` (Approach 1).

## Operator surface

No command, flag, or CLI noun is created by this mapping. ADR-089's `/sp:dev-review-session` is a
separate active-context review surface and consumes only the placement rule.

```text
/sp:dev-dogfood <testee> [...]     # §6 findings may carry an optional class tag
/sp:dev-find-issue [...]           # section 9 candidates may carry a retro signal
```

`Skill(skill="sp:issue-finding")` stays the legacy coexistence path and is out of edit scope.

## Ownership

| Path | Owns | Does not own |
| --- | --- | --- |
| `plugins/sp/references/environment-lens.md` (new) | Seven retro categories, placement rule, present-don't-apply, keep/drop list, category→projection table | Report section grammar, validators, SKILL.md bodies |
| `plugins/sp/skills/dogfood-testing/references/report-template.md` §6 | Optional `environment` / `testee` / `waste` class tag; skill/command checklist; fix-mode exclusion for environment tags | Category table (points at the mapping) |
| `plugins/sp/skills/history-anatomy/references/report-contract.md` §9 | Signal grammar under closed categories; structure-gate reject of retro-as-category | Category table (points at the mapping) |
| `plugins/sp/skills/issue-finding/` | Unchanged | Lens, new categories, new flags |
| `plugins/sp/skills/session-review/` | Applies the placement rule to supported live-session proposals | Category table or history-anatomy projection |
| `vendors/misc/retro/SKILL.md` | Inspiration only | Runtime invocation |

## Mapping SSOT

Exactly one file under `plugins/sp/references/` enumerates these seven names, verbatim:

| Retro category | History-anatomy `category` (closed) | History-anatomy `<signal>` | Dogfood class |
| --- | --- | --- | --- |
| navigation | `workflow` | `navigation` | `environment` (P3–P2) |
| automated checks | `reliability` | `automated-checks` | `environment`; action is a gate, not prose |
| coding standards | `workflow` | `coding-standards` | `environment`; owner surface is review, never implementer |
| AGENTS.md placement | `workflow` | `agents-md-placement` | `environment`; action = move to skill/reference/check |
| tool economy | `performance` | `tool-economy` | existing cache-health P3; `environment` when the tool itself is the waste |
| no-ops | `workflow` | `no-ops` | `environment`; `file:line` of the dead instruction |
| information access | `telemetry` | `information-access` | existing chained-step `~unknown` P3; `environment` when access is missing |

Neither projection restates those seven names with different wording. Each projection names the mapping file as the category table.

**Placement rule** (in the mapping file, not copied into either `SKILL.md`):

1. Automatable → propose a check (`spur-check`, biome, tests, script-contract, filesystem linter).
2. Coding standard → owner surface is `sp:code-verification`, `sp:code-review`, or pipeline review.
3. Always-loaded file (`AGENTS.md` / `CLAUDE.md`) → navigation pointer only.

## Dogfood projection (`report-template.md` §6)

Protocol stays `sp:dogfood-testing@1.2`. `validate-report` does not gain required fields.

Optional class tag, closed set: `environment` | `testee` | `waste`. Finding line:

```text
- **<P>** — [<class>] <what's wrong>. → **Action:** <concrete change>.  (`file:line`, ~effort)  `[<feasibility>]`
```

- `<class>` is omitted on existing reports and on findings that do not use the lens.
- Class brackets sit immediately after the em-dash. Feasibility tags (`[feasible]` / `[stale]` / `[unverifiable]`) stay at end-of-line. The two bracket positions are distinct.
- Untagged findings remain valid. Cache-health P3 (aggregate cache% < 50) does not require a class tag.
- When the testee classification is `slash-command` or `agent-skill`, the driver may scan the seven mapping categories; it is not required to emit a row per category.

**Classification**

| Observation | Class | Owner surface |
| --- | --- | --- |
| Navigation delay; hidden file dependency | `environment` | AGENTS.md / skill `see_also` / indexed-context anatomy |
| Dead always-loaded instruction | `environment` | `file:line` of the instruction |
| Missed coding standard | `environment` | review path — never the implementer skill |
| Session mistake a linter/typechecker/test could have caught | `environment` | the check, not a new AGENTS.md sentence |
| Testee contract bug | `testee` (or untagged) | the testee |
| Token/tool waste that is not a missing environment affordance | `waste` or untagged cache-health P3 | existing cost/cache findings |

When the testee is a skill or command, a defect in **that testee's contract** (the protocol the run is grading) is `testee` and may be repaired in fix-mode. The same file tagged `environment` (always-loaded steering, placement, a check that should exist, a review-path standard) is a proposal only. Class, not path, decides mutation.

`validate-report` (`plugins/sp/scripts/dogfood-testing/validate-report.ts`) checks headings, protocol string, footer, Issues subheads, and ledger cardinality. It does not parse §6 bullets. A class tag cannot fail `@1.2`; the validator gains no required fields.

**Fix-mode (ADR-085).** Environment-tagged findings are recommended actions in §6 only. Bounded retries do not `Edit` or `Write` `AGENTS.md`, `CLAUDE.md`, skills, rules, numbered docs, or plugin references for those findings. Step-failure fixes against a `testee`-class finding are unchanged. `--task` remains an opt-in sink and may copy an environment finding into a review task; it does not apply the change.

Dogfood `SKILL.md` is BODY_BUDGET-baselined at 37,452 bytes (live 37,435). Lens rules go in `report-template.md`, already linked from that skill. Do not grow the SKILL.md body.

## History-anatomy projection (`report-contract.md`)

Closed vocabulary unchanged: `reliability | repetition | workflow | performance | coverage | telemetry | positive`.

Stable key remains `<category>:<owner-surface>:<signal>`. Retro names occupy `<signal>` (table above) or a stable owner-surface slug. They never occupy `<category>`.

**Three homes** (do not collapse):

| Home | I9 shape |
| --- | --- |
| Section 4 Findings | Keyed findings use a closed `category`. Retro name is `<signal>` (preferred) or owner-surface. Full existing field set unchanged. |
| Section 9 Workflow and process improvements | I9 projection. Each **projected** candidate names owner surface, expected impact, verification method, and reversibility (same four names as section 7), and may cite a section-4 `key`. Unprojected numbered prose stays valid and gains no required fields. |
| Section 7 Remediation options | Existing proposal table. I9 does not add a second mutation source; auto-written corpus tasks stay forbidden (0680 R4). |

Examples (section 4 `key`):

```text
workflow:agents-md:navigation
reliability:spur-check:automated-checks
workflow:code-verification:coding-standards
workflow:agents-md:agents-md-placement
performance:mcp:tool-economy
workflow:skill-md:no-ops
telemetry:logs:information-access
```

Section 9 projected-candidate line (additive; existing numbered prose without these fields remains valid):

```text
- `workflow:agents-md:navigation` — **owner surface:** `AGENTS.md` see_also. **expected impact:** shorter file hunt. **verification method:** subsequent daily report key `resolved` or absent. **reversibility:** revert the pointer.
```

The report contains no applied change, no diff, and no command it claims to have run.

**Structure gate.** `checkReportStructure` (`plugins/sp/scripts/history-anatomy-cache.ts`) matches pipe-rows whose first segment is already in the closed vocabulary, then scans Findings bullet blocks for `key` + triage fields. A retro-as-category key currently misses the pipe-row regex and does not fail. Extend the gate so a finding whose `category` or key first segment is a retro name fails:

```text
navigation | automated-checks | coding-standards | agents-md-placement | tool-economy | no-ops | information-access
```

plus the spaced display names (`automated checks`, `coding standards`, `AGENTS.md placement`, `tool economy`, `information access`). Retro names in `<signal>` or owner-surface must pass. Fixtures that use only the closed vocabulary still pass; a retro signal is not required.

History-anatomy `SKILL.md` stays a dispatcher under 20,000 bytes and does not copy the seven category names.

## BODY_BUDGET and non-targets

| File | Constraint |
| --- | --- |
| `plugins/sp/skills/dogfood-testing/SKILL.md` | ≤ 37,452 bytes; no net growth |
| `plugins/sp/skills/issue-finding/SKILL.md` | ≤ 27,060 bytes; no edit |
| `plugins/sp/skills/history-anatomy/SKILL.md` | dispatcher; < 20,000 bytes; no seven-name table |
| `plugins/sp/references/environment-lens.md` | new; not a SKILL.md; not BODY_BUDGET-gated |

## Verification shapes

Structural tests (plugin suite) must prove:

1. Exactly one `plugins/sp/references/` file enumerates the seven names and the placement rule.
2. `report-template.md` and `report-contract.md` name that file and do not redefine the seven names.
3. A dogfood report with an `environment` / `testee` / `waste` tagged §6 finding is accepted by `validate-report` at protocol `sp:dogfood-testing@1.2`.
4. An untagged @1.2 report, including cache-health P3, remains accepted.
5. A history-anatomy fixture using only closed categories passes the structure gate, including a section 9 that is numbered prose without I9 proposal fields.
6. A history-anatomy finding whose `category` or key first segment is a retro name fails the structure gate; the same retro name in `<signal>` passes.
7. `dogfood-testing` and `issue-finding` SKILL.md byte sizes do not exceed their BODY_BUDGET baselines.

## Out of this satellite

- `writing-for-agents` dependency; `CODING_STANDARDS.md`; installing `vendors/misc/retro`.
- `/sp:dev-retro`; any `spur` CLI noun/verb/flag. ADR-089's active-session reviewer is specified in
  `docs/design/session-review.md`, not by this mapping.
- Unfreezing history-anatomy categories; restoring raw JSONL as a primary evidence plane.
- Auto-creating tasks from environment findings (`--task` / `--create-task` stay existing opt-in sinks).
- Folding the lens into wrap-up learnings or `.spur/context/` memory.
- Raising BODY_BUDGET baselines.
