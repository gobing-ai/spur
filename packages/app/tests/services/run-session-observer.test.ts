import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCliMigrations, RunSessionDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { type AgentServiceOutput, RunSessionObserver, type RunSessionOverlapRegistry } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Fixture {
    home: string;
    getDb: () => ReturnType<typeof createDbAdapter> extends Promise<infer T> ? Promise<T> : never;
    registry: RunSessionOverlapRegistry;
    warnings: string[];
    observer: (runId: string, home?: string, cwd?: string) => RunSessionObserver;
}

async function makeFixture(): Promise<Fixture> {
    const home = mkdtempSync(join(tmpdir(), 'spur-run-session-'));
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    const warnings: string[] = [];
    const output: AgentServiceOutput = { write: () => {}, error: (m: string) => warnings.push(m) };
    const registry: RunSessionOverlapRegistry = { active: new Map(), overlapped: new Set() };
    return {
        home,
        getDb: async () => adapter,
        registry,
        warnings,
        observer: (runId, homeOverride, cwd) =>
            new RunSessionObserver({
                runId,
                getDb: async () => adapter,
                output,
                registry,
                home: homeOverride ?? home,
                cwd: cwd ?? process.cwd(),
            }),
    };
}

/** Write a session file at/after the observer's watermark (the run's own write). */
async function writeSessionFile(path: string, content: string): Promise<void> {
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, content);
}

/** Write a session file with a mtime safely before the run's watermark (pre-existing). */
async function writePreExistingSessionFile(path: string, content: string): Promise<void> {
    const fs = await import('node:fs/promises');
    await fs.mkdir(join(path, '..'), { recursive: true });
    await fs.writeFile(path, content);
    const past = new Date(Date.now() - 5_000);
    await fs.utimes(path, past, past);
}

afterEach(async () => {
    // Temp homes are cleaned by each test that created one; nothing global to tear down.
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunSessionObserver (feature E6 / task 0557)', () => {
    test('R1 — one session file written during the run → exact observed mapping', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-1');
            await obs.watermark('pi');
            await writeSessionFile(
                join(fx.home, '.pi', 'agent', 'sessions', '11111111-2222-3333-4444-555555555555.jsonl'),
                '{"id":"11111111-2222-3333-4444-555555555555","type":"user","message":{"role":"user","content":"hi"}}\n',
            );
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-1');
            expect(rows, `warnings: ${fx.warnings.join(' | ')}`).toHaveLength(1);
            expect(rows[0], `warnings: ${fx.warnings.join(' | ')}`).toMatchObject({
                run_id: 'run-1',
                source: 'pi',
                session_id: '11111111-2222-3333-4444-555555555555',
                exactness: 'exact',
                mechanism: 'observed',
            });
            // R4 — both lookup directions resolve.
            expect(await dao.getBySession('pi', '11111111-2222-3333-4444-555555555555')).toHaveLength(1);
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R1 — claude sessions live under a per-project subdir; the walk recurses', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-2');
            await obs.watermark('claude');
            await writeSessionFile(
                join(fx.home, '.claude', 'projects', '-Users-robin', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'),
                '{"sessionId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","type":"user","message":{"content":"hi"}}\n',
            );
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-2');
            expect(rows, `warnings: ${fx.warnings.join(' | ')}`).toHaveLength(1);
            expect(rows[0]?.session_id, `warnings: ${fx.warnings.join(' | ')}`).toBe(
                'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            );
            expect(rows[0]?.exactness).toBe('exact');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R1 — codex session id comes from the session_meta record, not the rollout file stem', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-3');
            await obs.watermark('codex');
            await writeSessionFile(
                join(fx.home, '.codex', 'sessions', '2026', '11', '20', 'rollout-2026-11-20T10-00-00-c0dec0de.jsonl'),
                '{"timestamp":"2026-11-20T10:00:00Z","type":"session_meta","payload":{"id":"c0dec0de-0000-0000-0000-000000000000"}}\n',
            );
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-3');
            expect(rows[0]?.session_id, `warnings: ${fx.warnings.join(' | ')}`).toBe(
                'c0dec0de-0000-0000-0000-000000000000',
            );
            expect(rows[0]?.exactness).toBe('exact');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R2 — supplied session id writes an exact mapping without any directory scan', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-4');
            // The root does not exist at all — observation would find nothing,
            // yet the supplied id is authoritative (R2).
            obs.supply('pi', 'supplied-session-1');
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-4');
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                run_id: 'run-4',
                source: 'pi',
                session_id: 'supplied-session-1',
                exactness: 'exact',
                mechanism: 'supplied',
            });
            expect(fx.warnings).toHaveLength(0);
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R3 — two runs overlapping the same root write no exact mapping and log the ambiguity', async () => {
        const fx = await makeFixture();
        try {
            const a = fx.observer('run-a');
            const b = fx.observer('run-b');
            // Both watermark before either resolves — induced concurrent overlap.
            await a.watermark('pi');
            await b.watermark('pi');
            await writeSessionFile(join(fx.home, '.pi', 'agent', 'sessions', 'shared.jsonl'), '{"id":"shared"}\n');
            await a.resolve();
            await b.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rowsA = await dao.getByRunId('run-a');
            const rowsB = await dao.getByRunId('run-b');
            // R3: zero exact mappings — both degrade to unresolved.
            expect(rowsA.map((r) => r.exactness)).toEqual(['unresolved']);
            expect(rowsB.map((r) => r.exactness)).toEqual(['unresolved']);
            expect(rowsA[0]?.session_id).toBeNull();
            expect(fx.warnings.some((w) => w.includes('ambiguous'))).toBe(true);

            // A subsequent sequential run is clean again — the registry cleared.
            // Push the overlap file's mtime into the past first so it cannot be
            // (mis)counted as a candidate of run-c (sub-ms Date.now() floor).
            const fs = await import('node:fs/promises');
            const sharedPath = join(fx.home, '.pi', 'agent', 'sessions', 'shared.jsonl');
            const past = new Date(Date.now() - 5_000);
            await fs.utimes(sharedPath, past, past);
            const c = fx.observer('run-c');
            await c.watermark('pi');
            await writeSessionFile(join(fx.home, '.pi', 'agent', 'sessions', 'third.jsonl'), '{"id":"third"}\n');
            await c.resolve();
            const rowsC = await dao.getByRunId('run-c');
            expect(rowsC[0]?.exactness).toBe('exact');
            expect(rowsC[0]?.session_id).toBe('third');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('a session file stamped just before the watermark still resolves (filesystem clock skew)', async () => {
        // Linux stamps inodes from a coarse cached clock that lags the precise
        // clock by up to one kernel tick, so a file written microseconds AFTER
        // the watermark can carry an mtime just BEFORE it. Without slack in the
        // watermark the run's own session file drops out of the candidate set
        // and an exact mapping degrades to unresolved — green on macOS, red on
        // Linux CI (2026-08-16 run 31918417004).
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-skew');
            await obs.watermark('pi');
            const path = join(fx.home, '.pi', 'agent', 'sessions', 'skewed-session.jsonl');
            await writeSessionFile(path, '{"id":"skewed-session"}\n');
            const fsp = await import('node:fs/promises');
            const skewed = new Date(Date.now() - 50);
            await fsp.utimes(path, skewed, skewed);
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-skew');
            expect(rows[0]?.session_id, `warnings: ${fx.warnings.join(' | ')}`).toBe('skewed-session');
            expect(rows[0]?.exactness).toBe('exact');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R3 — several files written during the run (zero/many candidates) degrade to unresolved', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-many');
            await obs.watermark('pi');
            await writeSessionFile(join(fx.home, '.pi', 'agent', 'sessions', 'one.jsonl'), '{"id":"one"}\n');
            await writeSessionFile(join(fx.home, '.pi', 'agent', 'sessions', 'two.jsonl'), '{"id":"two"}\n');
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-many');
            expect(rows).toHaveLength(1);
            expect(rows[0]?.exactness).toBe('unresolved');
            expect(rows[0]?.session_id).toBeNull();
            expect(fx.warnings.some((w) => w.includes('2 candidate session files'))).toBe(true);
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R5 — a missing session root records unresolved and never throws', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-missing');
            await obs.watermark('pi'); // ~/.pi/agent/sessions does not exist under fx.home
            await expect(obs.resolve()).resolves.toBeUndefined();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-missing');
            expect(rows).toHaveLength(1);
            expect(rows[0]?.exactness).toBe('unresolved');
            expect(fx.warnings.some((w) => w.includes('resolve failed'))).toBe(true);
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('zero candidates with a readable root also records unresolved (no session produced)', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-zero');
            // A pre-existing file with a mtime before the watermark must NOT be a
            // candidate — only files created/extended during the run count.
            await writePreExistingSessionFile(join(fx.home, '.pi', 'agent', 'sessions', 'old.jsonl'), '{"id":"old"}\n');
            await obs.watermark('pi');
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-zero');
            expect(rows[0]?.exactness).toBe('unresolved');
            expect(rows[0]?.session_id).toBeNull();
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('an agent with no observable session root writes nothing', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-hermes');
            await obs.watermark('hermes');
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            expect(await dao.getByRunId('run-hermes')).toHaveLength(0);
            expect(fx.warnings).toHaveLength(0);
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('a custom sessionDir (workflow-style run-scoped sessions) is observed instead of the home root', async () => {
        const fx = await makeFixture();
        try {
            const sessionDir = join(fx.home, 'workdir', '.spur', 'run', 'wf-1', 'agent-sessions', 'pi');
            const obs = fx.observer('run-wf', fx.home, join(fx.home, 'workdir'));
            await obs.watermark('pi', sessionDir);
            await writeSessionFile(join(sessionDir, 'wf-session-1.jsonl'), '{"id":"wf-session-1"}\n');
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-wf');
            expect(rows[0]?.session_id, `warnings: ${fx.warnings.join(' | ')}`).toBe('wf-session-1');
            expect(rows[0]?.exactness).toBe('exact');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R4 — agy transcript.jsonl derives canonical session id from brain/<uuid> path', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-agy');
            await obs.watermark('antigravity-cli');
            const agyPath = join(
                fx.home,
                '.gemini',
                'antigravity-cli',
                'brain',
                '11111111-1111-4111-8111-111111111111',
                '.system_generated',
                'logs',
                'transcript.jsonl',
            );
            await writeSessionFile(agyPath, '{"type":"USER_INPUT","content":"hello"}\n');
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-agy');
            expect(rows[0]?.session_id, `warnings: ${fx.warnings.join(' | ')}`).toBe(
                '11111111-1111-4111-8111-111111111111',
            );
            expect(rows[0]?.exactness).toBe('exact');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R4 — unreadable codex metadata falls back to canonical uuid in rollout filename', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-codex-unreadable');
            await obs.watermark('codex');
            const codexPath = join(
                fx.home,
                '.codex',
                'sessions',
                '2026',
                '08',
                '23',
                'rollout-2026-08-23T12-00-00-22222222-2222-4222-8222-222222222222.jsonl',
            );
            await writeSessionFile(codexPath, 'INVALID_JSON_FIRST_LINE\n');
            await obs.resolve();

            const dao = new RunSessionDao(await fx.getDb());
            const rows = await dao.getByRunId('run-codex-unreadable');
            expect(rows[0]?.session_id, `warnings: ${fx.warnings.join(' | ')}`).toBe(
                '22222222-2222-4222-8222-222222222222',
            );
            expect(rows[0]?.exactness).toBe('exact');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R4 — codex generic event ids cannot override the canonical rollout path', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-codex-event-id');
            await obs.watermark('codex');
            const codexPath = join(
                fx.home,
                '.codex',
                'sessions',
                '2026',
                '08',
                '23',
                'rollout-2026-08-23T12-00-00-33333333-3333-4333-8333-333333333333.jsonl',
            );
            await writeSessionFile(
                codexPath,
                '{"id":"event-id","type":"response_item","payload":{"id":"payload-id","type":"message"}}\n',
            );
            await obs.resolve();

            const rows = await new RunSessionDao(await fx.getDb()).getByRunId('run-codex-event-id');
            expect(rows[0]?.session_id).toBe('33333333-3333-4333-8333-333333333333');
            expect(rows[0]?.exactness).toBe('exact');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });

    test('R4 — agy transcript without explicit or UUID path identity stays unresolved', async () => {
        const fx = await makeFixture();
        try {
            const obs = fx.observer('run-agy-unresolved');
            await obs.watermark('antigravity-cli');
            await writeSessionFile(
                join(fx.home, '.gemini', 'antigravity-cli', 'brain', 'not-a-uuid', 'logs', 'transcript.jsonl'),
                '{"type":"USER_INPUT","content":"hello"}\n',
            );
            await obs.resolve();

            const rows = await new RunSessionDao(await fx.getDb()).getByRunId('run-agy-unresolved');
            expect(rows[0]?.session_id).toBeNull();
            expect(rows[0]?.exactness).toBe('unresolved');
        } finally {
            rmSync(fx.home, { recursive: true, force: true });
        }
    });
});
