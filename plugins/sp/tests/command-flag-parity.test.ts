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
 * R5 (task 0413, H82): --agent declared by exactly 25 mode-aware commands.
 *     dev-idea joined the set once its pipeline gained an operator-steerable executor.
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
    return m?.[1] ?? '';
}

/** Extract `--flag` tokens from a string. */
function extractFlags(text: string): Set<string> {
    const flags = new Set<string>();
    for (const m of text.matchAll(/(--[a-z][a-z-]*)/g)) {
        const flag = m[1];
        if (flag !== undefined) flags.add(flag);
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
        if (commandName === undefined) continue;
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
        // 0885: dev-refactor joins the mode-aware set (references the inline-default contract).
        expect(agentCommands.length).toBe(26);
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

    // ---------- task 0496 (feature H1): --worktree [<name>] placeholder ----------
    //
    // Every command declaring --worktree must document the optional <name> argument consistently. extractFlags still captures
    // --worktree (the regex stops at `[`), so R8 parity passes either way — this test pins
    // the placeholder spelling so the three commands cannot drift.

    // dev-run joined the set: it drives a whole task pipeline (a batch of one), unlike dev-next
    // which dispatches a single step and stays excluded below.
    const WORKTREE_COMMANDS = ['dev-runall', 'dev-refineall', 'dev-verifyall', 'dev-run', 'dev-review'];
    for (const command of WORKTREE_COMMANDS) {
        test(`R7 — ${command} documents optional --worktree name as [<name>]`, () => {
            const raw = readFileSync(join(COMMANDS_DIR, `${command}.md`), 'utf8');
            const hint = argumentHint(raw);
            expect(
                hint.includes('[--worktree [<name>]]'),
                `${command} argument-hint must include '[--worktree [<name>]]' to document the optional name argument (task 0496). Got: ${hint}`,
            ).toBe(true);
        });
    }

    test('R7 — dev-next does not declare --worktree in any form (task 0496)', () => {
        const raw = readFileSync(join(COMMANDS_DIR, 'dev-next.md'), 'utf8');
        expect(raw.includes('--worktree'), 'dev-next must stay free of --worktree (WT-7 exclusion, task 0496)').toBe(
            false,
        );
    });

    // ---------- task 0931 (feature H1): --concurrency, the parallel worker bound ----------
    //
    // --concurrency is dev-runall-only and deliberately stays OUT of the argument-hint: the
    // R8 gate derives membership from hints, and the dev-operations.md row (out of this task's
    // scope) would drift. It is documented in the command's Argument Flags table + flag notes
    // and defined once in flag-glossary.md.

    test('0931 — dev-runall documents --concurrency <n> in its Argument Flags table and flag notes', () => {
        const raw = readFileSync(join(COMMANDS_DIR, 'dev-runall.md'), 'utf8');
        expect(raw).toMatch(/\| `--concurrency` `<n>` \|[^\n]+\| 2 \|/);
        expect(raw).toContain('`--concurrency <n>`\n(parallel-mode worker bound');
        // Only dev-runall carries it.
        for (const file of commandFiles) {
            if (file === 'dev-runall.md') continue;
            const other = readFileSync(join(COMMANDS_DIR, file), 'utf8');
            expect(other.includes('--concurrency'), `${file} unexpectedly declares --concurrency`).toBe(false);
        }
    });

    test('0931 — flag-glossary.md defines --concurrency exactly once, keyed on its anchor', () => {
        expect(glossaryEntryCount('--concurrency')).toBe(1);
        const glossary = readFileSync(GLOSSARY_PATH, 'utf8');
        expect(glossary).toContain('**Anchor:** `#flag-concurrency`.');
        expect(glossary).toContain('(default 2, `n ≥ 1`)');
    });
});

// ---------- task 1022 (feature I33): dev-review contract hygiene ----------
//
// R1 single target forwarding; R2 coordinator Review ownership; R3 triage Edit/Write;
// R4 one --focus vocabulary (SSOT: code-verification review mode); R5 no live --fix/--next
// routes; R6 --auto declared + --json removed; R7 functional-review modes include review.

describe('task 1022 — dev-review contract hygiene', () => {
    const ROUTING_PATH = join(ROOT, 'plugins', 'sp', 'skills', 'next-router', 'references', 'routing-table.md');
    const REVIEWER_PATH = join(ROOT, 'plugins', 'sp', 'agents', 'super-reviewer.md');
    const CV_PATH = join(ROOT, 'plugins', 'sp', 'skills', 'code-verification', 'SKILL.md');
    const FUNCTIONAL_PATH = join(ROOT, 'plugins', 'sp', 'skills', 'functional-review', 'SKILL.md');
    const reviewRaw = readFileSync(join(COMMANDS_DIR, 'dev-review.md'), 'utf8');

    test('R1 — each review skill receives the target exactly once (no doubled <wbs>/<path> prefix)', () => {
        expect(reviewRaw).not.toMatch(/args="<wbs> \$ARGUMENTS"/);
        expect(reviewRaw).not.toMatch(/args="<path> \$ARGUMENTS"/);
        // Post-1023, $ARGUMENTS carries the whole selector (`--tasks 1021,1022 …`), so each per-target
        // leg forwards its one resolved target plus the non-selector flags — never raw $ARGUMENTS.
        expect(reviewRaw).toContain('Skill(skill="sp:functional-review", args="<wbs> $FLAGS")');
        expect(reviewRaw).toContain('Skill(skill="sp:code-verification", args="review <wbs> $FLAGS")');
        expect(reviewRaw).toContain('Skill(skill="sp:code-improvement", args="<wbs> $FLAGS")');
        expect(reviewRaw).toContain('Skill(skill="sp:code-verification", args="review <path> $FLAGS")');
        expect(reviewRaw).toContain('Skill(skill="sp:code-improvement", args="<path> $FLAGS")');
        expect(reviewRaw).not.toMatch(/Skill\(skill="sp:[a-z-]+", args="(review )?\$ARGUMENTS"\)/);
    });

    test('R2 — the invoking session is the coordinator and writes ## Review in WBS mode', () => {
        expect(reviewRaw).toContain('Coordinator = this session');
        expect(reviewRaw).toContain('spur task update <wbs> --section Review --from-file');
        const reviewer = readFileSync(REVIEWER_PATH, 'utf8');
        expect(reviewer).toMatch(/WBS target → the merged report is written/);
        expect(reviewer).toMatch(/path target → advisory output only/);
        // The agent file must not claim /sp:dev-review spawns it — the invoking session is
        // the coordinator (1022 R2); the command's contract text is the guard above.
        expect(reviewer).not.toContain('Spawned by `/sp:dev-review`');
    });

    test('R3 — allowed-tools includes Edit and Write, stated as --triage direct-fix only', () => {
        expect(reviewRaw).toMatch(/^allowed-tools:\s*\[.*"Edit".*"Write".*\]$/m);
        expect(reviewRaw).toContain('`Edit`/`Write` in `allowed-tools` exist only for these direct fixes');
    });

    test('R4 — one --focus vocabulary for review, SSOT in code-verification review mode', () => {
        const cv = readFileSync(CV_PATH, 'utf8');
        expect(cv).toContain('--focus <all|functional|security|efficiency|correctness|usability|architecture>');
        // The stale glossary list no longer claims to be the review/verify vocabulary
        // (dev-reverse keeps its own reconstruction lens list).
        const glossary = readFileSync(GLOSSARY_PATH, 'utf8');
        expect(glossary).not.toContain('`dev-verify`/`dev-verifyall` (`all|stack|');
        expect(reviewRaw).toContain('[code-verification/SKILL.md](../skills/code-verification/SKILL.md)');
    });

    test('R5 — no live route recommends dev-review --fix or super-reviewer --next', () => {
        const routing = readFileSync(ROUTING_PATH, 'utf8');
        expect(routing).not.toMatch(/dev-review[^\n]*--fix/);
        expect(routing).toContain('/sp:dev-review --tasks <wbs> --triage');
        const reviewer = readFileSync(REVIEWER_PATH, 'utf8');
        expect(reviewer).not.toContain('--next');
        // code-verification's review-mode flag list drops --fix. Slice from the anchored
        // heading to the next H2 and require a non-empty section, so a moved heading fails
        // loud instead of passing on '' (task 1032 R5).
        const cv = readFileSync(CV_PATH, 'utf8');
        const reviewSection = cv.match(/^## Mode: review[^\n]*\n([\s\S]*?)(?=^## )/m)?.[1] ?? '';
        expect(reviewSection.length).toBeGreaterThan(0);
        expect(reviewSection).not.toContain('--fix');
        // dev-review keeps --fix only as the documented deprecated no-op, outside the hint.
        expect(extractFlags(argumentHint(reviewRaw)).has('--fix')).toBe(false);
    });

    test('R6 — --auto declared in hint and dev-operations row; --json gone from super-reviewer', () => {
        expect(extractFlags(argumentHint(reviewRaw)).has('--auto')).toBe(true);
        expect(commandTableFlags().get('dev-review')?.has('--auto')).toBe(true);
        const reviewer = readFileSync(REVIEWER_PATH, 'utf8');
        expect(reviewer).not.toContain('--json');
    });

    test('R7 — functional-review frontmatter modes include review', () => {
        const raw = readFileSync(FUNCTIONAL_PATH, 'utf8');
        expect(raw).toMatch(/modes:\s*\n\s*-\s*verify\s*\n\s*-\s*review/);
    });
});

// ---------- task 1023 (feature I33): dev-review target selectors ----------
//
// R1 exactly one of --tasks/--feature/--scope per invocation; R2 --tasks keeps the review-safe
// batch selector grammar (comma WBS list, feature:<id>; status pseudo-lists and ready rejected)
// with --feature as union sugar; R5 deprecated positional alias; R6 pipeline review step forwards
// --tasks ${vars.wbs} and the bundled copy matches; R7 multi-target worktree admission/slug/marker;
// R8 hint + dev-operations row + glossary (#flag-tasks/#flag-feature/#flag-scope) change together.

describe('task 1023 — dev-review target selectors (--tasks / --feature / --scope)', () => {
    const PIPELINE = join(ROOT, 'config', 'workflows', 'task-pipeline.yaml');
    const BUNDLED_PIPELINE = join(ROOT, 'apps', 'cli', 'config', 'workflows', 'task-pipeline.yaml');
    const opsRaw = readFileSync(DEV_OPS_PATH, 'utf8');
    const reviewRaw = readFileSync(join(COMMANDS_DIR, 'dev-review.md'), 'utf8');
    const reviewHintFlags = extractFlags(argumentHint(reviewRaw));

    test('R1 — hint declares the three exclusive selectors plus --auto; exclusivity stated before review', () => {
        for (const flag of ['--tasks', '--feature', '--scope', '--auto']) {
            expect(reviewHintFlags.has(flag), `dev-review argument-hint must declare ${flag} (task 1023)`).toBe(true);
        }
        expect(reviewRaw).toContain('Exactly one target kind per invocation');
    });

    test('R2 — review-safe selector grammar: comma WBS list + feature:<id>; status pseudo-lists and ready rejected; --feature is union sugar', () => {
        expect(reviewRaw).toContain('`feature:<id>`');
        expect(reviewRaw).toMatch(/status pseudo-lists and `ready` are rejected for review/);
        expect(reviewRaw).toContain('--feature <id>[,<id>]');
        expect(reviewRaw).toContain('execution-batch.md#step-1--selector-resolution-r1');
    });

    test('R5 — positional documented as a deprecated alias naming the replacement selectors', () => {
        expect(reviewRaw).toContain('Deprecated positional alias');
        expect(reviewRaw).toContain('`^\\d{4}$`');
        expect(reviewRaw).toContain('--tasks <wbs>');
        expect(reviewRaw).toContain('--scope <path>');
    });

    test('R8a — dev-operations.md row 2 and §2 text carry the selectors, NOT-STARTED and exit-2 contracts', () => {
        const rowFlags = commandTableFlags().get('dev-review');
        expect(rowFlags).toBeDefined();
        for (const flag of ['--tasks', '--feature', '--scope', '--auto']) {
            expect(rowFlags?.has(flag), `dev-operations.md dev-review row must declare ${flag}`).toBe(true);
        }
        expect(opsRaw).toContain('--feature <id>[,<id>]');
        expect(opsRaw).toContain('--scope <path>[,<path>]');
        expect(opsRaw).toContain('NOT-STARTED');
        expect(opsRaw).toContain('no implicit `cwd` target');
    });

    test('R8b — glossary #flag-tasks / #flag-feature / #flag-scope each cover dev-review', () => {
        const glossary = readFileSync(GLOSSARY_PATH, 'utf8');
        const sectionOf = (flag: string): string => {
            const name = flag.replace(/^--/, '');
            return glossary.split('\n### ').find((p) => p.startsWith(`\`--${name}`)) ?? '';
        };
        for (const flag of ['--tasks', '--feature', '--scope']) {
            const section = sectionOf(flag);
            expect(section, `${flag} glossary entry must mention dev-review (task 1023)`).toContain('dev-review');
        }
        expect(sectionOf('--feature')).toContain('`--feature <id>[,<id>]`');
        expect(sectionOf('--scope')).toContain('comma list of paths');
        expect(sectionOf('--tasks')).toMatch(/status pseudo-lists and `ready` are\s+rejected/);
    });

    // Biome forbids "${...}" inside string literals; split the token to keep the literal assertion honest.
    const VARREF = '$' + '{vars.wbs}';
    test('R6 — pipeline review step forwards the task via --tasks; generated apps/cli/config matches', () => {
        const pipeline = readFileSync(PIPELINE, 'utf8');
        const forwarded = 'input: /sp:dev-review --tasks ' + VARREF + ' --auto';
        const bare = 'input: /sp:dev-review ' + VARREF + ' --auto';
        expect(pipeline).toContain(forwarded);
        expect(pipeline).not.toContain(bare);
        expect(readFileSync(BUNDLED_PIPELINE, 'utf8')).toContain(forwarded);
    });

    test('R7 — multi-target worktree admission, slug and marker documented', () => {
        for (const raw of [reviewRaw, opsRaw]) {
            expect(raw).toContain('sp/review-<first>-and-<N>-<short-id>');
            expect(raw).toContain('sp/review-<slug>-<short-id>');
        }
        expect(reviewRaw).toMatch(/every target to resolve before the tree is cut/);
        expect(reviewRaw).toMatch(/`selector` = the full normalized target list/);
    });
});

describe('task 1032 — dev-review P4 advisory sweep', () => {
    const SKILLS = join(ROOT, 'plugins', 'sp', 'skills');
    const cv = readFileSync(join(SKILLS, 'code-verification', 'SKILL.md'), 'utf8');
    const reviewRaw = readFileSync(join(COMMANDS_DIR, 'dev-review.md'), 'utf8');
    const step3 = cv.match(/^### Step 3 — [^\n]*\n([\s\S]*?)(?=^### )/m)?.[1] ?? '';

    test('R1/R2 — scope recipe matches the subject only and is anchored at the repo root', () => {
        expect(step3.length).toBeGreaterThan(0);
        expect(step3).toContain("git log --format='%H %s'");
        expect(step3).not.toContain('--grep=');
        expect(step3).toContain('ROOT=$(git rev-parse --show-toplevel)');
        expect(step3).toContain('TASK_FILE#$ROOT/}');
        expect(step3).not.toContain('$PWD/');
    });

    test('R3 — tagged commits touching only the task file degrade visibly', () => {
        expect(step3).toMatch(/touch only the task file/);
    });

    test('R4 — dev-review --focus row links the SSOT without restating the vocabulary', () => {
        const focusRow = reviewRaw.split('\n').find((l) => l.startsWith('| `--focus`')) ?? '';
        expect(focusRow).toContain('[code-verification/SKILL.md](../skills/code-verification/SKILL.md)');
        expect(focusRow).not.toContain('all\\|functional');
    });

    test('R6 — no positional-only /sp:dev-review <wbs> example remains in routed docs', () => {
        const docs = [
            join(SKILLS, 'code-verification', 'SKILL.md'),
            join(SKILLS, 'next-router', 'references', 'routing-table.md'),
            join(SKILLS, 'spur-dev', 'references', 'execution-workflow.md'),
            join(SKILLS, 'spur-dev', 'references', 'gate-checklists.md'),
        ];
        for (const doc of docs) expect(readFileSync(doc, 'utf8')).not.toContain('/sp:dev-review <wbs>');
    });

    test('R7 — sys-architecture describes task sets and advisory --scope review', () => {
        const arch = readFileSync(join(SKILLS, 'sys-architecture', 'SKILL.md'), 'utf8');
        const para = arch.split('\n').find((l) => l.includes('`/sp:dev-review` is')) ?? '';
        expect(para).toContain('--tasks');
        expect(para).toContain('--scope');
    });

    test('R8 — nested --scope collapses to the ancestor; positional beside a selector exits 2', () => {
        expect(reviewRaw).toContain('`--scope apps,apps/cli` → `apps`');
        expect(reviewRaw).toMatch(/positional beside an explicit selector[^\n]*exit 2/);
    });
});
