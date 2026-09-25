import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    changedPathsOf,
    DOC_OWNED_SURFACES,
    type DriftProbeEnv,
    driftReasonForPath,
    main,
    runDriftProbe,
    type SpurShowResult,
    solutionSectionOf,
    WRAPUP_DRIFT_PROBE_USAGE,
} from '../scripts/wrapup-drift-probe';

/**
 * 0944: execution pins for the wrapup-drift-probe plugin script. These call the exported
 * `runDriftProbe(env, options, spur)` with a fake `SpurRunner` — the same spawnable
 * interface the workflow wrapper and its node twin exercise through `main(argv, env,
 * { cwd })`. One case per doc-owned surface glob (R2), plus the fail-safe contract:
 * any lookup or parse problem is dirty, never a silent clean.
 */

function cleanup(cwd: string): void {
    rmSync(cwd, { recursive: true, force: true });
}

function newCwd(): string {
    return mkdtempSync(join(tmpdir(), 'wrapup-drift-probe-'));
}

function solutionWith(paths: string[]): string {
    const map = paths.map((p) => `- \`${p}:1\``).join('\n');
    return `# 0944 some task\n\n## Intent\n\nDo things.\n\n### Solution\n\n${map}\n\n### Plan\n\nSteps.\n`;
}

function fakeSpur(responses: Record<string, SpurShowResult>): SpurShowResult & { calls: string[][] } {
    const calls: string[][] = [];
    const runner = (args: string[]): SpurShowResult => {
        calls.push(args);
        return responses[args.join(' ')] ?? { status: 1, stdout: '' };
    };
    return Object.assign(runner, { calls });
}

function writeCapture(cwd: string, runId: string, tasks: string[]): void {
    mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
    writeFileSync(join(cwd, '.spur', 'run', `${runId}-wrapup-tasks.json`), `${JSON.stringify(tasks)}\n`);
}

function probe(cwd: string, runId: string, spur: ReturnType<typeof fakeSpur>, env: Partial<DriftProbeEnv> = {}) {
    return runDriftProbe({ __runId: runId, spurBin: 'unused', ...env }, { cwd }, spur);
}

describe('wrapup-drift-probe 0944', () => {
    test('one case per doc-owned surface glob — a changed path under each is dirty', () => {
        const representative: Record<(typeof DOC_OWNED_SURFACES)[number], string> = {
            'packages/contracts/**': 'packages/contracts/src/wrapup.ts',
            'apps/cli/src/commands/**': 'apps/cli/src/commands/wrap.ts',
            'packages/config/src/**': 'packages/config/src/env.ts',
            'drizzle/*.sql': 'drizzle/0099_wrapup_probe.sql',
            [`${join('config', 'workflows')}/**`]: `${join('config', 'workflows', 'wrapup-pipeline.yaml')}`,
            'plugins/sp/commands/**': 'plugins/sp/commands/dev-wrap.md',
            'plugins/sp/skills/**': 'plugins/sp/skills/spur-cli/SKILL.md',
            'plugins/sp/hooks/**': 'plugins/sp/hooks/session-start.ts',
            'package.json': 'package.json',
            'docs/00_ADR.md': 'docs/00_ADR.md',
            'docs/03_ARCHITECTURE.md': 'docs/03_ARCHITECTURE.md',
            'docs/04_DESIGN.md': 'docs/04_DESIGN.md',
            'docs/design/**': 'docs/design/workflow-catalogue-refactor.md',
        };
        for (const glob of DOC_OWNED_SURFACES) {
            const path = representative[glob];
            expect(driftReasonForPath(path), glob).toBe(`matches doc-owned surface ${glob}`);
            const cwd = newCwd();
            try {
                writeCapture(cwd, 's1', ['0944']);
                const result = probe(
                    cwd,
                    's1',
                    fakeSpur({
                        'task show 0944 --json': {
                            status: 0,
                            stdout: JSON.stringify({ status: 'done', content: solutionWith([path]) }),
                        },
                    }),
                );
                expect(result.clean, glob).toBe(false);
                expect(result.reasons, glob).toEqual([`0944: ${path} matches doc-owned surface ${glob}`]);
                expect(readFileSync(join(cwd, '.spur', 'run', 's1-mode.txt'), 'utf8')).toBe('\n');
                expect(JSON.parse(readFileSync(join(cwd, '.spur', 'run', 's1-drift-probe.json'), 'utf8'))).toEqual({
                    clean: false,
                    reasons: [`0944: ${path} matches doc-owned surface ${glob}`],
                    paths: [path],
                });
            } finally {
                cleanup(cwd);
            }
        }
    });

    test('a clean change map (no doc-owned surface) projects mode=fast', () => {
        const cwd = newCwd();
        try {
            writeCapture(cwd, 'c1', ['0944']);
            const spur = fakeSpur({
                'task show 0944 --json': {
                    status: 0,
                    stdout: JSON.stringify({
                        status: 'done',
                        content: solutionWith([
                            'packages/app/src/workflow/engine.ts',
                            'apps/server/src/index.ts',
                            'packages/app/src/workflow/engine.ts',
                        ]),
                    }),
                },
            });
            const result = probe(cwd, 'c1', spur);
            expect(spur.calls).toEqual([['task', 'show', '0944', '--json']]);
            expect(result.clean).toBe(true);
            expect(result.reasons).toEqual([]);
            // Sorted, deduped across repeated line cites of one file.
            expect(result.paths).toEqual(['apps/server/src/index.ts', 'packages/app/src/workflow/engine.ts']);
            expect(readFileSync(join(cwd, '.spur', 'run', 'c1-mode.txt'), 'utf8')).toBe('fast\n');
            expect(JSON.parse(readFileSync(join(cwd, '.spur', 'run', 'c1-drift-probe.json'), 'utf8'))).toEqual({
                clean: true,
                reasons: [],
                paths: result.paths,
            });
        } finally {
            cleanup(cwd);
        }
    });

    test('task and feature corpus paths are never drift', () => {
        expect(driftReasonForPath('docs/tasks5/0944_skip-clean-model-passes.md')).toBeNull();
        expect(driftReasonForPath('docs/features/D64-wrapup.json')).toBeNull();
        const cwd = newCwd();
        try {
            writeCapture(cwd, 's2', ['0944']);
            const result = probe(
                cwd,
                's2',
                fakeSpur({
                    'task show 0944 --json': {
                        status: 0,
                        stdout: JSON.stringify({
                            status: 'done',
                            content: solutionWith(['docs/tasks5/0944_x.md:12', 'docs/features/D64.json:3']),
                        }),
                    },
                }),
            );
            expect(result.clean).toBe(true);
        } finally {
            cleanup(cwd);
        }
    });

    test('a new top-level workspace directory is doc-owned by default', () => {
        expect(driftReasonForPath('tooling/probe.ts')).toBe('new top-level workspace directory');
        expect(driftReasonForPath('README.md')).toBeNull();
    });

    test('an empty or unparseable Solution fails safe (dirty)', () => {
        const cwd = newCwd();
        try {
            writeCapture(cwd, 's3', ['0944']);
            const spur = fakeSpur({
                'task show 0944 --json': {
                    status: 0,
                    stdout: JSON.stringify({ status: 'done', content: '# 0944\n\n### Solution\n\n(no map yet)\n' }),
                },
            });
            const result = probe(cwd, 's3', spur);
            expect(result.clean).toBe(false);
            expect(result.reasons).toEqual(['0944: Solution empty or unparseable']);
        } finally {
            cleanup(cwd);
        }
    });

    test('a task show failure and an unparseable body each fail safe (dirty)', () => {
        const cwd = newCwd();
        try {
            writeCapture(cwd, 's4', ['0944', '0945']);
            const result = probe(
                cwd,
                's4',
                fakeSpur({
                    'task show 0944 --json': { status: 1, stdout: '' },
                    'task show 0945 --json': { status: 0, stdout: 'not json at all' },
                }),
            );
            expect(result.clean).toBe(false);
            expect(result.reasons).toEqual(['0944: task show failed (status=1)', '0945: task show output unparseable']);
        } finally {
            cleanup(cwd);
        }
    });

    test('a missing or corrupted normalized capture fails safe (dirty)', () => {
        const cwd = newCwd();
        try {
            const result = probe(cwd, 's5', fakeSpur({}));
            expect(result.clean).toBe(false);
            expect(result.reasons).toEqual(['normalized task capture missing or corrupted']);
            expect(readFileSync(join(cwd, '.spur', 'run', 's5-mode.txt'), 'utf8')).toBe('\n');
        } finally {
            cleanup(cwd);
        }
    });

    test('an empty __runId is a hard mis-invocation and writes nothing', () => {
        const cwd = newCwd();
        try {
            const result = probe(cwd, '', fakeSpur({}));
            expect(result.exitCode).toBe(1);
            const exists = (p: string): boolean => {
                try {
                    readFileSync(join(cwd, p), 'utf8');
                    return true;
                } catch {
                    return false;
                }
            };
            expect(exists(join('.spur', 'run', '-drift-probe.json'))).toBe(false);
            expect(exists(join('.spur', 'run', '-mode.txt'))).toBe(false);
        } finally {
            cleanup(cwd);
        }
    });

    test('main rejects positional args with the usage line', () => {
        const seen: string[] = [];
        const original = process.stderr.write;
        process.stderr.write = ((chunk: unknown): boolean => {
            seen.push(String(chunk));
            return true;
        }) as typeof process.stderr.write;
        try {
            expect(main(['unexpected'], { __runId: 'x' }, { cwd: newCwd() })).toBe(2);
        } finally {
            process.stderr.write = original;
        }
        expect(seen.join('')).toContain(WRAPUP_DRIFT_PROBE_USAGE);
    });

    test('Solution parsing pins: heading depth tolerance, section boundary, path-like filter, line stripping', () => {
        const section = solutionSectionOf('# t\n\n## Solution\n\n- `a/b.ts:1`\n\n### Plan\n\n- `c:2`\n');
        expect(changedPathsOf(section)).toEqual(['a/b.ts']);
        expect(changedPathsOf(solutionSectionOf('# t\n\n#### Solution\n- `x/y.ts:3-9`\n'))).toEqual(['x/y.ts']);
        // The extractor keeps one entry per cite; the probe dedupes across cites.
        expect(changedPathsOf(solutionSectionOf('### Solution\n- `d/e.ts:7`\n- `d/e.ts:41`\n'))).toEqual([
            'd/e.ts',
            'd/e.ts',
        ]);
        expect(solutionSectionOf('# t\n\nNo solution here.\n')).toBeNull();
        expect(changedPathsOf(solutionSectionOf('### Solution\n\nsee `the docs:12` and `plain`\n'))).toEqual([]);
    });
});
