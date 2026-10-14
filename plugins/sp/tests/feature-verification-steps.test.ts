import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/**
 * 1197 R1/R2, AC1/AC2 — the installed Node twin re-enters Bun.
 *
 * The `feature-verification` workflow runs `feature-verification-steps.mjs` with `node`
 * in installed mode, but the generated inline bundle keeps `bun:sqlite` external by design. Before
 * the re-entry the twin died on module load (`ERR_UNSUPPORTED_ESM_URL_SCHEME`); these cases pin the
 * twin under a scratch `scripts/` + `lib/` layout, spawned exactly as the workflow does.
 */
describe('installed Node twin re-enters Bun (task 1197 R1/R2, AC1/AC2)', () => {
    const TWIN = join(import.meta.dir, '..', 'scripts', 'feature-verification-steps.mjs');
    const BUNDLE = join(import.meta.dir, '..', 'lib', 'inline-run.generated.mjs');
    // The verifier resolves its own definition from the project layer, so the throwaway project
    // carries the shipped one (as the task's measured throwaway project did).
    const WORKFLOW = join(import.meta.dir, '..', '..', '..', 'config', 'workflows', 'feature-verification.yaml');
    const nodeBin = Bun.which('node');
    const args = ['verify', '--feature-id', 'T1', '--run-id', 'r1', '--cmd', 'true'];
    const twinRel = join('scripts', 'feature-verification-steps.mjs');

    /** A throwaway git project carrying the installed layout: twin under scripts/, bundle under lib/. */
    function installedProject(): string {
        const root = mkdtempSync(join(tmpdir(), 'fv-steps-installed-'));
        mkdirSync(join(root, 'scripts'), { recursive: true });
        mkdirSync(join(root, 'lib'), { recursive: true });
        copyFileSync(TWIN, join(root, 'scripts', 'feature-verification-steps.mjs'));
        copyFileSync(BUNDLE, join(root, 'lib', 'inline-run.generated.mjs'));
        mkdirSync(join(root, '.spur', 'workflows'), { recursive: true });
        copyFileSync(WORKFLOW, join(root, '.spur', 'workflows', 'feature-verification.yaml'));
        mkdirSync(join(root, 'docs', 'features'), { recursive: true });
        writeFileSync(
            join(root, 'docs', 'features', 'T1_feature.md'),
            '---\nname: "T1 feature"\nstatus: todo\n---\n\n## T1. Feature\n',
        );
        const git = (...gitArgs: string[]) => spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
        git('init', '-q');
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A');
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
        return root;
    }

    test.skipIf(nodeBin === null)(
        'AC1: node loads the twin past the Bun-only bundle and fails only on the missing run row',
        () => {
            const root = installedProject();
            try {
                const node = spawnSync(nodeBin as string, [twinRel, ...args], {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 60_000,
                });
                const bun = spawnSync('bun', [twinRel, ...args], {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 60_000,
                });
                // Module load succeeded: the Node run never sees the Bun-only ESM scheme.
                expect(node.stderr).not.toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
                expect(node.stdout).not.toContain('ERR_UNSUPPORTED_ESM_URL_SCHEME');
                // It reaches the verifier and fails exactly as the Bun run does — the missing run row.
                expect(node.status).toBe(bun.status);
                expect(node.stderr).toBe(bun.stderr);
                expect(node.status).not.toBe(0);
                expect(node.stderr).toMatch(/FOREIGN KEY|missing run row|RUN_NOT_FOUND/i);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        },
    );

    test.skipIf(nodeBin === null)('AC2: a missing Bun is named on stderr and exits 1', () => {
        const root = installedProject();
        const binDir = mkdtempSync(join(tmpdir(), 'fv-steps-nobun-'));
        try {
            // PATH holds only a node symlink, so the Bun re-exec fails with ENOENT.
            symlinkSync(nodeBin as string, join(binDir, 'node'));
            const run = spawnSync(join(binDir, 'node'), [twinRel, ...args], {
                cwd: root,
                env: { PATH: binDir, HOME: binDir },
                encoding: 'utf8',
                timeout: 60_000,
            });
            expect(run.status).toBe(1);
            expect(run.stderr).toContain('feature-verification-steps requires Bun on PATH');
        } finally {
            rmSync(binDir, { recursive: true, force: true });
            rmSync(root, { recursive: true, force: true });
        }
    });
});
