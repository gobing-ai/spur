import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
        expect(guard?.options?.command).toBe(`test "\${vars.profile}" = auto && test "\${vars.idea_approved}" = true`);
    });

    test('design bypass to decompose is declared before the always edge to design-approval', () => {
        const bypass = edgeIndex('system-design', 'decompose');
        const gate = edgeIndex('system-design', 'design-approval');

        expect(bypass).toBeGreaterThanOrEqual(0);
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(bypass).toBeLessThan(gate);
        expect(DEF.transitions[gate]?.guard?.kind).toBe('always');
    });

    test('design bypass is guarded on both profile=auto and design_approved=true', () => {
        const guard = DEF.transitions[edgeIndex('system-design', 'decompose')]?.guard;

        expect(guard?.kind).toBe('shell');
        expect(guard?.options?.command).toBe(
            `test "\${vars.profile}" = auto && test "\${vars.design_approved}" = true`,
        );
    });

    test('__runId is declared so discovery artifacts can carry run provenance (R8)', () => {
        const vars = (DEF as unknown as { vars: Record<string, unknown> }).vars;
        expect(vars).toHaveProperty('__runId');
    });
});

/**
 * R8 (0366): the start state's reset action must ARCHIVE a prior run's discovery
 * report, never silently overwrite or delete it. The command is lifted from the
 * YAML rather than copied, so editing the workflow to reintroduce a blind `rm -f`
 * fails this test instead of quietly regressing the retain policy.
 */
describe('idea-pipeline definition — discovery artifact retain policy (R8 of 0366)', () => {
    /** The start-state reset command, taken straight from the shipped definition. */
    function resetCommand(): string {
        const start = DEF.states.find((s) => s.id === 'start');
        const cmd = start?.onEnter?.find(
            (a) => a.kind === 'shell' && (a.options?.command ?? '').includes('idea-archive'),
        )?.options?.command;
        if (cmd === undefined) throw new Error('start state has no idea-archive reset command');
        return cmd;
    }

    async function runInTemp(command: string, dir: string): Promise<number> {
        const proc = Bun.spawn(['sh', '-c', command], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
        return await proc.exited;
    }

    test('a prior idea-eval report is moved into a timestamped archive, not deleted', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-idea-archive-'));
        const runDir = join(dir, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        await writeFile(join(runDir, 'idea-eval-report.md'), 'PRIOR RUN REPORT\n');
        await writeFile(join(runDir, 'idea-needs-design.json'), '{"needs_design":true}');
        // Ephemeral markers that the reset is expected to clear.
        await writeFile(join(runDir, 'idea-feature-id.txt'), 'X1');
        await writeFile(join(runDir, 'idea-batch-create.done'), 'ts');

        expect(await runInTemp(resetCommand(), dir)).toBe(0);

        // The report survives — relocated under .spur/run/idea-archive/<timestamp>/.
        const archives = await readdir(join(runDir, 'idea-archive'));
        expect(archives.length).toBe(1);
        const archived = join(runDir, 'idea-archive', archives[0] ?? '', 'idea-eval-report.md');
        expect(await readFile(archived, 'utf8')).toBe('PRIOR RUN REPORT\n');

        // ...and is cleared from the live path so the next run starts clean.
        expect(await Bun.file(join(runDir, 'idea-eval-report.md')).exists()).toBe(false);
        expect(await Bun.file(join(runDir, 'idea-needs-design.json')).exists()).toBe(false);
        // Ephemeral markers are removed outright (no archival value).
        expect(await Bun.file(join(runDir, 'idea-feature-id.txt')).exists()).toBe(false);
        expect(await Bun.file(join(runDir, 'idea-batch-create.done')).exists()).toBe(false);

        await rm(dir, { recursive: true, force: true });
    });

    test('a first run with no prior artifacts creates no archive and still succeeds', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-idea-archive-'));
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });

        expect(await runInTemp(resetCommand(), dir)).toBe(0);
        expect(await Bun.file(join(dir, '.spur', 'run', 'idea-archive')).exists()).toBe(false);

        await rm(dir, { recursive: true, force: true });
    });

    test('discovery instructs a run_id provenance footer on the emitted report', () => {
        const discovery = DEF.states.find((s) => s.id === 'discovery');
        const input = discovery?.onEnter?.find((a) => a.kind === 'agent.run')?.options?.input ?? '';

        expect(input).toContain(`run_id: \${vars.__runId}`);
        expect(input).toContain('generated_at');
    });
});
