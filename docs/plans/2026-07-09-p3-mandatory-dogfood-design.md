# P3 Design Options: Mandatory Dogfood for Self-Referential Changes

## Problem

Changes to Spur's own workflow infrastructure (`.spur/workflows/`, `plugins/sp/`, `packages/app/src/services/*workflow*`) are self-referential — they modify the tool the dogfood test uses. Without a mandatory dogfood artifact, these changes can ship untested against the workflow they modify. The 2026-07-09 incident involved changes to `packages/app/src/services/*workflow*` (context.ts workflowService, team-service) with no dogfood.

## Design Options

### Option A: `spur feature check` L4 Finding (recommended)

Add an L4 check in `feature-check.ts`: when a feature's tasks touch self-referential paths, require a `docs/dogfood/` artifact before the feature can be marked `done`.

**Detection:** Scan the feature's task files for references to self-referential paths in their Solution sections:
- `.spur/workflows/*.yaml`
- `plugins/sp/**`
- `packages/app/src/services/*workflow*`
- `packages/app/src/workflow/**`

**Requirement:** At least one file matching `docs/dogfood/<date>-*<feature-id>*.md` must exist. If not, emit an error finding:

> "Feature L touches self-referential paths (workflow infrastructure) but no dogfood artifact exists in `docs/dogfood/`. Run the dogfood workflow and write a report before marking the feature `done`."

**Enforcement:** Error-level finding in `spur feature check`. Feature cannot pass check (and thus cannot transition to `done` via the lifecycle adapter) without the artifact.

**Pros:**
- Feature-level gate — catches the problem at the natural review point.
- Path detection is deterministic (grep task Solution sections for self-referential paths).
- Aligns with existing `docs/dogfood/` convention.
- Doesn't interfere with task-level workflow.

**Cons:**
- Path detection may have false positives (a task that mentions a workflow path in Background but doesn't modify it). Can be mitigated by only scanning Solution sections.
- Doesn't enforce dogfood quality — the artifact could be empty. (But `spur feature check` already validates section presence; a dogfood-specific check could verify minimum content.)
- Feature check is only run when the feature transitions; if the feature is already `active`, a new task added later won't trigger the check until the next `feature check`.

### Option B: Task-Level Gate in `spur task check`

Add the dogfood requirement at the task level: when a task's Solution section references self-referential paths, require a dogfood artifact before the task can be marked `done`.

**Enforcement:** L4 check in `task-check.ts`: if Solution references self-referential paths AND no `docs/dogfood/` file mentions the WBS, emit an error.

**Pros:**
- Catches the problem earlier (per-task, not per-feature).
- More precise — only the tasks that actually touch self-referential paths are gated.

**Cons:**
- Dogfood is inherently a feature-level activity (you dogfood the workflow, not individual tasks). A per-task dogfood artifact is awkward.
- A task might touch a self-referential path as part of a larger feature; the dogfood should cover the feature, not the task.
- More false positives: a task that fixes a typo in a workflow YAML doesn't need a dogfood.

### Option C: Workflow-Run-Based Dogfood (mandatory pipeline run)

Instead of checking for a document, require that a `dogfood-pipeline.yaml` run exists for the feature before `done`. The dogfood pipeline is a special workflow that exercises the changed workflow infrastructure end-to-end.

**Enforcement:** `feature-check.ts` L4: if the feature touches self-referential paths, query `task_run_links` for a `kind='dogfood'` row linked to the feature ID. If none, error.

**Pros:**
- Provenance-based — the dogfood actually ran, not just documented.
- Integrates with the existing `task_run_links` provenance table.
- The dogfood pipeline can be automated (CI).

**Cons:**
- Requires building a `dogfood-pipeline.yaml` workflow (significant effort).
- Not all self-referential changes can be dogfooded via a pipeline (e.g., changes to the pipeline engine itself — you can't use the pipeline to test the pipeline if the pipeline is broken).
- Overkill for small changes.

### Option D: Skill-Level Rule in spur-dev (soft, no code)

Add a rule to the `spur-dev` skill: "If any task in this feature touches `.spur/workflows/`, `plugins/sp/`, or `packages/app/src/services/*workflow*`, write a `docs/dogfood/` artifact before feature `done`."

**Enforcement:** None (the skill is advisory). Relies on the agent following the skill.

**Pros:**
- Zero implementation effort.
- Already partially done (P1 guardrail added to `execution-workflow.md`).

**Cons:**
- The prior incident proves that advisory rules are insufficient — the agent bypassed the pipeline entirely.
- No automated enforcement.

## Recommendation

**Option A** (feature check L4 finding). It's the right level (feature gate, not task gate), uses deterministic detection (path scanning in Solution sections), and aligns with the existing `docs/dogfood/` convention. The error-level finding makes it a hard gate when the lifecycle adapter calls `spur feature check` on the `done` transition.

**Hybrid with Option D:** Keep the skill-level rule (already added as P1 guardrail) as a reminder, and add Option A as the automated enforcement. The skill tells the agent what to do; the feature check enforces it.

## Implementation Sketch (Option A)

```typescript
// feature-check.ts, in runL4 or a new runL4Dogfood method
const SELF_REFERENTIAL_PATTERNS = [
    /\.spur\/workflows\//,
    /plugins\/sp\//,
    /packages\/app\/src\/services\/\w*workflow/,
    /packages\/app\/src\/workflow\//,
];

// Scan all task files linked to this feature for self-referential path references
// in their Solution sections.
const tasksDir = options?.tasksDir ?? join(dirname(featuresDir), 'tasks2');
const linkedTasks = await this.findTasksForFeature(featureId, tasksDir);
const touchesSelfRef = linkedTasks.some(taskFile => {
    const solution = taskFile.doc.getSection('Solution') ?? '';
    return SELF_REFERENTIAL_PATTERNS.some(p => p.test(solution));
});

if (touchesSelfRef) {
    const dogfoodDir = join(dirname(featuresDir), 'dogfood');
    const hasDogfood = await this.fs.exists(dogfoodDir) &&
        (await this.fs.readDir(dogfoodDir)).some(f => f.includes(featureId));
    if (!hasDogfood) {
        findings.push({
            layer: 'L4',
            severity: 'error',
            section: 'Dogfood',
            message: `Feature touches self-referential paths (workflow infrastructure) but no dogfood artifact exists in docs/dogfood/. Write a dogfood report before marking the feature done.`,
        });
    }
}
```

## Open Questions for Operator

1. Should the check be at feature level (Option A) or task level (Option B)?
2. Should the dogfood artifact be required for ALL self-referential changes, or only those touching `packages/app/src/workflow/` (the engine itself)?
3. Should the dogfood artifact have a minimum structure (template), or is any file in `docs/dogfood/` sufficient?
4. Should this be error-level (hard gate) or warning-level (soft gate with `--strict` escalation)?
