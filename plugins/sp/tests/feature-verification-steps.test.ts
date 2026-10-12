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

test('the plugin entry no longer owns the DB, artifact or feature-directory surfaces (1176 R2)', () => {
    // The AC's source scan: the operation owns those concerns now, so the adapter must not reach for
    // the DB facade, the DAO, or a feature-directory listing.
    const source = Bun.file(SCRIPT).text();
    return source.then((text) => {
        // Comments are excluded: the entry may *document* the boundary it no longer owns, so the scan
        // looks at executable lines only.
        const code = text
            .split('\n')
            .filter((line) => {
                const t = line.trim();
                return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
            })
            .join('\n');
        for (const owned of ['openInlineRunProjectDb', 'ArtifactDao', 'findFeatureFile', 'readdirSync']) {
            expect(code, `plugin entry must not own ${owned}`).not.toContain(owned);
        }
        // The single seam it does consume is the app operation.
        expect(code).toContain('runFeatureVerification');
    });
});
