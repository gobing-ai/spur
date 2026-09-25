/**
 * 0945: idea-pipeline route-guard legibility — routing truth-table parity.
 *
 * The four route guards (ac-generate/feature-check → system-design|decompose) were rewritten to
 * read derived fact files (0945 R2 writer: `<runId>-idea-design-route.txt`, `<runId>-idea-ac-ready.status`)
 * instead of re-deriving design×needs_design and dual status reads inline. Routing parity is the
 * whole risk, so the PRE-refactor guard commands are frozen below as the oracle and EXECUTED
 * against the live guards over the full cross product `profile|__hitlAnswer × design ×
 * needs_design × ac × coverage` — the regression proof that legibility changed nothing (closed
 * Q&A: the truth-table test is written before the rewrite and stays green through it).
 *
 * Parity per edge over all states + unchanged declaration order proves identical routing: the
 * engine takes the first passing edge, so equal guard booleans in equal order route identically.
 *
 * Dimension domains:
 * - `design` is enumerated over its declared contract values `auto|skip` (idea-pipeline.yaml var
 *   header: no force path). Values outside the contract are outside the truth table.
 * - `needs_design` covers present-true, present-false, missing file, and corrupt JSON — the
 *   fail-safe direction (missing/corrupt → design route) is exercised, never assumed.
 * - `__hitlAnswer` is inert for the ac-generate guards and `profile` is inert for the
 *   feature-check guards (neither old nor new command references them), so each family fixes the
 *   inert var at one value and enumerates the dimensions the guards can distinguish.
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { countLogicalCommands } from '../../src/services/workflow-service';

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const RUN_ID = 'run-routing';
const stateDirs = new Map<string, string>();

interface ActionDef {
    kind: string;
    options?: { command?: string };
}
interface TransitionDef {
    from: string;
    to: string;
    guard?: { kind?: string; options?: { command?: string } };
}
interface IdeaPipelineDef {
    states: { id: string; onEnter?: ActionDef[] }[];
    transitions: TransitionDef[];
}

const DEF = parseYaml(readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8')) as IdeaPipelineDef;

function guardCommand(from: string, to: string): string {
    const guard = DEF.transitions.find((t) => t.from === from && t.to === to)?.guard;
    if (guard?.kind !== 'shell') throw new Error(`no shell guard on ${from}→${to}`);
    return guard.options?.command ?? '';
}

/**
 * The 0945 R2 writer contract — one deterministic shell action, duplicated verbatim at the end
 * of BOTH ac-generate and feature-check onEnter (YAML has no include; byte-equality is
 * test-pinned). Fails safe: missing/corrupt needs-design JSON → `design`; any non-PASS or
 * missing check status → `FAIL`.
 */
export const IDEA_ROUTE_WRITER_COMMAND = [
    'mkdir -p .spur/run &&',
    '{ test "$design" = skip -o "$design" = auto -a "$(jq -r .needs_design .spur/run/$__runId-idea-needs-design.json 2>/dev/null)" = false &&',
    "printf 'skip\\n' > .spur/run/$__runId-idea-design-route.txt ||",
    "printf 'design\\n' > .spur/run/$__runId-idea-design-route.txt; } &&",
    '{ test "$(cat .spur/run/$__runId-idea-ac-check.status 2>/dev/null)" = PASS -a "$(cat .spur/run/$__runId-idea-coverage.status 2>/dev/null)" = PASS &&',
    "printf 'PASS\\n' > .spur/run/$__runId-idea-ac-ready.status ||",
    "printf 'FAIL\\n' > .spur/run/$__runId-idea-ac-ready.status; }",
].join(' ');

/** The pre-0945 guard commands (frozen oracle — the routing contract the rewrite must preserve). */
const ORACLE_GUARDS: Record<string, string> = {
    'ac-generate→system-design': [
        'ac_status="$(cat .spur/run/$__runId-idea-ac-check.status 2>/dev/null)" cov_status="$(cat .spur/run/$__runId-idea-coverage.status 2>/dev/null)";',
        'test "$profile" = auto -a "$ac_status" = PASS && test "$cov_status" = PASS && test "$design" = auto -a "$(jq -r .needs_design .spur/run/$__runId-idea-needs-design.json 2>/dev/null)" != false',
    ].join(' '),
    'ac-generate→decompose':
        'test "$profile" = auto && test "$(cat .spur/run/$__runId-idea-ac-check.status 2>/dev/null)" = PASS && test "$(cat .spur/run/$__runId-idea-coverage.status 2>/dev/null)" = PASS && test "$design" = skip -o "$design" = auto -a "$(jq -r .needs_design .spur/run/$__runId-idea-needs-design.json 2>/dev/null)" = false',
    'feature-check→system-design': [
        'ac_status="$(cat .spur/run/$__runId-idea-ac-check.status 2>/dev/null)";',
        'test "$__hitlAnswer" = yes && test "$ac_status" = PASS && test "$design" = auto && test "$(jq -r .needs_design .spur/run/$__runId-idea-needs-design.json 2>/dev/null)" != false',
    ].join(' '),
    'feature-check→decompose':
        'test "$__hitlAnswer" = yes && test "$(cat .spur/run/$__runId-idea-ac-check.status 2>/dev/null)" = PASS && (test "$design" = skip || (test "$design" = auto && test "$(jq -r .needs_design .spur/run/$__runId-idea-needs-design.json 2>/dev/null)" = false))',
};

const DESIGN_VALUES = ['auto', 'skip'];
const NEEDS_VALUES: Array<{ label: string; content: string | null }> = [
    { label: 'true', content: '{"needs_design": true}\n' },
    { label: 'false', content: '{"needs_design": false}\n' },
    { label: 'missing', content: null },
    { label: 'corrupt', content: 'not-json\n' },
];
const STATUS_VALUES: Array<{ label: string; content: string | null }> = [
    { label: 'PASS', content: 'PASS\n' },
    { label: 'FAIL', content: 'FAIL\n' },
    { label: 'missing', content: null },
];

interface RouteState {
    vars: Record<string, string>;
    needs: string | null;
    ac: string | null;
    cov: string | null;
}

function describeState(state: RouteState): string {
    return JSON.stringify({
        ...state.vars,
        needs_design: state.needs === null ? 'missing' : state.needs.trim(),
        ac: state.ac === null ? 'missing' : state.ac.trim(),
        coverage: state.cov === null ? 'missing' : state.cov.trim(),
    });
}

/**
 * Build (once per unique file state) a directory with the cell's signal files and the writer-
 * derived fact files, then evaluate oracle and live guard there in separate subshells — the
 * engine's routing decision. The writer is the live onEnter copy when present, the frozen
 * contract otherwise.
 */
function evaluatePair(
    oldCommand: string,
    newCommand: string,
    writer: string,
    state: RouteState,
    root: string,
): {
    oldPassed: boolean;
    newPassed: boolean;
    cellDir: string;
} {
    const key = [
        state.vars.design ?? '',
        state.needs === null ? 'missing' : state.needs.trim(),
        state.ac === null ? 'missing' : state.ac.trim(),
        state.cov === null ? 'missing' : state.cov.trim(),
    ].join('|');
    let cwd = stateDirs.get(`${root}|${key}`);
    if (!cwd) {
        cwd = join(root, key.replace(/[^\w.-]+/g, '_'));
        const runDir = join(cwd, '.spur', 'run');
        mkdirSync(runDir, { recursive: true });
        if (state.needs !== null) writeFileSync(join(runDir, `${RUN_ID}-idea-needs-design.json`), state.needs, 'utf8');
        if (state.ac !== null) writeFileSync(join(runDir, `${RUN_ID}-idea-ac-check.status`), state.ac, 'utf8');
        if (state.cov !== null) writeFileSync(join(runDir, `${RUN_ID}-idea-coverage.status`), state.cov, 'utf8');
        const result = spawnSync('/bin/sh', ['-c', `( ${writer} )`], {
            cwd,
            env: { ...state.vars, __runId: RUN_ID },
            encoding: 'utf8',
        });
        if (result.status !== 0) throw new Error(`writer failed (exit ${result.status}): ${result.stderr}`);
        stateDirs.set(`${root}|${key}`, cwd);
    }
    const env: Record<string, string> = { ...state.vars, __runId: RUN_ID };
    const script = `( ${oldCommand} ) && __old_passed=0 || __old_passed=1; ( ${newCommand} ) && __new_passed=0 || __new_passed=1; printf '%s %s' "$__old_passed" "$__new_passed"`;
    const result = spawnSync('/bin/sh', ['-c', script], { cwd, env, encoding: 'utf8' });
    const match = /^(\d+) (\d+)$/.exec(result.stdout.trim());
    if (!match) throw new Error(`routing harness could not parse its own output: ${result.stdout}`);
    return { oldPassed: match[1] === '0', newPassed: match[2] === '0', cellDir: cwd };
}

function shellActions(stateId: string): ActionDef[] {
    return (DEF.states.find((s) => s.id === stateId)?.onEnter ?? []).filter((a) => a.kind === 'shell');
}

describe('idea-pipeline 0945 — route fact writer (R2)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'idea-routing-'));

    test('the writer action is declared once at the end of BOTH ac-generate and feature-check onEnter, byte-equal', () => {
        for (const stateId of ['ac-generate', 'feature-check']) {
            const writer = shellActions(stateId).find((a) =>
                (a.options?.command ?? '').includes('-idea-design-route.txt'),
            );
            expect(writer, `writer action missing from ${stateId} onEnter`).toBeDefined();
            expect(writer?.options?.command).toBe(IDEA_ROUTE_WRITER_COMMAND);
        }
        const acShells = shellActions('ac-generate').map((a) => a.options?.command ?? '');
        // End of list: the writer runs AFTER the recorded checks it derives from.
        expect(acShells[acShells.length - 1]).toBe(IDEA_ROUTE_WRITER_COMMAND);
        expect(acShells[acShells.length - 1]).toContain('idea-coverage.status');
    });

    test('writer truth table: route folds design×needs_design fail-safe to design; readiness is PASS only when both checks PASS', () => {
        const expectRoute = (design: string, needs: { label: string; content: string | null }): string => {
            if (design === 'skip') return 'skip';
            if (design === 'auto' && needs.label === 'false') return 'skip';
            return 'design';
        };
        for (const design of DESIGN_VALUES) {
            for (const needs of NEEDS_VALUES) {
                const ac = { label: 'PASS', content: 'PASS\n' };
                const cov = { label: 'FAIL', content: 'FAIL\n' };
                const state: RouteState = {
                    vars: { design, profile: 'auto', __hitlAnswer: 'yes' },
                    needs: needs.content,
                    ac: ac.content,
                    cov: cov.content,
                };
                const { oldPassed, newPassed, cellDir } = evaluatePair(
                    'exit 0',
                    'exit 0',
                    IDEA_ROUTE_WRITER_COMMAND,
                    state,
                    cwd,
                );
                expect(oldPassed).toBe(true);
                expect(newPassed).toBe(true);
                const route = readFileSync(
                    join(cellDir, '.spur', 'run', `${RUN_ID}-idea-design-route.txt`),
                    'utf8',
                ).trim();
                expect(route, `route for design=${design} needs=${needs.label}`).toBe(expectRoute(design, needs));
                // Non-PASS coverage with PASS ac must fold to FAIL, never PASS.
                const ready = readFileSync(
                    join(cellDir, '.spur', 'run', `${RUN_ID}-idea-ac-ready.status`),
                    'utf8',
                ).trim();
                expect(ready).toBe('FAIL');
            }
        }
    });

    test('writer readiness is PASS only when both recorded checks are PASS (missing folds to FAIL)', () => {
        for (const ac of STATUS_VALUES) {
            for (const cov of STATUS_VALUES) {
                const state: RouteState = {
                    vars: { design: 'auto', profile: 'auto', __hitlAnswer: 'yes' },
                    needs: '{"needs_design": true}\n',
                    ac: ac.content,
                    cov: cov.content,
                };
                const { cellDir } = evaluatePair('exit 0', 'exit 0', IDEA_ROUTE_WRITER_COMMAND, state, cwd);
                const ready = readFileSync(
                    join(cellDir, '.spur', 'run', `${RUN_ID}-idea-ac-ready.status`),
                    'utf8',
                ).trim();
                expect(ready, `ac=${ac.label} cov=${cov.label}`).toBe(
                    ac.label === 'PASS' && cov.label === 'PASS' ? 'PASS' : 'FAIL',
                );
            }
        }
    });
});

describe('idea-pipeline 0945 — routing truth-table parity (R3)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'idea-routing-parity-'));
    const liveWriter =
        shellActions('ac-generate').find((a) => (a.options?.command ?? '').includes('-idea-design-route.txt'))?.options
            ?.command ?? IDEA_ROUTE_WRITER_COMMAND;

    test('live route guards match the frozen pre-refactor oracle over the full cross product', () => {
        const cases: Array<{
            edge: string;
            from: string;
            to: string;
            inertVar: 'profile' | '__hitlAnswer';
            fixed: string;
        }> = [
            ...['system-design', 'decompose'].map((to) => ({
                edge: `ac-generate→${to}`,
                from: 'ac-generate',
                to,
                inertVar: '__hitlAnswer' as const,
                fixed: 'yes',
            })),
            ...['system-design', 'decompose'].map((to) => ({
                edge: `feature-check→${to}`,
                from: 'feature-check',
                to,
                inertVar: 'profile' as const,
                fixed: 'auto',
            })),
        ];
        let cells = 0;
        for (const profile of ['auto', 'standard', '']) {
            for (const hitlAnswer of ['yes', 'no', 'cancel', '']) {
                for (const design of DESIGN_VALUES) {
                    for (const needs of NEEDS_VALUES) {
                        for (const ac of STATUS_VALUES) {
                            for (const cov of STATUS_VALUES) {
                                const state: RouteState = {
                                    vars: { profile, __hitlAnswer: hitlAnswer, design },
                                    needs: needs.content,
                                    ac: ac.content,
                                    cov: cov.content,
                                };
                                for (const c of cases) {
                                    // The inert var for this guard family is pinned to its fixed value;
                                    // the enumerated value would be invisible to both guards alike.
                                    const cell: RouteState = {
                                        ...state,
                                        vars: { ...state.vars, [c.inertVar]: c.fixed },
                                    };
                                    const oracle = ORACLE_GUARDS[c.edge];
                                    if (oracle === undefined) throw new Error(`no oracle guard for edge ${c.edge}`);
                                    const live = guardCommand(c.from, c.to);
                                    const { oldPassed, newPassed } = evaluatePair(oracle, live, liveWriter, cell, cwd);
                                    expect(
                                        newPassed === oldPassed,
                                        `${c.edge} routing diverged (oracle=${oldPassed}, live=${newPassed}) for ${describeState(cell)}`,
                                    ).toBe(true);
                                    cells++;
                                }
                            }
                        }
                    }
                }
            }
        }
        expect(cells).toBe(3456);
    }, 60000);

    test('the rewritten guards read the derived files, keep the one-var contract, and stay at 3 logical commands', () => {
        for (const [from, to, varName] of [
            ['ac-generate', 'system-design', 'profile'],
            ['ac-generate', 'decompose', 'profile'],
            ['feature-check', 'system-design', '__hitlAnswer'],
            ['feature-check', 'decompose', '__hitlAnswer'],
        ] as const) {
            const command = guardCommand(from, to);
            expect(command, `${from}→${to} must read the derived route file`).toContain('-idea-design-route.txt');
            // Anti-pattern (0945): no guard reads the needs_design JSON after the rewrite.
            expect(command, `${from}→${to} must not read needs-design JSON`).not.toContain('idea-needs-design.json');
            // ADR-115 guard cap: 3 logical commands, no (warn).
            expect(countLogicalCommands(command), `${from}→${to} segment count`).toBeLessThanOrEqual(3);
            if (from === 'ac-generate') {
                expect(command, 'ac-generate route guards read the derived readiness file').toContain(
                    '-idea-ac-ready.status',
                );
                expect(command).toContain(`test "$${varName}"`);
            } else {
                // One-letter 0945 deviation (driver decision 2026-09-25, parity-first): the
                // interactive feature-check gate keeps reading the recorded ac-check status
                // directly — the operator's answer governs coverage there (0887), and the
                // derived ready file folds coverage in, which would change routing.
                expect(command).toContain('-idea-ac-check.status');
                expect(command).not.toContain('-idea-ac-ready.status');
                expect(command).toContain(`test "$${varName}"`);
            }
        }
    });
});
