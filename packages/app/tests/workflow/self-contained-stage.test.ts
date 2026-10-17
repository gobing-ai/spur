import { describe, expect, test } from 'bun:test';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { collectSelfContainedStageViolations } from '../../src/workflow/composition-lint';

// D65 1233 (design workflow-execution-foundation §4.4): a stage that is not self-contained
// cannot run under a subprocess or fleet executor, so validate rejects it before any run.
// Failure modes first — undeclared output, a prompt path from a later state, a path produced
// only in a sibling branch, and a templated path.

/**
 * One engine var template as the prompter writes it. Assembled from its parts so the literal
 * does not trip `lint/suspicious/noTemplateCurlyInString`; the fixtures then interpolate it.
 */
const VAR = '$' + '{vars.__runId}';

/** The same placeholder for the per-task var a shell writes as `$wbs`. */
const WBS_VAR = '$' + '{vars.wbs}';

function sm(states: object[], transitions: object[] = [], name = 'test-workflow'): WorkflowDef {
    return { kind: 'state-machine', name, states, transitions } as unknown as WorkflowDef;
}

const DECLARED_OUTPUT = { expectFile: `.spur/run/${VAR}-candidate.md` };

describe('collectSelfContainedStageViolations R1 — declared completion', () => {
    test('flags an agent.run that declares neither expectFiles nor ownedSections', () => {
        const def = sm([
            {
                id: 'implement',
                onEnter: [{ kind: 'agent.run', options: { role: 'coder', input: '/sp:dev-run --mode implement' } }],
            },
        ]);
        const v = collectSelfContainedStageViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('implement/agent.run[0]');
        expect(v[0]).toContain('neither expectFiles nor ownedSections');
    });

    test('accepts expectFile, expectFiles, ownedSections and the requireDiff guard', () => {
        const def = sm([
            { id: 'a', onEnter: [{ kind: 'agent.run', options: { role: 'coder', ...DECLARED_OUTPUT } }] },
            {
                id: 'b',
                onEnter: [{ kind: 'agent.run', options: { role: 'coder', expectFiles: ['.spur/run/x.txt'] } }],
            },
            { id: 'c', onEnter: [{ kind: 'agent.run', options: { role: 'coder', ownedSections: ['Solution'] } }] },
            {
                id: 'd',
                onEnter: [{ kind: 'agent.run', options: { role: 'coder', requireDiff: true } }],
            },
        ]);
        expect(collectSelfContainedStageViolations(def)).toEqual([]);
    });

    test('walks transition-flow node actions too', () => {
        const def = {
            kind: 'transition-flow',
            nodes: [{ id: 'implement', action: { kind: 'agent.run', options: { role: 'coder' } } }],
            edges: [],
        } as unknown as WorkflowDef;
        const v = collectSelfContainedStageViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('implement/agent.run[0]');
    });
});

describe('collectSelfContainedStageViolations R2 — prompt paths', () => {
    test('flags a run path produced only by a later state', () => {
        const def = sm(
            [
                { id: 'precheck', onEnter: [{ kind: 'shell', options: { command: 'mkdir -p .spur/run' } }] },
                {
                    id: 'enrich',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: { role: 'coder', ...DECLARED_OUTPUT, input: 'Read .spur/run/late.md' },
                        },
                    ],
                },
                { id: 'late', onEnter: [{ kind: 'shell', options: { command: 'printf x > .spur/run/late.md' } }] },
            ],
            [
                { from: 'precheck', to: 'enrich' },
                { from: 'enrich', to: 'late' },
            ],
        );
        const v = collectSelfContainedStageViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('enrich/agent.run[0]');
        expect(v[0]).toContain('.spur/run/late.md');
    });

    test('flags a run path produced only in a sibling branch', () => {
        const def = sm(
            [
                { id: 'precheck', onEnter: [{ kind: 'shell', options: { command: 'true' } }] },
                {
                    id: 'sibling',
                    onEnter: [{ kind: 'shell', options: { command: 'printf x > .spur/run/sibling.md' } }],
                },
                {
                    id: 'enrich',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: { role: 'coder', ...DECLARED_OUTPUT, input: 'Read .spur/run/sibling.md' },
                        },
                    ],
                },
            ],
            [
                { from: 'precheck', to: 'sibling' },
                { from: 'precheck', to: 'enrich' },
                { from: 'sibling', to: 'done' },
                { from: 'enrich', to: 'done' },
            ],
        );
        const v = collectSelfContainedStageViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('enrich/agent.run[0]');
        expect(v[0]).toContain('.spur/run/sibling.md');
    });

    test('matches a templated prompt path against the same template a predecessor shell wrote', () => {
        const def = sm(
            [
                {
                    id: 'precheck',
                    onEnter: [{ kind: 'shell', options: { command: 'printf x > .spur/run/$__runId-bundle.json' } }],
                },
                {
                    id: 'enrich',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: {
                                role: 'coder',
                                ...DECLARED_OUTPUT,
                                input: `Read .spur/run/${VAR}-bundle.json first`,
                            },
                        },
                    ],
                },
            ],
            [{ from: 'precheck', to: 'enrich' }],
        );
        expect(collectSelfContainedStageViolations(def)).toEqual([]);
    });

    test('reports a templated path that no predecessor produces', () => {
        const def = sm([
            {
                id: 'enrich',
                onEnter: [
                    {
                        kind: 'agent.run',
                        options: {
                            role: 'coder',
                            ...DECLARED_OUTPUT,
                            input: `Read .spur/run/${VAR}-missing.md`,
                        },
                    },
                ],
            },
        ]);
        const v = collectSelfContainedStageViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain(`.spur/run/${VAR}-missing.md`);
    });

    test('accepts a path declared in inputs, or named as the stage own expectFile', () => {
        const def = sm([
            {
                id: 'enrich',
                onEnter: [
                    {
                        kind: 'agent.run',
                        options: {
                            role: 'coder',
                            expectFile: `.spur/run/${VAR}-candidate.md`,
                            inputs: [{ path: `.spur/run/${VAR}-bundle.json`, kind: 'artifact' }],
                            input: `Write .spur/run/${VAR}-candidate.md from .spur/run/${VAR}-bundle.json`,
                        },
                    },
                ],
            },
        ]);
        expect(collectSelfContainedStageViolations(def)).toEqual([]);
    });

    test('accepts a path a predecessor command.gate names in args', () => {
        const def = sm(
            [
                {
                    id: 'precheck',
                    onEnter: [
                        {
                            kind: 'command.gate',
                            options: {
                                id: 'task-show',
                                executable: 'spur',
                                args: ['task', 'show', '1233', '--out', '.spur/run/bundle.json'],
                            },
                        },
                    ],
                },
                {
                    id: 'enrich',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: { role: 'coder', ...DECLARED_OUTPUT, input: 'Read .spur/run/bundle.json' },
                        },
                    ],
                },
            ],
            [{ from: 'precheck', to: 'enrich' }],
        );
        expect(collectSelfContainedStageViolations(def)).toEqual([]);
    });

    test('accepts a path produced earlier in the same state', () => {
        const def = sm([
            {
                id: 'escalate',
                onEnter: [
                    { kind: 'shell', options: { command: 'printf x >> .spur/run/$wbs-escalation.md' } },
                    {
                        kind: 'agent.run',
                        options: {
                            role: 'coder',
                            ...DECLARED_OUTPUT,
                            input: `Read .spur/run/${WBS_VAR}-escalation.md`,
                        },
                    },
                ],
            },
        ]);
        expect(collectSelfContainedStageViolations(def)).toEqual([]);
    });
});

describe('collectSelfContainedStageViolations allowances (R3)', () => {
    test('covers only the reviewed workflow, state and path — never a wildcard', () => {
        const discovery = sm(
            [
                {
                    id: 'discovery',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: {
                                role: 'planner',
                                ...DECLARED_OUTPUT,
                                input: `Emit .spur/run/${VAR}-idea-needs-design.json`,
                            },
                        },
                    ],
                },
                {
                    id: 'feature-create',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: {
                                role: 'planner',
                                ...DECLARED_OUTPUT,
                                input: `Emit .spur/run/${VAR}-idea-needs-design.json`,
                            },
                        },
                    ],
                },
            ],
            [],
            'idea-pipeline',
        );
        const v = collectSelfContainedStageViolations(discovery);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('feature-create/agent.run[0]');
    });

    test('does not cover the same state in another workflow', () => {
        const def = sm(
            [
                {
                    id: 'discovery',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: {
                                role: 'planner',
                                ...DECLARED_OUTPUT,
                                input: `Emit .spur/run/${VAR}-idea-needs-design.json`,
                            },
                        },
                    ],
                },
            ],
            [],
            'another-pipeline',
        );
        expect(collectSelfContainedStageViolations(def).length).toBe(1);
    });

    test('does not cover a path added to an allowed state later', () => {
        const def = sm(
            [
                {
                    id: 'discovery',
                    onEnter: [
                        {
                            kind: 'agent.run',
                            options: {
                                role: 'planner',
                                ...DECLARED_OUTPUT,
                                input: `Emit .spur/run/${VAR}-idea-needs-design.json and .spur/run/${VAR}-new.md`,
                            },
                        },
                    ],
                },
            ],
            [],
            'idea-pipeline',
        );
        const v = collectSelfContainedStageViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain(`.spur/run/${VAR}-new.md`);
    });
});
