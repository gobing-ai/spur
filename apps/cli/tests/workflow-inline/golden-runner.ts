/**
 * Replays one {@link GoldenCase} through either the retired plugin scripts (`old`, used once to
 * freeze `../fixtures/workflow-inline-golden.json`) or the `spur workflow` CLI (`cli`), and returns
 * the normalized observations both sides are compared on.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { getEnvVar } from '@gobing-ai/spur-config';
import { GIT_ENV, type GoldenCase } from './golden-cases';

export const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
export const CLI = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');

export interface StepObservation {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface CaseObservation {
    steps: StepObservation[];
    artifacts: Record<string, unknown>;
    db: Record<string, unknown>;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Path-, clock- and id-independent text: the only normalization either side receives. */
export function normalize(text: string, root: string): string {
    return (
        text
            .replaceAll(root, '<ROOT>')
            .replaceAll(REPO_ROOT, '<REPO>')
            // The checkout's bundled-asset dir; spelled out it trips the sp-runtime-path rule in fixtures.
            .replaceAll('<REPO>/config/', '<REPO_CONFIG>/')
            .replace(ISO, '<TS>')
            .replace(UUID, '<UUID>')
            .replace(/\bqo-[0-9a-f]+/g, 'qo-<ID>')
            .replace(/"(durationMs|elapsedMs)":\s?\d+/g, '"$1":0')
            .replace(/\b(\d+)ms\b/g, '<N>ms')
    );
}

function listTree(abs: string, base: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(abs).sort()) {
        const p = join(abs, name);
        if (statSync(p).isDirectory()) out.push(...listTree(p, base));
        else out.push(relative(base, p));
    }
    return out;
}

function snapshotArtifacts(root: string, rels: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const rel of rels) {
        const abs = join(root, rel);
        if (!existsSync(abs)) out[rel] = null;
        else if (statSync(abs).isDirectory()) out[rel] = listTree(abs, abs).map((p) => normalize(p, root));
        else out[rel] = normalize(readFileSync(abs, 'utf8'), root);
    }
    return out;
}

function snapshotDb(root: string, spec: GoldenCase['db']): Record<string, unknown> {
    if (spec === undefined) return {};
    const path = join(root, spec.dir ?? '.', '.spur', 'spur.db');
    if (!existsSync(path)) return { missing: true };
    const db = new Database(path, { readonly: true });
    try {
        return Object.fromEntries(spec.queries.map((q) => [q, db.query(q).all()]));
    } finally {
        db.close();
    }
}

/** Child env: hermetic HOME and config, fixed git identity, no ambient spur/host variables. */
export function childEnv(root: string): Record<string, string> {
    return {
        PATH: getEnvVar('PATH') ?? '',
        HOME: `${root}.home`,
        SPUR_SKIP_GLOBAL_CONFIG: 'true',
        ...GIT_ENV,
    };
}

export async function runCase(
    c: GoldenCase,
    side: 'old' | 'cli',
    launch: (side: 'old' | 'cli', script: string, args: string[]) => string[] = defaultLaunch,
): Promise<CaseObservation> {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'spur-wf-inline-golden-')));
    try {
        mkdirSync(`${root}.home`, { recursive: true });
        c.setup(root);
        const steps: StepObservation[] = [];
        for (const step of c.steps) {
            step.before?.(root);
            const proc = Bun.spawn(launch(side, step.script, side === 'old' ? step.old : step.cli), {
                cwd: join(root, step.cwd ?? '.'),
                env: childEnv(root),
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
            steps.push({ exitCode, stdout: normalize(stdout, root), stderr: normalize(stderr, root) });
        }
        return { steps, artifacts: snapshotArtifacts(root, c.artifacts ?? []), db: snapshotDb(root, c.db) };
    } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(`${root}.home`, { recursive: true, force: true });
    }
}

function defaultLaunch(side: 'old' | 'cli', script: string, args: string[]): string[] {
    return side === 'old'
        ? [process.execPath, join(REPO_ROOT, 'plugins', 'sp', 'scripts', `${script}.ts`), ...args]
        : [process.execPath, CLI, 'workflow', ...args];
}
