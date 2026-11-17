/**
 * A93 script ownership inventory (task 1351 R1/R4).
 *
 * Failure modes first — each one would make the migration inventory lie:
 *   - a tracked script has no entry (silently unmigrated), or two entries claim one file
 *   - an entry names no destination/action, or migrates a file through a wave that does not exist
 *   - a retained file has no responsibility-based reason (the ADR-130 exemption A93 removes)
 *   - a caller anchor does not resolve, or a file with no caller hides that fact
 *   - an app/packages service value-imports repository tooling (the boundary ADR-130 draws)
 *   - the architectural direction is deleted from the ADR or its projections (AC1)
 *   - the proposed public contracts or the deferred consent owner vanish from the design (R3)
 *
 * The candidate set is regenerated from git on every run; the report is the artifact under test.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Repo root: repo-wide-tests → repo. */
const REPO_ROOT = join(import.meta.dir, '..');
const REPORT_REL = 'docs/reports/A93-script-ownership.json';
const DESIGN_REL = 'docs/design/concrete-spur-self.md';
const ADR_REL = 'docs/00_ADR.md';
const GOVERNANCE_REL = 'docs/design/harness-surface-governance.md';

const DESTINATIONS = ['builder', 'self', 'app-workflow', 'scripts'] as const;
const ACTIONS = ['absorb', 'extract', 'retain', 'slim', 'shrink'] as const;
/** Frozen A93 execution waves; every migrating action must land in exactly one. */
const WAVES = ['1352', '1353', '1354', '1355', '1356'] as const;
/** Actions that move behavior out; only `retain` leaves the file where it is. */
const MOVING_ACTIONS = ['absorb', 'extract', 'slim', 'shrink'] as const;

interface Caller {
    path: string;
    line: number;
}

interface Entry {
    path: string;
    responsibility: string;
    destination: string;
    action: string;
    waveWbs: string | null;
    tests: string[];
    callers: Caller[];
    retainedReason?: string;
    noRuntimeCaller?: boolean;
    subject?: string;
    /** What actually happened after the owning wave ran (1356 final audit). */
    disposition?: 'moved-forwarder' | 'retained' | 'retained-slimmed' | 'pending';
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
    deferredConsent: { owner: string; scope: string[]; blocksPublicImplementation: boolean };
    consentStatus: { state: 'granted' | 'pending'; at: string; by: string; record: string };
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

const report = JSON.parse(read(REPORT_REL)) as Report;

describe('A93 script ownership report shape', () => {
    test('declares its schema, generation time and source commit', () => {
        expect(report.schemaVersion).toBe(1);
        expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
        expect(report.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    });

    test('covers exactly the tracked candidate set — no missing, duplicate or stray entry', () => {
        const claimed = report.entries.map((entry) => entry.path);
        const candidates = trackedCandidates();
        const duplicates = claimed.filter((path, index) => claimed.indexOf(path) !== index);
        expect(duplicates).toEqual([]);
        expect(candidates.filter((path) => !claimed.includes(path))).toEqual([]);
        expect(claimed.filter((path) => !candidates.includes(path))).toEqual([]);
    });

    test('every entry classifies one owner, one action and a consistent wave', () => {
        const problems: string[] = [];
        for (const entry of report.entries) {
            const where = entry.path;
            if (!entry.responsibility || entry.responsibility.trim().length < 12) {
                problems.push(`${where}: responsibility missing or vacuous`);
            }
            if (!(DESTINATIONS as readonly string[]).includes(entry.destination)) {
                problems.push(`${where}: unknown destination ${entry.destination}`);
            }
            if (!(ACTIONS as readonly string[]).includes(entry.action)) {
                problems.push(`${where}: unknown action ${entry.action}`);
            }
            if (entry.action === 'retain') {
                if (entry.waveWbs !== null) problems.push(`${where}: retain must not name a wave`);
                if (!entry.retainedReason) problems.push(`${where}: retain without a reason`);
                if (entry.destination !== 'scripts') problems.push(`${where}: retain outside scripts/`);
            } else if ((MOVING_ACTIONS as readonly string[]).includes(entry.action)) {
                if (!entry.waveWbs || !(WAVES as readonly string[]).includes(entry.waveWbs)) {
                    problems.push(`${where}: ${entry.action} must name an A93 wave, got ${entry.waveWbs}`);
                }
                if (entry.destination === 'scripts' && !entry.retainedReason) {
                    problems.push(`${where}: ${entry.action} keeps the file in scripts/ without a reason`);
                }
            }
            if (entry.destination === 'scripts' && !entry.retainedReason) {
                problems.push(`${where}: destination scripts/ without a responsibility-based reason`);
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
    test('every existing app→script import is a recorded, wave-owned edge', () => {
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
                problems.push(`${edge.importer}: edge must be closed by an A93 wave`);
            }
        }
        expect(problems).toEqual([]);
    });
});

describe('final audit dispositions (1356 R3)', () => {
    test('every entry carries a disposition consistent with its destination', () => {
        const problems: string[] = [];
        for (const entry of report.entries) {
            if (!entry.disposition) {
                problems.push(`${entry.path}: no disposition`);
                continue;
            }
            if (entry.destination === 'scripts' && entry.disposition === 'moved-forwarder') {
                problems.push(`${entry.path}: scripts/ entry claims a forwarder without a new owner`);
            }
            if (entry.destination !== 'scripts' && entry.disposition === 'retained') {
                problems.push(`${entry.path}: migrating entry still reads as retained`);
            }
        }
        expect(problems).toEqual([]);
    });

    test('the app-to-script boundary ledger is empty at the final audit', () => {
        // A93 closed the one recorded edge (release-ops → bundle-plugins) by driving the generator.
        expect(report.boundaryEdges).toEqual([]);
    });
});

describe('architectural direction and its projections stay recorded (AC1)', () => {
    test('ADR-130 keeps its dated amendment beside the historical decision', () => {
        const adr = read(ADR_REL);
        expect(adr).toContain('Amendment (2026-11-16) — shipped ownership before repository tooling');
        expect(adr).toContain('Historical reading (2026-10-16');
    });

    test('the governance table and the entry doc carry the same ownership split', () => {
        expect(read(GOVERNANCE_REL)).toContain('ADR-130 (amended 2026-11-16)');
        const agents = read('AGENTS.md');
        expect(agents).toContain('ADR-130');
    });
});

describe('proposed public contracts and deferred consent stay explicit (R3)', () => {
    const design = read(DESIGN_REL);
    const proposedBuilderVerbs = [
        'builder build-cli',
        'builder build-server',
        'builder build-binaries',
        'builder bundle-config',
        'builder bundle-web',
        'builder verify-pack',
    ];

    test('the six builder surfaces and self install remain the exact proposed scope', () => {
        for (const verb of proposedBuilderVerbs) expect(design).toContain(verb);
        expect(design).toContain('spur self install');
    });

    test('the consent owner and the deferral are named, not inferred', () => {
        expect(design).toContain('Robin');
        expect(design).toContain('consent');
    });

    test('the report records the consent owner, its exact scope and the recorded grant', () => {
        expect(report.deferredConsent.owner).toBe('Robin');
        // `blocksPublicImplementation` records the state the 1351 audit was generated in; the
        // consentStatus block records the grant that followed it.
        expect(report.consentStatus.state).toBe('granted');
        expect(report.consentStatus.at).toBe('2026-11-16');
        expect(report.consentStatus.by).toBe('Robin');
        for (const verb of proposedBuilderVerbs) {
            expect(report.deferredConsent.scope).toContain(verb.replace('builder ', ''));
        }
        expect(report.deferredConsent.scope).toContain('self install');
        expect(report.deferredConsent.scope).toContain('self status');
    });
});
