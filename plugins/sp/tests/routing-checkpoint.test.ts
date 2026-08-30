import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectRoutingCheckpoint } from '../scripts/stage-registry-adapter';

/**
 * Routing-checkpoint inspection (0711 R3): the adapter keeps a lean inline
 * mirror of `packages/app/src/workflow/checkpoint-contract.ts` semantics (the
 * plugin installs into foreign repos and cannot import workspace packages).
 * The fixtures below mirror the app-side contract test's canonical document —
 * keep the two fixture sets in lockstep; behavioral parity is the pin.
 */

function doc(overrides: Record<string, string> = {}, artifacts?: string[]): string {
    const base: Record<string, string> = {
        schema_version: '1',
        session_id: '2026-01-01-0703',
        workflow: 'task-pipeline',
        run_id: '5c0f7ab6-b2f4-4ab9-84be-f0294d00dc99',
        task_wbs: '0703',
        feature_id: 'A6',
        phase: 'running',
        status: 'running',
        last_gate: 'record',
        source_commit: 'c0ffee',
        digest: 'sha256:abc',
        generated_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        next_action: 'continue implement',
    };
    const scalars = { ...base, ...overrides };
    const lines = Object.entries(scalars)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}: ${v}`);
    const artifactBlock = artifacts === undefined ? '' : `artifacts:\n${artifacts.map((a) => `  - ${a}`).join('\n')}\n`;
    return `---\n${lines.join('\n')}\n${artifactBlock}---\n`;
}

// The inspector reads from disk; tests write fixture sessions dirs.
async function withSessions(body: string, name = '0703-checkpoint.md'): Promise<string> {
    const { mkdir, mkdtemp, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'spur-rc-'));
    await mkdir(dir, { recursive: true });
    if (body !== '') await writeFile(join(dir, name), body);
    return dir;
}

const alwaysExists = () => true;
const nothingExists = () => false;
const input = { headCommit: 'c0ffee', artifactExists: alwaysExists };

describe('inspectRoutingCheckpoint (0711 R3 adapter mirror)', () => {
    test('absent checkpoint file is the normal non-checkpoint case', async () => {
        const dir = await withSessions('');
        expect(inspectRoutingCheckpoint(dir, '0703', input)).toEqual({ usable: false, reason: 'absent' });
        await rm(dir, { recursive: true, force: true });
    });

    test('fresh owner-matched non-terminal checkpoint at HEAD is usable', async () => {
        const dir = await withSessions(doc({}, ['.spur/run/0703-implement-diff.txt']));
        expect(inspectRoutingCheckpoint(dir, '0703', input)).toEqual({ usable: true });
        await rm(dir, { recursive: true, force: true });
    });

    test('owner mismatch is reported and ignored', async () => {
        // The file sits at the queried WBS's checkpoint name but claims a different owner inside.
        const dir = await withSessions(doc(), '0704-checkpoint.md');
        expect(inspectRoutingCheckpoint(dir, '0704', input)).toEqual({
            usable: false,
            reason: 'owner-mismatch: task_wbs=0703 != 0704',
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('terminal status falls through to the non-checkpoint route (A5), never A4', async () => {
        const dir = await withSessions(doc({ status: 'done' }));
        expect(inspectRoutingCheckpoint(dir, '0703', input)).toEqual({
            usable: false,
            reason: 'terminal: status=done',
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('commit drift: missing or mismatched source_commit vs HEAD is stale', async () => {
        const missing = await withSessions(doc({ source_commit: '' }));
        expect(inspectRoutingCheckpoint(missing, '0703', input)).toMatchObject({ usable: false });
        const drifted = await withSessions(doc({ source_commit: 'deadbeef' }));
        expect(inspectRoutingCheckpoint(drifted, '0703', input)).toMatchObject({
            usable: false,
            reason: 'commit-drift: checkpoint@deadbeef != HEAD',
        });
        // Without a known HEAD the commit axis is skipped.
        expect(inspectRoutingCheckpoint(drifted, '0703', { artifactExists: alwaysExists })).toEqual({ usable: true });
        await rm(missing, { recursive: true, force: true });
        await rm(drifted, { recursive: true, force: true });
    });

    test('missing referenced artifact is reported and ignored', async () => {
        const dir = await withSessions(doc({}, ['.spur/run/gone.json']));
        expect(inspectRoutingCheckpoint(dir, '0703', { headCommit: 'c0ffee', artifactExists: nothingExists })).toEqual({
            usable: false,
            reason: 'missing-artifact: .spur/run/gone.json',
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('malformed frontmatter is never trusted', async () => {
        const noFm = await withSessions('no frontmatter\n');
        expect(inspectRoutingCheckpoint(noFm, '0703', input).usable).toBe(false);
        const unterminated = await withSessions('---\nschema_version: 1\n');
        expect(inspectRoutingCheckpoint(unterminated, '0703', input).usable).toBe(false);
        const badSchema = await withSessions(doc({ schema_version: '2' }));
        expect(inspectRoutingCheckpoint(badSchema, '0703', input).usable).toBe(false);
        await rm(noFm, { recursive: true, force: true });
        await rm(unterminated, { recursive: true, force: true });
        await rm(badSchema, { recursive: true, force: true });
    });

    test('parses both artifact spellings: frontmatter list and inline commas (parity with app parser)', async () => {
        const list = await withSessions(doc({}, ['a.json']));
        expect(
            inspectRoutingCheckpoint(list, '0703', { headCommit: 'c0ffee', artifactExists: (p) => p === 'a.json' }),
        ).toEqual({ usable: true });
        const inline = await withSessions(doc({ artifacts: 'a.json, b.md' }));
        expect(
            inspectRoutingCheckpoint(inline, '0703', {
                headCommit: 'c0ffee',
                artifactExists: (p) => p === 'a.json' || p === 'b.md',
            }),
        ).toEqual({ usable: true });
        await rm(list, { recursive: true, force: true });
        await rm(inline, { recursive: true, force: true });
    });
});
