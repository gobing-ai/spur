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
 * R10/R11 (task 0403, feature H8): every flag declared in two or more command
 *     argument-hints has exactly one canonical glossary entry in dev-operations.md,
 *     and each declaring command references that entry. Structural only — no prose
 *     comparison (R5). Residual gap accepted: a command could carry the reference
 *     AND contradict it in prose; that is not caught here, deliberately, because
 *     prose comparison produces false failures that get suppressed.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const COMMANDS_DIR = join(ROOT, 'plugins', 'sp', 'commands');
const DEV_OPS_PATH = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references', 'dev-operations.md');

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

    // ---------- task 0403 (feature H8): glossary anchoring ----------
    //
    // Scope (per header lines 13–15): only commands with a numbered dev-operations.md
    // table row. rule-*, workflow-*, spur-init, dev-next, dev-parallel, dev-findissue
    // have no SSOT row and are out of scope — their flags are not anchored here.
    // --agent is explicitly deferred to feature H9 (task 0401 R12); skip it entirely.
    const H9_DEFERRED = new Set(['--agent']);

    // In-scope command -> argument-hint, for commands that have a numbered table row.
    const inScopeHints: Map<string, string> = new Map();
    for (const file of commandFiles) {
        const commandName = file.replace(/\.md$/, '');
        if (!tableFlags.has(commandName)) continue; // out of scope: no table row
        const raw = readFileSync(join(COMMANDS_DIR, file), 'utf8');
        const hint = argumentHint(raw);
        if (hint) inScopeHints.set(commandName, hint);
    }
    const flagDeclaringCommands = (flag: string): string[] => {
        const out: string[] = [];
        for (const [name, hint] of inScopeHints) {
            if (extractFlags(hint).has(flag)) out.push(name);
        }
        return out;
    };
    const inScopeFlags = new Set<string>();
    for (const hint of inScopeHints.values()) {
        for (const f of extractFlags(hint)) if (!H9_DEFERRED.has(f)) inScopeFlags.add(f);
    }
    const sharedFlags = new Set<string>();
    for (const flag of inScopeFlags) {
        if (flagDeclaringCommands(flag).length >= 2) sharedFlags.add(flag);
    }

    // R1: every shared flag has EXACTLY one canonical glossary entry.
    // Entry form (task 0399): "**Anchor:** `#flag-<name>`".
    //
    // Both failure directions matter and neither is hypothetical:
    //   0 entries — a shared flag with no canonical definition is the state H8 exists to end; the
    //               next flag added to a second command would otherwise pass this gate silently.
    //   2 entries — the "two definitions" state, the original defect (`--next` had four).
    // An earlier revision asserted `<= 1`, treating a missing entry as an out-of-scope follow-up.
    // That exemption is not load-bearing: all 22 in-scope shared flags already carry exactly one
    // anchor, so the strict form matches requirement R1 as written and costs nothing today.
    const opsRaw = readFileSync(DEV_OPS_PATH, 'utf8');
    function glossaryEntryCount(flag: string): number {
        const name = flag.replace(/^--/, '');
        const re = new RegExp(`\\*\\*Anchor:\\*\\* \`#flag-${name}\``, 'g');
        return (opsRaw.match(re) ?? []).length;
    }
    for (const flag of sharedFlags) {
        test(`R1 — shared flag ${flag} has exactly one canonical glossary entry`, () => {
            const count = glossaryEntryCount(flag);
            expect(
                count,
                `${flag} is declared by ${flagDeclaringCommands(flag).length} in-scope commands but has ${count} glossary entries in dev-operations.md; expected exactly 1. Zero means the shared flag has no canonical definition; two means the "two definitions" state this gate exists to prevent. Add or de-duplicate the "**Anchor:** \`#flag-${flag.replace(/^--/, '')}\`" entry.`,
            ).toBe(1);
        });
    }

    // R2/R3: each declaring command references the glossary entry, for shared flags
    // that HAVE exactly one anchor. Reference form (task 0399): a markdown link whose
    // visible text is `--<flag>` and whose URL contains "#flag-". Matches both same-file
    // (#flag-x) and relative-path (path/dev-operations.md#flag-x) forms.
    function commandHasReference(commandName: string, flag: string): boolean {
        const raw = readFileSync(join(COMMANDS_DIR, `${commandName}.md`), 'utf8');
        const name = flag.replace(/^--/, '');
        const re = new RegExp(`\\[\`--${name}\`]\\([^)]*#flag-${name}`);
        return re.test(raw);
    }
    for (const flag of sharedFlags) {
        if (glossaryEntryCount(flag) !== 1) continue; // no anchor -> not enforceable here
        for (const commandName of flagDeclaringCommands(flag)) {
            test(`R2/R3 — ${commandName} references the ${flag} glossary entry`, () => {
                const deprecated = DEPRECATED_FLAGS[commandName]?.[flag];
                if (deprecated) return; // deprecated flags are exempt from re-documentation
                expect(
                    commandHasReference(commandName, flag),
                    `${commandName} declares ${flag} (shared by ≥2 in-scope commands) but does not reference its glossary entry. A command inventing its own meaning for a shared flag fails here — add a [\`${flag}\`](../skills/spur-dev/references/dev-operations.md#flag-${flag.replace(/^--/, '')}) reference.`,
                ).toBe(true);
            });
        }
    }
});
