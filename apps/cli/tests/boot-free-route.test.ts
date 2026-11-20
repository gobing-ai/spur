import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootFreeMode } from '../src/boot-free-route';
import { createCliContext } from '../src/context';
import { buildProgram, main, shouldRenderBanner } from '../src/index';

test('the registered tree owns boot policy and keeps the machine-only MCP entry out of root help', () => {
    const output = { write: () => {}, error: () => {} };
    const cli = buildProgram(createCliContext({ output }), output);
    expect(cli.commands.map((command) => command.name())).toContain('mcp');
    expect(cli.helpInformation()).not.toContain('stdio-to-HTTP');
    const modes = [
        ['self serve', 'bare'],
        ['self migrate --check', 'migration-check'],
        ['self migrate', undefined],
        ['task gate 1', 'config'],
        ['self status', 'status'],
        ['self install', 'bare'],
        ['builder bundle-config', 'bare'],
        ['builder build-cli', 'bare'],
        ['mcp --cwd x', 'bare'],
        ['workflow commit-guard-start --run r', 'bare'],
        ['workflow persist-check', 'bare'],
        ['task list', undefined],
        ['workflow run x', undefined],
    ] as const;
    for (const [args, expected] of modes) {
        expect(bootFreeMode(cli, ['--no-logo', ...args.split(' ')]), args).toBe(expected);
    }
    for (const args of ['workflow commit-guard-start', 'mcp', 'history timeline', 'self status --json']) {
        expect(shouldRenderBanner(args.split(' ')), args).toBe(false);
    }
});

test('boot-free CLI entry points leave a scratch project database absent', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-boot-free-'));
    const out: string[] = [];
    const errors: string[] = [];
    const output = { write: (line: string) => out.push(line), error: (line: string) => errors.push(line) };
    try {
        for (const [args, expected] of [
            ['self migrate --check --json', 0],
            ['workflow commit-guard-check --run r', 1],
            ['mcp --help', 0],
        ] as const) {
            expect(await main(args.split(' '), { cwd, output }), args).toBe(expected);
            expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);
        }
        out.length = 0;
        await main(['self', 'status', '--json'], { cwd, output });
        expect(JSON.parse(out.join('\n'))).toHaveProperty('overallState');
        expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);

        mkdirSync(join(cwd, '.spur'), { recursive: true });
        writeFileSync(join(cwd, '.spur', 'config.yaml'), 'broken: [');
        out.length = 0;
        expect(await main(['self', 'status', '--json'], { cwd, output })).toBe(1);
        expect(JSON.parse(out.join('\n'))).toMatchObject({ error: { code: 'config' } });
        errors.length = 0;
        expect(await main(['task', 'gate', '1407', 'light'], { cwd, output })).toBe(1);
        expect(errors.join('\n')).toContain('config.yaml');
        expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});
