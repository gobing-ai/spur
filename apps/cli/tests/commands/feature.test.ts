/**
 * Thin-wrapper integration tests for apps/cli/src/commands/feature.ts.
 * Behavioral tests for FeatureService live in
 * packages/app/tests/services/feature-service.test.ts.
 *
 * These exercise the `spur feature` verb surface through the real `main()`
 * entry point: golden paths, the `--json` envelope, status/priority filters,
 * and exit codes 0/1/2 (design §7.2, §10).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', `.tmp-feature-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'features'), { recursive: true });
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

/** The feature ID from the `feature create` confirmation line. */
function createdId(output: CapturedOutput): string {
    const msg = output.messages.find((m) => m.startsWith('Created feature'));
    if (msg === undefined) throw new Error(`no "Created feature" line in: ${output.messages.join(' | ')}`);
    const id = msg.replace('Created feature ', '').split(':')[0]?.trim();
    if (!id) throw new Error(`could not parse id from: ${msg}`);
    return id;
}

describe('spur feature CLI', () => {
    test('noun help lists subcommands', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', '--help'], { cwd, output });
        expect(exitCode).toBe(0);
        const allOut = output.messages.join('');
        expect(allOut).toContain('create');
        expect(allOut).toContain('show');
        expect(allOut).toContain('update');
        expect(allOut).toContain('advance');
        expect(allOut).toContain('list');
    });

    test('create allocates a top-level letter ID and exits 0', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'First Feature'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(createdId(output)).toMatch(/^[A-Z]$/);
    });

    test('create --json returns the write-result envelope', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'JSON Feature', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.ref.kind).toBe('feature');
        expect(parsed.ref.id).toMatch(/^[A-Z][1-9]*$/);
        expect(parsed.eventName).toBe('feature.created');
    });

    test('create --parent allocates a child digit', async () => {
        const pOut = createCapturedOutput();
        await main(['feature', 'create', 'Parent For Child'], { cwd, output: pOut });
        const parentId = createdId(pOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'A Child', '--parent', parentId], { cwd, output });
        expect(exitCode).toBe(0);
        expect(createdId(output)).toMatch(new RegExp(`^${parentId}[1-9]$`));
    });

    test('show --json returns the feature with content', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Showable'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', id, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.id).toBe(id);
        expect(parsed.content).toContain('## Goal');
    });

    test('show unknown ID exits 1', async () => {
        const exitCode = await main(['feature', 'show', 'ZZZZZ'], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(1);
    });

    test('show alias `get` routes to the show handler (0534 R1)', async () => {
        // No create here: the suite runs at the A-Z top-level letter ceiling, so an
        // extra feature would exhaust allocation and break later move tests. Routing
        // is proven by the error contract matching `feature show` (the alias cannot
        // have its own handler).
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'get', 'ZZZZZ'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('not found');
    });

    test('update --help names the section-discovery command (0534 R2)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'update', '--help'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('spur task sections <wbs> list');
    });

    test('update --field sets a frontmatter value', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Prioritize Me'], { cwd, output: cOut });
        const id = createdId(cOut);

        const exitCode = await main(['feature', 'update', id, '--field', 'priority', '--value', 'P0'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);

        const shown = createCapturedOutput();
        await main(['feature', 'show', id, '--json'], { cwd, output: shown });
        expect(JSON.parse(lastMessage(shown)).frontmatter.priority).toBe('P0');
    });

    test('update --field without --value exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'No Value'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id, '--field', 'priority'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(2);
    });

    test('update --section --from-file replaces a feature section', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Section CLI'], { cwd, output: cOut });
        const id = createdId(cOut);
        const source = join(cwd, 'goal-body.md');
        writeFileSync(source, 'CLI-written goal.\n');

        const exitCode = await main(['feature', 'update', id, '--section', 'Goal', '--from-file', source], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);

        const shown = createCapturedOutput();
        await main(['feature', 'show', id], { cwd, output: shown });
        expect(shown.messages.join('')).toContain('## Goal\nCLI-written goal.\n');
    });

    test('update --section without --from-file exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'No Source'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id, '--section', 'Goal'], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(2);
    });

    test('update status and section in one invocation', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Section Plus Status'], { cwd, output: cOut });
        const id = createdId(cOut);
        const source = join(cwd, 'scope-body.md');
        writeFileSync(source, 'In scope: combined update.\n\nOut of scope: unrelated work.\n');

        const exitCode = await main(['feature', 'update', id, 'active', '--section', 'Scope', '--from-file', source], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(0);

        const shown = createCapturedOutput();
        await main(['feature', 'show', id, '--json'], { cwd, output: shown });
        const parsed = JSON.parse(lastMessage(shown));
        expect(parsed.frontmatter.status).toBe('active');
        expect(parsed.content).toContain('In scope: combined update.');
    });

    test('list --json returns features sorted by ID with status/priority', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
        const ids = parsed.map((f: { id: string }) => f.id);
        expect([...ids]).toEqual([...ids].sort());
    });

    test('list --priority filters by priority', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list', '--priority', 'P0', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        for (const f of parsed) {
            expect(f.priority).toBe('P0');
        }
    });

    test('create prints a human confirmation line (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'create', 'Human Output'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toMatch(/^Created feature [A-Z][1-9]*: /);
    });

    test('show prints content (non-JSON)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Human Show'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', id], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('## Goal');
    });

    test('list prints human rows (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'list'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.length).toBeGreaterThan(0);
    });

    test('update <status> transitions the feature lifecycle (human output)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Transition Me'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        // backlog → active is a valid feature-lifecycle transition.
        const exitCode = await main(['feature', 'update', id, 'active'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain(`${id}:`);
    });

    test('advance walks the forward lifecycle path to a reachable target', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Me'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed).toEqual({
            id,
            status: 'active',
            hops: [{ from: 'backlog', to: 'active' }],
        });
    });

    test('advance prints a human trail for a successful hop', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Human'], { cwd, output: cOut });
        const id = createdId(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain(`${id}: advanced to active`);
        expect(lastMessage(output)).toContain('backlog → active');
    });

    test('advance is idempotent when the feature already has the target status', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Idempotent'], { cwd, output: cOut });
        const id = createdId(cOut);
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(JSON.parse(lastMessage(output))).toEqual({ id, status: 'active', hops: [] });
    });

    test('advance prints human no-op when already at the target status', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Noop Human'], { cwd, output: cOut });
        const id = createdId(cOut);
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'active'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toBe(`${id}: already at active; no advance needed`);
    });

    test('advance unknown feature exits 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', 'ZZZZZ', '--json'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('Feature ZZZZZ not found');
    });

    test('advance exits 1 when the target is not reachable along the forward path', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Unreachable'], { cwd, output: cOut });
        const id = createdId(cOut);
        // Reach `blocked` through the legal path (backlog → active → blocked) —
        // `--field status` is rejected so the lifecycle guard cannot be bypassed.
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });
        await main(['feature', 'update', id, 'blocked'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'done'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain(`cannot reach 'done' from 'blocked'`);
    });

    test('advance exits 1 when a guarded hop is denied', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Advance Guarded'], { cwd, output: cOut });
        const id = createdId(cOut);
        await main(['feature', 'update', id, 'active'], { cwd, output: createCapturedOutput() });

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', id, '--to', 'verifying'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('Lifecycle transition denied');
    });

    test('update with neither status nor --field exits 2', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Nothing To Do'], { cwd, output: cOut });
        const id = createdId(cOut);
        const exitCode = await main(['feature', 'update', id], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(2);
    });

    test('check validates a feature and returns a per-feature result (--json)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Checkable'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'check', id, '--json'], { cwd, output });
        // A freshly-created backlog feature has no required sections → passes.
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed[0].id).toBe(id);
        expect(parsed[0]).toHaveProperty('findings');
        expect(parsed[0]).toHaveProperty('pass');
    });

    test('check unknown ID exits 1', async () => {
        const exitCode = await main(['feature', 'check', 'ZZZZZ'], { cwd, output: createCapturedOutput() });
        expect(exitCode).toBe(1);
    });

    test('check prints human PASS/FAIL lines (non-JSON)', async () => {
        const cOut = createCapturedOutput();
        await main(['feature', 'create', 'Human Check'], { cwd, output: cOut });
        const id = createdId(cOut);
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'check', id], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toMatch(/PASS|FAIL/);
    });

    test('refresh regenerates INDEX.md and reports tasksUpdated (--json)', async () => {
        await main(['feature', 'create', 'Refreshable Group'], { cwd, output: createCapturedOutput() });
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'refresh', '--all', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.index_path).toMatch(/INDEX\.md$/);
        expect(typeof parsed.tasksUpdated).toBe('number');
        // INDEX.md exists with the tree header.
        const index = await Bun.file(`${cwd}/docs/features/INDEX.md`).text();
        expect(index).toContain('# Feature Index');
    });

    test('move --dry-run reports the old→new map without writing (--json)', async () => {
        // Build an isolated source (with a child) + a target group.
        const aOut = createCapturedOutput();
        await main(['feature', 'create', 'MV Source'], { cwd, output: aOut });
        const sourceId = createdId(aOut);
        await main(['feature', 'create', 'MV Sub', '--parent', sourceId], { cwd, output: createCapturedOutput() });
        const tOut = createCapturedOutput();
        await main(['feature', 'create', 'MV Target'], { cwd, output: tOut });
        const targetId = createdId(tOut);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'move', sourceId, '--parent', targetId, '--dry-run', '--json'], {
            cwd,
            output,
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.dryRun).toBe(true);
        expect(parsed.movedCount).toBeGreaterThanOrEqual(2); // source + its child
        expect(parsed.mapping[sourceId]).toMatch(new RegExp(`^${targetId}[1-9]$`));
    });

    test('move applies the cascade and prints a human summary (non-JSON)', async () => {
        const aOut = createCapturedOutput();
        await main(['feature', 'create', 'MV2 Source'], { cwd, output: aOut });
        const sourceId = createdId(aOut);
        await main(['feature', 'create', 'MV2 Sub', '--parent', sourceId], { cwd, output: createCapturedOutput() });
        const tOut = createCapturedOutput();
        await main(['feature', 'create', 'MV2 Target'], { cwd, output: tOut });
        const targetId = createdId(tOut);

        // Dry-run first (human output branch), then apply (human output branch).
        const dryOut = createCapturedOutput();
        expect(
            await main(['feature', 'move', sourceId, '--parent', targetId, '--dry-run'], { cwd, output: dryOut }),
        ).toBe(0);
        expect(dryOut.messages.join('')).toContain('Dry run');
        expect(dryOut.messages.join('')).toContain(`${sourceId} →`);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'move', sourceId, '--parent', targetId], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toMatch(/Moved \d+ feature\(s\)/);
        // The source file no longer exists under its old ID.
        const list = createCapturedOutput();
        await main(['feature', 'list', '--json'], { cwd, output: list });
        const ids = JSON.parse(lastMessage(list)).map((f: { id: string }) => f.id);
        expect(ids).not.toContain(sourceId);
    });

    test('move into own subtree exits 1', async () => {
        const aOut = createCapturedOutput();
        await main(['feature', 'create', 'MV3 Source'], { cwd, output: aOut });
        const sourceId = createdId(aOut);
        const childOut = createCapturedOutput();
        await main(['feature', 'create', 'MV3 Sub', '--parent', sourceId], { cwd, output: childOut });
        const childId = createdId(childOut);
        const exitCode = await main(['feature', 'move', sourceId, '--parent', childId], {
            cwd,
            output: createCapturedOutput(),
        });
        expect(exitCode).toBe(1);
    });

    test('refresh prints a human summary (non-JSON)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'refresh', '--all'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(lastMessage(output)).toContain('INDEX.md regenerated');
    });

    test('bare refresh refuses to sweep without --feature/--all (R5a, 0625)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'refresh'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.join('')).toContain('--feature <id> or --all is required');
    });

    test('check with no id validates all features in the folder (--json)', async () => {
        // Exercises the validate-all branch (no <id>): every feature file is checked.
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'check', '--json'], { cwd, output });
        // Some earlier-created features may be active without required sections → may FAIL;
        // assert the result is a populated array regardless of pass/fail.
        const parsed = JSON.parse(lastMessage(output));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(1);
        expect(exitCode === 0 || exitCode === 1).toBe(true);
    });

    test('sync requires id or --all (exits 2)', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync'], { cwd, output });
        expect(exitCode).toBe(2);
        expect(output.errors.join('')).toContain('Feature ID is required unless --all is passed');
    });

    test('sync <id> --dry-run --json outputs sync proposal', async () => {
        const listOut = createCapturedOutput();
        await main(['feature', 'list', '--json'], { cwd, output: listOut });
        const features = JSON.parse(lastMessage(listOut));
        const fid = features[0]?.id ?? 'A';

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', fid, '--dry-run', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.proposal.featureId).toBe(fid);
        expect(typeof parsed.proposal.from).toBe('string');
        expect(typeof parsed.proposal.to).toBe('string');
    });

    test('sync --all --json evaluates features in corpus', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', '--all', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(typeof parsed.totalFeatures).toBe('number');
        expect(Array.isArray(parsed.results)).toBe(true);
    });

    test('sync <id> human text branch', async () => {
        const listOut = createCapturedOutput();
        await main(['feature', 'list', '--json'], { cwd, output: listOut });
        const features = JSON.parse(lastMessage(listOut));
        const fid = features[0]?.id ?? 'A';

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', fid, '--dry-run'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain(`Feature ${fid}:`);
    });

    test('sync --all human text branch with linked tasks and --folder', async () => {
        const featDir = join(cwd, 'docs', 'features');
        const tasksDir = join(cwd, 'docs', 'tasks');
        await mkdir(featDir, { recursive: true });
        await mkdir(tasksDir, { recursive: true });

        const fid = 'A';
        const taskContent = `---
schema_version: 1
wbs: "9910"
name: "Task 9910"
title: "Task 9910"
status: "wip"
feature_id: "${fid}"
created_at: "${new Date().toISOString()}"
updated_at: "${new Date().toISOString()}"
---

## Description
Task description

## Requirements
- R1: Requirement 1

## Solution
Solution description

## Testing
Testing description

## Review
Review description
`;
        writeFileSync(join(tasksDir, '9910_sync-all-task.md'), taskContent);

        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'sync', '--all', '--dry-run', '--folder', featDir], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Evaluated');
    });

    test('show non-existent feature returns error exit code', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'show', 'Z99'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('Feature Z99 not found');
    });

    test('advance non-existent feature throws error', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['feature', 'advance', 'Z99'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.join('')).toContain('Feature Z99 not found');
    });

    test('update parameter guard errors', async () => {
        const fid = 'A';

        const errOut1 = createCapturedOutput();
        const code1 = await main(['feature', 'update', fid, '--from-file', 'foo.md'], { cwd, output: errOut1 });
        expect(code1).toBe(2);
        expect(errOut1.errors.join('')).toContain('--section is required with --from-file');

        const errOut2 = createCapturedOutput();
        const code2 = await main(['feature', 'update', fid, '--value', 'val'], { cwd, output: errOut2 });
        expect(code2).toBe(2);
        expect(errOut2.errors.join('')).toContain('--field is required with --value');
    });
});
