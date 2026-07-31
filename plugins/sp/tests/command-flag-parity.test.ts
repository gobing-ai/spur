/**
 * command-flag-parity.test — bidirectional flag parity between each
 * numbered command-table entry in dev-operations.md and the matching
 * plugins/sp/commands/<cmd>.md frontmatter `argument-hint` (task 0397,
 * feature H6). Closes the same drift class as spur-cli-parity (task 0396)
 * but for the slash-command layer.
 *
 * R8: for every command that HAS a numbered entry in the dev-operations.md
 *     command table, every flag in its argument-hint appears in that table
 *     row, and every flag in the row appears in the argument-hint.
 * R9: deprecated flags are excluded via a named ignore-list with a stated reason.
 *
 * Commands not in the numbered table (dev-findissue, dev-next, dev-parallel,
 * rule-*, workflow-*, spur-init, …) are out of scope — they have no SSOT row
 * to parity-check against here.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const COMMANDS_DIR = join(ROOT, 'plugins', 'sp', 'commands');
const DEV_OPS_PATH = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'dev-operations.md');

// R9 — deprecated-flag ignore-list. Each entry names the command + flag + reason.
const DEPRECATED_FLAGS: Record<string, Record<string, string>> = {
    'dev-review': {
        '--fix': 'deprecated no-op; remediation routes to /sp:dev-verify --fix',
        '--next': 'deprecated no-op; progression routes to /sp:dev-next',
    },
};

/** Extract the `argument-hint:` value from a command .md frontmatter. */
function argumentHint(raw: string): string {
    const m = raw.match(/^argument-hint:\s*"(.*)"\s*$/m);
    return m ? m[1] : '';
}

/** Extract `--flag` tokens from a string. */
function extractFlags(text: string): Set<string> {
    const flags = new Set<string>();
    for (const m of text.matchAll(/(--[a-z][a-z-]*)/g)) {
        flags.add(m[1]);
    }
    return flags;
}

/** Parse the numbered command table in dev-operations.md.
 *  Returns a map of command-name (e.g. "dev-runall") -> table-row flags Set. */
function commandTableFlags(): Map<string, Set<string>> {
    const opsRaw = readFileSync(DEV_OPS_PATH, 'utf8');
    const map = new Map<string, Set<string>>();
    // Rows look like: | <n>[a?] | <op> | `dev-<op>` | ... | <flag cell> |
    for (const line of opsRaw.split('\n')) {
        if (!line.startsWith('|')) continue;
        // must contain a `dev-<name>` backtick token
        const nameMatch = line.match(/`(dev-[a-z-]+)`/);
        if (!nameMatch) continue;
        const commandName = nameMatch[1];
        map.set(commandName, extractFlags(line));
    }
    return map;
}

describe('sp plugin — command flag parity with dev-operations.md (R8/R9, task 0397)', () => {
    const tableFlags = commandTableFlags();

    // Enumerate every command that has a numbered table entry AND a .md file.
    const commandFiles = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));

    for (const file of commandFiles) {
        const commandName = file.replace(/\.md$/, '');
        const rowFlags = tableFlags.get(commandName);
        if (!rowFlags) continue; // no table entry -> out of scope (R8: "that command's dev-operations.md entry")

        const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
        const hint = argumentHint(raw);
        if (!hint) continue;

        const hintFlags = extractFlags(hint);
        const deprecated = DEPRECATED_FLAGS[commandName] ?? {};

        test(`${commandName}: argument-hint flags appear in dev-operations.md table row (R8 forward)`, () => {
            for (const flag of hintFlags) {
                if (deprecated[flag]) continue; // R9 ignore-list
                expect(
                    rowFlags.has(flag),
                    `${commandName} argument-hint declares ${flag} but its dev-operations.md table row omits it${deprecated[flag] ? ` (deprecated: ${deprecated[flag]})` : ''}`,
                ).toBe(true);
            }
        });

        test(`${commandName}: dev-operations.md table-row flags appear in argument-hint (R8 reverse)`, () => {
            for (const flag of rowFlags) {
                if (deprecated[flag]) continue; // R9 ignore-list
                expect(
                    hintFlags.has(flag),
                    `${commandName} dev-operations.md table row declares ${flag} but the argument-hint omits it${deprecated[flag] ? ` (deprecated: ${deprecated[flag]})` : ''}`,
                ).toBe(true);
            }
        });
    }

    test('R9 — deprecated-flag ignore-list is named with reasons', () => {
        const opsRaw = readFileSync(DEV_OPS_PATH, 'utf8');
        expect(opsRaw).toContain('--fix');
        expect(opsRaw).toContain('deprecated');
        expect(DEPRECATED_FLAGS['dev-review']['--fix']).toBeTruthy();
        expect(DEPRECATED_FLAGS['dev-review']['--next']).toBeTruthy();
    });

    test('R8 — the three drift defects 0397 fixes are closed (dev-verifyall --next, dev-runall --mode/--continue)', () => {
        // dev-verifyall argument-hint must now include --next
        const verifyall = readFileSync(join(COMMANDS_DIR, 'dev-verifyall.md'), 'utf8');
        expect(argumentHint(verifyall)).toContain('--next');

        // dev-runall argument-hint must include --mode and --continue
        const runall = readFileSync(join(COMMANDS_DIR, 'dev-runall.md'), 'utf8');
        const runallHint = argumentHint(runall);
        expect(runallHint).toContain('--mode');
        expect(runallHint).toContain('--continue');

        // dev-runall must NOT carry --next (deliberate asymmetry, R4)
        expect(runallHint).not.toContain('--next');
    });
});
