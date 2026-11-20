/**
 * A94 script downstream-use inventory (task 1409 R1–R5; retargeted from A93).
 *
 * Failure modes first — each one would make the downstream-use inventory lie:
 *   - a tracked script has no entry (silently unmigrated), or two entries claim one file
 *   - an entry claims no downstream use, or migrates through a wave that does not exist
 *   - a retained or forwarder file has no reason naming why a downstream project would not use it
 *   - a moving entry names no target surface, so its destination is unverifiable
 *   - a file reads `done` while it is still tracked (a wave that claimed a move it did not make)
 *   - a caller anchor does not resolve, or a file with no caller hides that fact
 *   - the recorded consent vanished, or a surface is accepted before that consent is granted
 *   - the dispatcher's usage list drifts from its live cases, or a retired name exits silently
 *   - an app/packages service value-imports repository tooling (the boundary ADR-130 draws)
 *   - the architectural direction is deleted from the ADR or its projections (A93 AC1)
 *   - the closed A93 report is edited instead of frozen (A94 keeps it as history)
 *
 * The candidate set is regenerated from git on every run; the report is the artifact under test.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Repo root: repo-wide-tests → repo. */
const REPO_ROOT = join(import.meta.dir, '..');
const REPORT_REL = 'docs/reports/A94-script-ownership.json';
const A93_REPORT_REL = 'docs/reports/A93-script-ownership.json';
const DISPATCHER_REL = 'scripts/spur-dev.ts';
const ADR_REL = 'docs/00_ADR.md';
const GOVERNANCE_REL = 'docs/design/harness-surface-governance.md';

/** A94 downstream-use vocabulary (docs/design/downstream-tooling-absorption.md §2). */
const DOWNSTREAM = ['move', 'generalize', 'forwarder', 'retain'] as const;
const DISPOSITIONS = ['pending', 'done', 'retained'] as const;
/** Frozen A94 execution waves; every moving or forwarder entry must land in exactly one. */
const WAVES = ['1410', '1411', '1412', '1413', '1414', '1415'] as const;
/** Downstream values that move behavior out; only `retain` leaves the file where it is. */
const MOVING = ['move', 'generalize'] as const;

interface Caller {
    path: string;
    line: number;
}

interface Entry {
    path: string;
    responsibility: string;
    tests: string[];
    callers: Caller[];
    downstream: string;
    surface?: string;
    waveWbs?: string;
    downstreamReason?: string;
    disposition?: string;
    noRuntimeCaller?: boolean;
    subject?: string;
}

interface BoundaryEdge {
    importer: string;
    line: number;
    imported: string;
    resolution: string;
    waveWbs: string | null;
}

interface Report {
    schemaVersion: number;
    generatedAt: string;
    sourceCommit: string;
    consentStatus: {
        state: 'granted' | 'pending';
        at: string;
        by: string;
        record: string;
        amendment: string;
    };
    waves: string[];
    entries: Entry[];
    boundaryEdges: BoundaryEdge[];
}

function read(rel: string): string {
    return readFileSync(join(REPO_ROOT, rel), 'utf-8');
}

function tracked(rel: string): boolean {
    try {
        execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: REPO_ROOT, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** Every in-scope script candidate, regenerated from the tree (never a fixed count). */
function trackedCandidates(): string[] {
    const listed = execFileSync('git', ['ls-files', 'scripts'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    return listed
        .split('\n')
        .filter(Boolean)
        .filter((path) => path === 'scripts/install.sh' || path === 'scripts/spur-dev.ts')
        .concat(
            listed
                .split('\n')
                .filter(Boolean)
                .filter((path) => path.startsWith('scripts/commands/') && path.endsWith('.ts')),
        )
        .sort();
}

/** Live dispatcher vocabulary, read from the source rather than restated here. */
function dispatcherSource(): string {
    return read(DISPATCHER_REL);
}

const report = JSON.parse(read(REPORT_REL)) as Report;

describe('A94 script ownership report shape', () => {
    test('declares its schema, generation time and source commit', () => {
        expect(report.schemaVersion).toBe(2);
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
        expect(report.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
        expect(report.waves).toEqual([...WAVES]);
    });

    test('covers exactly the tracked candidate set — no missing, duplicate or stray entry', () => {
        const claimed = report.entries.map((entry) => entry.path);
        const candidates = trackedCandidates();
        const duplicates = claimed.filter((path, index) => claimed.indexOf(path) !== index);
        expect(duplicates).toEqual([]);
        expect(candidates.filter((path) => !claimed.includes(path))).toEqual([]);
        expect(claimed.filter((path) => !candidates.includes(path))).toEqual([]);
    });

    test('every entry classifies one downstream use, its destination and its wave', () => {
        const problems: string[] = [];
        for (const entry of report.entries) {
            const where = entry.path;
            if (!entry.responsibility || entry.responsibility.trim().length < 12) {
                problems.push(`${where}: responsibility missing or vacuous`);
            }
            if (!(DOWNSTREAM as readonly string[]).includes(entry.downstream)) {
                problems.push(`${where}: unknown downstream value ${entry.downstream}`);
            }
            if (!entry.disposition || !(DISPOSITIONS as readonly string[]).includes(entry.disposition)) {
                problems.push(`${where}: unknown disposition ${entry.disposition}`);
            }
            if (entry.downstream === 'retain') {
                if (entry.waveWbs) problems.push(`${where}: retain must not name a wave`);
                if (entry.disposition !== 'retained') problems.push(`${where}: retain must read as retained`);
            } else if ((MOVING as readonly string[]).includes(entry.downstream)) {
                if (!entry.surface) problems.push(`${where}: ${entry.downstream} without a target surface`);
                if (!entry.waveWbs || !(WAVES as readonly string[]).includes(entry.waveWbs)) {
                    problems.push(`${where}: ${entry.downstream} must name an A94 wave, got ${entry.waveWbs}`);
                }
                if (entry.disposition === 'retained') problems.push(`${where}: moving entry still reads as retained`);
            }
            if (entry.downstream === 'forwarder') {
                if (!entry.surface) problems.push(`${where}: forwarder without the surface it forwards to`);
                if (!entry.waveWbs || !(WAVES as readonly string[]).includes(entry.waveWbs)) {
                    problems.push(`${where}: forwarder must name the wave that deletes it`);
                }
            }
            if ((entry.downstream === 'retain' || entry.downstream === 'forwarder') && !entry.downstreamReason) {
                problems.push(`${where}: ${entry.downstream} without a downstream reason`);
            }
            if (entry.downstreamReason && entry.downstreamReason.trim().length < 12) {
                problems.push(`${where}: downstream reason too thin to review`);
            }
        }
        expect(problems).toEqual([]);
    });

    test('a moving entry reads done only once its file is gone', () => {
        const problems: string[] = [];
        for (const entry of report.entries) {
            if (entry.disposition === 'done' && tracked(entry.path)) {
                problems.push(`${entry.path}: claims done while still tracked`);
            }
        }
        expect(problems).toEqual([]);
    });

    test('every listed test and caller anchor is real', () => {
        const problems: string[] = [];
        for (const entry of report.entries) {
            for (const test of entry.tests) {
                if (!tracked(test)) problems.push(`${entry.path}: test ${test} is not tracked`);
            }
            for (const caller of entry.callers) {
                const absolute = join(REPO_ROOT, caller.path);
                if (!existsSync(absolute)) {
                    problems.push(`${entry.path}: caller ${caller.path} does not exist`);
                    continue;
                }
                const lines = readFileSync(absolute, 'utf-8').split('\n').length;
                if (caller.line < 1 || caller.line > lines) {
                    problems.push(`${entry.path}: caller ${caller.path}:${caller.line} is outside the file`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    test('a file with no runtime caller says so, and names its subject or owner', () => {
        const problems: string[] = [];
        for (const entry of report.entries) {
            if (entry.callers.length > 0) continue;
            if (entry.noRuntimeCaller !== true) {
                problems.push(`${entry.path}: no callers and no noRuntimeCaller finding`);
            }
            if (!entry.subject) {
                problems.push(`${entry.path}: no callers and no subject/fixture owner named`);
            } else if (!existsSync(join(REPO_ROOT, entry.subject))) {
                problems.push(`${entry.path}: subject ${entry.subject} does not exist`);
            }
        }
        expect(problems).toEqual([]);
    });
});

/** Value imports (not `import type`) from an app/packages service into repository tooling. */
// shortcut: static import syntax only (`import … from`, not `await import()`/`require`), upgrade when a
// service starts loading repository tooling dynamically.
function appToScriptImports(): Caller[] {
    const hits: Caller[] = [];
    const roots = readdirSync(join(REPO_ROOT, 'apps')).map((app) => join('apps', app, 'src'));
    const packages = readdirSync(join(REPO_ROOT, 'packages')).map((pkg) => join('packages', pkg, 'src'));
    const walk = (rel: string): void => {
        const absolute = join(REPO_ROOT, rel);
        if (!existsSync(absolute)) return;
        for (const name of readdirSync(absolute)) {
            const child = join(rel, name);
            if (statSync(join(REPO_ROOT, child)).isDirectory()) {
                if (name === 'node_modules') continue;
                walk(child);
                continue;
            }
            if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
            const lines = readFileSync(join(REPO_ROOT, child), 'utf-8').split('\n');
            for (const [index, line] of lines.entries()) {
                const match = /^\s*import\s+(?!type\b)[^;]*?from\s+['"]([^'"]*\/scripts\/[^'"]*)['"]/.exec(line);
                if (match) hits.push({ path: child, line: index + 1 });
            }
        }
    };
    for (const root of [...roots, ...packages]) walk(relative('.', root));
    return hits;
}

describe('app/packages services never value-import repository tooling', () => {
    test('every existing app→script import is a recorded boundary edge', () => {
        const hits = appToScriptImports();
        const recorded = report.boundaryEdges.map((edge) => `${edge.importer}:${edge.line}`);
        const untracked = hits.filter((hit) => !recorded.includes(`${hit.path}:${hit.line}`));
        expect(untracked).toEqual([]);
    });

    test('a recorded edge names a resolution and a wave that closes it', () => {
        const problems: string[] = [];
        for (const edge of report.boundaryEdges) {
            if (!existsSync(join(REPO_ROOT, edge.importer))) problems.push(`${edge.importer}: missing importer`);
            if (!edge.imported.startsWith('scripts/')) problems.push(`${edge.importer}: imported path unrecorded`);
            if (!edge.resolution) problems.push(`${edge.importer}: no resolution`);
            if (!edge.waveWbs || !(WAVES as readonly string[]).includes(edge.waveWbs)) {
                problems.push(`${edge.importer}: edge must be closed by an A94 wave`);
            }
        }
        expect(problems).toEqual([]);
    });

    test('the app-to-script boundary ledger is empty at the A94 start', () => {
        expect(report.boundaryEdges).toEqual([]);
    });
});

describe('consent is recorded before any surface is accepted (R5)', () => {
    test('the report records the exact grant, its record and the surface-shape amendment', () => {
        expect(report.consentStatus).toEqual({
            state: 'granted',
            at: '2026-11-19',
            by: 'Robin',
            record: 'docs/design/downstream-tooling-absorption.md §5',
            amendment: '2026-11-20 surface-shape',
        });
    });

    test('no entry names a surface while the consent is not granted', () => {
        if (report.consentStatus.state === 'granted') return;
        expect(report.entries.filter((entry) => entry.surface).map((entry) => entry.path)).toEqual([]);
    });
});

/** Live names the dispatcher answers: its `case '<name>':` labels plus every DELEGATED key. */
function liveDispatcherNames(source: string): string[] {
    const cases = [...source.matchAll(/case '([a-z0-9-]+)':/g)].map((match) => match[1]);
    const delegatedBlock = /const DELEGATED: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
    const delegated = [...delegatedBlock.matchAll(/'([a-z0-9-]+)':/g)].map((match) => match[1]);
    return [...new Set([...cases, ...delegated])].sort();
}

/** RETIRED map entries: retired name → replacement command. */
function retiredNames(source: string): Array<{ name: string; replacement: string }> {
    const block = /export const RETIRED: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
    return [...block.matchAll(/'([a-z0-9-]+)':\s*'([^']+)'/g)].map((match) => ({
        name: match[1],
        replacement: match[2],
    }));
}

describe('dispatcher usage and retired names (R3, R4)', () => {
    const source = dispatcherSource();
    const runDispatcher = (args: string[] = []) =>
        spawnSync(process.execPath, [DISPATCHER_REL, ...args], { cwd: REPO_ROOT, encoding: 'utf-8' });

    test('the no-argument usage list names every live case and DELEGATED key', () => {
        const live = liveDispatcherNames(source);
        expect(live.length).toBeGreaterThan(0);
        const run = runDispatcher();
        expect(run.status).toBe(0);
        const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
        expect(live.filter((name) => !output.includes(name))).toEqual([]);
    });

    test('RETIRED never shadows a live name and its replacement is a spur command', () => {
        const live = new Set(liveDispatcherNames(source));
        const problems: string[] = [];
        for (const entry of retiredNames(source)) {
            if (live.has(entry.name)) problems.push(`${entry.name}: retired name is still dispatched`);
            if (!/^spur [a-z]/.test(entry.replacement)) {
                problems.push(`${entry.name}: replacement is not a spur command (${entry.replacement})`);
            }
        }
        expect(problems).toEqual([]);
    });

    test('a retired name exits 2 naming its replacement', () => {
        for (const entry of retiredNames(source)) {
            const run = runDispatcher([entry.name]);
            expect(run.status).toBe(2);
            expect(run.stderr ?? '').toContain(`spur-dev: '${entry.name}' moved to '${entry.replacement}'`);
        }
    });

    test('an unknown name still exits 1', () => {
        expect(runDispatcher(['definitely-not-a-command']).status).toBe(1);
    });
});

describe('architectural direction and its projections stay recorded (A93 AC1)', () => {
    test('the closed A93 report stays frozen as history', () => {
        const a93 = JSON.parse(read(A93_REPORT_REL)) as { schemaVersion: number };
        expect(a93.schemaVersion).toBe(1);
    });

    test('ADR-130 keeps its dated amendment beside the historical decision', () => {
        const adr = read(ADR_REL);
        expect(adr).toContain('Amendment (2026-11-16) — shipped ownership before repository tooling');
        expect(adr).toContain('Historical reading (2026-10-16');
    });

    test('the governance table and the entry doc carry the same ownership split', () => {
        expect(read(GOVERNANCE_REL)).toContain('ADR-130 (amended 2026-11-16)');
        expect(read('AGENTS.md')).toContain('ADR-130');
    });
});
