import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bootstrap budget (task 1128 R1/R2, AC1) — the runall driver used to load `SKILL.md` +
 * `execution-batch.md` + `inline-pipeline-driver.md` (187,963 B ≈ 47k tokens) before its first
 * dispatch and compacted within minutes. The sections whose trigger fires later now live in sibling
 * on-demand files, and this test keeps the pre-dispatch read small.
 *
 * The budgets live HERE, together, with the task that set them: a raise is one visible number, not a
 * spread of prose. Measured 2026-10-08 on the split tree: 56,975 / 80,707 / 65,125 B.
 */
const BOOTSTRAP_BUDGETS_BYTES = {
    // task 1128 R2 — sequential-inline, --worktree, --mode parallel
    'sequential-inline': 90_000,
    '--worktree': 110_000,
    '--mode parallel': 110_000,
} as const;

const SPUR_DEV = join(import.meta.dir, '..', 'skills', 'spur-dev');
const SKILL = join(SPUR_DEV, 'SKILL.md');

/**
 * Parse the `## Bootstrap reads` list: one `- <mode>: \`path\`, \`path\`` line per mode, holding
 * relative paths only (task 1128 Design — easy to parse, and agents follow it literally).
 */
function parseBootstrapReads(markdown: string): Map<string, string[]> {
    const section = markdown.split(/^## Bootstrap reads$/m)[1];
    if (section === undefined) throw new Error('SKILL.md has no "## Bootstrap reads" section');
    const body = section.split(/^## /m)[0] ?? '';
    const modes = new Map<string, string[]>();
    for (const line of body.split('\n')) {
        const match = /^-\s+([^:]+):\s*(.+)$/.exec(line.trim());
        if (match === null) continue;
        const mode = (match[1] ?? '').trim();
        const paths = [...(match[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
        if (paths.length === 0) throw new Error(`"${mode}" lists no reference file`);
        modes.set(mode, paths);
    }
    return modes;
}

function byteLength(path: string): number {
    return readFileSync(path).byteLength;
}

const SKILL_BYTES = byteLength(SKILL);
const MODES = parseBootstrapReads(readFileSync(SKILL, 'utf8'));

describe('bootstrap budget (task 1128 R2, AC1)', () => {
    test('every mode is listed and every listed mode has a budget', () => {
        expect([...MODES.keys()].sort()).toEqual(Object.keys(BOOTSTRAP_BUDGETS_BYTES).sort());
    });

    test('every listed file exists under references/ and is a relative path', () => {
        for (const [mode, paths] of MODES) {
            for (const path of paths) {
                expect([mode, path.startsWith('references/')]).toEqual([mode, true]);
                expect([mode, path, byteLength(join(SPUR_DEV, path)) > 0]).toEqual([mode, path, true]);
            }
        }
    });

    test.each(Object.entries(BOOTSTRAP_BUDGETS_BYTES))('%s stays inside its budget', (mode, budget) => {
        const paths = MODES.get(mode) ?? [];
        const total = paths.reduce((sum, path) => sum + byteLength(join(SPUR_DEV, path)), SKILL_BYTES);
        const breakdown = paths.map((path) => `${path}=${byteLength(join(SPUR_DEV, path))}`).join(' + ');
        expect(
            total <= budget,
            `${mode} bootstrap ${total} B > budget ${budget} B (SKILL.md=${SKILL_BYTES} + ${breakdown}); ` +
                'move a section into an on-demand sibling under references/ or state the trigger that defers it',
        ).toBe(true);
    });
});

// The parser is the contract the budgets are read through — an unparseable manifest must fail loudly
// rather than silently sum nothing (a silent zero would make every budget pass).
describe('bootstrap manifest parsing', () => {
    test('a manifest line resolves mode + relative paths', () => {
        const parsed = parseBootstrapReads(
            [
                '## Bootstrap reads',
                '',
                '- sequential-inline: `references/a.md`',
                '- --worktree: `references/a.md`, `references/b.md`',
                '',
            ].join('\n'),
        );
        expect([...parsed]).toEqual([
            ['sequential-inline', ['references/a.md']],
            ['--worktree', ['references/a.md', 'references/b.md']],
        ]);
    });

    test('a missing section throws instead of summing zero bytes', () => {
        expect(() => parseBootstrapReads('# Nothing here')).toThrow('no "## Bootstrap reads"');
    });

    test('a mode line with no file is rejected', () => {
        expect(() => parseBootstrapReads('## Bootstrap reads\n\n- sequential-inline: none\n')).toThrow(
            'lists no reference file',
        );
    });
});
