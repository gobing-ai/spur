import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { registerBuilderCommand } from '../../../src/commands/builder';
import type { CliContext } from '../../../src/context';

// Task 0617 R4: the CLI wiring for `spur builder` — the two promoted verbs, their flags, and
// the error path that renders through context.output and sets exit code 1. The ops logic itself
// is covered by tests/release-ops.test.ts against real temp git repos.
const repos: string[] = [];

function sh(cwd: string, cmd: string[]): void {
    const result = Bun.spawnSync(cmd, { cwd });
    if (result.exitCode !== 0) {
        throw new Error(`${cmd.join(' ')} failed: ${result.stderr.toString()}`);
    }
}

function mkRepo(): string {
    const root = join(tmpdir(), `spur-builder-cli-${crypto.randomUUID()}`);
    repos.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'pkgs', 'lib'), { recursive: true });
    writeFileSync(
        join(repo, 'package.json'),
        `${JSON.stringify({ name: '@demo/root', version: '0.1.0', workspaces: ['pkgs/*'] }, null, 4)}\n`,
    );
    writeFileSync(
        join(repo, 'pkgs', 'lib', 'package.json'),
        `${JSON.stringify({ name: '@demo/lib', version: '0.1.0' }, null, 4)}\n`,
    );
    sh(repo, ['git', 'init']);
    sh(repo, ['git', 'config', 'user.email', 'test@example.com']);
    sh(repo, ['git', 'config', 'user.name', 'Test']);
    sh(repo, ['git', 'add', '.']);
    sh(repo, ['git', 'commit', '-m', 'init']);
    return repo;
}

/** A context whose output is captured and whose exit code is recorded, so actions are observable. */
function makeContext(cwd: string): { context: CliContext; lines: string[]; exitCode: () => number } {
    let code = 0;
    const lines: string[] = [];
    const context = {
        cwd,
        output: {
            write: (m: string) => lines.push(m),
            error: (m: string) => lines.push(`ERR ${m}`),
        },
        setExitCode: (c: number) => {
            code = c;
        },
    } as unknown as CliContext;
    return { context, lines, exitCode: () => code };
}

afterEach(() => {
    for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('spur builder command wiring', () => {
    test('action renders an unknown-package error and sets exit code 1', async () => {
        const repo = mkRepo();
        const { context, lines, exitCode } = makeContext(repo);
        const program = new Command();
        program.exitOverride();
        registerBuilderCommand(program, context);

        await program.parseAsync(['builder', 'bump-ver', 'nope', '0.2.0'], { from: 'user' });
        expect(exitCode()).toBe(1);
        expect(lines.join('\n')).toContain('unknown package "nope"');
    });

    test('--json errors render machine-readable output', async () => {
        const repo = mkRepo();
        const { context, lines, exitCode } = makeContext(repo);
        const program = new Command();
        program.exitOverride();
        registerBuilderCommand(program, context);

        await program.parseAsync(['builder', 'bump-ver', 'nope', '0.2.0', '--json'], { from: 'user' });
        expect(exitCode()).toBe(1);
        const parsed = JSON.parse(lines.join('\n')) as { ok: boolean; verb: string; error: string };
        expect(parsed.ok).toBe(false);
        expect(parsed.verb).toBe('bump-ver');
        expect(parsed.error).toContain('unknown package "nope"');
    });

    test('bump-ver success path commits and tags through the action', async () => {
        const repo = mkRepo();
        const { context, lines, exitCode } = makeContext(repo);
        const program = new Command();
        program.exitOverride();
        registerBuilderCommand(program, context);

        await program.parseAsync(['builder', 'bump-ver', 'lib', '0.2.0'], { from: 'user' });
        expect(exitCode()).toBe(0);
        expect(lines.join('\n')).toContain('@demo/lib-v0.2.0');
        const tags = Bun.spawnSync(['git', 'tag', '-l'], { cwd: repo }).stdout.toString();
        expect(tags).toContain('@demo/lib-v0.2.0');
    });

    test('bump-ver --check rejects incompatible write flags (--push/--all) instead of ignoring them', async () => {
        const repo = mkRepo();
        for (const flags of [['--push'], ['--all']]) {
            const { context, lines, exitCode } = makeContext(repo);
            const program = new Command();
            program.exitOverride();
            registerBuilderCommand(program, context);

            await program.parseAsync(['builder', 'bump-ver', '--check', 'lib', ...flags], { from: 'user' });
            expect(exitCode()).toBe(1);
            expect(lines.join('\n')).toContain('rejects incompatible write flags (--push/--all)');
        }
    });

    test('bump-ver --json success renders a machine summary', async () => {
        const repo = mkRepo();
        const { context, lines, exitCode } = makeContext(repo);
        const program = new Command();
        program.exitOverride();
        registerBuilderCommand(program, context);

        await program.parseAsync(['builder', 'bump-ver', 'lib', '0.2.0', '--json'], { from: 'user' });
        expect(exitCode()).toBe(0);
        const last = JSON.parse(lines[lines.length - 1] ?? '{}') as { ok: boolean; verb: string; version: string };
        expect(last.ok).toBe(true);
        expect(last.verb).toBe('bump-ver');
        expect(last.version).toBe('0.2.0');
    });
});
