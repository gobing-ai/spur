import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { registerBuilderCommand } from '../../../src/commands/builder';
import type { CliContext } from '../../../src/context';

// CLI wiring for `spur builder publish`: flag/argument registration and the error path that renders
// through context.output and sets exit code 1. The publish logic (manifest rewrite/restore, npm) is
// covered by tests/release-ops.test.ts with an injected runner; no npm is invoked here.
const roots: string[] = [];

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
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('spur builder publish wiring', () => {
    test('registers <dir> and --otp', () => {
        const program = new Command();
        registerBuilderCommand(program, makeContext(tmpdir()).context);
        const publish = program.commands
            .find((c) => c.name() === 'builder')
            ?.commands.find((c) => c.name() === 'publish');
        expect(publish?.registeredArguments.map((a) => a.name())).toEqual(['dir']);
        expect(publish?.options.map((o) => o.long)).toContain('--otp');
    });

    test('a directory without package.json renders the error and sets exit code 1', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-builder-publish-'));
        roots.push(root);
        const { context, lines, exitCode } = makeContext(root);
        const program = new Command();
        program.exitOverride();
        registerBuilderCommand(program, context);

        await program.parseAsync(['builder', 'publish', 'missing-pkg'], { from: 'user' });
        expect(exitCode()).toBe(1);
        expect(lines.join('\n')).toContain(`ERR no package.json at ${join(root, 'missing-pkg')}`);
    });
});
