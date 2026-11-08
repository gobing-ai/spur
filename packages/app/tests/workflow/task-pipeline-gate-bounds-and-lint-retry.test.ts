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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
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

function runShell(command: string, cwd: string, vars: Record<string, string>): void {
    const run = spawnSync('/bin/sh', ['-c', render(command, vars)], {
        cwd,
        env: { ...getEnvVars(), ...vars },
        encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`shell exited ${run.status}: ${run.stderr}`);
}

/** First passing edge in declaration order — the engine's routing decision. */
function firstPassingEdgeIndex(from: string, cwd: string, vars: Record<string, string>): number {
    const edges = definition.transitions.filter((t) => t.from === from);
    for (const [index, edge] of edges.entries()) {
        if (edge.guard?.kind === 'always') return index;
        if (edge.guard?.kind !== 'shell') continue;
        const run = spawnSync('/bin/sh', ['-c', edge.guard.options?.command ?? ''], {
            cwd,
            env: { ...getEnvVars(), ...vars },
            encoding: 'utf8',
        });
        if (run.status === 0) return index;
    }
    throw new Error(`no passing edge out of ${from}`);
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

describe('1319 R5 — one inline re-review before any remediate hop', () => {
    const retryStep = () => {
        const steps = state('review').onEnter ?? [];
        const last = steps.at(-1);
        if (last?.kind !== 'shell') throw new Error('the retry token is not the last onEnter step');
        return String((last.options as { command?: string }).command ?? '');
    };

    test('a lint failure sets RETRY, clears the stale cert/answer, and routes review → review', () => {
        const cwd = staged();
        try {
            const vars = baseVars();
            const cert = join(cwd, '.spur', 'run', `${RUN_ID}-review-cert.md`);
            const answer = join(cwd, '.spur', 'run', `${RUN_ID}-review-answer.txt`);
            writeFileSync(join(cwd, '.spur', 'run', `${WBS}-verdict-lint.txt`), 'line 12: AC3 matches no task AC\n');
            writeFileSync(cert, 'stale cert\n');
            writeFileSync(answer, 'stale answer\n');

            runShell(retryStep(), cwd, vars);

            expect(readFileSync(join(cwd, '.spur', 'run', `${RUN_ID}-review-lint-retry`), 'utf8')).toBe('RETRY\n');
            expect(existsSync(cert)).toBe(false);
            expect(existsSync(answer)).toBe(false);
            // The retry edge wins over remediate and over retry-exhausted (declaration order).
            const index = firstPassingEdgeIndex('review', cwd, vars);
            expect(definition.transitions.filter((t) => t.from === 'review')[index]?.to).toBe('review');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('a retried run whose lint still fails falls through to remediate', () => {
        const cwd = staged();
        try {
            const vars = baseVars();
            writeFileSync(join(cwd, '.spur', 'run', `${WBS}-verdict-lint.txt`), 'line 12: still wrong\n');
            writeFileSync(join(cwd, '.spur', 'run', `${WBS}-review.status`), 'FAIL\n');
            // The retry already happened once in this run.
            writeFileSync(join(cwd, '.spur', 'run', `${RUN_ID}-review-lint-retried`), '');

            runShell(retryStep(), cwd, vars);
            expect(readFileSync(join(cwd, '.spur', 'run', `${RUN_ID}-review-lint-retry`), 'utf8')).toBe('NONE\n');

            const edges = definition.transitions.filter((t) => t.from === 'review');
            const index = firstPassingEdgeIndex('review', cwd, vars);
            expect(edges[index]?.to).toBe('remediate');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('a clean lint never asks for a retry', () => {
        const cwd = staged();
        try {
            const vars = baseVars();
            writeFileSync(join(cwd, '.spur', 'run', `${WBS}-review.status`), 'PASS\n');
            writeFileSync(join(cwd, '.spur', 'run', `${WBS}-approval.status`), 'APPROVED\n');

            runShell(retryStep(), cwd, vars);

            expect(readFileSync(join(cwd, '.spur', 'run', `${RUN_ID}-review-lint-retry`), 'utf8')).toBe('NONE\n');
            const edges = definition.transitions.filter((t) => t.from === 'review');
            const index = firstPassingEdgeIndex('review', cwd, vars);
            expect(edges[index]?.to).toBe('done');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
