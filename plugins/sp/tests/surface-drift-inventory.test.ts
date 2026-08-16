/**
 * surface-drift-inventory — unit coverage for the span/flag parsers (task 0539).
 *
 * These parsers decide what the drift inventory even *looks at*: a span the
 * extractor drops is a surface claim that can never be reported as drift, so a
 * silent parser regression weakens the inventory without failing it. The sweeps
 * themselves shell the live CLI and are covered by running the tool; this file
 * pins the pure extraction layer that gates them.
 */
import { describe, expect, test } from 'bun:test';
import {
    backticks,
    flagNames,
    isFlagSpan,
    lineInvocationSpans,
    nounOfReference,
    parseInvocation,
} from '../scripts/surface-drift-inventory';

describe('parseInvocation — noun/verb/flag extraction', () => {
    test('splits a plain invocation into noun, verb, and flags', () => {
        expect(parseInvocation('spur task update 0042 --section Plan --json')).toEqual({
            nouns: ['task'],
            verbs: ['update'],
            flags: ['--section', '--json'],
        });
    });

    test('strips the monorepo dev prefixes so both invocation forms normalize alike', () => {
        const direct = parseInvocation('spur feature check F1 --strict');
        expect(parseInvocation('bun run apps/cli/src/index.ts feature check F1 --strict')).toEqual(direct);
        expect(parseInvocation('bunx spur feature check F1 --strict')).toEqual(direct);
    });

    test('expands slash alternation into every claimed name', () => {
        expect(parseInvocation('spur task show/get 0042')).toEqual({
            nouns: ['task'],
            verbs: ['show', 'get'],
            flags: [],
        });
    });

    test('a pipe is a shell separator, not alternation — only the first verb is claimed', () => {
        // `show|get` in prose reads as alternation, but `|` is a pipe in a real
        // command; the slash form above is how alternation is claimed.
        expect(parseInvocation('spur task show|get 0042')?.verbs).toEqual(['show']);
    });

    test('flags survive a placeholder argument (the documented invocation style)', () => {
        // `<wbs>` contains `>`; splitting on it truncated the span and silently
        // dropped every flag documented after the first placeholder.
        expect(parseInvocation('spur task update <wbs> --section <name> --from-file <path>')).toEqual({
            nouns: ['task'],
            verbs: ['update'],
            flags: ['--section', '--from-file'],
        });
    });

    test('stops at a shell separator so only the first command is claimed', () => {
        expect(parseInvocation('spur task check && spur feature check')).toEqual({
            nouns: ['task'],
            verbs: ['check'],
            flags: [],
        });
    });

    test('an ellipsis ends noun/verb claims — elided prose asserts nothing further', () => {
        expect(parseInvocation('spur task … --json')).toEqual({ nouns: ['task'], verbs: [], flags: ['--json'] });
    });

    test('placeholders and quoted args are not mistaken for verbs', () => {
        expect(parseInvocation('spur task update <wbs> --section "Plan"')).toEqual({
            nouns: ['task'],
            verbs: ['update'],
            flags: ['--section'],
        });
    });

    test('returns null when the span asserts no surface', () => {
        expect(parseInvocation('spur')).toBeNull();
        expect(parseInvocation('git status')).toBeNull();
        expect(parseInvocation('')).toBeNull();
    });

    test('trailing punctuation from prose is trimmed', () => {
        expect(parseInvocation('spur status.')).toEqual({ nouns: ['status'], verbs: [], flags: [] });
    });
});

describe('span extraction', () => {
    test('backticks returns every inline span on the line', () => {
        expect(backticks('use `spur task check` then `spur feature sync`')).toEqual([
            'spur task check',
            'spur feature sync',
        ]);
    });

    test('lineInvocationSpans finds backticked invocations', () => {
        expect(lineInvocationSpans('run `spur workflow run x.yaml` now').some((s) => s.includes('workflow'))).toBe(
            true,
        );
    });

    test('lineInvocationSpans ignores backticked spans that are not invocations', () => {
        expect(lineInvocationSpans('the `feature_id` frontmatter field')).toEqual([]);
    });
});

describe('flag spans', () => {
    test('isFlagSpan accepts a pure flag list with placeholders', () => {
        expect(isFlagSpan('--from-answer <path> --folder')).toBe(true);
        expect(isFlagSpan('--json')).toBe(true);
    });

    test('isFlagSpan rejects a span carrying a verb', () => {
        expect(isFlagSpan('task check --json')).toBe(false);
    });

    test('flagNames extracts both short and long forms', () => {
        expect(flagNames('--section <name> -f --dry-run')).toEqual(['--section', '-f', '--dry-run']);
    });
});

describe('nounOfReference — reference path to CLI noun', () => {
    test('maps a plural reference file to its singular noun', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/tasks.md')).toBe('task');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/features.md')).toBe('feature');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/workflows.md')).toBe('workflow');
    });

    test('maps a nested reference file through its parent directory', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/tasks/operations.md')).toBe('task');
    });

    test('already-singular nouns map to themselves', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/agent.md')).toBe('agent');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/team.md')).toBe('team');
    });

    test('returns null for a file outside the noun-mapped references', () => {
        expect(nounOfReference('plugins/sp/skills/spur-dev/references/cross-cutting.md')).toBeNull();
    });
});
