import { expect, test } from 'bun:test';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'feature-verification-steps.ts');

function run(args: string[]): { exitCode: number; stderr: string } {
    const result = Bun.spawnSync(['bun', SCRIPT, 'verify', '--feature-id', 'ZZ', '--run-id', 't0948', ...args], {
        cwd: join(import.meta.dir, '..', '..', '..'),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { exitCode: result.exitCode ?? 1, stderr: result.stderr.toString() };
}

test('source mode names the mode and the fix, not a plugin reinstall (0948 R3)', () => {
    const { exitCode, stderr } = run(['--module-mode', 'source', '--spur-bin', 'spur']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('source mode');
    expect(stderr).toContain('Fix:');
    expect(stderr).toContain('plugins/sp/lib/inline-run.generated.mjs');
    expect(stderr).not.toContain('rebuild/install the sp plugin');
});

test('bundle mode in this checkout loads the generated bundle (0948 R3)', () => {
    const { exitCode, stderr } = run(['--module-mode', 'bundle', '--spur-bin', '']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('feature ZZ not found');
    expect(stderr).not.toContain('source mode');
    expect(stderr).not.toContain('rebuild/install the sp plugin');
});
