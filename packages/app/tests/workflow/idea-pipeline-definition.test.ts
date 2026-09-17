/**
 * R4/R5 (0366): the pre-approval bypass is implemented purely by transition
 * *declaration order* — the state-machine driver takes the first passing edge.
 * If the guarded bypass is ever reordered after the `always` edge, a run with
 * `profile=auto` + `idea_approved=true` silently falls back into the paused
 * taste gate, which is exactly the defect 0366 fixed. Only ordering encodes
 * that contract, so it needs its own regression guard.
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { parse as parseYaml } from 'yaml';

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
    options?: { command?: string; input?: string; answerFile?: string; expectFile?: string; prompt?: string };
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
        // 0769: the check is measured once by the idea-design-check command.gate at the end of
        // system-design; the guard consumes the recorded run-scoped result file.
        expect(guard?.options?.command).toBe(
            `test "$profile" = auto && test "$design_approved" = true && test "$(cat .spur/run/$__runId-idea-design-check.status 2>/dev/null)" = PASS`,
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
        // 0824: batch-create-run condenses the sentinel/result paths behind the shared base
        // `P=".spur/run/$__runId-idea-batch-create"`; those stems stay run-scoped through $P.
        const pDerivedStems = ['idea-batch-create-result.json', 'idea-batch-create.done', 'idea-batch-create.failed'];
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
            'idea-handoff.md',
        ]) {
            // Two spellings are both run-scoped and both valid: engine template resolution
            // (`${vars.__runId}`) in non-shell options, and the env-var handoff (`$__runId`) in
            // shell action and guard commands, where embedding a value would make it executable
            // (tasks 0432 / 0435). The invariant is that the path is scoped, not how it is spelled.
            const pScoped = pDerivedStems.includes(stem) && raw.includes('P=".spur/run/$__runId-idea-batch-create"');
            const scoped =
                raw.includes(`.spur/run/\${vars.__runId}-${stem}`) ||
                raw.includes(`.spur/run/$__runId-${stem}`) ||
                pScoped;
            expect(scoped, `${stem} must be run-id scoped in either spelling`).toBe(true);
            // No unscoped live path remains (comments may still mention idea-*).
            expect(raw).not.toMatch(new RegExp(`\\.spur/run/${stem.replace('.', '\\.')}`));
        }
        // 0824: the per-task check scratch file (dynamic `<wbs>` stem) and the dep-map TSV
        // were handoff-finalize shell scratch — finalizeIdeaHandoff keeps them in memory, so
        // the definition must not grow a fixed-path (unscoped) replacement either.
        expect(raw).not.toMatch(/\.spur\/run\/\d{4}-idea-check-/);
        expect(raw).not.toContain('.spur/run/idea-dep-map.tsv');
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

    test('both design exits route through the recorded design check before decomposition', () => {
        const auto = DEF.transitions[edgeIndex('system-design', 'decompose')]?.guard?.options?.command ?? '';
        const interactive = DEF.transitions[edgeIndex('design-approval', 'decompose')]?.guard?.options?.command ?? '';
        const rejected = DEF.transitions[edgeIndex('design-approval', 'feature-check')]?.guard?.options?.command ?? '';

        // 0769: every sibling exit consumes the same recorded idea-design-check status.
        const passCheck = 'test "$(cat .spur/run/$__runId-idea-design-check.status 2>/dev/null)" = PASS';
        const failCheck = 'test "$(cat .spur/run/$__runId-idea-design-check.status 2>/dev/null)" != PASS';
        expect(auto).toContain(passCheck);
        expect(interactive).toContain('$__hitlAnswer');
        expect(interactive).toContain(passCheck);
        expect(rejected).toContain(failCheck);
    });

    test('feature check is measured once per boundary by command.gates that record run-scoped PASS/FAIL', () => {
        const gates: Array<{
            state: string;
            executable: string;
            args: string[];
            resultFile: string;
            softFail?: boolean;
        }> = [];
        for (const s of DEF.states) {
            for (const a of s.onEnter ?? []) {
                if (a.kind === 'command.gate') {
                    const o = a.options as {
                        executable: string;
                        args: string[];
                        resultFile: string;
                        softFail?: boolean;
                    };
                    gates.push({
                        state: s.id,
                        executable: o.executable,
                        args: o.args,
                        resultFile: o.resultFile,
                        softFail: o.softFail,
                    });
                }
            }
        }

        // 0769: exactly one measured check per author/revise boundary (evidence, not ceremony).
        expect(gates.map((g) => g.state).sort()).toEqual(['ac-generate', 'system-design']);
        for (const g of gates) {
            expect(g.softFail).toBe(true);
            // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
            expect(g.executable).toBe('${vars.spurBin}');
            // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the literal YAML template, not interpolating
            expect(g.args).toEqual(['feature', 'check', '${vars.featureId}']);
            expect(g.resultFile).toMatch(/^\.spur\/run\/\$\{vars\.__runId\}-idea-(ac|design)-check\.status$/);
        }
        // Guards must consume the recorded result — no transition re-runs the CLI.
        const guardCommands = DEF.transitions.map((t) => t.guard?.options?.command ?? '').join('\n');
        expect(guardCommands).not.toContain('$spurBin feature check');
    });

    test('approve with a failing design check routes back through the AC gate, not a dead end', () => {
        const guard = DEF.transitions[edgeIndex('design-approval', 'feature-check')]?.guard?.options?.command ?? '';

        // P3-1 (0515): `yes && check` failing previously matched no edge → engine
        // fail('no-passing-transition'). 0769: the negation consumes the recorded
        // idea-design-check status — a rejected-by-AC design loops into feature-check, which
        // routes to ac-generate under the capped retry loop instead of killing the run.
        expect(guard).toContain('$__hitlAnswer');
        expect(guard).toContain('!= PASS');
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

        // 0824: the prompt body moved into the skill reference; the input only names the
        // operation, the reference slice and both artifact paths.
        expect(agent?.input).toContain('sp:spec-decomposition');
        expect(agent?.input).toContain('Idea-pipeline emission');
        expect(agent?.input).toContain(`\${vars.__runId}-idea-task-batch.json`);
        expect(agent?.input).toContain(`\${vars.__runId}-idea-task-order.json`);
    });

    test('the decompose order-sidecar contract lives in the skill reference slice (0824)', () => {
        const ref = readFileSync(
            join(import.meta.dir, '../../../../plugins/sp/skills/spec-decomposition/references/decomposition.md'),
            'utf8',
        );
        const slice = ref.split('## Idea-pipeline emission')[1]?.split('## Common schema violations')[0] ?? '';
        expect(slice).toContain('depends_on_names');
        // State [] per item — the shape the decompose validator accepts.
        expect(slice).toContain('depends_on_names: []');
        expect(slice).toContain('exactly one batch item');
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
        // 0824: the condensed program derives sentinel/result paths from the shared base P;
        // temp/mv atomicity and the jq verdict gate are unchanged.
        expect(batchRunCmd).toContain('P=".spur/run/$__runId-idea-batch-create"');
        expect(batchRunCmd).toContain('"$P-result.json.tmp"');
        expect(batchRunCmd).toContain('"$P.done"');
        expect(batchRunCmd).toContain('--json');
        expect(batchRunCmd).toContain('.created == (.wbs | length)');
    });

    test('batch-create-run success flows through ready-prepare to finalize, then terminal handoff', () => {
        const toPrepare = edgeIndex('batch-create-run', 'ready-prepare');
        const prepareToFinalize = edgeIndex('ready-prepare', 'handoff-finalize');
        const toHandoff = edgeIndex('handoff-finalize', 'handoff');

        expect(toPrepare).toBeGreaterThanOrEqual(0);
        expect(prepareToFinalize).toBeGreaterThanOrEqual(0);
        expect(toHandoff).toBeGreaterThanOrEqual(0);
        // success edge stays guarded on the done sentinel; finalize entry and the
        // terminal edge are unconditional (evidence absence degrades, never blocks)
        expect(DEF.transitions[toPrepare]?.guard?.options?.command).toContain('idea-batch-create.done');
        expect(DEF.transitions[prepareToFinalize]?.guard?.kind).toBe('always');
        expect(DEF.transitions[toHandoff]?.guard?.kind).toBe('always');
    });

    test('ready-prepare writes and validates the run-scoped ready evidence sidecar (0788)', () => {
        const prepare = DEF.states.find((s) => s.id === 'ready-prepare');
        const agent = (prepare?.onEnter ?? []).find((a) => a.kind === 'agent.run');
        const shell = (prepare?.onEnter ?? []).find((a) => a.kind === 'shell');

        // 0824: the input carries only the operation, its vars and its output paths; the
        // checklist/digest guidance moved into the skill reference.
        expect(agent?.options?.input).toContain('references/planning-workflow.md');
        expect(agent?.options?.input).toContain('Ready preparation');
        expect(agent?.options?.input).toContain(`\${vars.__runId}-idea-batch-create-result.json`);
        expect(agent?.options?.input).toContain(`\${vars.__runId}-idea-ready.json`);
        // 0824 (spec:168): the output check is the answer file; expectFile was rejected on
        // idea-ready.json (spec:316) because a missing sidecar must degrade the handoff
        // recommendation to refineall, not fail the run.
        expect(agent?.options?.answerFile).toBe(`.spur/run/\${vars.__runId}-ready-prepare-answer.txt`);
        expect(agent?.options?.expectFile).toBe(agent?.options?.answerFile);
        // Fail-closed shape validation; absence is normalized to an empty sidecar so
        // the handoff degrades to refineall instead of failing the run.
        expect(shell?.options?.command).toContain('$__runId-idea-ready.json');
        expect(shell?.options?.command).toContain('jq -e');
        expect(shell?.options?.command).toContain('.status == "ready"');
        expect(shell?.options?.command).toContain('planningDigest');
    });

    test('the ready-prepare checklist and digest live in the planning-workflow reference (0824)', () => {
        const ref = readFileSync(
            join(import.meta.dir, '../../../../plugins/sp/skills/spur-dev/references/planning-workflow.md'),
            'utf8',
        );
        const slice = ref.split('**Ready preparation (ready-prepare, 0788).**')[1]?.split('## Step 6')[0] ?? '';
        expect(slice).toContain('computePlanningDigest');
        expect(slice).toContain('planningDigest');
        expect(slice).toContain('never fabricate evidence');
    });

    test('batch-create-run creates with --skip-ready; preparation is the ready-prepare stage (0788)', () => {
        expect(batchRunCmd).toContain('--skip-ready');
    });

    test('handoff-finalize delegates to the bundled finalizeIdeaHandoff and fails closed (0824)', () => {
        // 0824: the finalize shell is a locator wrapper. The zip/deps/refresh/check/report
        // contract is pinned by finalizeIdeaHandoff unit tests (idea-handoff.test.ts); no
        // second shell implementation may remain in the definition.
        expect(finalizeCmd).toContain('packages/app/src/workflow/idea-handoff-cli.ts');
        expect(finalizeCmd).toContain('superskill script path sp idea-handoff.mjs');
        expect(finalizeCmd).toContain('failed closed');
        expect(finalizeCmd).toContain('exit 1');
        expect(finalizeCmd).not.toContain('task deps');
        expect(finalizeCmd).not.toContain('task check');
        expect(finalizeCmd).not.toContain('feature refresh');
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
 * pins the invariants a future edit must not break:
 *
 *   F1 — the handoff-finalize shell stays a locator wrapper around the bundled
 *        finalizeIdeaHandoff (zip → deps → refresh → check → report); a missing writer and a
 *        missing plugin twin fail closed (0824). The finalize contract itself is pinned on
 *        finalizeIdeaHandoff in idea-handoff.test.ts — no shell copy may return.
 *   F2 — the private order sidecar stays OUT of the public task-batch schema (R2 no-surface guard):
 *        the schema remains closed and carries no depends_on_names / dependencies / order field.
 */
describe('idea-pipeline definition — regression invariants and no-surface guard (0519)', () => {
    const finalizeCmd =
        DEF.states.find((s) => s.id === 'handoff-finalize')?.onEnter?.find((a) => a.kind === 'shell')?.options
            ?.command ?? '';

    test('handoff-finalize fails closed with exit 1 when neither the monorepo writer nor the plugin twin exists (0824)', () => {
        // R1 (0824): a seeded project without the sp plugin must not silently skip
        // finalization. In a temp cwd (no packages/, no plugins/) with a failing
        // `superskill` on PATH, the wrapper exits 1 naming the failure.
        const cwd = mkdtempSync(join(tmpdir(), 'idea-handoff-failclosed-'));
        try {
            const superskill = join(cwd, 'superskill');
            writeFileSync(superskill, '#!/bin/sh\necho "stub: superskill unavailable" >&2\nexit 1\n');
            chmodSync(superskill, 0o755);
            const result = spawnSync('sh', ['-c', finalizeCmd], {
                cwd,
                encoding: 'utf8',
                env: { ...getEnvVars(), __runId: 'r-fc', featureId: 'F1', PATH: `${cwd}:${getEnvVar('PATH') ?? ''}` },
            });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('failed closed');
            expect(result.stderr).toContain('superskill install sp');
            // No partial handoff report may appear.
            expect(() => readFileSync(join(cwd, '.spur/run/r-fc-idea-handoff.md'))).toThrow();
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
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

// ─── 0887: idea-pipeline robustness (verbatim idea, coverage gate, prompt contracts) ───

function stateActions(stateId: string): Action[] {
    return DEF.states.find((s) => s.id === stateId)?.onEnter ?? [];
}

function agentPrompt(stateId: string): string {
    const action = stateActions(stateId).find((a) => a.kind === 'agent.run');
    expect(action, `state "${stateId}" must carry an agent.run`).toBeDefined();
    return String(action?.options?.input ?? '');
}

function guardCommand(from: string, to: string): string {
    const guard = DEF.transitions.find((t) => t.from === from && t.to === to)?.guard;
    expect(guard, `transition ${from}→${to} must declare a guard`).toBeDefined();
    return String(guard?.options?.command ?? '');
}

describe('idea-pipeline definition — 0887 robustness contract', () => {
    test('R1: start persists the idea verbatim to -idea-input.md and fails the run when it is empty', () => {
        const shell = stateActions('start').find((a) => a.kind === 'shell');
        const command = String(shell?.options?.command ?? '');
        expect(command).toContain('-idea-input.md');
        // Verbatim write of $idea, then a whitespace-aware non-empty check (a bare `test -s`
        // passes a newline-only file, so emptiness must be measured with awk NF).
        expect(command).toContain('printf \'%s\\n\' "$idea" >');
        expect(command).toContain("awk 'NF'");
        expect(command).toContain('-idea-precheck-doctor.status');
    });

    test('R2: every model-bearing stage prompt treats the idea-input artifact as the authoritative ask', () => {
        for (const state of [
            'discovery',
            'feature-create',
            'ac-generate',
            'system-design',
            'decompose',
            'ready-prepare',
        ]) {
            expect(agentPrompt(state), `${state} prompt must reference idea-input.md`).toContain('-idea-input.md');
        }
    });

    test('R3: discovery requires the mandatory Requirement inventory section with I<n> items', () => {
        const prompt = agentPrompt('discovery');
        expect(prompt).toContain('## Requirement inventory');
        expect(prompt).toContain('[unclear:');
        expect(prompt).toContain('[deferred:');
    });

    test('R4: ac-generate measures requirement coverage in a soft shell after idea-ac-check', () => {
        const actions = stateActions('ac-generate');
        const kinds = actions.map((a) => a.kind);
        // The gate runs before the coverage shell; both sit at the same author/revise boundary.
        expect(kinds.indexOf('command.gate')).toBeGreaterThanOrEqual(0);
        expect(kinds.indexOf('command.gate')).toBeLessThan(kinds.lastIndexOf('shell'));
        const coverage = actions
            .filter((a) => a.kind === 'shell')
            .find((a) => String(a.options?.command).includes('idea-coverage-check.ts'));
        expect(coverage).toBeDefined();
        const command = String(coverage?.options?.command ?? '');
        expect(command).toContain('-idea-eval-report.md');
        expect(command).toContain('-idea-ac-content.md');
        expect(command).toContain('-idea-coverage.status');
        // Seeded-project resolution: repo checkout first, then the superskill-staged script;
        // neither present fails closed to FAIL (the shell itself always exits 0 — soft).
        expect(command).toContain('superskill script path');
        expect(command).toContain("printf 'FAIL");
    });

    test('R4: profile=auto ac-generate guards conjunct the recorded coverage status', () => {
        const forward = guardCommand('ac-generate', 'system-design');
        expect(forward).toContain('-idea-coverage.status');
        expect(forward).toContain('test "$cov_status" = PASS');
        expect(guardCommand('ac-generate', 'decompose')).toContain(
            'test "$(cat .spur/run/$__runId-idea-coverage.status 2>/dev/null)" = PASS',
        );
        for (const to of ['ac-generate', 'failed'] as const) {
            const command = guardCommand('ac-generate', to);
            expect(command).toContain('test "$ac_status" != PASS || test "$cov_status" != PASS');
        }
    });

    test('R4: interactive feature-check surfaces the coverage status in its prompt', () => {
        const confirm = stateActions('feature-check').find((a) => a.kind === 'hitl.confirm');
        expect(String(confirm?.options?.prompt ?? '')).toContain('-idea-coverage.status');
    });

    test('R5: ac-generate prompt carries both task-check rules (verbatim titles, gate language)', () => {
        const prompt = agentPrompt('ac-generate');
        expect(prompt).toContain('# covers:');
        expect(prompt).toContain('byte-identical');
        expect(prompt).toContain('L4.gate-language');
    });

    test('R6: feature-create prompt names the .ref.id --json envelope', () => {
        expect(agentPrompt('feature-create')).toContain('.ref.id');
    });
});
