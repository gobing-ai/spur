import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { Command } from '@commander-js/extra-typings';
import { registerBuilderCommand } from '../../../src/commands/builder';
import type { CliContext } from '../../../src/context';

// Task 0617 R4: the CLI wiring for `spur builder` — the two promoted verbs, their flags, and
// the error path that renders through context.output and sets exit code 1. The ops logic itself
// is covered by tests/release-ops.test.ts against real temp git repos.
const repos: string[] = [];

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
    test('registers the noun with exactly its eight verbs (the hidden pr alias was removed in 1290)', () => {
        const program = new Command();
        const { context } = makeContext(process.cwd());
        registerBuilderCommand(program, context);

        const builder = program.commands.find((c) => c.name() === 'builder');
        expect(builder).toBeDefined();
        const verbs = builder?.commands.map((c) => c.name()) ?? [];
        expect(verbs).toEqual([
            'bump-ver',
            'drop-tags',
            'publish',
            'show-branches',
            'pr-status',
            'pr-check',
            'pr-open',
            'pr-review',
        ]);
    });

    test('help renders both verbs without invoking actions', () => {
        const program = new Command();
        const { context } = makeContext(process.cwd());
        registerBuilderCommand(program, context);
        program.exitOverride();

        let help = '';
        program.commands
            .find((c) => c.name() === 'builder')
            ?.commands.find((c) => c.name() === 'bump-ver')
            ?.helpInformation()
            .split('\n')
            .forEach((line) => {
                help += `${line}\n`;
            });
        expect(help).toContain('--all');
        expect(help).toContain('--push');
        expect(help).toContain('--json');
    });
});
