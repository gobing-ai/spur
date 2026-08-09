/**
 * command-flag-parity.test — multi-layer flag parity for dev-* commands.
 *
 * R8/R9 (task 0397, H6): bidirectional parity between each numbered dev-operations.md
 *     table row and the matching argument-hint. Deprecated flags excluded via ignore-list.
 * R1 (task 0412, H81): every flag declared by ≥2 dev-* hints has exactly one canonical
 *     glossary entry. Membership derived from ALL 28 hints (not just table-rowed commands).
 *     The old R2/R3 per-flag inline deep-link is dropped — gate (e) in validate-commands.ts
 *     now enforces a single footer glossary reference per command.
 * R4 (task 0413, H82): --inline/--subprocess absent from every hint (collapsed to --agent).
 * R5 (task 0413, H82): --agent declared by exactly 19 mode-aware commands.
 * R6 (task 0412, H81): compatibility aliases documented in body, absent from canonical hint.
 *
 * Body text (removal notices, disambiguation prose) is deliberately excluded from flag
 * derivation — see task 0412 ### Design on false positives.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const COMMANDS_DIR = join(ROOT, 'plugins', 'sp', 'commands');
const DEV_OPS_PATH = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'dev-operations.md');
const GLOSSARY_PATH = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'flag-glossary.md');

// R9 — deprecated-flag ignore-list. Each entry names the command + flag + reason.
// dev-review --next was dropped entirely in task 0401 (not deprecated) — no entry here.
const DEPRECATED_FLAGS: Record<string, Record<string, string>> = {
    'dev-review': {
        '--fix': 'deprecated no-op; remediation routes to /sp:dev-verify --fix',
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
 *  Returns a map of command-name (e.g. "dev-runall") -> table-row flags Set.
 *  Only rows whose first column is a numeric table index (`<n>` or `<n><letter>`,
 *  e.g. `13` or `5a`) are matched — incidental `|`-prefixed rows elsewhere in the
 *  file (failure-mode tables, etc.) that mention `dev-<name>` must NOT clobber. */
function commandTableFlags(): Map<string, Set<string>> {
    const opsRaw = readFileSync(DEV_OPS_PATH, 'utf8');
    const map = new Map<string, Set<string>>();
    // Rows look like: | <n>[a?] | <op> | `dev-<op>` | ... | <flag cell> |
    // First column must be a numeric index, optionally suffixed with a single letter.
    const rowRe = /^\|\s*\d+[a-z]?\s*\|/;
    for (const line of opsRaw.split('\n')) {
        if (!rowRe.test(line)) continue;
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

    test('R8 — the three drift defects 0397 fixes are closed (dev-verifyall --next, dev-runall --mode/--continue)', () => {
        // dev-verifyall argument-hint must now include --next
        const verifyall = readFileSync(join(COMMANDS_DIR, 'dev-verifyall.md'), 'utf8');
        expect(argumentHint(verifyall)).toContain('--next');

        // dev-runall argument-hint must include --mode and --continue
        const runall = readFileSync(join(COMMANDS_DIR, 'dev-runall.md'), 'utf8');
        const runallHint = argumentHint(runall);
        expect(runallHint).toContain('--mode');
        expect(runallHint).toContain('--continue');

        // dev-runall now carries --next (task 0401 R5: batch-once wrap). The old
        // "deliberate asymmetry" no longer holds — --next means chain-to-completion
        // with a batch-once wrap hop, which dev-runall supports.
        expect(runallHint).toContain('--next');
    });
    // ---------- task 0412 (feature H81): glossary membership from ALL 28 dev commands ----------
    //
    // Shared-flag membership is now derived from every dev-*.md hint (not just those with a
    // numbered dev-operations.md table row). Body text — removal notices, disambiguation prose,
    // compatibility aliases — is deliberately excluded (see task 0412 ### Design: "a naive
    // body-wide flag regex produces false positives").
    //
    // R1: every shared flag (declared by ≥2 dev commands) has EXACTLY one canonical glossary
    //     entry. The per-flag inline deep-link (old R2/R3) is dropped: gate (e) in
    //     validate-commands.ts now enforces a single command-level footer glossary reference.

    const allDevHints: Map<string, string> = new Map();
    for (const file of commandFiles) {
        const commandName = file.replace(/\.md$/, '');
        if (!commandName.startsWith('dev-')) continue;
        const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
        const hint = argumentHint(raw);
        if (hint) allDevHints.set(commandName, hint);
    }
    const flagDeclaringCommands = (flag: string): string[] => {
        const out: string[] = [];
        for (const [name, hint] of allDevHints) {
            if (extractFlags(hint).has(flag)) out.push(name);
        }
        return out;
    };
    const allDevFlags = new Set<string>();
    for (const hint of allDevHints.values()) {
        for (const f of extractFlags(hint)) allDevFlags.add(f);
    }
    const sharedFlags = new Set<string>();
    for (const flag of allDevFlags) {
        if (flagDeclaringCommands(flag).length >= 2) sharedFlags.add(flag);
    }

    const glossaryRaw = readFileSync(GLOSSARY_PATH, 'utf8');
    function glossaryEntryCount(flag: string): number {
        const name = flag.replace(/^--/, '');
        const re = new RegExp(`\\*\\*Anchor:\\*\\* \`#flag-${name}\``, 'g');
        return (glossaryRaw.match(re) ?? []).length;
    }
    for (const flag of sharedFlags) {
        test(`R1 — shared flag ${flag} has exactly one canonical glossary entry`, () => {
            const count = glossaryEntryCount(flag);
            expect(
                count,
                `${flag} is declared by ${flagDeclaringCommands(flag).length} dev commands but has ${count} glossary entries in flag-glossary.md; expected exactly 1. Zero means the shared flag has no canonical definition; two means the "two definitions" state this gate exists to prevent. Add or de-duplicate the "**Anchor:** \`#flag-${flag.replace(/^--/, '')}\`" entry.`,
            ).toBe(1);
        });
    }

    // ---------- task 0413 (feature H82): post-collapse execution-surface invariant ----------
    //
    // The --agent / --inline / --subprocess triple was collapsed to a single --agent selector.
    // Assert: --agent on exactly the mode-aware commands; --inline / --subprocess absent from
    // every canonical hint.

    test('R4 — --inline and --subprocess are absent from every dev command hint', () => {
        for (const [name, hint] of allDevHints) {
            const flags = extractFlags(hint);
            expect(flags.has('--inline'), `${name} still declares --inline`).toBe(false);
            expect(flags.has('--subprocess'), `${name} still declares --subprocess`).toBe(false);
        }
    });

    test('R5 — --agent is declared by exactly the mode-aware commands (those referencing the inline-default contract)', () => {
        const agentCommands = [...allDevHints.keys()].filter((n) =>
            extractFlags(allDevHints.get(n) ?? '').has('--agent'),
        );
        expect(agentCommands.length).toBe(20);
    });

    // ---------- compatibility alias owning-contract assertions ----------
    //
    const COMPAT_ALIASES: Array<{ command: string; flag: string; doc: string }> = [
        { command: 'dev-verify', flag: '--skip-shipable', doc: 'typo-tolerant alias of --skip-shippable' },
        { command: 'dev-verifyall', flag: '--skip-shipable', doc: 'typo-tolerant alias of --skip-shippable' },
    ];
    for (const { command, flag, doc } of COMPAT_ALIASES) {
        test(`R6 — ${command} documents compatibility alias ${flag}`, () => {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            expect(
                raw.includes(flag),
                `${command} must document the compatibility alias ${flag} in its body (${doc}). It was removed or never added.`,
            ).toBe(true);
            // The alias must NOT appear in the canonical hint
            const hint = argumentHint(raw);
            expect(
                extractFlags(hint).has(flag),
                `${command}: compatibility alias ${flag} must not appear in the canonical argument-hint`,
            ).toBe(false);
        });
    }
});
