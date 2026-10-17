import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { loadWorkflowDef, type WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { parseDecisionConfig } from '../../src/workflow/decision-hitl-responder';

// D65 1241 R2 (design workflow-execution-foundation §3.4/§4.5): the shipped operator gates are
// decision points — interactive runs ask the operator whatever mode the gate declares, and
// `profile=auto` answers from the gate's evidence binding. Failure modes first: a gate left on
// `mode: never` (never auto-answered), an evidence gate inside a paused state (0911 D2), and a
// deferred answer that no guard routes.

const WORKFLOWS_DIR = resolve(__dirname, '../../../..', 'config', 'workflows');
const MIGRATED = ['idea-pipeline.yaml', 'wrapup-pipeline.yaml', 'wayfinder-resolution.yaml'];

const GATE_KINDS = new Set(['hitl.confirm', 'hitl.select']);

interface GateSite {
    stateId: string;
    paused: boolean;
    options: Record<string, unknown>;
}

function gateSites(def: WorkflowDef): GateSite[] {
    const sites: GateSite[] = [];
    for (const state of (def as unknown as { states: Array<Record<string, unknown>> }).states) {
        for (const action of (state.onEnter as Array<{ kind: string; options?: Record<string, unknown> }>) ?? []) {
            if (!GATE_KINDS.has(action.kind)) continue;
            sites.push({ stateId: state.id as string, paused: state.pause === true, options: action.options ?? {} });
        }
    }
    return sites;
}

function stateIds(def: WorkflowDef): Set<string> {
    return new Set((def as unknown as { states: Array<{ id: string }> }).states.map((state) => state.id));
}

const load = async (file: string): Promise<WorkflowDef> =>
    await loadWorkflowDef(join(WORKFLOWS_DIR, file), { validateSchema: false });

describe('migrated operator gates (1241 R2)', () => {
    test('every migrated gate declares an evidence binding in an unpaused state', async () => {
        for (const file of MIGRATED) {
            const def = await load(file);
            const ids = stateIds(def);
            for (const site of gateSites(def)) {
                const parsed = parseDecisionConfig(site.options, '__hitlAnswer', 'confirm');
                expect({ file, state: site.stateId, ok: parsed.ok }).toEqual({ file, state: site.stateId, ok: true });
                if (!parsed.ok) continue;
                expect({ file, state: site.stateId, mode: parsed.config.mode }).toEqual({
                    file,
                    state: site.stateId,
                    mode: 'evidence',
                });
                if (parsed.config.mode !== 'evidence') continue;
                // A paused state never reaches the automatic answer path (0911 D2).
                expect({ file, state: site.stateId, paused: site.paused }).toEqual({
                    file,
                    state: site.stateId,
                    paused: false,
                });
                for (const node of parsed.config.evidenceNodes) {
                    expect({ file, node, exists: ids.has(node) }).toEqual({ file, node, exists: true });
                }
            }
        }
    });

    test('no shipped workflow leaves an operator gate on mode: never', async () => {
        const offenders: string[] = [];
        for (const file of readdirSync(WORKFLOWS_DIR).filter((entry) => entry.endsWith('.yaml'))) {
            for (const site of gateSites(await load(file))) {
                const parsed = parseDecisionConfig(site.options, '__hitlAnswer', 'confirm');
                if (parsed.ok && parsed.config.mode === 'never') offenders.push(`${file}:${site.stateId}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    // Today's headless responder answered every confirm with `no`; the gates keep that routing
    // for an absent answer by folding it before the guards read `__hitlAnswer`.
    test('a deferred or absent answer still resolves to the deny the guards route on', async () => {
        const def = await load('idea-pipeline.yaml');
        const state = (def as unknown as { states: Array<Record<string, unknown>> }).states.find(
            (entry) => entry.id === 'idea-eval',
        );
        const actions = (state?.onEnter ?? []) as Array<{ kind: string; options?: Record<string, unknown> }>;
        const fold = actions.find(
            (action) => action.kind === 'shell' && String(action.options?.command).includes('no'),
        );
        expect(fold).toBeDefined();
        const command = String(fold?.options?.command).replaceAll('$__runId', 'r1');

        const workdir = mkdtempSync(join(tmpdir(), 'spur-gate-fold-'));
        try {
            for (const [answer, expected] of [
                ['', 'no'],
                ['yes', 'yes'],
                ['cancel', 'cancel'],
            ] as const) {
                const result = Bun.spawnSync(['bash', '-c', command], {
                    cwd: workdir,
                    env: { ...getEnvVars(), __hitlAnswer: answer },
                    stdout: 'pipe',
                    stderr: 'pipe',
                });
                expect({ answer, exit: result.exitCode }).toEqual({ answer, exit: 0 });
                const written = readFileSync(join(workdir, '.spur/run/r1-idea-eval-answer.txt'), 'utf8').trim();
                expect({ answer, written }).toEqual({ answer, written: expected });
            }
        } finally {
            rmSync(workdir, { recursive: true, force: true });
        }
    });

    // `--auto` keeps today's recommendation routing: the auto-skip guards run before the gate.
    test('idea-pipeline keeps the auto-skip route around each gate', async () => {
        const def = await load('idea-pipeline.yaml');
        const guards = (
            (
                def as unknown as {
                    transitions: Array<{ from: string; to: string; guard?: { options?: { command?: string } } }>;
                }
            ).transitions ?? []
        ).map((transition) => ({
            from: transition.from,
            to: transition.to,
            command: transition.guard?.options?.command ?? '',
        }));
        const autoRoute = (from: string, to: string): boolean =>
            guards.some(
                (guard) =>
                    guard.from === from &&
                    guard.to === to &&
                    guard.command.includes('"$profile" = auto') &&
                    guard.command.includes('idea_approved'),
            );
        expect(autoRoute('discovery', 'feature-create')).toBe(true);
        expect(autoRoute('discovery', 'cancelled')).toBe(true);
        const designSkip = guards.find((guard) => guard.from === 'system-design' && guard.to === 'decompose');
        expect(designSkip?.command).toContain('"$profile" = auto');
    });
});
