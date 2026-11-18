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

/** `self` verbs with no `docs/help` page (pre-1388 gap, named so it stays visible). */
const UNDOCUMENTED_SELF_VERBS = new Set(['exec', 'install', 'search', 'uninstall']);

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
    const record = (cmd: CmdLike, path: string): void => {
        if (!cli.has(path)) {
            cli.set(path, new Set(cmd.options.map((o) => o.long).filter((f): f is string => f !== undefined)));
        }
    };
    const walk = (cmd: CmdLike, path: string): void => {
        record(cmd, path);
        for (const sub of cmd.commands) walk(sub, `${path} ${sub.name()}`);
    };
    for (const noun of program.commands) {
        // Task 1388: the five legacy verbs are now documented under `spur self <verb>` paths (their
        // pages carry the canonical H1), so the whole `self` subtree is walked. The four verbs
        // below have no `docs/help` page at all — that gap predates 1388 and stayed hidden behind
        // the old blanket skip; naming them here keeps it visible instead of silent.
        if (noun.name() === 'self') {
            // Record the container, then descend verb by verb so the four undocumented verbs can
            // be named instead of silently walked.
            record(noun, 'spur self');
            for (const verb of noun.commands) {
                if (UNDOCUMENTED_SELF_VERBS.has(verb.name())) continue;
                walk(verb, `spur self ${verb.name()}`);
            }
            continue;
        }
        walk(noun, `spur ${noun.name()}`);
    }
    return cli;
}

/**
 * Parse the documented flag rows per command path. Three documented shapes:
 *   `# spur <noun>` / `# spur self <verb>` — single-verb file (1020 canonical alias H1s);
 *       every flag row belongs to `spur <noun>`
 *   `## spur <noun> <verb>`  per-verb section
 *   `## spur agent start | stop`  combined section — rows attribute to each named path
 * A row cell may carry an escaped pipe inside backticks (`<yes\|no\|cancel>`), so the
 * split must not cut at `\|`.
 */
function collectDocFlags(): Map<string, Map<string, Set<string>>> {
    const docs = new Map<string, Map<string, Set<string>>>();
    for (const file of readdirSync(HELP_DIR).filter((f) => f.startsWith('cmd_') && f.endsWith('.md'))) {
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
            // 1020 canonicalized these pages to `# spur self <verb>` H1s; 1388 then removed the
            // top-level spellings, so the H1 — not the filename — now names the command path.
            const h1 = /^# (spur (?:self )?[a-z-]+)\s*$/.exec(line);
            if (h1) {
                current = [own(h1[1] as string)];
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

    test('AC7: every CLI flag has a documented row (subcommand :: flag)', () => {
        // Task 1388: a page is found by the path its H1 documents, not by its filename, so
        // `cmd_status.md` (# spur self status) still covers `spur self status`.
        const docByPath = new Map<string, Set<string>>();
        for (const sections of docs.values()) {
            for (const [path, flags] of sections) {
                const merged = docByPath.get(path) ?? new Set<string>();
                for (const flag of flags) merged.add(flag);
                docByPath.set(path, merged);
            }
        }
        const undocumented: string[] = [];
        for (const [path, flags] of cli) {
            const docFlags = docByPath.get(path) ?? new Set<string>();
            for (const flag of flags) {
                if (ALLOW_LIST.has(flag)) continue;
                if (!docFlags.has(flag)) undocumented.push(`${path} :: ${flag}`);
            }
        }
        expect(undocumented).toEqual([]);
    });

    test('AC7: every documented flag exists on its subcommand (file :: subcommand :: flag)', () => {
        const phantom: string[] = [];
        for (const [file, sections] of docs) {
            // Task 1388: a page's own H1 (e.g. `# spur self status`) is the path it documents,
            // so a file whose name no longer matches a top-level noun is not a phantom.
            const ownsLivePath = [...sections.keys()].some((path) => cli.has(path));
            if (!ownsLivePath) {
                phantom.push(`${file} :: <no such command>`);
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
