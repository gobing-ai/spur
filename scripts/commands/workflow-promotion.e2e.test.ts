import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

/**
 * `promotion evaluate|check|resolve` through the REAL dispatcher (A93 1356 R4).
 *
 * The extraction moved the measurement/verdict into `@gobing-ai/spur-app`, so these cases drive
 * `bun scripts/spur-dev.ts promotion <op>` end to end against disposable fixtures: a candidate
 * catalogue, a `config/workflows` tree and an isolated SQLite history plane. Failure modes first —
 * unmeasured promotion, a graph that does not reduce actions, a pinned-baseline regression, a
 * missing candidate and a contradicting resolve.
 */

const REPO_ROOT = join(import.meta.dir, '..', '..');
let root = '';
let configPath = '';
let dbPath = '';
let workflowsDir = '';

const NOW = '2026-11-16T12:00:00.000Z';

interface Candidate {
    id: string;
    canonical: string;
    deadline: string;
    createdAt: string;
    rationale: string;
    measurement: { workflow: string };
    delta: { agentRunCount: number; baselineAgentRunCount?: number };
    verdict: unknown;
}

/** Write the fixture tree: candidate catalogue + one canonical workflow declaring 3 agent.run actions. */
async function fixture(candidates: Candidate[]): Promise<void> {
    root = await mkdtemp(join(tmpdir(), 'promotion-e2e-'));
    configPath = join(root, 'workflow-candidates.json');
    dbPath = join(root, 'spur.db');
    workflowsDir = join(root, 'workflows');
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(configPath, `${JSON.stringify({ schemaVersion: 1, candidates }, null, 2)}\n`);
    // The resolver reads actions from `states[].onEnter`; three `agent.run` actions = the ADR-076 bar.
    await writeFile(
        join(workflowsDir, 'task-pipeline.yaml'),
        [
            'kind: state-machine',
            'name: task-pipeline',
            'version: "1"',
            'states:',
            '  - id: implement',
            '    initial: true',
            '    onEnter:',
            '      - kind: agent.run',
            '        options:',
            '          prompt: a',
            '      - kind: agent.run',
            '        options:',
            '          prompt: b',
            '      - kind: agent.run',
            '        options:',
            '          prompt: c',
            '  - id: done',
            '    terminal: true',
            'transitions:',
            '  - from: implement',
            '    to: done',
            '    guard:',
            '      kind: always',
            '',
        ].join('\n'),
    );
}

/** Seed the history plane directly (fixture setup; never live run data). */
function seedHistory(realRuns: number): void {
    const db = new Database(dbPath);
    db.run(
        'CREATE TABLE runs (id TEXT, workflow_name TEXT, status TEXT, started_at TEXT, completed_at TEXT, metadata_json TEXT)',
    );
    db.run('CREATE TABLE action_runs (id TEXT, run_id TEXT, node TEXT, kind TEXT, status TEXT, duration_ms INTEGER)');
    const insRun = db.query("INSERT INTO runs VALUES (?, 'task-pipeline', 'done', ?, ?, '{}')");
    const insAction = db.query('INSERT INTO action_runs VALUES (?, ?, ?, ?, ?, ?)');
    for (let index = 0; index < realRuns; index += 1) {
        const started = `2026-08-2${index}T00:00:00.000Z`;
        const completed = `2026-08-2${index}T00:30:00.000Z`;
        insRun.run(`run-${index}`, started, completed);
        insAction.run(`run-${index}-a1`, `run-${index}`, 'implement', 'agent.run', 'done', 100);
        insAction.run(`run-${index}-a2`, `run-${index}`, 'review', 'agent.run', 'done', 200);
    }
    db.close();
}

function promotion(args: string[]): { code: number; stdout: string; stderr: string } {
    const result = Bun.spawnSync(['bun', 'scripts/spur-dev.ts', 'promotion', ...args], {
        cwd: REPO_ROOT,
        env: { ...getEnvVars() },
    });
    return { code: result.exitCode ?? 1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

/** The persisted verdict of the single fixture candidate. */
async function savedVerdict(): Promise<{ decision: string; evaluatedAt?: string; reason: string }> {
    const saved = JSON.parse(await readFile(configPath, 'utf-8')) as { candidates: { verdict: unknown }[] };
    const verdict = saved.candidates[0]?.verdict;
    if (verdict === null || typeof verdict !== 'object') throw new Error('fixture candidate has no recorded verdict');
    return verdict as { decision: string; evaluatedAt?: string; reason: string };
}

const evaluateArgs = (id: string): string[] => [
    'evaluate',
    id,
    '--db',
    dbPath,
    '--config',
    configPath,
    '--workflows-dir',
    workflowsDir,
    '--now',
    NOW,
];

const baseCandidate = (over: Partial<Candidate> = {}): Candidate => ({
    id: 'c1',
    canonical: 'task-pipeline',
    deadline: '2026-12-01',
    createdAt: '2026-11-01',
    rationale: 'fixture candidate',
    measurement: { workflow: 'task-pipeline' },
    delta: { agentRunCount: 2 },
    verdict: null,
    ...over,
});

beforeEach(() => {
    root = '';
});

afterEach(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true });
});

describe('promotion evaluate through the dispatcher', () => {
    test('a measured reduction promotes and records the fixed evaluation time', async () => {
        await fixture([baseCandidate()]);
        seedHistory(2);
        const result = promotion(evaluateArgs('c1'));
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain('promote');
        const verdict = await savedVerdict();
        expect(verdict.decision).toBe('promote');
        expect(verdict.evaluatedAt).toBe(NOW);
        expect(verdict.reason).toContain('2 real run(s)');
    });

    test('an equal action count is rejected by the ADR-076 bar', async () => {
        await fixture([baseCandidate({ delta: { agentRunCount: 3 } })]);
        seedHistory(2);
        const result = promotion(evaluateArgs('c1'));
        expect(result.code).toBe(0);
        const saved = await savedVerdict();
        expect(saved.decision).toBe('delete');
    });

    test('zero real runs cannot promote, however small the projection', async () => {
        await fixture([baseCandidate({ delta: { agentRunCount: 1 } })]);
        seedHistory(0);
        const result = promotion(evaluateArgs('c1'));
        expect(result.code).toBe(0);
        const verdict = await savedVerdict();
        expect(verdict.decision).toBe('delete');
        expect(verdict.reason).toContain('no measured real-run history');
    });

    test('a pinned baseline still promotes an already-applied change', async () => {
        await fixture([baseCandidate({ delta: { agentRunCount: 3, baselineAgentRunCount: 4 } })]);
        seedHistory(3);
        const result = promotion(evaluateArgs('c1'));
        expect(result.code).toBe(0);
        const verdict = await savedVerdict();
        expect(verdict.decision).toBe('promote');
        expect(verdict.reason).toContain('incumbent baseline of 4');
    });

    test('an unknown candidate fails loudly instead of writing', async () => {
        await fixture([baseCandidate()]);
        seedHistory(1);
        const result = promotion(evaluateArgs('nope'));
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('candidate nope not found');
        const saved = JSON.parse(await readFile(configPath, 'utf-8')) as { candidates: Candidate[] };
        expect(saved.candidates[0]?.verdict).toBeNull();
    });
});

describe('promotion resolve through the dispatcher', () => {
    test('a verdict the operator contradicts is refused and the candidate is kept', async () => {
        await fixture([
            baseCandidate({
                verdict: { decision: 'delete', evaluatedAt: NOW },
            }),
        ]);
        const result = promotion([
            'resolve',
            'c1',
            '--decision',
            'promote',
            '--config',
            configPath,
            '--workflows-dir',
            workflowsDir,
        ]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('contradicts');
        const saved = JSON.parse(await readFile(configPath, 'utf-8')) as { candidates: Candidate[] };
        expect(saved.candidates).toHaveLength(1);
    });

    test('a matching decision removes the candidate', async () => {
        await fixture([baseCandidate({ verdict: { decision: 'delete', evaluatedAt: NOW } })]);
        const result = promotion([
            'resolve',
            'c1',
            '--decision',
            'delete',
            '--config',
            configPath,
            '--workflows-dir',
            workflowsDir,
        ]);
        expect(result.code, result.stderr).toBe(0);
        const saved = JSON.parse(await readFile(configPath, 'utf-8')) as { candidates: Candidate[] };
        expect(saved.candidates).toEqual([]);
    });
});

describe('promotion check through the dispatcher', () => {
    test('an expired candidate fails the gate and names the deadline', async () => {
        await fixture([baseCandidate({ deadline: '2026-01-01' })]);
        // An explicit, absent fixture DB keeps the retirement guard from reading this checkout's live
        // history (the guard only runs when the named DB exists).
        const result = promotion([
            'check',
            '--config',
            configPath,
            '--workflows-dir',
            workflowsDir,
            '--now',
            NOW,
            '--db',
            join(root, 'no-history.db'),
        ]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('2026-01-01');
    });

    test('a fresh catalogue passes', async () => {
        await fixture([baseCandidate({ deadline: '2026-12-01' })]);
        // An explicit, absent fixture DB keeps the retirement guard from reading this checkout's live
        // history (the guard only runs when the named DB exists).
        const result = promotion([
            'check',
            '--config',
            configPath,
            '--workflows-dir',
            workflowsDir,
            '--now',
            NOW,
            '--db',
            join(root, 'no-history.db'),
        ]);
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).toContain('PASS');
    });
});
