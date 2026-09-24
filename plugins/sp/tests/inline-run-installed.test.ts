import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed Node twin records identity, fingerprint, action and closure without a checkout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-inline-installed-'));
    const plugin = join(root, 'installed plugin');
    const project = join(root, 'project');
    try {
        mkdirSync(join(plugin, 'scripts'), { recursive: true });
        mkdirSync(join(plugin, 'lib'), { recursive: true });
        mkdirSync(project);
        cpSync(
            resolve(import.meta.dir, '../scripts/inline-run-setup.mjs'),
            join(plugin, 'scripts/inline-run-setup.mjs'),
        );
        cpSync(
            resolve(import.meta.dir, '../lib/inline-run.generated.mjs'),
            join(plugin, 'lib/inline-run.generated.mjs'),
        );
        const cli = join(root, 'cli-fixture.mjs');
        const definition = join(root, 'selected.yaml');
        writeFileSync(
            definition,
            `"$schema": "@gobing-ai/spur/schemas/state-machine-workflow.schema.json"
kind: state-machine
name: installed-smoke
initialState: start
terminalStates: [end]
states:
  - id: start
  - id: end
transitions:
  - from: start
    to: end
    guard: { kind: always }
`,
        );
        // Fixture supplies only the existing CLI projection. The detached child loads real app code.
        const projection = spawnSync(
            'bun',
            [
                resolve(import.meta.dir, '../../../apps/cli/src/index.ts'),
                'workflow',
                'show',
                definition,
                '--format',
                'todo',
                '--json',
            ],
            { cwd: project, encoding: 'utf8', timeout: 30_000 },
        );
        expect(projection.status, projection.stderr).toBe(0);
        const inventory = JSON.parse(projection.stdout);
        inventory.source.layer = 'shared';
        writeFileSync(cli, `console.log(${JSON.stringify(JSON.stringify(inventory))});`);
        const invoke = (...args: string[]) =>
            spawnSync('node', [join(plugin, 'scripts/inline-run-setup.mjs'), ...args, '--spur-bin', `node ${cli}`], {
                cwd: project,
                encoding: 'utf8',
                timeout: 30_000,
            });
        const setup = invoke('--run-id', 'installed-run', '--file', 'installed-smoke');
        expect(setup.status, setup.stderr).toBe(0);
        const shellAttempt = spawnSync(
            'node',
            [
                join(plugin, 'scripts/inline-run-setup.mjs'),
                '--run-id',
                'shell-attempt',
                '--file',
                'installed-smoke',
                '--spur-bin',
                `node ${cli}; touch shell-marker`,
            ],
            { cwd: project, encoding: 'utf8', timeout: 30_000 },
        );
        expect(shellAttempt.status).toBe(1);
        expect(shellAttempt.stderr).toContain('must not contain shell metacharacters');
        expect(existsSync(join(project, 'shell-marker'))).toBe(false);
        // 0927 R1: the setup outcome lives in the run-record pair, also bundle-only.
        const outcome = JSON.parse(readFileSync(join(project, '.spur/run/installed-run.state.json'), 'utf8')) as Record<
            string,
            unknown
        >;
        expect(outcome).toMatchObject({
            schemaVersion: 1,
            runId: 'installed-run',
            layer: 'shared',
            definitionDigest: inventory.definitionDigest,
        });
        expect(readFileSync(join(project, '.spur/run/installed-run.md'), 'utf8')).toContain(
            '# spur inline run installed-run',
        );
        // 0927 R4: the retired sidecars stay retired on the installed path too.
        expect(existsSync(join(project, '.spur/run/installed-run-inline-setup.json'))).toBe(false);
        expect(existsSync(join(project, '.spur/run/installed-run.log'))).toBe(false);
        expect(invoke('--run-id', 'installed-run', '--file', 'installed-smoke').status).toBe(0);

        // 0927 R3: a project-layer override produces the same record behavior from the
        // bundle-only twin — the source CLI resolves the project copy; the twin revalidates
        // and records the identical identity shape in the pair.
        mkdirSync(join(project, '.spur', 'workflows'), { recursive: true });
        writeFileSync(
            join(project, '.spur', 'workflows', 'installed-smoke.yaml'),
            readFileSync(definition, 'utf8').replace('name: installed-smoke', 'name: installed-smoke\nversion: "2"'),
        );
        const overrideProjection = spawnSync(
            'bun',
            [
                resolve(import.meta.dir, '../../../apps/cli/src/index.ts'),
                'workflow',
                'show',
                'installed-smoke',
                '--format',
                'todo',
                '--json',
            ],
            { cwd: project, encoding: 'utf8', timeout: 30_000 },
        );
        expect(overrideProjection.status, overrideProjection.stderr).toBe(0);
        const overrideInventory = JSON.parse(overrideProjection.stdout) as {
            source: { layer: string; path: string };
            definitionDigest: string;
        };
        // The CLI may realpath the temp dir, so compare by project-layer shape and
        // difference from the shared-layer projection rather than a raw prefix.
        expect(overrideInventory.source.layer).toBe('project');
        expect(overrideInventory.source.path.endsWith('/.spur/workflows/installed-smoke.yaml')).toBe(true);
        expect(overrideInventory.source.path).not.toBe(inventory.source.path);
        expect(overrideInventory.definitionDigest).not.toBe(inventory.definitionDigest);
        writeFileSync(cli, `console.log(${JSON.stringify(JSON.stringify(overrideInventory))});`);
        const overrideSetup = invoke('--run-id', 'override-run', '--file', 'installed-smoke');
        expect(overrideSetup.status, overrideSetup.stderr).toBe(0);
        const overrideState = JSON.parse(
            readFileSync(join(project, '.spur/run/override-run.state.json'), 'utf8'),
        ) as Record<string, unknown>;
        expect(overrideState).toMatchObject({
            schemaVersion: 1,
            runId: 'override-run',
            layer: 'project',
            definitionDigest: overrideInventory.definitionDigest,
        });
        expect(readFileSync(join(project, '.spur/run/override-run.md'), 'utf8')).toContain(
            '# spur inline run override-run',
        );
        expect(existsSync(join(project, '.spur/run/override-run-inline-setup.json'))).toBe(false);
        expect(existsSync(join(project, '.spur/run/override-run.log'))).toBe(false);
        // Restore the shared-layer projection so the drift scenario below keeps pointing at
        // the root definition it rewrites.
        writeFileSync(cli, `console.log(${JSON.stringify(JSON.stringify(inventory))});`);

        expect(spawnSync('git', ['init', '-q'], { cwd: project }).status).toBe(0);
        writeFileSync(join(project, 'source.txt'), 'tracked\n');
        expect(spawnSync('git', ['add', 'source.txt'], { cwd: project }).status).toBe(0);
        expect(
            spawnSync(
                'git',
                ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'],
                { cwd: project },
            ).status,
        ).toBe(0);
        writeFileSync(join(project, 'task.md'), '## 0914. Fixture\n\n### Requirements\n\n- [ ] R1. Fixture\n');
        const fingerprint = invoke('--fingerprint', '--task-file', 'task.md');
        expect(fingerprint.status, fingerprint.stderr).toBe(0);
        expect(fingerprint.stdout.trim()).toMatch(/^sha256:[a-f0-9]{64}$/);
        const action = invoke(
            '--action',
            '--run-id',
            'installed-run',
            '--node',
            'start',
            '--kind',
            'note',
            '--status',
            'done',
            '--ok',
            'true',
            '--duration-ms',
            '12',
        );
        expect(action.status, action.stderr).toBe(0);
        expect(JSON.parse(action.stdout).ok).toBe(true);
        const close = invoke('--close', '--run-id', 'installed-run', '--status', 'done');
        expect(close.status, close.stderr).toBe(0);
        const db = new Database(join(project, '.spur/spur.db'), { readonly: true });
        try {
            expect(db.query('SELECT status FROM runs WHERE id = ?').get('installed-run')).toEqual({ status: 'done' });
            expect(db.query('SELECT COUNT(*) AS count FROM action_runs WHERE run_id = ?').get('installed-run')).toEqual(
                { count: 1 },
            );
        } finally {
            db.close();
        }
        const missingAction = invoke(
            '--action',
            '--run-id',
            'missing-run',
            '--node',
            'start',
            '--kind',
            'note',
            '--status',
            'done',
            '--ok',
            'true',
            '--duration-ms',
            '1',
        );
        expect(missingAction.status).toBe(0);
        expect(JSON.parse(missingAction.stdout).ok).toBe(false);
        expect(invoke('--close', '--run-id', 'missing-run', '--status', 'done').status).toBe(1);
        writeFileSync(definition, readFileSync(definition, 'utf8').replace('installed-smoke', 'drifted'));
        const drift = invoke('--run-id', 'drifted-run', '--file', 'installed-smoke');
        expect(drift.status).toBe(1);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}, 60_000);
