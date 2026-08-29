---
schema_version: 1
name: "Synchronize expert-spur and spur-cli with the complete CLI surface"
status: done
template: standard
created_at: 2026-08-29T16:09:54.274Z
updated_at: "2026-08-29T16:30:22.836Z"
feature_id: I
ac_altitude: task-local
---

## 0715. Synchronize expert-spur and spur-cli with the complete CLI surface

### Background
Recent source-level CLI changes outpaced the `sp:spur-cli` facade. The skill still excludes implemented `history` and `projects` nouns, while the `expert-spur` wrapper overstates its noun scope and duplicates workflow competency logic. This leaves agentic routing incomplete despite the live-surface parity gate passing by treating mature nouns as exclusions.
### Requirements
- [x] R1. Derive the visible noun, verb, key-flag, JSON, and exit-status contracts from the source-local CLI registrations, handlers, tests, and authoritative design docs.
- [x] R2. Make `plugins/sp/skills/spur-cli` route every visible real noun to a source-grounded reference; keep only Commander-generated `help` excluded.
- [x] R3. Correct stale or incomplete existing noun references discovered by the source audit without duplicating implementation-owned schemas.
- [x] R4. Keep `plugins/sp/agents/expert-spur.md` a thin wrapper for multi-step corpus work and remove claims or procedures that belong to the facade/backend skill.
- [x] R5. Strengthen parity/structure checks so omitted mature nouns and verb drift fail deterministically.
- [x] R6. Validate the agent and skill with Superskill plus focused Spur tests and project gates.
### Acceptance Criteria
- [x] Given the source-local root help, the facade noun inventory contains all 11 visible nouns and no generated `help` noun.
- [x] Given every routed noun, its reference verb inventory matches the source-local `<noun> --help` output bidirectionally and documented key flags exist.
- [x] `history` and `projects` references document current implemented behavior, machine-readable output, and material failure semantics from source/tests.
- [x] Existing references cover all current verbs, including recent task/workflow/agent additions.
- [x] `expert-spur.md` is scoped to multi-step task/feature/rule/workflow corpus work and delegates CLI semantics to `sp:spur-cli` without duplicating workflow authoring logic.
- [x] Focused parity, structure, Superskill validation, lint/typecheck, and relevant project gates pass.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
Treat Commander registration plus handler/service tests as implementation authority. Promote `history` and `projects` into Tier B references, retain `help` as the sole Tier C exclusion, and extend the existing table-driven parity gate rather than adding a second catalog. Keep the facade as a progressive-disclosure index; detailed flags/output live in noun references. Reduce `expert-spur` to routing, sequencing, mutation, and verification responsibilities for the four corpus nouns.
### Plan
1. Capture the source-local root, noun, and verb surfaces and compare them with every existing facade reference.
2. Inspect handlers/tests for semantics not visible in Commander help, prioritizing recent changes and omitted nouns.
3. Patch the facade, noun references, thin agent wrapper, and parity tests.
4. Run focused tests, Superskill lifecycle validation/evaluation, and repository gates; record evidence.
### Solution
- Expanded the facade to route all 11 visible source nouns. Commander-generated `help` is the sole exclusion; JSON capability is documented as per-verb rather than universal.
- Added source-grounded history and projects references covering verbs, material flags, payload ownership, behavior, and exit semantics.
- Synchronized recent agent, task, and workflow additions, and corrected overbroad JSON claims in agent/message/team references.
- Reduced `plugins/sp/agents/expert-spur.md:20` to a thin task/feature/rule/workflow corpus sequencer over `sp:spur-cli`; removed duplicated workflow runbook and circular skill-to-agent routing.
- Extended CLI-surface parity tests so `history` and `projects` are first-class routed nouns and only generated `help` may be excluded.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Source registrations and handlers were audited against noun help, service types, design contracts, and parity tests; the facade records the authority boundary. |
| R2 | MET | The facade routes task, feature, rule, workflow, builder, agent, message, team, self, history, and projects; only generated help is excluded. |
| R3 | MET | Existing agent/message/team/task/workflow references now cover the current verbs and advertise JSON only where implemented. |
| R4 | MET | The expert agent is a thin corpus sequencer and delegates CLI semantics to `sp:spur-cli`. |
| R5 | MET | Live parity maps include history/projects and assert that help is the only excluded generated noun. |
| R6 | MET | Superskill validation passed; focused tests and full `bun run spur-check` passed with 6,744 tests and zero failures. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC-1 — all 11 visible nouns | MET | test | Plugin live-surface parity passed and derives the root noun inventory from the source-local CLI. |
| AC-2 — bidirectional noun verb and key-flag parity | MET | test | `plugins/sp` parity/structure suites passed 89 tests and the helper suite passed 17 tests. |
| AC-3 — history and projects source contracts | MET | test | New noun references are included in the live parity layout; their full verb and key-flag inventories passed. |
| AC-4 — recent additions covered | MET | test | CLI parity plus JSON-envelope inventory passed 16 tests, including the recent agent/task/workflow floors. |
| AC-5 — thin expert wrapper | MET | command | Superskill agent validation passed and evaluation improved to aggregate 0.98, Grade A. |
| AC-6 — project gates | MET | command | `bun run spur-check` passed lint, typecheck, rules, 6,744 tests, and coverage gates. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Verdict:** PASS for the scoped source-to-agent synchronization.

- Functional traceability: all six requirements and acceptance checks are met by source-grounded references and live parity tests.
- Architecture: `sp:spur-cli` owns CLI semantics; `expert-spur` only sequences multi-step corpus operations; `sp:spur-dev` retains lifecycle ownership.
- Residual repository gate: the corpus-wide sweep reports no new errors but remains non-zero on warning-baseline drift outside 0715. The only 0715 warning was removed by linking the maintenance task to the active feature I umbrella.

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | scope | changed files | No P1–P3 findings in the scoped documentation and parity-test change. |
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-08-29T16:10:42.957Z backlog → todo (system)
- 2026-08-29T16:10:43.378Z todo → wip (system)
- 2026-08-29T16:28:51.242Z wip → testing (system)
- 2026-08-29T16:30:22.836Z testing → done (system)
