/**
 * flag-contract-parity.test — cross-surface flag parity gate fixtures (task 0415 / H82).
 *
 * Four regression fixtures reproduce the drift classes evidenced in the task background:
 *
 *   1. `--agent auto` cross-file contradiction  → C3a (cross-cutting.md vs flag-glossary.md)
 *   2. `--agent <name>` in-file three-way       → C3b (resolution order vs value table vs rule)
 *   3. Glossary membership error                → C1 (exact declaring-commands equality)
 *   4. Command↔dev-operations default mismatch  → C2 (Default column vs Inputs)
 *
 * Each fixture is mutation-checked: the drifted content must produce a violation naming the
 * flag, the surfaces + claims, and the authority; the corrected content must produce none.
 *
 * Fixtures feed SYNTHETIC surface content (strings), never the real files, so they stay
 * hermetic and prove the gate binds rather than whatever the tree currently says.
 */
import { describe, expect, test } from 'bun:test';
import {
    bootMain,
    checkAgentValueTables,
    checkDefaultsParity,
    checkGlossaryMembership,
    extractTriggerTable,
    parseCliArgs,
    renderHelp,
    runCli,
    validate,
} from '../scripts/validate-flag-contracts';

// ─── Fixture 1 (C3a): --agent auto cross-file contradiction ─────────────────

const GLOSSARY_AGENT_AUTO_SUBPROCESS = [
    '### `--agent <inline|auto|name>` — name who does the model-bearing work',
    '',
    '**Anchor:** `#flag-agent`.',
    '',
    '| Value | Who does the work | Derived surface |',
    '| --- | --- | --- |',
    '| `inline` (default when omitted) | Whoever is running this session | Inline — by definition |',
    "| `auto` | Tier-resolved from the stage's `min_tier` + `fallback` | Subprocess — a fresh process |",
    "| `<name>` | That coding agent or configured executor | Inline when it is the current session's agent; subprocess otherwise |",
].join('\n');

const CROSS_CUTTING_AGENT_AUTO_DRIFTED = [
    '## Inline-default execution surface',
    '',
    '### The one rule',
    '',
    '> **`--agent <value>` names *who* does the model-bearing work. The execution surface is derived from',
    '> that choice, never declared separately:** if the named executor is the agent already running this',
    '> session, the work happens inline; otherwise it dispatches a subprocess.',
    '',
    '| Value | Who does the work | Derived surface |',
    '| --- | --- | --- |',
    '| `inline` (default when omitted) | Whoever is running this session | Inline — by definition |',
    "| `auto` | Tier-resolved from the stage's `min_tier` + `fallback` | Does not force subprocess; runs inline |",
    "| `<name>` (coding agent or configured executor) | That executor | Inline when it resolves to the current session's agent; subprocess otherwise |",
].join('\n');

const CROSS_CUTTING_AGENT_AUTO_CORRECT = CROSS_CUTTING_AGENT_AUTO_DRIFTED.replace(
    '| Does not force subprocess; runs inline |',
    '| Subprocess — a tier-resolved executor pins a specific agent/model, which the host session cannot supply |',
);

// ─── Fixture 2 (C3b): --agent <name> in-file three-way disagreement ─────────

const CROSS_CUTTING_NAME_THREE_WAY = [
    '## Inline-default execution surface',
    '',
    '### The one rule',
    '',
    '> **`--agent <value>` names *who* does the model-bearing work. The execution surface is derived from',
    '> that choice, never declared separately:** if the named executor is the agent already running this',
    '> session, the work happens inline; otherwise it dispatches a subprocess.',
    '',
    '### Resolution order',
    '',
    '1. **Operator override:** `--agent <name>` forces subprocess execution unconditionally.',
    '2. **Inline:** otherwise invoke the backing `Skill()` directly in the current session.',
    '',
    '| Value | Who does the work | Derived surface |',
    '| --- | --- | --- |',
    '| `inline` (default when omitted) | Whoever is running this session | Inline — by definition |',
    "| `auto` | Tier-resolved from the stage's `min_tier` + `fallback` | Subprocess |",
    "| `<name>` (coding agent or configured executor) | That executor | Inline when it resolves to the current session's agent; subprocess otherwise |",
].join('\n');

const CROSS_CUTTING_NAME_CONSISTENT = CROSS_CUTTING_NAME_THREE_WAY.replace(
    [
        '### Resolution order',
        '',
        '1. **Operator override:** `--agent <name>` forces subprocess execution unconditionally.',
        '2. **Inline:** otherwise invoke the backing `Skill()` directly in the current session.',
        '',
    ].join('\n'),
    '',
);

// ─── Fixture 3 (C1): glossary membership error ──────────────────────────────

const GLOSSARY_KEEP_GOING_DRIFTED = [
    '### `--keep-going` — batch failure policy: skip dependents, continue independents',
    '',
    '**Anchor:** `#flag-keep-going`.',
    '',
    'Batch failure policy on batch commands (`dev-refineall`, `dev-runall`, `dev-verifyall`): skip',
    'in-batch dependents of a failed task and continue independents.',
].join('\n');

const GLOSSARY_KEEP_GOING_CORRECT = GLOSSARY_KEEP_GOING_DRIFTED.replace(
    '(`dev-refineall`, `dev-runall`, `dev-verifyall`)',
    '(`dev-refineall`, `dev-runall`)',
);

// Authority: dev-verifyall never declared --keep-going; dev-refineall and dev-runall did.
const KEEP_GOING_HINTS = new Map<string, string>([
    [
        'dev-refineall',
        '--feature <id> | --tasks <selector> [--focus <mode>] [--description <text>] [--agent <inline|auto|name>] [--auto] [--keep-going] [--status <s>] [--json]',
    ],
    [
        'dev-runall',
        '--tasks <selector> [--feature <id>] [--mode <sequential|parallel>] [--keep-going] [--auto] [--agent <inline|auto|name>] [--json] [--wrap] [--next] [--continue]',
    ],
    [
        'dev-verifyall',
        '--tasks <selector> [--feature <id>] [--agent <inline|auto|name>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable]',
    ],
]);

// ─── Fixture 4 (C2): command↔dev-operations default mismatch ────────────────

const WRAPALL_TABLE_OMITTED = [
    '## Argument Flags',
    '',
    '| Flag | Description | Default |',
    '| --- | --- | --- |',
    '| `--since` `<iso-date>` | Wrap tasks completed since a date. | configured |',
    '| `--feature` `<id>` | Wrap tasks in a feature. | omitted |',
    '| `--status` `<s>` | Only wrap tasks in a status. | omitted |',
    '| `--auto` | Skip objective HITL gates. | off |',
    '| `--merge` | Merge wrap branches. | off |',
    '| `--dry-run` | Render wraps without writing. | off |',
].join('\n');

const WRAPALL_TABLE_DONE = WRAPALL_TABLE_OMITTED.replace(
    '| `--status` `<s>` | Only wrap tasks in a status. | omitted |',
    '| `--status` `<s>` | Only wrap tasks in a status. | done |',
);

const OPS_WRAPALL_DEFAULT_DONE = [
    '## Operation map',
    '',
    '| # | Operation | Command | Backing | Skill / Verb | Arg-hint |',
    '| --- | ----------- | --------- | --------- | -------------- | ---------- |',
    '| 15 | wrapall | `dev-wrapall` | `Skill()` | `spur workflow run` (wrapup-pipeline) | `[--since <iso>] [--feature <id>] [--status <s>] [--auto] [--merge] [--dry-run]` |',
    '',
    '## Skill-backed operations',
    '',
    '### 15. wrapall',
    '',
    '- **Inputs:** `--since <iso-date>` filters done tasks by frontmatter `updated_at >= date` (v1 approximation).',
    '  `--feature <id>` selects all tasks under a feature AND advances the feature through legal lifecycle',
    '  edges (`backlog → active → verifying → done`, guards honored). `--status <s>` (default: `done`)',
    '  filters by task status. `--auto` skips objective confirmations. `--merge` triggers branch cleanup',
    '  (irreversible HITL gate).',
].join('\n');

describe('sp plugin — cross-surface flag parity gate (task 0415 / H82)', () => {
    describe('C3a — --agent auto cross-file contradiction (drift #1)', () => {
        test('cross-cutting "does not force subprocess" vs glossary "a fresh process" → violation', () => {
            const violations = checkAgentValueTables(
                CROSS_CUTTING_AGENT_AUTO_DRIFTED,
                GLOSSARY_AGENT_AUTO_SUBPROCESS,
                '',
            );
            expect(violations.length, JSON.stringify(violations, null, 2)).toBeGreaterThan(0);
            expect(violations[0].flag).toBe('--agent');
            const surfaces = violations[0].surfaces.map((s) => s.name);
            expect(surfaces).toContain('cross-cutting.md');
            expect(surfaces).toContain('flag-glossary.md');
            expect(violations[0].authority).toBe('cross-cutting.md');
        });

        test('both surfaces agree (auto → subprocess) → no violation', () => {
            const violations = checkAgentValueTables(
                CROSS_CUTTING_AGENT_AUTO_CORRECT,
                GLOSSARY_AGENT_AUTO_SUBPROCESS,
                '',
            );
            expect(violations).toEqual([]);
        });
    });

    describe('C3b — --agent <name> in-file three-way disagreement (drift #2)', () => {
        test('resolution order (unconditional subprocess) vs value table (conditional) → violation', () => {
            const violations = checkAgentValueTables(CROSS_CUTTING_NAME_THREE_WAY, GLOSSARY_AGENT_AUTO_SUBPROCESS, '');
            expect(violations.length, JSON.stringify(violations, null, 2)).toBeGreaterThan(0);
            expect(violations[0].flag).toBe('--agent');
            expect(violations[0].gate).toBe('C3b');
        });

        test('all in-file claims agree (conditional) → no violation', () => {
            const violations = checkAgentValueTables(CROSS_CUTTING_NAME_CONSISTENT, GLOSSARY_AGENT_AUTO_SUBPROCESS, '');
            expect(violations).toEqual([]);
        });
    });

    describe('C1 — glossary membership error (drift #3)', () => {
        test('--keep-going naming dev-verifyall (never declared it) → violation', () => {
            const violations = checkGlossaryMembership(GLOSSARY_KEEP_GOING_DRIFTED, KEEP_GOING_HINTS);
            expect(violations.length, JSON.stringify(violations, null, 2)).toBeGreaterThan(0);
            expect(violations[0].flag).toBe('--keep-going');
            const claims = violations[0].surfaces.map((s) => s.claim).join(' ');
            expect(claims).toContain('dev-verifyall');
        });

        test('--keep-going listing exactly its declarers → no violation', () => {
            const violations = checkGlossaryMembership(GLOSSARY_KEEP_GOING_CORRECT, KEEP_GOING_HINTS);
            expect(violations).toEqual([]);
        });
    });

    describe('C2 — command↔dev-operations default mismatch (drift #4)', () => {
        test('table says omitted, ops says done → violation', () => {
            const violations = checkDefaultsParity(
                new Map([['dev-wrapall', WRAPALL_TABLE_OMITTED]]),
                OPS_WRAPALL_DEFAULT_DONE,
            );
            expect(violations.length, JSON.stringify(violations, null, 2)).toBeGreaterThan(0);
            expect(violations[0].flag).toBe('--status');
            expect(violations[0].gate).toBe('C2');
            expect(violations[0].authority).toBe('command file');
        });

        test('table and ops agree (done) → no violation', () => {
            const violations = checkDefaultsParity(
                new Map([['dev-wrapall', WRAPALL_TABLE_DONE]]),
                OPS_WRAPALL_DEFAULT_DONE,
            );
            expect(violations).toEqual([]);
        });
    });

    describe('real-tree gate (runs in the sp test suite so it cannot be forgotten)', () => {
        test('validate() reports zero violations on the shipped surfaces', () => {
            const result = validate();
            expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
        });
    });

    describe('loud-failure paths (R2: unparseable surface never silently skipped)', () => {
        test('C3a — missing cross-cutting value table → loud violation', () => {
            const violations = checkAgentValueTables('no table here', GLOSSARY_AGENT_AUTO_SUBPROCESS, '');
            expect(violations.some((v) => v.gate === 'C3a' && v.message.includes('cross-cutting.md'))).toBe(true);
        });

        test('C3a — missing glossary value table → loud violation', () => {
            const violations = checkAgentValueTables(CROSS_CUTTING_AGENT_AUTO_CORRECT, 'no table here', '');
            expect(violations.some((v) => v.gate === 'C3a' && v.message.includes('flag-glossary.md'))).toBe(true);
        });

        test('C3b — one-rule blockquote missing → loud violation', () => {
            const section = [
                '## Inline-default execution surface',
                '',
                '| Value | Who does the work | Derived surface |',
                '| --- | --- | --- |',
                '| `inline` (default when omitted) | Whoever is running this session | Inline — by definition |',
                '| `auto` | Tier-resolved | Subprocess |',
                '| `<name>` | That executor | Inline when current session; subprocess otherwise |',
            ].join('\n');
            const violations = checkAgentValueTables(section, '', '');
            expect(violations.some((v) => v.gate === 'C3b' && v.message.includes('blockquote missing'))).toBe(true);
        });
    });

    describe('ADR-041 participation (C3a)', () => {
        const ADR_AGREE = [
            '## ADR-041: The Dev Command Surface Uses a Single `--agent <inline|auto|name>` Selector',
            '',
            'If the named executor is the agent already running the session, the work happens inline;',
            'otherwise it dispatches a subprocess. `--inline` → `--agent inline`; `--subprocess` → `--agent auto`.',
        ].join('\n');

        test('ADR agrees with cross-cutting value table → no ADR violation', () => {
            const violations = checkAgentValueTables(
                CROSS_CUTTING_AGENT_AUTO_CORRECT,
                GLOSSARY_AGENT_AUTO_SUBPROCESS,
                ADR_AGREE,
            );
            expect(
                violations.filter((v) => v.gate === 'C3a' && v.surfaces.some((s) => s.name === 'docs/00_ADR.md')),
            ).toEqual([]);
        });

        test('ADR contradicts cross-cutting (auto → inline) → ADR violation', () => {
            const adrDrifted = ADR_AGREE.replace(
                '`--subprocess` → `--agent auto`',
                '`--subprocess` → `--agent inline`',
            );
            const violations = checkAgentValueTables(
                CROSS_CUTTING_AGENT_AUTO_CORRECT,
                GLOSSARY_AGENT_AUTO_SUBPROCESS,
                adrDrifted,
            );
            const adrViolations = violations.filter(
                (v) => v.gate === 'C3a' && v.surfaces.some((s) => s.name === 'docs/00_ADR.md'),
            );
            expect(adrViolations.length, JSON.stringify(violations, null, 2)).toBeGreaterThan(0);
        });

        test('ADR without the marker sentences → no ADR claim, no violation from ADR', () => {
            const violations = checkAgentValueTables(
                CROSS_CUTTING_AGENT_AUTO_CORRECT,
                GLOSSARY_AGENT_AUTO_SUBPROCESS,
                '## ADR-041: unrelated decision',
            );
            expect(violations.filter((v) => v.surfaces.some((s) => s.name === 'docs/00_ADR.md'))).toEqual([]);
        });
    });

    describe('C2 — skip paths (no claim on one side → no comparison)', () => {
        test('command without an operation-map row → no C2 violation', () => {
            const violations = checkDefaultsParity(
                new Map([['dev-noop', WRAPALL_TABLE_OMITTED]]),
                OPS_WRAPALL_DEFAULT_DONE,
            );
            expect(violations).toEqual([]);
        });

        test('ops section without a default marker for the flag → no C2 violation', () => {
            const ops = [
                '## Operation map',
                '',
                '| # | Operation | Command | Backing | Skill / Verb | Arg-hint |',
                '| --- | ----------- | --------- | --------- | -------------- | ---------- |',
                '| 15 | wrapall | `dev-wrapall` | `Skill()` | `spur workflow run` | `[--status <s>]` |',
                '',
                '### 15. wrapall',
                '',
                '- **Inputs:** `--status <s>` filters by task status.',
            ].join('\n');
            const violations = checkDefaultsParity(new Map([['dev-wrapall', WRAPALL_TABLE_OMITTED]]), ops);
            expect(violations).toEqual([]);
        });

        test('command file with no Argument Flags table → no C2 violation', () => {
            const violations = checkDefaultsParity(new Map([['dev-run', 'no table']]), OPS_WRAPALL_DEFAULT_DONE);
            expect(violations).toEqual([]);
        });
    });

    describe('C1 — single-name parentheticals are explanatory, not claims', () => {
        test('--feature naming one command in prose parenthetical → not a C1 claim', () => {
            const glossary = [
                '### `--feature <id>` — scope the operation to a feature',
                '',
                '**Anchor:** `#flag-feature`.',
                '',
                'On feature-advancing commands (`dev-wrapall`) it also advances the feature.',
            ].join('\n');
            const violations = checkGlossaryMembership(glossary, KEEP_GOING_HINTS);
            expect(violations).toEqual([]);
        });
    });

    describe('CLI surface (runs where the gate runs: the sp test suite)', () => {
        test('runCli --help renders the gate list', () => {
            expect(parseCliArgs(['--help']).help).toBe(true);
            expect(parseCliArgs(['--json']).json).toBe(true);
            expect(parseCliArgs(['--check']).check).toBe(true);
            expect(renderHelp()).toContain('C1');
            expect(runCli(['--help']).exitCode).toBe(0);

            let exitCode = -1;
            let out = '';
            bootMain(['--help'], {
                exit: (c) => {
                    exitCode = c ?? 0;
                },
                stdout: {
                    write: (s) => {
                        out += s;
                        return true;
                    },
                },
            });
            expect(exitCode).toBe(0);
            expect(out).toContain('validate-flag-contracts');
        });

        test('runCli --json on a clean tree exits 0 with a report', () => {
            const r = runCli(['--json'], { validateFn: () => ({ violations: [], fileCount: 5 }) });
            expect(r.exitCode).toBe(0);
            expect(JSON.parse(r.stdout).violations).toEqual([]);
        });

        test('runCli human output reports violations on a dirty tree', () => {
            const dirty = {
                violations: [
                    {
                        flag: '--x',
                        gate: 'C1',
                        surfaces: [{ name: 'a', claim: '1' }],
                        authority: 'b',
                        message: 'drift',
                    },
                ],
                fileCount: 5,
            };
            const r = runCli([], { validateFn: () => dirty });
            expect(r.exitCode).toBe(1);
            expect(r.stderr).toContain('drift');
            expect(r.stdout).toBe('');
        });

        test('runCli human output on a clean tree reports agreement', () => {
            const r = runCli([], { validateFn: () => ({ violations: [], fileCount: 5 }) });
            expect(r.exitCode).toBe(0);
            expect(r.stdout).toContain('agree');
            expect(r.stderr).toBe('');
        });

        test('extractTriggerTable returns null when the table is absent', () => {
            expect(extractTriggerTable('## Inline-default execution surface\n\nno table here')).toBeNull();
        });
    });
});
