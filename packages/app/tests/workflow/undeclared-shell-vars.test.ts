import { describe, expect, test } from 'bun:test';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { collectUndeclaredShellVarViolations } from '../../src/services/workflow-service';

// 0674 R5: every `$var` a shell action/guard references must have a declared home in the
// workflow's vars: block (or be provided locally). Drives the collector directly — the
// validate() wiring is covered by the all-workflows sweep in spur-check.

function sm(states: object[], transitions: object[] = [], vars: Record<string, unknown> = {}): WorkflowDef {
    return {
        kind: 'state-machine',
        states: states as never,
        transitions: transitions as never,
        vars,
    } as unknown as WorkflowDef;
}

describe('collectUndeclaredShellVarViolations (0674 R5)', () => {
    test('flags a lowercase var referenced but not declared (the $baselineSince class)', () => {
        const def = sm(
            [{ id: 'analyze', onEnter: [{ kind: 'shell', options: { command: 'run --since "$baselineSince"' } }] }],
            [],
            {},
        );
        const v = collectUndeclaredShellVarViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('$baselineSince');
        expect(v[0]).toContain('0674 R5');
    });

    test('accepts a declared var of the same name', () => {
        const def = sm([{ id: 'a', onEnter: [{ kind: 'shell', options: { command: 'run --since "$since"' } }] }], [], {
            since: '',
        });
        expect(collectUndeclaredShellVarViolations(def)).toEqual([]);
    });

    test('UPPER_SNAKE names are env-namespace exempt (ambient or sourced .env)', () => {
        const def = sm(
            [
                {
                    id: 'a',
                    onEnter: [
                        {
                            kind: 'shell',
                            options: {
                                command: '. .spur/run/$__runId-paths.env; run --since "$HA_SINCE" --path "$PWD"',
                            },
                        },
                    ],
                },
            ],
            [],
            { __runId: '' },
        );
        expect(collectUndeclaredShellVarViolations(def)).toEqual([]);
    });

    test('dotted braced engine templates are skipped', () => {
        const def = sm([{ id: 'a', onEnter: [{ kind: 'shell', options: { command: `echo \${vars.wbs}` } }] }], [], {});
        expect(collectUndeclaredShellVarViolations(def)).toEqual([]);
    });

    test('single-quoted spans are literal text (jq program bodies never expand)', () => {
        const def = sm(
            [
                {
                    id: 'a',
                    onEnter: [
                        {
                            kind: 'shell',
                            options: { command: 'jq --slurpfile b "$BATCH" \'(($b[0] | length) == 1)\' "$OUT"' },
                        },
                    ],
                },
            ],
            [],
            {},
        );
        expect(collectUndeclaredShellVarViolations(def)).toEqual([]);
    });

    test('escaped \\$name passes through to jq unexpanded', () => {
        const def = sm(
            [
                {
                    id: 'a',
                    onEnter: [
                        { kind: 'shell', options: { command: 'jq --arg d "$x" ".checks += [\\"e\\":\\$d]" f.json' } },
                    ],
                },
            ],
            [],
            { x: '' },
        );
        expect(collectUndeclaredShellVarViolations(def)).toEqual([]);
    });

    test('local assignments, for-loop vars, and read vars count as provided', () => {
        const def = sm([
            {
                id: 'a',
                onEnter: [
                    {
                        kind: 'shell',
                        options: {
                            command:
                                'FID=$(task show); for w in one two; do echo "$w"; done; printf "" | while read -r n rest; do echo "$n $rest"; done; echo "$FID"',
                        },
                    },
                ],
            },
        ]);
        expect(collectUndeclaredShellVarViolations(def)).toEqual([]);
    });

    test('walks transition guards as well as actions', () => {
        const def = sm(
            [{ id: 'precheck' }],
            [
                {
                    from: 'precheck',
                    to: 'implement',
                    guard: { kind: 'shell', options: { command: 'test "$(cat .spur/run/$wbs-x.status)" = PASS' } },
                },
            ],
            {},
        );
        const v = collectUndeclaredShellVarViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('precheck→implement');
    });
});
