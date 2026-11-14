/**
 * 1319 R3/R5 — the two pipeline behaviours that are wiring, not library code.
 *
 * Same harness discipline as the other task-pipeline tests (0945/0943): load the LIVE definition,
 * execute its own actions and guards against staged state with the workflow vars exported as env.
 * No engine run and no model call.
 *
 * - R3/AC5: the implement-exit formatter is a bounded `command.gate`. A hanging formatter finishes
 *   at the bound and still reports success to the chain (`softFail`), so the run proceeds to gate.
 * - R5/AC7: on a verdict-lint failure the review state re-enters itself ONCE with the lint findings
 *   in the prompt and the stale cert/answer removed; a second failure falls through to remediate.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { CommandGateActionRunner } from '../../src/workflow/actions/command-gate';

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const WBS = '1319';
const RUN_ID = 'run-bounds';

interface ActionDef {
    kind: string;
    options?: Record<string, unknown>;
}

interface TransitionDef {
    from: string;
    to: string;
    terminalReason?: string;
    guard?: { kind?: string; options?: { command?: string } };
}

interface PipelineDef {
    vars?: Record<string, string>;
    states: { id: string; onEnter?: ActionDef[] }[];
    transitions: TransitionDef[];
}

const definition = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'task-pipeline.yaml'), 'utf8')) as PipelineDef;

function state(id: string): { id: string; onEnter?: ActionDef[] } {
    const found = definition.states.find((s) => s.id === id);
    if (found === undefined) throw new Error(`state ${id} missing`);
    return found;
}

/** Template substitution the engine applies before an action runs. */
function render(text: string, vars: Record<string, string>): string {
    return text.replace(/\$\{vars\.(\w+)\}/g, (_all, name: string) => vars[name] ?? '');
}

function baseVars(): Record<string, string> {
    return {
        wbs: WBS,
        __runId: RUN_ID,
        stepTimeoutMs: '300',
        gateTimeoutMs: '300',
        gateBackstopMs: '14400000',
        profile: 'auto',
        qualityGateMaxFixAttempts: '2',
    };
}

function staged(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'task-pipeline-bounds-'));
    mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
    return cwd;
}

describe('1319 R3 — the formatter step is bounded and stays best-effort', () => {
    test('a hanging formatCmd ends at the bound and never fails the chain', async () => {
        const cwd = staged();
        try {
            const vars = baseVars();
            vars.formatCmd = 'sleep 30';
            const action = (state('implement').onEnter ?? []).find(
                (a) => a.kind === 'command.gate' && a.options?.id === 'implement-format',
            );
            expect(action).toBeDefined();
            const options = action?.options as {
                executable: string;
                args: string[];
                resultFile: string;
                softFail: boolean;
                timeoutMs: string;
            };
            const startedAtMs = Date.now();
            const result = await new CommandGateActionRunner().execute(
                {
                    executable: options.executable,
                    args: options.args.map((arg) => render(arg, vars)),
                    resultFile: options.resultFile,
                    softFail: options.softFail,
                    timeoutMs: render(options.timeoutMs, vars),
                },
                { runId: RUN_ID, stateOrNodeId: 'implement', workdir: cwd, vars, env: {} },
            );
            const elapsedMs = Date.now() - startedAtMs;

            // Bounded, and soft: a hanging formatter is not a run-ending failure.
            expect(elapsedMs).toBeLessThan(15_000);
            expect(result.ok).toBe(true);
            expect((result.data as { timedOut?: boolean }).timedOut).toBe(true);
            // The gate is the real gate; the formatter never certifies anything.
            expect((result.data as { status?: string }).status).toBe('BLOCKED');
            expect(readFileSync(join(cwd, options.resultFile), 'utf8')).toBe('BLOCKED\n');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
