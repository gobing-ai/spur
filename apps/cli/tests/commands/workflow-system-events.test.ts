/**
 * Integration test (task 0370): CLI-driven `spur workflow run` persists
 * cataloged `workflow.*` rows into the shared `system_events` ledger the
 * Board history endpoint reads — even with `spur serve` down (R1, R3, R12).
 *
 * Mirrors the planning-system-events suite (task 0249) but drives a minimal
 * state-machine workflow so the engine + ObservableWorkflowAdapter emit onto
 * the CLI-local bus that `attachSystemEventLedger` taps.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import { createMigratedDbAdapter } from '../../src/context';
import { main } from '../../src/index';
import { createCapturedOutput } from '../helpers';

const MINIMAL_WORKFLOW = `name: ledger-cli-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: ledger bridge smoke
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

const roots: string[] = [];
afterAll(async () => {
    for (const r of roots) await rm(r, { recursive: true, force: true });
});

/** Fresh temp worktree with a workflow file; returns cwd + workflow path. */
async function freshProject(): Promise<{ cwd: string; workflow: string }> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-wf-events-'));
    roots.push(cwd);
    await mkdir(join(cwd, '.spur'), { recursive: true });
    const workflow = join(cwd, 'ledger-flow.yaml');
    await writeFile(workflow, MINIMAL_WORKFLOW);
    return { cwd, workflow };
}

/** Read every system_events row newest-first from the workspace ledger. */
async function readSystemEvents(cwd: string): Promise<SystemEventRow[]> {
    const db = await createMigratedDbAdapter(cwd);
    try {
        return await new SystemEventDao(db).query({ limit: 500 });
    } finally {
        await db.close();
    }
}

describe('CLI workflow events -> system_events ledger (0370)', () => {
    test('spur workflow run persists workflow.* rows correlated by run id (R1/R3/R12)', async () => {
        const { cwd, workflow } = await freshProject();
        const output = createCapturedOutput();
        const runId = 'ledger-run-0370';

        const exitCode = await main(['workflow', 'run', '--run-id', runId, '--json', workflow], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);

        const rows = await readSystemEvents(cwd);
        const names = rows.map((r) => r.event_name);
        // Adapter verb-form events (default tier) must land.
        expect(names.some((n) => n.startsWith('workflow.'))).toBe(true);
        // At least one of the run lifecycle markers is present.
        expect(
            names.includes('workflow.run.started') ||
                names.includes('workflow.run.finalized') ||
                names.includes('workflow.run.done'),
        ).toBe(true);

        // Correlation: every persisted workflow row for this run carries run_id.
        const forRun = rows.filter((r) => r.run_id === runId);
        expect(forRun.length).toBeGreaterThan(0);
        expect(forRun.every((r) => r.event_name.startsWith('workflow.'))).toBe(true);
    });

    test('silent/json run still writes the ledger (not gated on human progress)', async () => {
        const { cwd, workflow } = await freshProject();
        const output = createCapturedOutput();
        const runId = 'silent-run-0370';

        // --silent suppresses human progress; the bus + ledger must still attach.
        const exitCode = await main(['workflow', 'run', '--run-id', runId, '--silent', workflow], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);

        const rows = await readSystemEvents(cwd);
        expect(rows.some((r) => r.run_id === runId && r.event_name.startsWith('workflow.'))).toBe(true);
    });

    test('workflow validate does not open the ledger path (read-only)', async () => {
        const { cwd, workflow } = await freshProject();
        const output = createCapturedOutput();

        expect(await main(['workflow', 'validate', workflow, '--json'], { cwd, output })).toBe(0);

        // No mutation / no run → ledger stays empty.
        const rows = await readSystemEvents(cwd);
        expect(rows).toHaveLength(0);
    });
});
