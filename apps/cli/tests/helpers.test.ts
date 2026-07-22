import { describe, expect, test } from 'bun:test';
import { createCapturedOutput, createTempProject, runCli } from './helpers';

describe('cli test helpers', () => {
    describe('createTempProject', () => {
        test('creates a temp dir with package.json', async () => {
            const dir = await createTempProject();
            try {
                const pkg = await Bun.file(`${dir}/package.json`).json();
                expect(pkg.name).toBe('fixture');
            } finally {
                await Bun.spawn(['rm', '-rf', dir]).exited;
            }
        });
    });

    describe('createCapturedOutput', () => {
        test('records writes and errors', () => {
            const sink = createCapturedOutput();
            sink.write('a');
            sink.error('b');
            expect(sink.messages).toEqual(['a']);
            expect(sink.errors).toEqual(['b']);
        });
    });

    describe('runCli', () => {
        test('returns exit code 0 and parses --json stdout for status', async () => {
            const dir = await createTempProject();
            try {
                // init so .spur/config.yaml exists — status.ok is Spur-config health, not package.json
                await runCli(['init', '--name', 'fixture'], dir);
                const result = await runCli(['status', '--json'], dir);
                expect(result.code).toBe(0);
                expect(result.json).toBeDefined();
                const payload = result.json as { ok?: boolean };
                expect(payload.ok).toBe(true);
            } finally {
                await Bun.spawn(['rm', '-rf', dir]).exited;
            }
        });

        test('captures stderr for an invalid command', async () => {
            const dir = await createTempProject();
            try {
                const result = await runCli(['nonexistent-command'], dir);
                expect(result.code).not.toBe(0);
                expect(result.stderr.length).toBeGreaterThan(0);
            } finally {
                await Bun.spawn(['rm', '-rf', dir]).exited;
            }
        });

        test('leaves json undefined when stdout is not valid JSON', async () => {
            const dir = await createTempProject();
            try {
                // status without --json emits human text, not JSON
                const result = await runCli(['status'], dir);
                expect(result.json).toBeUndefined();
                expect(result.stdout.length).toBeGreaterThan(0);
            } finally {
                await Bun.spawn(['rm', '-rf', dir]).exited;
            }
        });
    });
});
