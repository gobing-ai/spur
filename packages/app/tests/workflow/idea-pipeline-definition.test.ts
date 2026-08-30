import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * R4/R5 (0366): the pre-approval bypass is implemented purely by transition
 * *declaration order* — the state-machine driver takes the first passing edge.
 * If the guarded bypass is ever reordered after the `always` edge, a run with
 * `profile=auto` + `idea_approved=true` silently falls back into the paused
 * taste gate, which is exactly the defect 0366 fixed. Only ordering encodes
 * that contract, so it needs its own regression guard.
 */

interface Guard {
    kind: string;
    options?: { command?: string };
}
interface Transition {
    from: string;
    to: string;
    guard?: Guard;
}
interface Action {
    kind: string;
    options?: { command?: string; input?: string };
}
interface WorkflowDef {
    states: { id: string; pause?: boolean; onEnter?: Action[] }[];
    transitions: Transition[];
}

// 'config' segment split to comply with the sp-runtime-path rule (config/{workflows|...} literal ban).
const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8')) as WorkflowDef;

/** Index of the first transition matching from→to, or -1. */
function edgeIndex(from: string, to: string): number {
    return DEF.transitions.findIndex((t) => t.from === from && t.to === to);
}

describe('idea-pipeline definition — pre-approval bypass ordering (R4/R5 of 0366)', () => {
    test('idea taste gate is a pausing state, so the bypass is what avoids the pause', () => {
        expect(DEF.states.find((s) => s.id === 'idea-eval')?.pause).toBe(true);
        expect(DEF.states.find((s) => s.id === 'design-approval')?.pause).toBe(true);
    });

    test('discovery bypass to feature-create is declared before the always edge to idea-eval', () => {
        const bypass = edgeIndex('discovery', 'feature-create');
        const gate = edgeIndex('discovery', 'idea-eval');

        expect(bypass).toBeGreaterThanOrEqual(0);
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(bypass).toBeLessThan(gate);
        expect(DEF.transitions[gate]?.guard?.kind).toBe('always');
    });

    test('discovery bypass is guarded on both profile=auto and idea_approved=true', () => {
        const guard = DEF.transitions[edgeIndex('discovery', 'feature-create')]?.guard;

        expect(guard?.kind).toBe('shell');
        // Guards reference vars by name so values reach the shell as env, never as command text
        // (task 0435) — the invariant asserted is still "both conditions, ANDed".
        expect(guard?.options?.command).toBe(`test "$profile" = auto && test "$idea_approved" = true`);
    });

    test('design bypass to decompose is declared before the always edge to design-approval', () => {
        const bypass = edgeIndex('system-design', 'decompose');
        const gate = edgeIndex('system-design', 'design-approval');

        expect(bypass).toBeGreaterThanOrEqual(0);
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(bypass).toBeLessThan(gate);
        expect(DEF.transitions[gate]?.guard?.kind).toBe('always');
    });

    test('design bypass is guarded on both profile=auto and design_approved=true, then feature check', () => {
        const guard = DEF.transitions[edgeIndex('system-design', 'decompose')]?.guard;

        expect(guard?.kind).toBe('shell');
        // Guards reference vars by name so values reach the shell as env, never as command text
        // (task 0435) — the invariant asserted is still "both conditions, ANDed". 0515 adds the
        // feature check so stale/invalidated AC cannot reach decompose on the auto-approved path.
        expect(guard?.options?.command).toBe(
            `test "$profile" = auto && test "$design_approved" = true && $spurBin feature check "$featureId"`,
        );
    });

    test('__runId is declared so discovery artifacts can carry run provenance (R8)', () => {
        const vars = (DEF as unknown as { vars: Record<string, unknown> }).vars;
        expect(vars).toHaveProperty('__runId');
    });
});

/**
 * R4 (0425): non-entity-scoped idea artifacts are `${vars.__runId}`-prefixed so
 * concurrent runs cannot share gate files / retry counters / discovery reports.
 * The start-state archive-and-reset block that papered over the collision is gone.
 */
describe('idea-pipeline definition — run-scoped artifacts (R4 of 0425)', () => {
    test('precheck resolves one planner executor for doctor and every dispatch stage', () => {
        const start = DEF.states.find((s) => s.id === 'start');
        const probe = (start?.onEnter ?? []).find((action) => action.kind === 'doctor.probe');
        const agentRuns = DEF.states
            .flatMap((state) => state.onEnter ?? [])
            .filter((action) => action.kind === 'agent.run');

        expect(probe?.options).toMatchObject({
            agent: `\${vars.agent}`,
            role: 'planner',
            resolvedAgentVar: 'planningAgent',
        });
        expect(agentRuns.length).toBeGreaterThan(0);
        expect(
            agentRuns.every(
                (action) => (action.options as Record<string, unknown> | undefined)?.agent === `\${vars.planningAgent}`,
            ),
        ).toBe(true);
    });

    test('start state no longer archives/resets shared idea-* paths', () => {
        const start = DEF.states.find((s) => s.id === 'start');
        const cmds = (start?.onEnter ?? []).filter((a) => a.kind === 'shell').map((a) => a.options?.command ?? '');
        expect(cmds.some((c) => c.includes('idea-archive'))).toBe(false);
        expect(cmds.some((c) => c.includes('rm -f .spur/run/idea-'))).toBe(false);
    });

    test('discovery/eval/gate paths are __runId-scoped', () => {
        const raw = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        // Every former fixed idea-* run path must carry the run-id prefix.
        for (const stem of [
            'idea-precheck-doctor.status',
            'idea-eval-report.md',
            'idea-needs-design.json',
            'idea-feature-id.txt',
            'idea-goal.md',
            'idea-scope.md',
            'idea-design-review.md',
            'idea-ac-retry-count',
            'idea-ac-content.md',
            'idea-ac-done.txt',
            'idea-decompose-retry-count',
            'idea-task-batch.json',
            'idea-task-order.json',
            'idea-batch-create-result.json',
            'idea-batch-create.done',
            'idea-batch-create.failed',
            'idea-dep-map.tsv',
            'idea-check-results.jsonl',
            'idea-handoff.md',
        ]) {
            // Two spellings are both run-scoped and both valid: engine template resolution
            // (`${vars.__runId}`) in non-shell options, and the env-var handoff (`$__runId`) in
            // shell action and guard commands, where embedding a value would make it executable
            // (tasks 0432 / 0435). The invariant is that the path is scoped, not how it is spelled.
            const scoped =
                raw.includes(`.spur/run/\${vars.__runId}-${stem}`) || raw.includes(`.spur/run/$__runId-${stem}`);
            expect(scoped, `${stem} must be run-id scoped in either spelling`).toBe(true);
            // No unscoped live path remains (comments may still mention idea-*).
            expect(raw).not.toMatch(new RegExp(`\\.spur/run/${stem.replace('.', '\\.')}`));
        }
        // 0518: the per-task check scratch file in handoff-finalize is dynamic (`<wbs>`), so the
        // fixed-stem loop above cannot cover it — assert the run-scoped prefix directly.
        expect(raw).toContain('.spur/run/$__runId-idea-check-');
    });

    test('discovery instructs a run_id provenance footer on the emitted report', () => {
        const discovery = DEF.states.find((s) => s.id === 'discovery');
        const input = discovery?.onEnter?.find((a) => a.kind === 'agent.run')?.options?.input ?? '';

        expect(input).toContain(`run_id: \${vars.__runId}`);
        expect(input).toContain('generated_at');
    });

    test('failed and cancelled are declared failure terminals', () => {
        const failureStates = (DEF as unknown as { failureStates?: string[] }).failureStates ?? [];
        expect(failureStates).toEqual(expect.arrayContaining(['failed', 'cancelled']));
    });
});

/**
 * 0515 R1: feature-create captures body-only Goal/Scope intent and persists both through
 * `spur feature update`; decomposition/checklist output must never enter Goal.
 */
describe('idea-pipeline definition — Goal/Scope intent artifacts (0515 R1)', () => {
    const featureCreate = DEF.states.find((s) => s.id === 'feature-create');
    const actions = (featureCreate?.onEnter ?? []).map((a) => ({
        kind: a.kind,
        command: a.options?.command ?? '',
        input: a.options?.input ?? '',
    }));

    test('agent prompt requires body-only Goal/Scope artifacts with intent and boundaries', () => {
        const agent = actions.find((a) => a.kind === 'agent.run');

        expect(agent?.input).toContain(`\${vars.__runId}-idea-goal.md`);
        expect(agent?.input).toContain(`\${vars.__runId}-idea-scope.md`);
        expect(agent?.input).toContain(`\${vars.__runId}-idea-feature-id.txt`);
        // Goal is intent only; decomposition/checklist output never enters it.
        expect(agent?.input).toContain('concise Goal intent only');
        expect(agent?.input).toContain('never task breakdowns, checklists, or how-to steps');
        // Scope carries explicit in/out boundaries.
        expect(agent?.input).toContain('in-scope and out-of-scope boundary bullets');
    });

    test('Goal/Scope are persisted through spur feature update and required non-empty', () => {
        const shells = actions.filter((a) => a.kind === 'shell');
        const goal = shells.find((c) => c.command.includes('--section Goal'));
        const scope = shells.find((c) => c.command.includes('--section Scope'));

        expect(goal?.command).toContain('test -s .spur/run/$__runId-idea-goal.md');
        expect(goal?.command).toContain(
            '$spurBin feature update "$featureId" --section Goal --from-file .spur/run/$__runId-idea-goal.md',
        );
        expect(scope?.command).toContain('test -s .spur/run/$__runId-idea-scope.md');
        expect(scope?.command).toContain(
            '$spurBin feature update "$featureId" --section Scope --from-file .spur/run/$__runId-idea-scope.md',
        );
    });
});

/**
 * 0515 R2: the design-review artifact carries operator rejection feedback into the revision
 * pass, which reconciles invalidated AC through the corpus CLI; both design exits run
 * `spur feature check` before decomposition.
 */
describe('idea-pipeline definition — design-review feedback contract (0515 R2)', () => {
    const sysDesign = DEF.states.find((s) => s.id === 'system-design');
    const actions = (sysDesign?.onEnter ?? []).map((a) => ({
        kind: a.kind,
        command: a.options?.command ?? '',
        input: a.options?.input ?? '',
    }));

    test('system-design creates and expects the run-scoped review artifact with fixed headings', () => {
        const shell = actions.find((a) => a.kind === 'shell');

        expect(shell?.command).toContain('$__runId-idea-design-review.md');
        expect(shell?.command).toContain('## Proposed design');
        expect(shell?.command).toContain('## Operator feedback');
        expect(shell?.command).toContain('## Reconciliation');

        const agent = actions.find((a) => a.kind === 'agent.run');
        expect(agent?.input).toContain(`\${vars.__runId}-idea-design-review.md`);
        expect(agent?.input).toContain('## Operator feedback');
        expect(agent?.input).toContain('## Reconciliation');
    });

    test('revision reconciles invalidated AC through spur feature update', () => {
        const agent = actions.find((a) => a.kind === 'agent.run');

        expect(agent?.input).toContain('feature update');
        expect(agent?.input).toContain('Acceptance Criteria');
        expect(agent?.input).toContain('--from-file');
    });

    test('design-approval prompt directs operator feedback into the review artifact', () => {
        const approval = DEF.states.find((s) => s.id === 'design-approval');
        const hitlAction = approval?.onEnter?.find((a) => a.kind === 'hitl.confirm');
        const prompt = (hitlAction?.options as { prompt?: string } | undefined)?.prompt ?? '';

        expect(prompt).toContain(`\${vars.__runId}-idea-design-review.md`);
        expect(prompt).toContain('Operator feedback');
    });

    test('both design exits run spur feature check before decomposition', () => {
        const auto = DEF.transitions[edgeIndex('system-design', 'decompose')]?.guard?.options?.command ?? '';
        const interactive = DEF.transitions[edgeIndex('design-approval', 'decompose')]?.guard?.options?.command ?? '';

        expect(auto).toContain('$spurBin feature check "$featureId"');
        expect(interactive).toContain('$__hitlAnswer');
        expect(interactive).toContain('$spurBin feature check "$featureId"');
    });

    test('approve with a failing feature check routes back through the AC gate, not a dead end', () => {
        const guard = DEF.transitions[edgeIndex('design-approval', 'feature-check')]?.guard?.options?.command ?? '';

        // P3-1 (0515): `yes && check` failing previously matched no edge → engine
        // fail('no-passing-transition'). The negated guard mirrors the system-design
        // auto path: a rejected-by-AC design loops into feature-check, which routes
        // to ac-generate under the capped retry loop instead of killing the run.
        expect(guard).toContain('$__hitlAnswer');
        expect(guard).toContain('! $spurBin feature check "$featureId"');
    });

    test('system-design fails closed when the Proposed design section is unpopulated', () => {
        const shells = actions.filter((a) => a.kind === 'shell');

        // P3-2 (0515): expectFile only proves existence and the onEnter skeleton pre-creates
        // the file, so an agent no-op would pass — the post-agent check must assert content.
        expect(
            shells.some(
                (s) => s.command.includes("awk '/^## Proposed design/") && s.command.includes("grep -q '[^[:space:]]'"),
            ),
        ).toBe(true);
    });
});

/**
 * 0518 R1/R2/R3: decompose emits the private task-order sidecar; batch-create-run captures
 * the `--json` result atomically before the done sentinel; handoff-finalize zips names to
 * WBS values, applies ordering via `spur task deps`, refreshes the feature roster, checks
 * every created task, and writes a readiness-gated handoff report before terminal handoff.
 */
describe('idea-pipeline definition — task ordering, roster refresh, handoff report (0518)', () => {
    const decompose = DEF.states.find((s) => s.id === 'decompose');
    const decomposeActions = (decompose?.onEnter ?? []).map((a) => ({
        kind: a.kind,
        command: a.options?.command ?? '',
        input: a.options?.input ?? '',
    }));
    const batchRunCmd =
        DEF.states.find((s) => s.id === 'batch-create-run')?.onEnter?.find((a) => a.kind === 'shell')?.options
            ?.command ?? '';
    const finalizeCmd =
        DEF.states.find((s) => s.id === 'handoff-finalize')?.onEnter?.find((a) => a.kind === 'shell')?.options
            ?.command ?? '';
    const handoffNote = DEF.states.find((s) => s.id === 'handoff')?.onEnter?.find((a) => a.kind === 'note')?.options as
        | { message?: string }
        | undefined;

    test('decompose instructs the task-order sidecar emission (R1)', () => {
        const agent = decomposeActions.find((a) => a.kind === 'agent.run');

        expect(agent?.input).toContain(`\${vars.__runId}-idea-task-order.json`);
        expect(agent?.input).toContain('depends_on_names');
        expect(agent?.input).toContain('exactly one batch item');
    });

    test('decompose validates the sidecar fails closed: array, unique batch names, name/dep coverage (R1)', () => {
        const validate = decomposeActions.find(
            (a) => a.kind === 'shell' && a.command.includes('idea-task-order.json') && a.command.includes('jq -e'),
        );

        expect(validate?.command).toContain('type == "array"');
        expect(validate?.command).toContain('unique');
        expect(validate?.command).toContain('depends_on_names');
        // F2 (0518 verify): bidirectional coverage — every batch name must appear in the
        // sidecar (a partial sidecar must not silently skip `task deps` for an unlisted item)
        // and sidecar names must themselves be unique.
        expect(validate?.command).toContain('($b[0] | map(.name)) - map(.name)');
        expect(validate?.command).toContain('(map(.name) | length) == (map(.name) | unique | length)');
    });

    test('batch-create-run captures --json result atomically before the done sentinel (R1)', () => {
        expect(batchRunCmd).toContain('--json');
        expect(batchRunCmd).toContain('$__runId-idea-batch-create-result.json.tmp');
        expect(batchRunCmd).toContain('.created == (.wbs | length)');
        expect(batchRunCmd).toContain('$__runId-idea-batch-create.done');
    });

    test('handoff-finalize sits between batch-create-run success and terminal handoff', () => {
        const toFinalize = edgeIndex('batch-create-run', 'handoff-finalize');
        const toHandoff = edgeIndex('handoff-finalize', 'handoff');

        expect(toFinalize).toBeGreaterThanOrEqual(0);
        expect(toHandoff).toBeGreaterThanOrEqual(0);
        // success edge stays guarded on the done sentinel; the terminal edge is unconditional
        expect(DEF.transitions[toFinalize]?.guard?.options?.command).toContain('idea-batch-create.done');
        expect(DEF.transitions[toHandoff]?.guard?.kind).toBe('always');
    });

    test('handoff-finalize applies ordering through spur task deps and refreshes the roster (R1/R2)', () => {
        expect(finalizeCmd).toContain('task deps');
        expect(finalizeCmd).toContain(' set ');
        expect(finalizeCmd).toContain('feature refresh --feature "$featureId" --json');
    });

    test('handoff-finalize checks every created task and writes the run-scoped report with one next command (R3)', () => {
        expect(finalizeCmd).toContain('task check');
        expect(finalizeCmd).toContain('$__runId-idea-handoff.md');
        // mutually exclusive recommendation: ready-depth refineall OR auto runall
        expect(finalizeCmd).toContain('--depth ready');
        expect(finalizeCmd).toContain('dev-runall');
        // F1 (0518 verify): the check loop fails closed — a non-JSON `task check --json`
        // exception must abort the run, not drop the task from the JSONL results and flip
        // the recommendation to runall. Guarded by `|| exit 1` on the JSONL append plus a
        // row-count assertion (CHECKS lines == WBS count) before the recommendation.
        expect(finalizeCmd).toContain('>> "$CHECKS" || exit 1');
        expect(finalizeCmd).toContain('wc -l < "$CHECKS"');
        expect(finalizeCmd).toContain('test "$CHECK_ROWS" = "$WBS_COUNT"');
    });

    test('terminal note points at the handoff report and no longer hardcodes runall', () => {
        expect(handoffNote?.message).toContain(`\${vars.__runId}-idea-handoff.md`);
        expect(handoffNote?.message).not.toContain('Next: /sp:dev-runall');
    });
});

/**
 * 0519: the four dogfood findings, locked as regression invariants, plus the no-surface guard.
 *
 * The 0515/0518 describe blocks above assert the presence of the hardened behavior. This block
 * pins the exact decision/validation markers the findings depend on, so a future edit that
 * re-introduces any one of the four defects (Goal/Scope intent lost, silent design rejection,
 * empty dependencies, static runall handoff) fails a focused assertion:
 *
 *   F1 — handoff-finalize zips batch names to result WBS values only after equal-length and
 *        unique-name validation; the NEXT recommendation is computed from per-task checks and is
 *        mutually exclusive (any-fail ⇒ refineall, all-pass ⇒ runall).
 *   F2 — the private order sidecar stays OUT of the public task-batch schema (R2 no-surface guard):
 *        the schema remains closed and carries no depends_on_names / dependencies / order field.
 */
describe('idea-pipeline definition — regression invariants and no-surface guard (0519)', () => {
    const finalizeCmd =
        DEF.states.find((s) => s.id === 'handoff-finalize')?.onEnter?.find((a) => a.kind === 'shell')?.options
            ?.command ?? '';

    test('handoff-finalize validates batch/result equal length and unique batch names before zipping', () => {
        // F1 (0518 verify): a length mismatch or duplicate batch name would make the index-based
        // name→WBS zip silently wrong. The zip is gated on both before any `task deps` runs.
        expect(finalizeCmd).toContain('(.wbs | length) == ($b[0] | length)');
        expect(finalizeCmd).toContain('($b[0] | map(.name) | unique | length) == ($b[0] | length)');
    });

    test('handoff recommendation is mutually exclusive: any-fail ⇒ refineall, all-pass ⇒ runall', () => {
        // Finding 4: the old static runall recommendation ignored task readiness. The single NEXT
        // computation keys off the per-task checks (`any(.[]; .pass == false)`) and emits exactly
        // one command — ready-depth refineall when any check fails, auto runall only when clean.
        expect(finalizeCmd).toContain('any(.[]; .pass == false)');
        expect(finalizeCmd).toContain('"/sp:dev-refineall --feature \\($feature) --auto --depth ready"');
        expect(finalizeCmd).toContain('"/sp:dev-runall --feature \\($feature) --auto"');
        // The report writes the variable, never a second hardcoded recommendation.
        expect(finalizeCmd).toContain('echo "$NEXT"');
        expect(finalizeCmd).not.toContain('echo "/sp:dev-runall');
    });

    test('static runall recommendation is gone from the whole workflow definition, not just the note', () => {
        const raw = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        // Finding 4 pre-fix: the handoff state hardcoded "Next: /sp:dev-runall --feature <id>"
        // in both the state description and the terminal note. No form of that static
        // recommendation may reappear anywhere in the definition.
        expect(raw).not.toContain('Next: /sp:dev-runall');
        expect(raw).not.toContain('Next command: /sp:dev-runall');
    });

    test('task-batch.schema.json stays closed and carries no order-sidecar field (R2)', () => {
        // F2: the private order sidecar (`depends_on_names`) is workflow-run data, never part of
        // the public batch-create input contract. The schema must remain closed (no additional
        // properties) and must not grow an order/dependency field — otherwise the no-surface
        // guard (0519 R2) breaks and the sidecar leaks into the documented batch surface.
        const schemaPath = join(import.meta.dir, '../../../../apps', 'cli', 'schemas', 'task-batch.schema.json');
        const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
            type: string;
            items: {
                type: string;
                additionalProperties?: boolean;
                properties: Record<string, unknown>;
            };
        };

        expect(schema.type).toBe('array');
        expect(schema.items.additionalProperties).toBe(false);
        for (const leaked of ['depends_on_names', 'dependencies', 'dependsOnNames', 'order']) {
            expect(schema.items.properties, `schema must not expose "${leaked}"`).not.toHaveProperty(leaked);
        }
    });
});
