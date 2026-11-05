import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCliContext } from '../src/context';
import { buildProgram } from '../src/index';
import type { CommandOutput } from '../src/output';

/**
 * Task 1293 R4 — live-commander surface parity for the Grok Bot help doc and example recipe.
 *
 * Every `spur <noun> <verb>` pair named in docs/help/how_to_use_spur_with_grok_bot.md and
 * docs/help/examples/grok-bot-notify.yaml must resolve in the live commander tree (the
 * dispatcher's own buildProgram — not a re-registered copy) and advertise `--json`. Nouns
 * must be a subset of the registered nouns. Tree mirrors apps/cli/tests/help-doc-parity.test.ts.
 */

const DOC = join(import.meta.dir, '..', '..', '..', 'docs', 'help', 'how_to_use_spur_with_grok_bot.md');
const RECIPE = join(import.meta.dir, '..', '..', '..', 'docs', 'help', 'examples', 'grok-bot-notify.yaml');

interface CmdLike {
    name(): string;
    options: Array<{ long?: string }>;
    commands: CmdLike[];
}

interface CliPath {
    flags: Set<string>;
    children: Set<string>;
}

/** Walk the commander tree: `spur <noun> [verb…]` → path records. */
function collectCliPaths(): { nouns: Set<string>; paths: Map<string, CliPath> } {
    const output: CommandOutput = { write: () => {}, error: () => {} };
    const program = buildProgram(createCliContext({ output }), output) as unknown as CmdLike;
    const nouns = new Set<string>();
    const paths = new Map<string, CliPath>();
    const walk = (cmd: CmdLike, path: string): void => {
        const children = new Set(cmd.commands.map((c) => c.name()));
        if (!paths.has(path)) {
            paths.set(path, {
                flags: new Set(cmd.options.map((o) => o.long).filter((f): f is string => f !== undefined)),
                children,
            });
        }
        for (const sub of cmd.commands) walk(sub, `${path} ${sub.name()}`);
    };
    for (const noun of program.commands) {
        if (noun.name() === 'self') continue; // container noun; legacy aliases are documented once
        nouns.add(noun.name());
        walk(noun, `spur ${noun.name()}`);
    }
    return { nouns, paths };
}

/**
 * Extract the `spur <noun> <verb>` pairs from the inline code spans and fenced blocks of a
 * document (prose mentions like "a spur workflow posts" or "spur has no next-step verb" are
 * deliberately not pairs — only code names them). The lookbehind skips the `bun spur `
 * toolchain-emulation line (that phrase names a bun run, not a CLI pair); lowercase-only
 * captures keep placeholders (`spur <noun>`), versions (`spur 0.4.3`) and names like
 * `cli:spur` out.
 */
function extractPairs(text: string): Array<{ noun: string; verb: string }> {
    const pattern = /(?<!bun )\bspur ([a-z][a-z-]*) ([a-z][a-z-]*)/g;
    let code = '';
    for (const chunk of text.matchAll(/```[\s\S]*?```|`[^`\n]*`/g)) code += `\n${chunk[0] ?? ''}`;
    const pairs: Array<{ noun: string; verb: string }> = [];
    for (const match of code.matchAll(pattern)) {
        pairs.push({ noun: match[1] ?? '', verb: match[2] ?? '' });
    }
    return pairs;
}

describe('grok-bot doc + recipe surface parity (1293 R4)', () => {
    test('every spur <noun> <verb> pair resolves live and advertises --json', () => {
        const text = `${readFileSync(DOC, 'utf8')}\n${readFileSync(RECIPE, 'utf8')}`;
        const pairs = extractPairs(text);
        expect(pairs.length).toBeGreaterThan(0);
        const { nouns, paths } = collectCliPaths();
        const seen = new Set<string>();
        for (const { noun, verb } of pairs) {
            const path = `spur ${noun} ${verb}`;
            if (seen.has(path)) continue;
            seen.add(path);
            // The noun must be a registered CLI noun (no invented hints).
            expect(nouns.has(noun)).toBe(true);
            const nounCmd = paths.get(`spur ${noun}`);
            expect(nounCmd).toBeDefined();
            // The verb must resolve on that noun ('spur <noun> <verb>' — subcommand or
            // noun-level alias verb), and the path must advertise --json.
            const full = paths.get(path);
            if (full) {
                expect(full.flags.has('--json')).toBe(true);
                continue;
            }
            expect(nounCmd?.children.has(verb)).toBe(true);
        }
    });
});
