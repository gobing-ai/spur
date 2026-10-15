import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStepProfileCli } from '../../src/workflow/step-profile-cli';
import { runDriftProbe } from '../../src/workflow/wrapup/drift-probe';
import { spurCommand } from '../../src/workflow/wrapup/spur-command';
import { resolveTasks } from '../../src/workflow/wrapup/steps';

test('absorbed nested lookups preserve a launch module containing spaces', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'spur launch spaces '));
    const module = join(cwd, 'stub spur.ts');
    const argv = [process.execPath, module];
    try {
        writeFileSync(
            module,
            `
            const args = process.argv.slice(2);
            console.log(JSON.stringify(args.includes('trace')
                ? { entries: [] }
                : { status: 'done', content: '## Solution\\n\\nChanged paths: none\\n' }));
        `,
        );
        expect(spurCommand(undefined, argv)).toEqual({ cmd: process.execPath, prefix: [module] });
        expect(runStepProfileCli(['sample', '--json'], 'unused', argv).exitCode).toBe(0);
        expect(resolveTasks({ __runId: 'r1', tasks: '["0101"]' }, { cwd, spurArgv: argv }).exitCode).toBe(0);
        expect(readFileSync(join(cwd, '.spur/run/r1-wrapup-resolve.status'), 'utf8')).toBe('PASS\n');
        const probe = runDriftProbe({ __runId: 'r1', tasks: '["0101"]' }, { cwd, spurArgv: argv });
        expect(probe.exitCode).toBe(0);
        expect(JSON.stringify(probe)).not.toContain('lookup failed');
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
