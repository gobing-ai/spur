import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCliContext } from '../src/context';
import { buildProgram } from '../src/index';
import type { CommandOutput } from '../src/output';

/**
 * Task 0800 R3 — flag-set parity between `docs/help/cmd_*.md` and the live commander tree.
 *
 * Every long flag a subcommand declares must have a row in its doc file, and every
 * documented flag must exist on the subcommand. Description TEXT is explicitly out of
 * scope (89 of 236 rows editorially differ by design). Two global flags are allow-listed:
 * `--json-envelope` (registered on effectively every subcommand) and `--help` (implicit);
 * both are covered once by the docs/help/index.md overview note.
 *
 * The tree under test is the dispatcher's own `buildProgram` — not a re-registered copy —
 * so a newly added verb or flag fails here the moment it lands without a doc row.
 */

const HELP_DIR = join(import.meta.dir, '..', '..', '..', 'docs', 'help');

/** Global flags documented once in docs/help/index.md instead of per subcommand. */
const ALLOW_LIST = new Set(['--json-envelope', '--help']);

interface CmdLike {
    name(): string;
    options: Array<{ long?: string }>;
    commands: CmdLike[];
}

/** Walk the commander tree: `spur <noun> [verb…]` → declared long flags. */
function collectCliFlags(): Map<string, Set<string>> {
    const output: CommandOutput = { write: () => {}, error: () => {} };
    const program = buildProgram(createCliContext({ output }), output) as unknown as CmdLike;
    const cli = new Map<string, Set<string>>();
    const walk = (cmd: CmdLike, path: string): void => {
        if (!cli.has(path)) {
            cli.set(path, new Set(cmd.options.map((o) => o.long).filter((f): f is string => f !== undefined)));
        }
        for (const sub of cmd.commands) walk(sub, `${path} ${sub.name()}`);
    };
    for (const noun of program.commands) {
        // `self` is a container re-registering the five legacy nouns as visible verbs;
        // those verbs are documented once under their top-level alias paths (cmd_init.md
        // etc.), so the duplicate subtree is skipped.
        if (noun.name() === 'self') continue;
        walk(noun, `spur ${noun.name()}`);
    }
    return cli;
}

/**
 * Parse the documented flag rows per command path. Three documented shapes:
 *   `# spur <noun>`          single-verb file — every flag row belongs to `spur <noun>`
 *   `## spur <noun> <verb>`  per-verb section
 *   `## spur team start | stop`  combined section — rows attribute to each named path
 * A row cell may carry an escaped pipe inside backticks (`<yes\|no\|cancel>`), so the
 * split must not cut at `\|`.
 */
function collectDocFlags(): Map<string, Map<string, Set<string>>> {
    const docs = new Map<string, Map<string, Set<string>>>();
    for (const file of readdirSync(HELP_DIR).filter((f) => f.startsWith('cmd_') && f.endsWith('.md'))) {
        const noun = file.replace(/^cmd_/, '').replace(/\.md$/, '');
        const sections = new Map<string, Set<string>>();
        let current: Array<{ path: string; flags: Set<string> }> = [];
        const own = (path: string): { path: string; flags: Set<string> } => {
            const existing = sections.get(path);
            if (existing !== undefined) return { path, flags: existing };
            const flags = new Set<string>();
            sections.set(path, flags);
            return { path, flags };
        };
        for (const line of readFileSync(join(HELP_DIR, file), 'utf8').split('\n')) {
            if (/^# spur [a-z-]+\s*$/.test(line)) {
                current = [own(`spur ${noun}`)];
                continue;
            }
            const h2 = /^## (spur [a-z][a-z |-]*?)\s*$/.exec(line);
            if (h2) {
                const parts = (h2[1] as string).split('|').map((s) => s.trim());
                const prefix = (parts[0] ?? '').split(' ').slice(0, -1).join(' ');
                current = parts.map((part, i) => own(i === 0 ? part : `${prefix} ${part}`));
                continue;
            }
            if (current.length === 0 || !line.startsWith('|')) continue;
            const firstCell = line.split(/(?<!\\)\|/)[1] ?? '';
            for (const m of firstCell.matchAll(/`([^`]+)`/g)) {
                for (const tok of (m[1] ?? '').split(',')) {
                    const flag = tok.trim().split(/[\s<[]/)[0] ?? '';
                    if (flag.startsWith('--')) for (const s of current) s.flags.add(flag);
                }
            }
        }
        docs.set(file, sections);
    }
    return docs;
}

describe('docs/help flag-set parity (task 0800 R3)', () => {
    const cli = collectCliFlags();
    const docs = collectDocFlags();

    test('AC7: every CLI flag has a documented row (file :: subcommand :: flag)', () => {
        const undocumented: string[] = [];
        for (const [path, flags] of cli) {
            const noun = path.split(' ')[1] ?? '';
            const file = `cmd_${noun}.md`;
            const docFlags = docs.get(file)?.get(path) ?? new Set<string>();
            for (const flag of flags) {
                if (ALLOW_LIST.has(flag)) continue;
                if (!docFlags.has(flag)) undocumented.push(`${file} :: ${path} :: ${flag}`);
            }
        }
        expect(undocumented).toEqual([]);
    });

    test('AC7: every documented flag exists on its subcommand (file :: subcommand :: flag)', () => {
        const phantom: string[] = [];
        for (const [file, sections] of docs) {
            const noun = file.replace(/^cmd_/, '').replace(/\.md$/, '');
            if (![...cli.keys()].some((p) => p === `spur ${noun}`)) {
                phantom.push(`${file} :: <no such top-level command>`);
                continue;
            }
            for (const [path, flags] of sections) {
                const cliFlags = cli.get(path);
                if (cliFlags === undefined) {
                    if (flags.size > 0) phantom.push(`${file} :: ${path} :: <no such command>`);
                    continue;
                }
                for (const flag of flags) {
                    if (ALLOW_LIST.has(flag)) continue;
                    if (!cliFlags.has(flag)) phantom.push(`${file} :: ${path} :: ${flag}`);
                }
            }
        }
        expect(phantom).toEqual([]);
    });
});
