/**
 * Unit tests for the CLI completion-trigger call site (task 0549):
 * `maybeTriggerHistoryRefresh` resolves the opt-in config from the project
 * config file, enqueues the coalesced job, and emits an observable
 * `history.refresh.enqueued` ledger row. Disabled/absent config → no DB job,
 * no event, no error output. Trigger failures never throw.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { createMigratedDbAdapter } from '../src/context';
import { type HistoryRefreshContext, maybeTriggerHistoryRefresh } from '../src/history-refresh';
import { type CapturedOutput, createCapturedOutput } from './helpers';

interface Project {
    cwd: string;
    output: CapturedOutput;
    context: HistoryRefreshContext;
}

/** Scaffold a tmp project with an optional `.spur/config.yaml` body. */
async function project(configYaml: string | null): Promise<Project> {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-refresh-'));
    if (configYaml !== null) {
        mkdirSync(join(cwd, '.spur'), { recursive: true });
        writeFileSync(join(cwd, '.spur', 'config.yaml'), configYaml);
    }
    const output = createCapturedOutput();
    const db = await createMigratedDbAdapter(cwd, {});
    // A5/ADR-082: merged config is threaded on the context; load it through the same
    // loader the composition root uses so the type matches HistoryRefreshContext.
    const spurConfig = configYaml === null ? undefined : await loadSpurConfig(cwd);
    const context: HistoryRefreshContext = { cwd, env: {}, getDb: async () => db, output, spurConfig };
    return { cwd, output, context };
}

function cleanup(p: Project): void {
    rmSync(p.cwd, { recursive: true, force: true });
}

async function jobRows(p: Project): Promise<Array<{ id: string; type: string; status: string }>> {
    const db = await p.context.getDb();
    return db.queryAll("SELECT id, type, status FROM queue_jobs WHERE type = 'history.refresh'");
}

async function eventRows(p: Project): Promise<Array<{ event_name: string; payload_json: string }>> {
    const db = await p.context.getDb();
    return db.queryAll(
        "SELECT event_name, payload_json FROM system_events WHERE event_name = 'history.refresh.enqueued'",
    );
}

describe('maybeTriggerHistoryRefresh (task 0549 R1/R3)', () => {
    test('opt-in config enqueues one pending job and an observable ledger row', async () => {
        const p = await project('history:\n  refresh:\n    on_completion: true\n');
        try {
            await maybeTriggerHistoryRefresh(p.context, 'task-done', '0549');
            const jobs = await jobRows(p);
            expect(jobs.length).toBe(1);
            expect(jobs[0]?.status).toBe('pending');
            const events = await eventRows(p);
            expect(events.length).toBe(1);
            expect(JSON.parse(events[0]?.payload_json ?? '{}').data).toMatchObject({
                outcome: 'enqueued',
                coalesced: false,
                jobId: jobs[0]?.id,
            });
        } finally {
            cleanup(p);
        }
    });

    test('disabled config (explicit false) enqueues nothing', async () => {
        const p = await project('history:\n  refresh:\n    on_completion: false\n');
        try {
            await maybeTriggerHistoryRefresh(p.context, 'task-done', '0549');
            expect((await jobRows(p)).length).toBe(0);
            expect((await eventRows(p)).length).toBe(0);
        } finally {
            cleanup(p);
        }
    });

    test('absent history section (default off) enqueues nothing', async () => {
        const p = await project('name: x\n');
        try {
            await maybeTriggerHistoryRefresh(p.context, 'pipeline-run', 'run-1');
            expect((await jobRows(p)).length).toBe(0);
        } finally {
            cleanup(p);
        }
    });

    test('trigger failure degrades to a warning and never throws', async () => {
        const p = await project('history:\n  refresh:\n    on_completion: true\n');
        try {
            const broken = {
                ...p.context,
                getDb: async () => {
                    throw new Error('db locked');
                },
            };
            await expect(maybeTriggerHistoryRefresh(broken, 'task-done', '0549')).resolves.toBeUndefined();
            expect(p.output.errors.some((m) => m.includes('history refresh trigger failed'))).toBe(true);
        } finally {
            cleanup(p);
        }
    });
});
