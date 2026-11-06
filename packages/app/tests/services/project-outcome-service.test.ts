/**
 * Project outcome service (task 1308). Fixtures precede the composition:
 * empty and unavailable proof, until-bound exclusion, partial USD, verified
 * task counts, gate timestamps, and the evidence cap.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCliMigrations, type DbAdapter, RunSessionDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { summarizeProjectOutcome } from '../../src/services/project-outcome';

const SINCE = '2026-08-20T00:00:00.000Z';
const UNTIL = '2026-08-20T23:00:00.000Z';
const WINDOW = { since: SINCE, until: UNTIL };
const PASS_REQUIREMENTS = [{ id: 'R1', status: 'MET', evidence: 'fixture implementation verified' }];

const temps: string[] = [];

afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openDb(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    return db;
}

async function insertRun(
    db: DbAdapter,
    id: string,
    workflow: string,
    status: string,
    startedAt: string,
    completedAt: string,
    opts: { dryRun?: boolean; createdAt?: number; terminalReason?: string | null } = {},
): Promise<void> {
    await db.run(
        `INSERT INTO runs (
            id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json,
            created_at, updated_at, terminal_reason
         ) VALUES (?, ?, 'auto', ?, NULL, ?, ?, ?, ?, ?, ?)`,
        id,
        workflow,
        status,
        startedAt,
        completedAt,
        opts.dryRun === true ? '{"dryRun":true}' : '{}',
        opts.createdAt ?? Date.parse(startedAt),
        Date.parse(completedAt),
        opts.terminalReason ?? null,
    );
}

async function insertExactCost(
    db: DbAdapter,
    runId: string,
    sessionId: string,
    messages: ReadonlyArray<{ cost: number | null; input: number; output: number }>,
    exactness: 'exact' | 'estimated' = 'exact',
): Promise<void> {
    await new RunSessionDao(db).insert({
        runId,
        source: 'fixture',
        sessionId,
        exactness,
        mechanism: exactness === 'estimated' ? 'inferred' : 'observed',
        resolvedAt: SINCE,
    });
    let seq = 1;
    for (const message of messages) {
        await db.run(
            `INSERT INTO history_message (
                record_hash, source, source_file, source_line, session_id, seq, role, record_type,
                disposition, ts, model, input_tokens, output_tokens, cost_usd, provenance, imported_at
             ) VALUES (?, 'fixture', 'fixture.jsonl', 1, ?, ?, 'assistant', 'message', 'conversation',
                       ?, 'fixture', ?, ?, ?, 'ambient', ?)`,
            `${runId}:${seq}`,
            sessionId,
            seq,
            SINCE,
            message.input,
            message.output,
            message.cost,
            SINCE,
        );
        seq += 1;
    }
}

async function insertGate(
    db: DbAdapter,
    id: string,
    runId: string,
    node: string,
    kind: string,
    startedAt: string | null,
    completedAt: string | null,
): Promise<void> {
    await db.run(
        `INSERT INTO action_runs (
            id, run_id, node, kind, status, duration_ms, ok, result_json, started_at, completed_at, created_at
         ) VALUES (?, ?, ?, ?, 'done', 999999, 1, '{}', ?, ?, ?)`,
        id,
        runId,
        node,
        kind,
        startedAt,
        completedAt,
        Date.parse(SINCE),
    );
}

function corpusFs(): FileSystem {
    return {
        exists: async (path: string) => existsSync(path),
        readFile: async (path: string) => readFileSync(path, 'utf8'),
    } as FileSystem;
}

function writeTask(cwd: string, wbs: string, body: string, verdict?: Record<string, unknown>): void {
    mkdirSync(join(cwd, 'tasks'), { recursive: true });
    writeFileSync(join(cwd, 'tasks', `${wbs}.md`), body);
    if (verdict) {
        mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
        writeFileSync(join(cwd, '.spur', 'run', `${wbs}-verdict.json`), JSON.stringify({ wbs, ...verdict }));
    }
}

describe('summarizeProjectOutcome', () => {
    test('empty window is a zero-denominator verification, not null, and unmeasured cost stays null', async () => {
        const db = await openDb();
        const cwd = mkdtempSync(join(tmpdir(), 'po-empty-'));
        temps.push(cwd);
        try {
            const outcome = await summarizeProjectOutcome(
                { db, cwd, fs: corpusFs(), locator: { findByWbs: async () => null } },
                WINDOW,
            );
            expect(outcome.verified).not.toBeNull();
            expect(outcome.verified?.taskDenominator).toBe(0);
            expect(outcome.verified?.verifiedResults).toBe(0);
            expect(outcome.measuredUsd).toBeNull();
            expect(outcome.tokens).toBeNull();
            expect(outcome.terminalRuns).toBe(0);
            expect(outcome.unknownUsdRows).toBe(0);
            expect(outcome.unknownCostRunCount).toBe(0);
            expect(outcome.gateDurationMs).toBeNull();
            expect(outcome.gateSampleCount).toBe(0);
            expect(outcome.evidence).toEqual([]);
            expect(outcome.evidenceTruncated).toBe(false);
        } finally {
            db.close();
        }
    });

    test('missing corpus leaves verified null while measured cost still folds', async () => {
        const db = await openDb();
        try {
            await insertRun(db, 'run-known', 'alpha', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T02:00:00.000Z', {
                terminalReason: 'done',
            });
            await insertExactCost(db, 'run-known', 'sess-known', [{ cost: 0.25, input: 100, output: 40 }]);
            const outcome = await summarizeProjectOutcome({ db }, WINDOW);
            expect(outcome.verified).toBeNull();
            expect(outcome.measuredUsd).toBeCloseTo(0.25, 6);
            expect(outcome.tokens).toBe(140);
            expect(outcome.terminalReasonMix.done).toBe(1);
        } finally {
            db.close();
        }
    });

    test('an unmigrated measurement plane throws instead of inventing zeros', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        try {
            await expect(summarizeProjectOutcome({ db }, WINDOW)).rejects.toThrow();
        } finally {
            db.close();
        }
    });

    test('rejects a window that is not ISO', async () => {
        const db = await openDb();
        try {
            await expect(summarizeProjectOutcome({ db }, { since: 'nope', until: UNTIL })).rejects.toThrow(
                'valid ISO range',
            );
        } finally {
            db.close();
        }
    });

    test('drops runs outside the startedAt window even when created_at is inside since', async () => {
        const db = await openDb();
        try {
            const insideCreated = Date.parse(SINCE) + 1_000;
            await insertRun(db, 'run-in', 'pipe', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:05:00.000Z');
            await insertExactCost(db, 'run-in', 'sess-in', [{ cost: 0.25, input: 10, output: 0 }]);
            await insertRun(db, 'run-after', 'pipe', 'done', '2026-08-21T03:00:00.000Z', '2026-08-21T04:00:00.000Z', {
                createdAt: insideCreated,
            });
            await insertExactCost(db, 'run-after', 'sess-after', [{ cost: 9, input: 10, output: 0 }]);
            await insertRun(db, 'run-before', 'pipe', 'done', '2026-08-19T03:00:00.000Z', '2026-08-19T04:00:00.000Z', {
                createdAt: insideCreated,
            });
            await insertExactCost(db, 'run-before', 'sess-before', [{ cost: 9, input: 10, output: 0 }]);
            const outcome = await summarizeProjectOutcome({ db }, WINDOW);
            expect(outcome.measuredUsd).toBeCloseTo(0.25, 6);
            expect(outcome.terminalRuns).toBe(1);
            expect(outcome.evidence.map((row) => row.runId)).toEqual(['run-in']);
        } finally {
            db.close();
        }
    });

    test('partial USD sums only persisted dollars and keeps the unknown row and run', async () => {
        const db = await openDb();
        try {
            await insertRun(db, 'run-partial', 'pipe', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T02:00:00.000Z');
            await insertExactCost(db, 'run-partial', 'sess-partial', [
                { cost: 0.5, input: 10, output: 5 },
                { cost: null, input: 3, output: 2 },
            ]);
            const outcome = await summarizeProjectOutcome({ db }, WINDOW);
            expect(outcome.measuredUsd).toBeCloseTo(0.5, 6);
            expect(outcome.tokens).toBe(20);
            expect(outcome.historyRows).toBe(2);
            expect(outcome.usdRows).toBe(1);
            expect(outcome.unknownUsdRows).toBe(1);
            expect(outcome.unknownCostRunCount).toBe(1);
            expect(outcome.evidence[0]?.unknownUsdRows).toBe(1);
        } finally {
            db.close();
        }
    });

    test('folds two workflows once and excludes dry, estimated, and unmapped runs from measured USD', async () => {
        const db = await openDb();
        try {
            await insertRun(db, 'run-a', 'alpha', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:30:00.000Z', {
                terminalReason: 'done',
            });
            await insertExactCost(db, 'run-a', 'sess-a', [{ cost: 0.25, input: 4, output: 1 }]);
            await insertRun(db, 'run-b', 'beta', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:30:00.000Z', {
                terminalReason: 'done',
            });
            await insertExactCost(db, 'run-b', 'sess-b', [{ cost: 0.5, input: 1, output: 1 }]);
            await insertRun(db, 'run-dry', 'alpha', 'done', '2026-08-20T03:00:00.000Z', '2026-08-20T04:00:00.000Z', {
                dryRun: true,
            });
            await insertExactCost(db, 'run-dry', 'sess-dry', [{ cost: 8, input: 1, output: 1 }]);
            await insertRun(db, 'run-est', 'alpha', 'done', '2026-08-20T04:00:00.000Z', '2026-08-20T04:10:00.000Z');
            await insertExactCost(db, 'run-est', 'sess-est', [{ cost: 4, input: 1, output: 1 }], 'estimated');
            await insertRun(db, 'run-none', 'beta', 'done', '2026-08-20T04:30:00.000Z', '2026-08-20T04:40:00.000Z');
            await insertRun(db, 'run-open', 'alpha', 'running', '2026-08-20T06:00:00.000Z', '2026-08-20T06:05:00.000Z');
            await insertExactCost(db, 'run-open', 'sess-open', [{ cost: 3, input: 1, output: 1 }]);
            const outcome = await summarizeProjectOutcome({ db }, WINDOW);
            expect(outcome.measuredUsd).toBeCloseTo(0.75, 6);
            expect(outcome.tokens).toBe(7);
            expect(outcome.mappedRuns).toBe(2);
            expect(outcome.terminalRuns).toBe(4);
            expect(outcome.unknownCostRunCount).toBe(2);
            expect(outcome.evidence.map((row) => row.runId)).toEqual(['run-a', 'run-b', 'run-est', 'run-none']);
            expect(outcome.evidence.find((row) => row.runId === 'run-est')?.measuredUsd).toBeNull();
            expect(outcome.evidence.find((row) => row.runId === 'run-none')?.measuredUsd).toBeNull();
        } finally {
            db.close();
        }
    });

    test('verified counts follow derivation: forced and unproved done stay out, retry is a task count', async () => {
        const db = await openDb();
        const cwd = mkdtempSync(join(tmpdir(), 'po-verified-'));
        temps.push(cwd);
        writeTask(
            cwd,
            '1308',
            `---
wbs: "1308"
status: done
---

## History

- 2026-08-20T10:00:00.000Z todo → wip (system)
- 2026-08-20T11:00:00.000Z wip → done (system)
- 2026-08-20T11:30:00.000Z done → wip (system)
- 2026-08-20T12:00:00.000Z wip → done (system)

## Testing

- [x] R1. covered
  - Verdict: PASS (from verdict artifact)
`,
            { verdict: 'PASS', requirements: PASS_REQUIREMENTS, proofDigest: 'sha256:abc' },
        );
        writeTask(
            cwd,
            '1309',
            `---
wbs: "1309"
status: done
done_forced: true
---

## History

- 2026-08-20T10:00:00.000Z todo → wip (system)
- 2026-08-20T11:00:00.000Z wip → done (system)
`,
        );
        writeTask(
            cwd,
            '1310',
            `---
wbs: "1310"
status: todo
---

## History

- 2026-08-20T10:00:00.000Z todo → wip (system)
`,
        );
        writeTask(
            cwd,
            '1311',
            `---
wbs: "1311"
status: done
---

## History

- 2026-08-20T10:00:00.000Z todo → wip (system)
- 2026-08-20T11:00:00.000Z wip → done (system)
`,
        );
        try {
            await insertRun(
                db,
                'run-1308',
                'task-pipeline',
                'done',
                '2026-08-20T10:00:00.000Z',
                '2026-08-20T12:00:00.000Z',
            );
            await insertRun(
                db,
                'run-1309',
                'task-pipeline',
                'done',
                '2026-08-20T10:00:00.000Z',
                '2026-08-20T11:00:00.000Z',
            );
            await insertRun(
                db,
                'run-1310',
                'task-pipeline',
                'failed',
                '2026-08-20T10:00:00.000Z',
                '2026-08-20T10:30:00.000Z',
            );
            await insertRun(
                db,
                'run-1311',
                'task-pipeline',
                'done',
                '2026-08-20T10:00:00.000Z',
                '2026-08-20T11:00:00.000Z',
            );
            for (const [id, wbs] of [
                ['link-1308', '1308'],
                ['link-1309', '1309'],
                ['link-1310', '1310'],
                ['link-1311', '1311'],
            ] as const) {
                await db.run(
                    `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES (?, ?, ?, 'pipeline', ?)`,
                    id,
                    wbs,
                    `run-${wbs}`,
                    SINCE,
                );
            }
            for (let attempt = 0; attempt < 3; attempt++) {
                await insertGate(db, `attempt-${attempt}`, 'run-1310', 'implement', 'agent.run', SINCE, UNTIL);
            }
            const outcome = await summarizeProjectOutcome(
                {
                    db,
                    cwd,
                    fs: corpusFs(),
                    locator: {
                        findByWbs: async (wbs: string) => ({ filePath: join(cwd, 'tasks', `${wbs}.md`) }),
                    },
                },
                WINDOW,
            );
            expect(outcome.verified?.taskDenominator).toBe(4);
            expect(outcome.verified?.verifiedResults).toBe(1);
            expect(outcome.verified?.correctionCount).toBe(1);
            expect(outcome.verified?.retryExhaustedCount).toBe(1);
            expect(outcome.verified?.excludedReasons.forcedDone).toBe(1);
            expect(outcome.verified?.excludedReasons.notDone).toBe(1);
            expect(outcome.verified?.excludedReasons.missingVerdict).toBe(1);
            expect(outcome.verified?.timeToVerified.count).toBe(1);
            expect(outcome.verified?.timeToVerified.meanMs).toBe(2 * 60 * 60 * 1000);
        } finally {
            db.close();
        }
    });

    test('gate duration sums retained gate timestamps and ignores wall clock', async () => {
        const db = await openDb();
        try {
            await insertRun(db, 'run-gate', 'pipe', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T02:00:00.000Z');
            await insertGate(
                db,
                'g1',
                'run-gate',
                'gate',
                'command.gate',
                '2026-08-20T01:00:00.000Z',
                '2026-08-20T01:00:05.000Z',
            );
            await insertGate(
                db,
                'g2',
                'run-gate',
                'gate',
                'command.gate',
                '2026-08-20T01:10:00.000Z',
                '2026-08-20T01:10:01.000Z',
            );
            await insertGate(
                db,
                'g0',
                'run-gate',
                'gate',
                'command.gate',
                '2026-08-20T01:20:00.000Z',
                '2026-08-20T01:20:00.000Z',
            );
            await insertGate(
                db,
                'g-back',
                'run-gate',
                'gate',
                'command.gate',
                '2026-08-20T01:30:00.000Z',
                '2026-08-20T01:29:00.000Z',
            );
            await insertGate(db, 'g-open', 'run-gate', 'gate', 'command.gate', '2026-08-20T01:40:00.000Z', null);
            await insertGate(
                db,
                'g-kind',
                'run-gate',
                'gate',
                'agent.run',
                '2026-08-20T01:00:00.000Z',
                '2026-08-20T01:00:09.000Z',
            );
            await insertGate(
                db,
                'g-node',
                'run-gate',
                'implement',
                'command.gate',
                '2026-08-20T01:00:00.000Z',
                '2026-08-20T01:00:09.000Z',
            );
            await insertGate(db, 'g-bad', 'run-gate', 'gate', 'command.gate', 'not-a-time', '2026-08-20T01:00:09.000Z');
            await insertRun(db, 'run-dry', 'pipe', 'done', '2026-08-20T03:00:00.000Z', '2026-08-20T04:00:00.000Z', {
                dryRun: true,
            });
            await insertGate(
                db,
                'g-dry',
                'run-dry',
                'gate',
                'command.gate',
                '2026-08-20T03:00:00.000Z',
                '2026-08-20T03:00:50.000Z',
            );
            await insertRun(db, 'run-live', 'pipe', 'running', '2026-08-20T05:00:00.000Z', '2026-08-20T06:00:00.000Z');
            await insertGate(
                db,
                'g-live',
                'run-live',
                'gate',
                'command.gate',
                '2026-08-20T05:00:00.000Z',
                '2026-08-20T05:00:50.000Z',
            );
            const outcome = await summarizeProjectOutcome({ db }, WINDOW);
            expect(outcome.gateDurationMs).toBe(6_000);
            expect(outcome.gateSampleCount).toBe(3);
            expect(outcome.gateDurationMs).not.toBe(60 * 60 * 1000);
        } finally {
            db.close();
        }
    });

    test('evidence sorts by startedAt then runId and keeps the lexicographically smallest wbs', async () => {
        const db = await openDb();
        try {
            await insertRun(db, 'z-run', 'pipe', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:05:00.000Z');
            await insertRun(db, 'b-run', 'pipe', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z');
            await insertRun(db, 'a-run', 'pipe', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z');
            await db.run(
                `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES ('l1', '2000', 'z-run', 'pipeline', ?)`,
                SINCE,
            );
            await db.run(
                `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES ('l2', '1308', 'z-run', 'pipeline', ?)`,
                SINCE,
            );
            const outcome = await summarizeProjectOutcome({ db }, WINDOW);
            expect(outcome.evidence.map((row) => row.runId)).toEqual(['z-run', 'a-run', 'b-run']);
            expect(outcome.evidence[0]?.wbs).toBe('1308');
            expect(outcome.evidenceTruncated).toBe(false);
        } finally {
            db.close();
        }
    });

    test('evidence caps at 100 while aggregates include the unlisted run', async () => {
        const db = await openDb();
        try {
            const base = Date.parse('2026-08-20T01:00:00.000Z');
            for (let i = 0; i <= 100; i++) {
                const started = new Date(base + i * 1000).toISOString();
                const completed = new Date(base + i * 1000 + 500).toISOString();
                await insertRun(db, `cap-${String(i).padStart(3, '0')}`, 'pipe', 'done', started, completed);
            }
            const last = 'cap-100';
            await insertExactCost(db, last, 'sess-last', [{ cost: 0.25, input: 2, output: 2 }]);
            await insertGate(
                db,
                'gate-last',
                last,
                'gate',
                'command.gate',
                '2026-08-20T01:01:40.000Z',
                '2026-08-20T01:01:44.000Z',
            );
            await db.run(
                `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES ('l-cap', '1308', 'cap-000', 'pipeline', ?)`,
                SINCE,
            );
            const outcome = await summarizeProjectOutcome({ db }, WINDOW);
            expect(outcome.terminalRuns).toBe(101);
            expect(outcome.evidence).toHaveLength(100);
            expect(outcome.evidence[0]?.runId).toBe('cap-000');
            expect(outcome.evidence[0]?.wbs).toBe('1308');
            expect(outcome.evidence.some((row) => row.runId === last)).toBe(false);
            expect(outcome.evidenceTruncated).toBe(true);
            expect(outcome.measuredUsd).toBeCloseTo(0.25, 6);
            expect(outcome.gateSampleCount).toBe(1);
            expect(outcome.gateDurationMs).toBe(4_000);
            expect(outcome.unknownCostRunCount).toBe(100);
        } finally {
            db.close();
        }
    });
});
