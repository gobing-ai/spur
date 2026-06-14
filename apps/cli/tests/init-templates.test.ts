import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/index';
import type { CommandOutput } from '../src/output';
import { createTempProject } from './helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

/** Build main() options with the global rules seed redirected to an isolated temp dir. */
async function isolatedOptions(cwd: string) {
    const globalDir = await mkdtemp(join(tmpdir(), 'spur-glob-'));
    const env = { ...process.env, SPUR_GLOBAL_RULES_DIR: globalDir };
    return { options: { cwd, env, output: nullOutput(), dbUrl: ':memory:' as const }, globalDir };
}

describe('spur init template copy', () => {
    test('templates are copied to .spur/config/templates/', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        const base = join(cwd, '.spur', 'config', 'templates');
        expect(existsSync(join(base, 'task', 'default.md'))).toBe(true);
        expect(existsSync(join(base, 'task', 'feature-impl.md'))).toBe(true);
        expect(existsSync(join(base, 'task', 'issue.md'))).toBe(true);
        expect(existsSync(join(base, 'task', 'review.md'))).toBe(true);
        expect(existsSync(join(base, 'task', 'meta.md'))).toBe(true);
        expect(existsSync(join(base, 'feature', 'default.md'))).toBe(true);
        expect(existsSync(join(base, 'bdd', 'gherkin.md'))).toBe(true);
        expect(existsSync(join(base, 'bdd', 'checklist.md'))).toBe(true);
    });

    test('bundled template files exist at source', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-init-test-'));
        const bundledTaskDir = join(process.cwd(), 'config', 'templates', 'task');
        expect(existsSync(bundledTaskDir)).toBe(true);
        expect(existsSync(join(bundledTaskDir, 'default.md'))).toBe(true);
        expect(existsSync(join(bundledTaskDir, 'feature-impl.md'))).toBe(true);
        expect(existsSync(join(bundledTaskDir, 'issue.md'))).toBe(true);
        expect(existsSync(join(bundledTaskDir, 'review.md'))).toBe(true);
        expect(existsSync(join(bundledTaskDir, 'meta.md'))).toBe(true);
        await rm(dir, { recursive: true });
    });

    test('template files have valid frontmatter', () => {
        const defaultContent = readFileSync('config/templates/task/default.md', 'utf-8');
        expect(defaultContent).toContain('schema_version: 1');
        expect(defaultContent).toContain('status: backlog');
        expect(defaultContent).toContain('{{ NAME }}');
    });

    test('feature template has auto-generated tasks marker', () => {
        const featureContent = readFileSync('config/templates/feature/default.md', 'utf-8');
        expect(featureContent).toContain('BEGIN_TASKS');
        expect(featureContent).toContain('END_TASKS');
    });

    test('init is idempotent — re-init does not overwrite templates without --force', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        // First init — templates are created.
        expect(await main(['init'], options)).toBe(0);
        const tmplPath = join(cwd, '.spur', 'config', 'templates', 'task', 'default.md');
        expect(existsSync(tmplPath)).toBe(true);

        // Modify the template in-place to add a marker.
        const original = readFileSync(tmplPath, 'utf-8');
        const marker = '<!-- IDEMPOTENCE MARKER -->';
        writeFileSync(tmplPath, `${original}\n${marker}`, 'utf-8');

        // Re-init without --force is blocked (config.yaml already exists).
        expect(await main(['init'], options)).toBe(1);
        // Template still has our marker — not overwritten.
        const after = readFileSync(tmplPath, 'utf-8');
        expect(after).toContain(marker);

        // Re-init with --force does overwrite.
        expect(await main(['init', '--force'], options)).toBe(0);
        const forced = readFileSync(tmplPath, 'utf-8');
        expect(forced).not.toContain(marker);
    });

    test('section-matrix.yaml is copied to .spur/config/tasks/', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        const matrixPath = join(cwd, '.spur', 'config', 'tasks', 'section-matrix.yaml');
        expect(existsSync(matrixPath)).toBe(true);
        const content = readFileSync(matrixPath, 'utf-8');
        expect(content).toContain('variants:');
    });

    test('workflow lifecycle and pipeline YAMLs are copied to .spur/config/workflows/', async () => {
        const cwd = await createTempProject();
        const { options } = await isolatedOptions(cwd);

        expect(await main(['init'], options)).toBe(0);

        const wfDir = join(cwd, '.spur', 'config', 'workflows');
        expect(existsSync(join(wfDir, 'task-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(wfDir, 'feature-lifecycle.yaml'))).toBe(true);
        expect(existsSync(join(wfDir, 'task-pipeline.yaml'))).toBe(true);
    });
});
