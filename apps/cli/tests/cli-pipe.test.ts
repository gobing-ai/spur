import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI drains large JSON to a pipe before exiting (0781)', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'spur-cli-pipe-'));
    const goal = 'Large feature goal. '.repeat(20000);
    try {
        await Bun.write(
            join(folder, 'A_pipe-output.md'),
            `---\nschema_version: 1\nid: A\nname: Pipe output\nstatus: backlog\npriority: P2\ncreated_at: 2026-09-06\nupdated_at: 2026-09-06\n---\n\n# A: Pipe output\n\n## Goal\n\n${goal}\n`,
        );
        // Use a real OS pipe: Bun's parent-side stream reader can drain quickly enough
        // to conceal an explicit-exit truncation. Delay the consumer to apply backpressure.
        const consumer =
            'await Bun.sleep(100); const text = await new Response(Bun.stdin.stream()).text(); console.log(JSON.stringify(JSON.parse(text).content));';
        const child = Bun.spawn(
            [
                'sh',
                '-c',
                '"$1" "$2" feature show A --folder "$3" --json | "$1" -e "$4"',
                'pipe-test',
                process.execPath,
                new URL('../src/index.ts', import.meta.url).pathname,
                folder,
                consumer,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        );
        const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ]);
        expect(stderr).toBe('');
        expect(code).toBe(0);
        expect(JSON.parse(stdout)).toContain(goal);
        const missing = Bun.spawn(
            [
                process.execPath,
                new URL('../src/index.ts', import.meta.url).pathname,
                'feature',
                'show',
                'Z',
                '--folder',
                folder,
                '--json',
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        );
        const [missingOut, missingErr, missingCode] = await Promise.all([
            new Response(missing.stdout).text(),
            new Response(missing.stderr).text(),
            missing.exited,
        ]);
        expect(missingCode).toBe(1);
        expect(`${missingOut}${missingErr}`).toContain('not found');
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
});
