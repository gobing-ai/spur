/**
 * Thin-wrapper integration tests for `spur workflow progress` (apps/cli/src/commands/workflow/progress.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    _resetAgentServiceShimsForTest,
    projectWorkflowProgress,
    type WorkflowProgressProjection,
} from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { main } from '../../../src/index';
import { createCapturedOutput, createTempProject } from '../../helpers';

// Warn-once shim markers (bare-binary, legacy executor) are process-global; bun
// batches test files per worker process — never inherit another file's state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

describe('spur workflow progress (D62 / 0867)', () => {
    const PROGRESS_WORKFLOW_YAML = `name: progress-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: start
  - id: mid
    onEnter:
      - kind: note
        options:
          message: mid
  - id: done
transitions:
  - from: start
    to: mid
    description: start passed
  - from: mid
    to: done
    description: mid passed
terminalStates:
  - done
`;

    /** Temp project holding the `progress-flow` definition and its own migrated DB. */
    async function progressFixture(): Promise<{ dir: string; dbUrl: string }> {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'progress-flow.yaml'), PROGRESS_WORKFLOW_YAML);
        return { dir, dbUrl: join(dir, '.spur', 'spur.db') };
    }

    test('R1/R3: --json is the projectWorkflowProgress projection, unmodified', async () => {
        const { dir, dbUrl } = await progressFixture();
        const output = createCapturedOutput();
        await main(
            ['workflow', 'run', '--run-id', 'progress-complete', join(dir, '.spur', 'workflows', 'progress-flow.yaml')],
            { output, cwd: dir, dbUrl },
        );
        output.messages.length = 0;

        const exitCode = await main(['workflow', 'progress', 'progress-complete', '--json'], {
            output,
            cwd: dir,
            dbUrl,
        });
        expect(exitCode).toBe(0);
        const projection = JSON.parse(output.messages.join('')) as WorkflowProgressProjection;
        expect(projection.schemaVersion).toBe(1);
        expect(projection.runId).toBe('progress-complete');
        expect(projection.workflow).toBe('progress-flow');
        expect(projection.status).toBe('completed');
        expect(projection.currentState).toBe('done');
        expect(projection.transitions.map((t) => `${t.from}->${t.to}`)).toEqual(['start->mid', 'mid->done']);

        // R2: each declared action carries its recorded attempts.
        const start = projection.states.find((s) => s.state === 'start');
        expect(start?.actions[0]?.actionKey).toBe('start:onEnter:0');
        expect(start?.actions[0]?.status).toBe('passed');
        expect(start?.actions[0]?.attempts[0]).toMatchObject({
            actionRunId: expect.any(String),
            ok: true,
        });

        // R3: rendering only — the CLI payload IS the projection, byte-for-byte apart
        // from the projection timestamp each call stamps.
        const db = await createMigratedDb({ url: dbUrl });
        const direct = await projectWorkflowProgress('progress-complete', { db, projectRoot: dir });
        db.close();
        const withoutTimestamp = (p: WorkflowProgressProjection) => ({ ...p, projectedAt: '<ignored>' });
        expect(withoutTimestamp(projection)).toEqual(withoutTimestamp(direct));
        await rm(dir, { recursive: true, force: true });
    });

    test('R2/R4: a running run exits 0, names state + attempts + next transitions, marks gaps unknown', async () => {
        const { dir, dbUrl } = await progressFixture();
        const db = await createMigratedDb({ url: dbUrl });
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES ('progress-running', 'progress-flow', 'sync', 'running', ?, '{}', ?, ?)",
            [now, now, now],
        );
        await db.run(
            "INSERT INTO transition_runs (id, run_id, from_state, to_state, trigger, status, created_at, updated_at) VALUES ('tr-1', 'progress-running', 'start', 'mid', 'start passed', 'completed', ?, ?)",
            [now, now],
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('ar-1', 'progress-running', 'mid', 'note', 'running', NULL, NULL, NULL, NULL, ?)",
            [now + 1],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'progress', 'progress-running', '--json'], {
            output,
            cwd: dir,
            dbUrl,
        });
        expect(exitCode).toBe(0);
        const projection = JSON.parse(output.messages.join('')) as WorkflowProgressProjection;
        expect(projection.status).toBe('running');
        expect(projection.currentState).toBe('mid');
        // Unanswered data stays null/unknown rather than being invented.
        expect(projection.definitionDigest).toBeNull();
        expect(projection.diagnostics.some((d) => d.code === 'definition-digest-missing')).toBe(true);
        const mid = projection.states.find((s) => s.state === 'mid');
        expect(mid?.actions[0]?.status).toBe('running');
        expect(mid?.actions[0]?.attempts[0]).toMatchObject({
            actionRunId: 'ar-1',
            status: 'running',
            durationMs: null,
            completedAt: null,
        });

        output.messages.length = 0;
        const humanExit = await main(['workflow', 'progress', 'progress-running'], { output, cwd: dir, dbUrl });
        expect(humanExit).toBe(0);
        const human = output.messages.join('\n');
        expect(human).toContain('Current state: mid');
        expect(human).toContain('Definition: version unknown · digest unknown');
        expect(human).toContain('attempt ar-1: running ok=unknown unknown');
        expect(human).toContain('mid → done [blocked] — mid passed');
        await rm(dir, { recursive: true, force: true });
    });

    test('R4: an incomplete run whose definition is unresolvable still exits 0 and names the gap', async () => {
        const { dir, dbUrl } = await progressFixture();
        const db = await createMigratedDb({ url: dbUrl });
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES ('progress-ghost', 'ghost-flow', 'sync', 'running', ?, '{}', ?, ?)",
            [now, now, now],
        );
        db.close();

        const output = createCapturedOutput();
        expect(await main(['workflow', 'progress', 'progress-ghost'], { output, cwd: dir, dbUrl })).toBe(0);
        const human = output.messages.join('\n');
        expect(human).toContain('Current state: unknown');
        expect(human).toContain('States: none recorded');
        expect(human).toContain('Next transitions: none');
        expect(human).toContain('definition-unavailable');
        await rm(dir, { recursive: true, force: true });
    });

    test('R5: an unknown run id is a named NOT_FOUND error, never an empty success', async () => {
        const { dir, dbUrl } = await progressFixture();

        const plain = createCapturedOutput();
        expect(await main(['workflow', 'progress', 'no-such-run'], { output: plain, cwd: dir, dbUrl })).toBe(1);
        expect(plain.errors.join('\n')).toContain('Run no-such-run not found.');
        expect(plain.messages).toEqual([]);

        const json = createCapturedOutput();
        expect(await main(['workflow', 'progress', 'no-such-run', '--json'], { output: json, cwd: dir, dbUrl })).toBe(
            1,
        );
        expect(json.errors.join('\n')).toContain('Run no-such-run not found.');
        expect(json.messages).toEqual([]);

        // ADR-091: the enveloped machine consumer gets a structured NOT_FOUND, still no success.
        const enveloped = createCapturedOutput();
        expect(
            await main(['workflow', 'progress', 'no-such-run', '--json', '--json-envelope'], {
                output: enveloped,
                cwd: dir,
                dbUrl,
            }),
        ).toBe(1);
        const doc = JSON.parse(enveloped.messages.join('')) as { ok: boolean; error: { code: string } };
        expect(doc.ok).toBe(false);
        expect(doc.error.code).toBe('NOT_FOUND');
        await rm(dir, { recursive: true, force: true });
    });
});
