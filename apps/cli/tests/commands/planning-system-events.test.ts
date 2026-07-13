/**
 * Integration test (task 0249): CLI-driven task/feature status changes persist
 * `task.*` / `feature.*` rows into the shared `system_events` ledger that the
 * System Events tabview reads, even with `spur serve` down (R1, R2, R4).
 *
 * Each scenario drives the real `main()` entry point against a temp worktree
 * with its own SQLite ledger, then opens the same DB out-of-band and asserts
 * the cataloged rows landed — the same sink the tabview history endpoint reads.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import { createMigratedDbAdapter } from '../../src/context';
import { main } from '../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

/** Read every system_events row newest-first from the workspace ledger. */
async function readSystemEvents(cwd: string): Promise<SystemEventRow[]> {
    const db = await createMigratedDbAdapter(cwd);
    try {
        return await new SystemEventDao(db).query({ limit: 500 });
    } finally {
        await db.close();
    }
}

/** Parse the `--json` object emitted to the captured output sink. */
function jsonFromOutput(output: CapturedOutput): Record<string, unknown> {
    const raw = output.messages.find((m) => m.trim().startsWith('{'));
    if (!raw) throw new Error(`no JSON message in output: ${output.messages.join(' | ')}`);
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
        throw new Error(`invalid JSON in output: ${raw} (${(e as Error).message})`);
    }
}

/** The WBS printed by `task create --json` as `ref.id` (e.g. "0001"). */
function wbsFromCreate(output: CapturedOutput): string {
    const json = jsonFromOutput(output);
    const ref = json.ref as { id?: string } | undefined;
    if (!ref?.id) throw new Error(`no ref.id in create output: ${output.messages.join(' | ')}`);
    return ref.id;
}

/** The feature ID printed by `feature create --json` as `ref.id` (e.g. "A"). */
function idFromFeatureCreate(output: CapturedOutput): string {
    const json = jsonFromOutput(output);
    const ref = json.ref as { id?: string } | undefined;
    if (!ref?.id) throw new Error(`no ref.id in create output: ${output.messages.join(' | ')}`);
    return ref.id;
}

/** Safe JSON parse for `payload_json`; returns null on failure. */
function parsePayload(row: SystemEventRow): Record<string, unknown> | null {
    if (!row.payload_json) return null;
    try {
        return JSON.parse(row.payload_json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/** Create a fresh temp worktree pre-seeded with the task/feature corpus dirs. */
async function freshCwd(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'spur-planning-events-'));
    await mkdir(join(root, 'docs', 'tasks'), { recursive: true });
    await mkdir(join(root, 'docs', 'features'), { recursive: true });
    return root;
}

const roots: string[] = [];
afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('CLI planning events -> system_events ledger (0249)', () => {
    test('spur task create / update <todo> persists task.created + task.transitioned (R1)', async () => {
        const cwd = await freshCwd();
        roots.push(cwd);

        // create a task; this runs the full planning pipeline (lock + write + emit).
        const createOut = createCapturedOutput();
        expect(await main(['task', 'create', 'Ledger sink task', '--json'], { cwd, output: createOut })).toBe(0);
        const wbs = wbsFromCreate(createOut);

        // forward step backlog -> todo — the only valid transition out of a freshly created task.
        const updateOut = createCapturedOutput();
        expect(await main(['task', 'update', wbs, 'todo', '--json'], { cwd, output: updateOut })).toBe(0);

        const rows = await readSystemEvents(cwd);
        const names = rows.map((r) => r.event_name);
        expect(names).toContain('task.created');
        const transitioned = rows.find((r) => r.event_name === 'task.transitioned');
        expect(transitioned).toBeDefined();
        const payload = parsePayload(transitioned as SystemEventRow);
        // Normalized payload carries the from→to status the planning renderer renders.
        expect(payload?.from).toBe('backlog');
        expect(payload?.to).toBe('todo');
        // Source/renderer are populated by the catalog normalization path — sink matches
        // the Board-driven shape so the tabview renders them identically (R4).
        expect(transitioned?.actor).toBeNull(); // PlanningEvent carries no actor field
    });

    test('spur feature create / update <status> persists feature.* rows (R2)', async () => {
        const cwd = await freshCwd();
        roots.push(cwd);

        const createOut = createCapturedOutput();
        expect(await main(['feature', 'create', 'Ledger sink feature', '--json'], { cwd, output: createOut })).toBe(0);
        const id = idFromFeatureCreate(createOut);

        const updateOut = createCapturedOutput();
        expect(await main(['feature', 'update', id, 'active', '--json'], { cwd, output: updateOut })).toBe(0);

        const rows = await readSystemEvents(cwd);
        const names = rows.map((r) => r.event_name);
        expect(names).toContain('feature.created');
        const transitioned = rows.find((r) => r.event_name === 'feature.transitioned');
        expect(transitioned).toBeDefined();
        const payload = parsePayload(transitioned as SystemEventRow);
        // default feature status is `backlog`; forward step `backlog -> active` yields from=backlog.
        expect(payload?.from).toBe('backlog');
        expect(payload?.to).toBe('active');
    });

    test('read-only spur task verbs do NOT open the DB (lazy emitter) (R4)', async () => {
        const cwd = await freshCwd();
        roots.push(cwd);

        const listOut = createCapturedOutput();
        expect(await main(['task', 'list'], { cwd, output: listOut })).toBe(0);

        // No mutation, no emit — ledger stays empty.
        const rows = await readSystemEvents(cwd);
        expect(rows).toHaveLength(0);
    });
});
