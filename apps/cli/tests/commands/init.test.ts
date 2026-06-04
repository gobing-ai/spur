import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInitCommand } from '../../src/commands/init';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';
import { createTempProject } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

/** A context whose global rules seed is redirected to an isolated temp dir. */
async function isolatedContext(cwd: string) {
    const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
    const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: globalDir };
    return { ctx: createCliContext({ cwd, env, output: nullOutput(), dbUrl: ':memory:' }), globalDir };
}

describe('init command', () => {
    test('scaffolds config, local rules, and an example workflow', async () => {
        const cwd = await createTempProject();
        const { ctx } = await isolatedContext(cwd);

        expect(await runInitCommand(ctx, {})).toBe(0);

        expect(existsSync(join(cwd, '.spur', 'config.json'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'recommended.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules', 'spur-dev.yaml'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'workflows', 'basic.yaml'))).toBe(true);
        // Team-mode agent specs directory is tracked via .gitkeep.
        expect(existsSync(join(cwd, '.spur', 'agents', '.gitkeep'))).toBe(true);
    });

    test('seeds the global rules directory from the bundled presets', async () => {
        const cwd = await createTempProject();
        const { ctx, globalDir } = await isolatedContext(cwd);

        expect(await runInitCommand(ctx, {})).toBe(0);

        // Bundled categories land in the isolated global root so any project's
        // `rule run --preset recommended` resolves a real ruleset afterwards.
        expect(existsSync(join(globalDir, 'recommended.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'quality', 'tsdoc-exports.yaml'))).toBe(true);
        expect(existsSync(join(globalDir, 'quality', 'coverage-gate.yaml'))).toBe(true);
    });

    test('--minimal skips local rules and workflow scaffold', async () => {
        const cwd = await createTempProject();
        const { ctx } = await isolatedContext(cwd);

        expect(await runInitCommand(ctx, { minimal: true })).toBe(0);

        expect(existsSync(join(cwd, '.spur', 'config.json'))).toBe(true);
        expect(existsSync(join(cwd, '.spur', 'rules'))).toBe(false);
        expect(existsSync(join(cwd, '.spur', 'workflows'))).toBe(false);
        // The agents directory is core team-mode infra, created even in --minimal mode.
        expect(existsSync(join(cwd, '.spur', 'agents', '.gitkeep'))).toBe(true);
    });

    test('re-init without --force is blocked, with --force overwrites', async () => {
        const cwd = await createTempProject();
        const { ctx } = await isolatedContext(cwd);

        expect(await runInitCommand(ctx, {})).toBe(0);
        // A second plain init must refuse rather than silently clobber the config.
        expect(await runInitCommand(ctx, {})).toBe(1);
        expect(await runInitCommand(ctx, { force: true })).toBe(0);
    });

    test('--json reports created files and the global seed count', async () => {
        const cwd = await createTempProject();
        const messages: string[] = [];
        const ctx = createCliContext({
            cwd,
            env: { ...process.env, SPUR_GLOBAL_RULES_DIR: await mkdtemp(join(tmpdir(), 'spur-glob-')) },
            output: { write: (m) => messages.push(m), error: () => {} },
            dbUrl: ':memory:',
        });

        expect(await runInitCommand(ctx, { json: true, name: 'fixture' })).toBe(0);
        const result = JSON.parse(messages.at(-1) ?? '{}') as {
            ok: boolean;
            project: string;
            created: string[];
            globalRulesSeeded: number;
        };
        expect(result.ok).toBe(true);
        expect(result.project).toBe('fixture');
        expect(result.created.length).toBeGreaterThan(0);
        expect(result.globalRulesSeeded).toBeGreaterThan(0);
    });
});
