/**
 * Thin-wrapper integration tests for `spur task show` (apps/cli/src/commands/task/show.ts).
 * Behavioral tests for TaskService live in packages/app/tests/services/task-service.test.ts.
 *
 * These exercise the verb surface through the real `main()` entry point:
 * golden paths, the `--json` envelope shape, and exit codes 0/1/2 (design §10, R5).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { apiErrorSchema } from '@gobing-ai/spur-contracts';
import { main } from '../../../src/index';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

let cwd: string;

beforeAll(async () => {
    cwd = join(join(import.meta.dir, '..'), '..', `.tmp-show-task-test-${Date.now()}`);
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
    // Materialize the file the fixtures cite as their evidence anchor. Since the 0994
    // follow-up a live record's Testing/Solution `file:line` anchor must RESOLVE at the
    // `--as done` guard (`L4.anchor-unresolved` is an error there), so a fixture citing a
    // path that does not exist would be denied by the anchor gate before the behaviour
    // each test below exists to exercise. Every fixture cites line 1 of this file.
    const evidenceTarget = join(cwd, 'apps', 'cli', 'src', 'commands', 'task.ts');
    await mkdir(join(evidenceTarget, '..'), { recursive: true });
    await writeFile(evidenceTarget, '// fixture evidence target (no real code)\nexport {};\n', 'utf-8');
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

/** The file path printed by `task create` ("Created task NNNN: <path>"). */
function createdPath(output: CapturedOutput): string {
    const msg = output.messages.find((m) => m.startsWith('Created task'));
    if (msg === undefined) throw new Error(`no "Created task" line in: ${output.messages.join(' | ')}`);
    const path = msg.split(': ')[1];
    if (path === undefined) throw new Error(`could not parse path from: ${msg}`);
    return path;
}

/** The WBS embedded in the `task create` confirmation line. */
function createdWbs(output: CapturedOutput): string {
    const match = createdPath(output).match(/(\d{4})_/);
    if (match?.[1] === undefined) throw new Error(`no WBS in created path`);
    return match[1];
}

/** The last captured message, or a throwing guard for empty output. */
function lastMessage(output: CapturedOutput): string {
    const msg = output.messages.at(-1);
    if (msg === undefined) throw new Error('no output captured');
    return msg;
}

describe('spur task CLI', () => {
    test('show prints task content', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Show me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Show me');
    });
    test('show --json exposes frontmatter as a top-level field (R4)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Show JSON'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.wbs).toBe(wbs);
        expect(parsed.name).toBe('Show JSON');
        expect(parsed.frontmatter.status).toBe('backlog');
    });
    test('show for non-existent WBS returns 1', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', '9999'], { cwd, output });
        expect(exitCode).toBe(1);
        expect(output.errors.at(-1)).toContain('not found');
    });
    test('show 9999 --json --json-envelope emits an apiErrorSchema error envelope', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', '9999', '--json', '--json-envelope'], { cwd, output });
        expect(exitCode).toBe(1);
        const parsed = apiErrorSchema.parse(JSON.parse(output.messages.at(-1) ?? '{}'));
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe('INTERNAL_ERROR');
        expect(parsed.error.message).toContain('not found');
    });
    test('show alias `get` resolves like show', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Alias me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'get', wbs], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain('Alias me');
    });

    // ── 1325 P1/P2: section filter + summary mode ──

    /** Byte-exact slice a section occupies in the file on disk, computed independently of the CLI. */
    function rawSectionSlice(raw: string, name: string): string {
        const heading = `### ${name}`;
        const start = raw.indexOf(heading);
        if (start === -1) throw new Error(`no section ${name}`);
        // A section's extent runs to the next heading's line start (includes the preceding newline).
        const next = raw.slice(start + 1).indexOf('\n### ');
        const end = next === -1 ? raw.length : start + 1 + next + 1;
        return raw.slice(start, end);
    }

    test('show --section returns only that section, byte-identical to the file (AC1)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Section filter me'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const raw = readFileSync(createdPath(cOut), 'utf-8');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--section', 'Background', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.sections).toHaveLength(1);
        expect(parsed.sections[0].name).toBe('Background');
        expect(parsed.sections[0].headingLine).toBe('### Background');
        expect(parsed.sections[0].content).toBe(rawSectionSlice(raw, 'Background'));
        expect(parsed.sections[0].byteCount).toBe(Buffer.byteLength(rawSectionSlice(raw, 'Background')));
        // Frontmatter metadata still rides along.
        expect(parsed.frontmatter.status).toBe('backlog');
        expect(parsed.wbs).toBe(wbs);
    });

    test('show --section is repeatable and --sections takes a CSV, in file order', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Section combos'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const repeated = createCapturedOutput();
        let exitCode = await main(['task', 'show', wbs, '--section', 'Plan', '--section', 'Background', '--json'], {
            cwd,
            output: repeated,
        });
        expect(exitCode).toBe(0);
        expect(JSON.parse(lastMessage(repeated)).sections.map((s: { name: string }) => s.name)).toEqual([
            'Background',
            'Plan',
        ]);

        const csv = createCapturedOutput();
        exitCode = await main(['task', 'show', wbs, '--sections', 'Design, History', '--json'], { cwd, output: csv });
        expect(exitCode).toBe(0);
        expect(JSON.parse(lastMessage(csv)).sections.map((s: { name: string }) => s.name)).toEqual([
            'Design',
            'History',
        ]);
    });

    test('show --summary returns the section index with byte counts and no bodies (AC2)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Summary mode'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const raw = readFileSync(createdPath(cOut), 'utf-8');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--summary', '--json'], { cwd, output });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lastMessage(output));
        expect(parsed.sections.length).toBeGreaterThan(0);
        expect(parsed.totalBytes).toBe(Buffer.byteLength(raw));
        for (const entry of parsed.sections) {
            expect(entry.byteCount).toBe(Buffer.byteLength(rawSectionSlice(raw, entry.name)));
            expect(entry.content).toBeUndefined();
        }
    });

    test('show --summary human output prints heading lines and byte counts', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Summary human'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--summary'], { cwd, output });
        expect(exitCode).toBe(0);
        const text = output.messages.join('');
        expect(text).toContain('— summary');
        expect(text).toContain('### Background — ');
        expect(text).toMatch(/total: \d+ bytes/);
    });

    test('show --section human output prints the byte-exact section content', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Human section'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);
        const raw = readFileSync(createdPath(cOut), 'utf-8');

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--section', 'Background'], { cwd, output });
        expect(exitCode).toBe(0);
        expect(output.messages.join('')).toContain(rawSectionSlice(raw, 'Background').trimEnd());
    });

    test('show --section with an unknown name exits 3 and lists the valid names', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Unknown section'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--section', 'Nonexistent', '--json'], { cwd, output });
        expect(exitCode).toBe(3);
        const message = output.messages.join('') + output.errors.join('');
        expect(message).toContain('"Nonexistent"');
        expect(message).toContain('Background');
    });

    test('show --summary cannot be combined with --section (exit 2)', async () => {
        const cOut = createCapturedOutput();
        await main(['task', 'create', '--skip-ready', 'Summary conflict'], { cwd, output: cOut });
        const wbs = createdWbs(cOut);

        const output = createCapturedOutput();
        const exitCode = await main(['task', 'show', wbs, '--summary', '--section', 'Background'], { cwd, output });
        expect(exitCode).toBe(2);
    });
});
