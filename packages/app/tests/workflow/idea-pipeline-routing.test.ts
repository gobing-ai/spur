/**
 * 0945 + D66 1250: idea-pipeline route-guard legibility and profile-independent routing.
 *
 * 0945 rewrote the route guards to read derived fact files (0945 R2 writer:
 * `<runId>-idea-design-route.txt`, `<runId>-idea-ac-ready.status`) instead of re-deriving
 * design×needs_design and dual status reads inline.
 *
 * 1250 R2 changes the ROUTING CONTRACT, not just the spelling: `feature-check` and `batch-create`
 * are deleted, so the recorded objective results route directly under EVERY profile — the former
 * `test "$profile" = auto` conjuncts and the always fallbacks into those states are gone. The
 * truth table below is therefore executed for BOTH profiles and asserts the target is identical,
 * which is the whole claim of R2: no profile can change an objective route.
 *
 * 1250 R1/R9 (entry check) and R3 (decide rescues) are pinned here by EXECUTING the live YAML
 * commands — the projections are driven against the exact schemaVersion-1 rows the `decide` action
 * writes (that action's own contract lives in `actions/decide.test.ts` / `decide-catalog.test.ts`).
 */

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { countLogicalCommands } from '../../src/workflow/composition-lint';

const WORKFLOWS_DIR = join(import.meta.dir, '../../../../config', 'workflows');
const RUN_ID = 'run-routing';
/** The engine's run-id template as YAML writes it, assembled so the literal does not trip lint. */
const RUN_ID_VAR = '$' + '{vars.__runId}';

interface ActionDef {
    kind: string;
    options?: Record<string, unknown>;
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

function shellActions(stateId: string): ActionDef[] {
    return (DEF.states.find((s) => s.id === stateId)?.onEnter ?? []).filter((a) => a.kind === 'shell');
}

function shellCommand(stateId: string, needle: string): string {
    const action = shellActions(stateId).find((a) => String(a.options?.command ?? '').includes(needle));
    if (action === undefined) throw new Error(`no ${stateId} shell action mentioning ${needle}`);
    return String(action.options?.command ?? '');
}

/**
 * The 0945 R2 writer contract — one deterministic shell action at the end of ac-generate onEnter
 * (1007 R2 deleted the former feature-check duplicate, so ac-generate is the SINGLE writer). Fails
 * safe: missing/corrupt needs-design JSON → `design`; any non-PASS or missing check → `FAIL`.
 */
export const IDEA_ROUTE_WRITER_COMMAND = [
    'mkdir -p .spur/run &&',
    '{ test "$design" = skip -o "$design" = auto -a "$(jq -r .needs_design .spur/run/$__runId-idea-needs-design.json 2>/dev/null)" = false &&',
    "printf 'skip\\n' > .spur/run/$__runId-idea-design-route.txt ||",
    "printf 'design\\n' > .spur/run/$__runId-idea-design-route.txt; } &&",
    '{ test "$(cat .spur/run/$__runId-idea-ac-check.status 2>/dev/null)" = PASS &&',
    "printf 'PASS\\n' > .spur/run/$__runId-idea-ac-ready.status ||",
    "printf 'FAIL\\n' > .spur/run/$__runId-idea-ac-ready.status; }",
].join(' ');

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
const RETRY_VALUES = ['0\n', '2\n', '3\n'];
const PROFILE_VALUES = ['auto', 'standard'];

interface RouteCell {
    design: string;
    needs: string | null;
    ac: string | null;
    retry: string;
    profile: string;
}

/** Write the cell's signal files, run the LIVE writer, and return the cell's workdir. */
function buildCell(root: string, cell: RouteCell, index: number): string {
    const cwd = join(root, `cell-${index}`);
    const runDir = join(cwd, '.spur', 'run');
    mkdirSync(runDir, { recursive: true });
    // Cell dirs are reused across tests in this file (same index space), so a stale signal file
    // from an earlier cell must never satisfy the writer's check-status read.
    for (const name of [
        `${RUN_ID}-idea-needs-design.json`,
        `${RUN_ID}-idea-ac-check.status`,
        `${RUN_ID}-idea-ac-retry-count`,
        `${RUN_ID}-idea-ac-ready.status`,
        `${RUN_ID}-idea-design-route.txt`,
    ]) {
        rmSync(join(runDir, name), { force: true });
    }
    if (cell.needs !== null) writeFileSync(join(runDir, `${RUN_ID}-idea-needs-design.json`), cell.needs, 'utf8');
    if (cell.ac !== null) writeFileSync(join(runDir, `${RUN_ID}-idea-ac-check.status`), cell.ac, 'utf8');
    writeFileSync(join(runDir, `${RUN_ID}-idea-ac-retry-count`), cell.retry, 'utf8');
    const result = spawnSync('/bin/sh', ['-c', IDEA_ROUTE_WRITER_COMMAND], {
        cwd,
        env: { design: cell.design, profile: cell.profile, __runId: RUN_ID },
        encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`writer failed (exit ${result.status}): ${result.stderr}`);
    return cwd;
}

/** The engine's routing decision: the first passing edge in declaration order. */
function firstPassingEdge(cwd: string, from: string, env: Record<string, string>): string | undefined {
    for (const transition of DEF.transitions.filter((t) => t.from === from)) {
        if (transition.guard === undefined) return transition.to;
        if (transition.guard.kind === 'always') return transition.to;
        const command = transition.guard.options?.command ?? 'false';
        if (spawnSync('/bin/sh', ['-c', command], { cwd, env, encoding: 'utf8' }).status === 0) return transition.to;
    }
    return undefined;
}

/** The recorded-check × route × retry contract, independent of profile (1250 R2). */
function expectedAcTarget(cell: RouteCell): string {
    const retry = Number(cell.retry.trim());
    if (cell.ac === 'PASS\n') {
        const skipRoute =
            cell.design === 'skip' || (cell.design === 'auto' && cell.needs === '{"needs_design": false}\n');
        return skipRoute ? 'decompose' : 'system-design';
    }
    return retry < 3 ? 'ac-generate' : 'failed';
}

describe('idea-pipeline 0945 — route fact writer (R2)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'idea-routing-'));

    test('the writer action is declared exactly once, at the end of ac-generate onEnter (1007 R2: single writer)', () => {
        const writers = ['ac-generate', 'feature-check'].filter((stateId) =>
            shellActions(stateId).some((a) => String(a.options?.command ?? '').includes('-idea-design-route.txt')),
        );
        expect(writers).toEqual(['ac-generate']);
        const acShells = shellActions('ac-generate').map((a) => String(a.options?.command ?? ''));
        expect(acShells[acShells.length - 1]).toBe(IDEA_ROUTE_WRITER_COMMAND);
        expect(acShells[acShells.length - 1]).toContain('idea-ac-check.status');
    });

    test('writer truth table: route folds design×needs_design fail-safe to design; readiness mirrors the recorded check', () => {
        const expectRoute = (design: string, needs: { label: string; content: string | null }): string => {
            if (design === 'skip') return 'skip';
            if (design === 'auto' && needs.label === 'false') return 'skip';
            return 'design';
        };
        let index = 0;
        for (const design of DESIGN_VALUES) {
            for (const needs of NEEDS_VALUES) {
                const cell: RouteCell = {
                    design,
                    needs: needs.content,
                    ac: 'PASS\n',
                    retry: '0\n',
                    profile: 'auto',
                };
                const dir = buildCell(cwd, cell, index++);
                expect(readFileSync(join(dir, '.spur', 'run', `${RUN_ID}-idea-design-route.txt`), 'utf8').trim()).toBe(
                    expectRoute(design, needs),
                );
                expect(readFileSync(join(dir, '.spur', 'run', `${RUN_ID}-idea-ac-ready.status`), 'utf8').trim()).toBe(
                    'PASS',
                );
            }
        }
    });

    test('writer readiness is PASS only when the recorded check is PASS (missing folds to FAIL)', () => {
        let index = 0;
        for (const ac of STATUS_VALUES) {
            const cell: RouteCell = {
                design: 'auto',
                needs: '{"needs_design": true}\n',
                ac: ac.content,
                retry: '0\n',
                profile: 'auto',
            };
            const dir = buildCell(cwd, cell, index++);
            const ready = readFileSync(join(dir, '.spur', 'run', `${RUN_ID}-idea-ac-ready.status`), 'utf8').trim();
            expect(ready, `ac=${ac.label}`).toBe(ac.label === 'PASS' ? 'PASS' : 'FAIL');
        }
    });
});

describe('idea-pipeline 1250 R2 — the recorded objective results route under every profile', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'idea-routing-profiles-'));

    test('the deleted objective gate states are gone from the definition', () => {
        const ids = DEF.states.map((s) => s.id);
        expect(ids).not.toContain('feature-check');
        expect(ids).not.toContain('batch-create');
        const targets = new Set(DEF.transitions.map((t) => t.to));
        expect(targets.has('feature-check')).toBe(false);
        expect(targets.has('batch-create')).toBe(false);
        // No answer-normalization shells survive for the deleted gates.
        const allShells = DEF.states
            .flatMap((s) => shellActions(s.id).map((a) => String(a.options?.command ?? '')))
            .join('\n');
        expect(allShells).not.toContain('idea-feature-check-answer.txt');
        expect(allShells).not.toContain('idea-batch-create-answer.txt');
    });

    test('ac-generate routes on the recorded check and derived route under auto AND standard alike', () => {
        let index = 0;
        const targets = new Map<string, string>();
        for (const design of DESIGN_VALUES) {
            for (const needs of NEEDS_VALUES) {
                for (const ac of STATUS_VALUES) {
                    for (const retry of RETRY_VALUES) {
                        const perProfile: string[] = [];
                        for (const profile of PROFILE_VALUES) {
                            const cell: RouteCell = { design, needs: needs.content, ac: ac.content, retry, profile };
                            const dir = buildCell(cwd, cell, index++);
                            const target = firstPassingEdge(dir, 'ac-generate', {
                                design,
                                profile,
                                __runId: RUN_ID,
                            });
                            expect(target, `ac-generate must route for ${JSON.stringify(cell)}`).toBe(
                                expectedAcTarget(cell),
                            );
                            perProfile.push(String(target));
                            targets.set(
                                `${design}|${needs.label}|${ac.label}|${retry.trim()}|${profile}`,
                                String(target),
                            );
                        }
                        // R2's whole claim: the profile cannot change an objective route.
                        expect(perProfile[0], `profile changed the route for design=${design} ac=${ac.label}`).toBe(
                            perProfile[1],
                        );
                    }
                }
            }
        }
        // 2 designs × 4 needs states × 3 check states × 3 retries × 2 profiles
        expect(targets.size).toBe(144);
    });

    test('decompose reaches the batch-create side effect directly under every profile', () => {
        const edges = DEF.transitions.filter((t) => t.from === 'decompose');
        expect(edges.length).toBe(1);
        expect(edges[0]?.to).toBe('batch-create-run');
        expect(edges[0]?.guard?.kind).toBe('always');
        // The former `test "$profile" = auto` predicate must not survive anywhere in the file.
        const raw = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        for (const command of DEF.transitions.map((t) => t.guard?.options?.command ?? '')) {
            if (!command.includes('$profile')) continue;
            // Only the taste gates may consult the profile: their auto-skip edges name the var the
            // operator pre-cleared (idea_approved for idea-eval, design_approved for the design).
            expect(command).toMatch(/idea_approved|design_approved/);
        }
        expect(raw).not.toContain('feature-dev.yaml');
    });

    test('the route guards read the derived facts and stay within the guard command cap', () => {
        for (const to of ['system-design', 'decompose'] as const) {
            const command = guardCommand('ac-generate', to);
            expect(command).toContain('-idea-ac-ready.status');
            expect(command).toContain('-idea-design-route.txt');
            // 1250 R2: the objective route is profile-independent, so no profile read remains.
            expect(command).not.toContain('$profile');
            // ADR-115 guard cap: 3 logical commands, no (warn).
            expect(countLogicalCommands(command), `ac-generate→${to} segment count`).toBeLessThanOrEqual(3);
        }
        for (const to of ['ac-generate', 'failed'] as const) {
            const command = guardCommand('ac-generate', to);
            expect(command).toContain('test "$ac_status" != PASS');
            expect(command).not.toContain('$profile');
        }
        expect(guardCommand('ac-generate', 'ac-generate')).toContain('test "$retry" -lt 3');
        expect(guardCommand('ac-generate', 'failed')).toContain('test "$retry" -ge 3');
    });
});

describe('idea-pipeline 1250 R1/R9 — the typed entry check', () => {
    test('start declares ONE executor-typed check: the executor-aware probe plus the idea-text check on the same status file', () => {
        const start = DEF.states.find((s) => s.id === 'start');
        const probe = (start?.onEnter ?? []).find((a) => a.kind === 'doctor.probe');
        expect(probe?.options).toMatchObject({
            resultFile: `.spur/run/${RUN_ID_VAR}-idea-precheck-doctor.status`,
            role: 'planner',
            resolvedAgentVar: 'planningAgent',
        });
        const text = shellCommand('start', '-idea-input.md');
        expect(text).toContain('printf \'%s\\n\' "$idea" >');
        expect(text).toContain("awk 'NF'");
        expect(text).toContain('FAIL: idea text is empty');
        expect(text).toContain('-idea-precheck-doctor.status');
    });

    test('an empty idea fails the entry check with the named reason, and start→failed reports it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'idea-entry-empty-'));
        const command = shellCommand('start', '-idea-input.md').replaceAll('$__runId', RUN_ID);
        const result = spawnSync('/bin/sh', ['-c', command], {
            cwd: dir,
            env: { idea: '   \n', __runId: RUN_ID },
            encoding: 'utf8',
        });
        expect(result.status).toBe(0);
        const statusPath = join(dir, '.spur', 'run', `${RUN_ID}-idea-precheck-doctor.status`);
        expect(readFileSync(statusPath, 'utf8').trim()).toBe('FAIL: idea text is empty');
        // The start→failed edge reports that first line; it must never be taken while the entry
        // check is PASS.
        const guard = guardCommand('start', 'failed');
        expect(guard).toContain('head -1');
        const reported = spawnSync('/bin/sh', ['-c', guard.replaceAll('$__runId', RUN_ID)], {
            cwd: dir,
            env: { __runId: RUN_ID },
            encoding: 'utf8',
        });
        expect(reported.status).toBe(0);
        expect(reported.stderr).toContain('FAIL: idea text is empty');
        // A non-empty idea writes PASS, and the discovery edge takes it.
        const okDir = mkdtempSync(join(tmpdir(), 'idea-entry-ok-'));
        spawnSync('/bin/sh', ['-c', command], {
            cwd: okDir,
            env: { idea: 'add a --dry-run flag', __runId: RUN_ID },
            encoding: 'utf8',
        });
        writeFileSync(join(okDir, '.spur', 'run', `${RUN_ID}-idea-precheck-doctor.status`), 'PASS\n', 'utf8');
        expect(firstPassingEdge(okDir, 'start', { __runId: RUN_ID })).toBe('discovery');
    });

    test('every agent.run stage dispatches through the selected executor with no per-stage doctor shell', () => {
        // The executor is a run var read by the entry check and by agent.run itself (D65 1232 /
        // 1250 R1); the definition must not grow a per-stage doctor or agent-resolution shell.
        const raw = readFileSync(join(WORKFLOWS_DIR, 'idea-pipeline.yaml'), 'utf8');
        expect(raw).toContain('executor: ""');
        const doctorSites = DEF.states
            .filter((s) => (s.onEnter ?? []).some((a) => a.kind === 'doctor.probe'))
            .map((s) => s.id);
        expect(doctorSites).toEqual(['start']);
        const agentRuns = DEF.states.flatMap((s) => (s.onEnter ?? []).filter((a) => a.kind === 'agent.run'));
        expect(agentRuns.length).toBe(6);
        expect(agentRuns.every((a) => a.options?.agent === '$' + '{vars.planningAgent}')).toBe(true);
    });
});

describe('idea-pipeline 1250 R3 — the decide rescues and their projections', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'idea-decides-'));

    /** The exact schemaVersion-1 row shape the `decide` action writes. */
    const decideRow = (source: 'model' | 'default', value: string): string =>
        `${JSON.stringify(
            {
                schemaVersion: 1,
                id: 'idea-recommendation',
                value,
                method: 'choice',
                backend: source === 'model' ? 'typesafe' : null,
                confidence: source === 'model' ? 0.9 : null,
                confidenceLevel: source === 'model' ? 'HIGH' : 'LOW',
                degraded: source === 'default',
                reason: source === 'model' ? 'accepted' : 'disabled',
                source,
                evidenceDigest: null,
                durationMs: 0,
            },
            null,
            2,
        )}\n`;

    function cell(name: string): string {
        const dir = join(cwd, name);
        mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
        return dir;
    }

    test('discovery declares the two catalog decides with the catalog ids, evidence and resultFile', () => {
        const decides = (DEF.states.find((s) => s.id === 'discovery')?.onEnter ?? []).filter(
            (a) => a.kind === 'decide',
        );
        expect(decides.map((a) => a.options?.decision)).toEqual(['idea-recommendation', 'needs-design']);
        expect(decides.map((a) => a.options?.resultFile)).toEqual([
            `.spur/run/${RUN_ID_VAR}-idea-recommendation.decision`,
            `.spur/run/${RUN_ID_VAR}-idea-needs-design.decision`,
        ]);
        for (const decide of decides) {
            expect(decide.options?.evidence).toEqual([`.spur/run/${RUN_ID_VAR}-idea-eval-report.md`]);
        }
        // The deterministic parses stay FIRST — the rescue-only contract (design §4).
        const kinds = (DEF.states.find((s) => s.id === 'discovery')?.onEnter ?? []).map((a) => a.kind);
        expect(kinds.indexOf('decide')).toBeGreaterThan(kinds.indexOf('agent.run'));
        expect(kinds[kinds.indexOf('decide') - 1]).toBe('shell');
    });

    test('the recommendation projection keeps the pre-1250 fallback: non-model reads unknown, and a parsed value wins', () => {
        // The projection is the shell that READS the decision row (the awk derivation writes the
        // derived file from the report and would match the same path).
        const projection = shellCommand('discovery', '-idea-recommendation.decision').replaceAll('$__runId', RUN_ID);
        const run = (dir: string): string => {
            const result = spawnSync('/bin/sh', ['-c', projection], { cwd: dir, encoding: 'utf8' });
            expect(result.status).toBe(0);
            return readFileSync(join(dir, '.spur', 'run', `${RUN_ID}-idea-recommendation.txt`), 'utf8').trim();
        };
        // Switch off / backend failure / low confidence → source default → stays unknown (pause).
        const fallback = cell('rec-default');
        writeFileSync(join(fallback, '.spur', 'run', `${RUN_ID}-idea-recommendation.txt`), 'unknown\n');
        writeFileSync(
            join(fallback, '.spur', 'run', `${RUN_ID}-idea-recommendation.decision`),
            decideRow('default', 'unknown'),
        );
        expect(run(fallback)).toBe('unknown');
        // A model answer in the closed vocabulary fills the derived file.
        for (const [value, expected] of [
            ['reshape', 'reshape'],
            ['drop', 'drop'],
            ['unknown', 'unknown'],
        ] as const) {
            const dir = cell(`rec-model-${value}`);
            writeFileSync(join(dir, '.spur', 'run', `${RUN_ID}-idea-recommendation.txt`), 'unknown\n');
            writeFileSync(
                join(dir, '.spur', 'run', `${RUN_ID}-idea-recommendation.decision`),
                decideRow('model', value),
            );
            expect(run(dir), `model value ${value}`).toBe(expected);
        }
        // Rescue-only: a deterministic parse is never overridden by the decide row.
        const parsed = cell('rec-parsed');
        writeFileSync(join(parsed, '.spur', 'run', `${RUN_ID}-idea-recommendation.txt`), 'proceed\n');
        writeFileSync(
            join(parsed, '.spur', 'run', `${RUN_ID}-idea-recommendation.decision`),
            decideRow('model', 'drop'),
        );
        expect(run(parsed)).toBe('proceed');
        // A missing decision row cannot promote anything.
        const absent = cell('rec-absent');
        writeFileSync(join(absent, '.spur', 'run', `${RUN_ID}-idea-recommendation.txt`), 'unknown\n');
        expect(run(absent)).toBe('unknown');
    });

    test('the needs-design projection falls back to design unless the model says skip', () => {
        const projection = shellCommand('discovery', '-idea-needs-design.json').replaceAll('$__runId', RUN_ID);
        const run = (dir: string): string => {
            const result = spawnSync('/bin/sh', ['-c', projection], { cwd: dir, encoding: 'utf8' });
            expect(result.status).toBe(0);
            return readFileSync(join(dir, '.spur', 'run', `${RUN_ID}-idea-needs-design.json`), 'utf8').trim();
        };
        const json = (dir: string, content: string | null): string => {
            const path = join(dir, '.spur', 'run', `${RUN_ID}-idea-needs-design.json`);
            if (content === null) rmSync(path, { force: true });
            else writeFileSync(path, content, 'utf8');
            return path;
        };
        const decision = (dir: string, row: string): void =>
            writeFileSync(join(dir, '.spur', 'run', `${RUN_ID}-idea-needs-design.decision`), row, 'utf8');
        // A valid boolean short-circuits: the decide row is never consulted.
        const valid = cell('nd-valid');
        json(valid, '{"needs_design": true}');
        decision(valid, decideRow('model', 'skip'));
        expect(run(valid)).toBe('{"needs_design": true}');
        // Corrupt JSON + a model `skip` → design skipped.
        const skip = cell('nd-skip');
        json(skip, 'not-json');
        decision(skip, decideRow('model', 'skip'));
        expect(run(skip)).toBe('{"needs_design": false}');
        // Corrupt JSON + any non-model source → the `design` fallback (needs_design true).
        for (const [label, row] of [
            ['default', decideRow('default', 'design')],
            ['missing', ''],
        ] as const) {
            const dir = cell(`nd-${label}`);
            json(dir, 'not-json');
            if (row !== '') decision(dir, row);
            expect(run(dir), `needs-design ${label}`).toBe('{"needs_design": true}');
        }
        // Missing JSON behaves like corrupt JSON (fail-safe to design).
        const missing = cell('nd-missing-file');
        json(missing, null);
        decision(missing, decideRow('model', 'design'));
        expect(run(missing)).toBe('{"needs_design": true}');
    });
});
