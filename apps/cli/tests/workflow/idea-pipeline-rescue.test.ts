import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * 1097 R2–R4 + 1250 R3 E2E — the discovery onEnter shells of the tracked idea-pipeline
 * workflow YAML are driven for real: the exact shell commands run via `sh -c` in a
 * temp project with the source CLI as $spurBin and the offline built-in `typesafe`
 * maker, then the derived files are asserted. Rescue-only contract: the awk derivation
 * runs FIRST and a parse that succeeds is never overridden (R4); an unclassifiable
 * report stays `unknown` and a corrupt needs_design JSON stays `{"needs_design": true}`.
 *
 * 1250 R3 moved the rescue itself from `spur decision run` shells to `kind: decide`
 * actions, so the shell layer no longer records the decision lifecycle. This file keeps
 * the real-shell coverage of the derivation→projection chain over the tracked YAML and
 * asserts the rescue is typed; the action's row/event contract is owned by
 * packages/app/tests/workflow/actions/decide*.test.ts and decision-gate-persistence.test.ts,
 * and the projection matrix by packages/app/tests/workflow/idea-pipeline-routing.test.ts.
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const WORKFLOW = join(REPO_ROOT, 'config', 'workflows', 'idea-pipeline.yaml');
const CLI_ENTRY = join(import.meta.dir, '..', '..', 'src', 'index.ts');

interface ActionDef {
    kind: string;
    options?: Record<string, unknown>;
}
interface WorkflowDef {
    states: { id: string; onEnter?: ActionDef[] }[];
}

const def = parseYaml(readFileSync(WORKFLOW, 'utf8')) as WorkflowDef;
const discoveryOnEnter = def.states.find((s) => s.id === 'discovery')?.onEnter ?? [];
const shellCommands = discoveryOnEnter
    .filter((a) => a.kind === 'shell')
    .map((a) => String(a.options?.command ?? '').trim());
// [0] awk recommendation derivation (0769), [1] recommendation projection (1250 R3),
// [2] needs-design projection (1250 R3). The rescue itself is the `decide` action between them.
const REC_PROJECTION = shellCommands[1];
if (shellCommands.length !== 3 || REC_PROJECTION === undefined) {
    throw new Error('expected 3 discovery onEnter shell actions (derivation + two projections)');
}

/** 1250 R3: the catalog decides that replaced the two `spur decision run` rescue shells. */
function discoveryDecideIds(): string[] {
    return discoveryOnEnter.filter((a) => a.kind === 'decide').map((a) => String(a.options?.decision ?? ''));
}

const dirs: string[] = [];
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempProject(): { dir: string; report: string; rec: string; nd: string } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-1097-rescue-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    const base = join(dir, '.spur', 'run', 'r-idea');
    return {
        dir,
        report: `${base}-eval-report.md`,
        rec: `${base}-recommendation.txt`,
        nd: `${base}-needs-design.json`,
    };
}

/** Hermetic subprocess env (config-layering pattern): explicit PATH, no ambient spread. */
function rescueEnv(): Record<string, string> {
    return {
        PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter),
        __runId: 'r',
        spurBin: `${process.execPath} ${CLI_ENTRY}`,
    };
}

function runShell(dir: string, command: string): void {
    const result = spawnSync('sh', ['-c', command], {
        cwd: dir,
        // HOME pins the config layers to the temp project. Without it the child's `os.homedir()`
        // falls back to the passwd entry, the machine's `~/.config/spur/config.yaml` is read, and
        // its `decisions.maker` decides the maker this test asserts — so an operator who points the
        // global config at a working local backend (fm-local) turns this fallback E2E green-only.
        env: { ...rescueEnv(), HOME: dir },
        encoding: 'utf8',
    });
    // Every rescue path must exit 0 — pipeline shell default onError is `fail`.
    expect(result.status).toBe(0);
}

/** The pipeline always runs the derivation before the rescues; mirror that order. */
function runDiscoveryShells(dir: string): void {
    for (const command of shellCommands) runShell(dir, command);
}

function decisionRows(dir: string): { event: string; data: Record<string, unknown> }[] {
    const dbPath = join(dir, '.spur', 'spur.db');
    if (!existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });
    try {
        // Event row ids are `sev_<uuid>` — not insertion-ordered. Restore the §4
        // lifecycle order in JS instead of trusting physical row order.
        const rank: Record<string, number> = {
            'decision.start': 0,
            'decision.failure': 1,
            'decision.success': 1,
            'decision.end': 2,
        };
        const rows = db
            .query("SELECT event_name, payload_json FROM system_events WHERE event_name LIKE 'decision.%'")
            .all() as unknown as { event_name: string; payload_json: string }[];
        return rows
            .map((row) => ({
                event: row.event_name,
                data: (JSON.parse(row.payload_json) as { data: Record<string, unknown> }).data,
            }))
            .sort((a, b) => (rank[a.event] ?? 9) - (rank[b.event] ?? 9));
    } finally {
        db.close();
    }
}

function resetDb(dir: string): void {
    rmSync(join(dir, '.spur', 'spur.db'), { force: true });
}

describe('idea-pipeline discovery rescue steps (task 1097)', () => {
    test('R4: parsed proceed recommendation and valid needs_design boolean call no decision', () => {
        const t = tempProject();
        writeFileSync(t.report, '## Recommendation\n\nproceed - the idea is worth building.\n');
        writeFileSync(t.nd, '{"needs_design": true}');
        runDiscoveryShells(t.dir);
        expect(readFileSync(t.rec, 'utf8')).toBe('proceed\n');
        expect(readFileSync(t.nd, 'utf8')).toBe('{"needs_design": true}');
        expect(decisionRows(t.dir)).toHaveLength(0);
    });

    test('R2: prose report keeps unknown, and the typed decide owns the rescue (1250 R3)', () => {
        const t = tempProject();
        resetDb(t.dir);
        writeFileSync(t.report, '## Recommendation\n\nThe evaluation leans positive but stops short of a verdict.\n');
        writeFileSync(t.nd, '{"needs_design": true}'); // valid boolean: the R2 rescue is recommendation-only
        runDiscoveryShells(t.dir);
        expect(readFileSync(t.rec, 'utf8')).toBe('unknown\n');
        // 1250 R3: the rescue is a `kind: decide` action now, so the shell layer records no
        // decision lifecycle. The action's start→failure→end persistence and row shape are owned
        // by packages/app/tests/workflow/actions/decide*.test.ts and decision-gate-persistence.test.ts.
        expect(decisionRows(t.dir)).toHaveLength(0);
        expect(discoveryDecideIds()).toEqual(['idea-recommendation', 'needs-design']);
        // The migration is real: no discovery shell invokes the CLI rescue any more; the shells
        // only derive and project, and the decide action reads the catalog.
        expect(shellCommands.filter((command) => command.includes('decision run'))).toEqual([]);
    });

    test('R2: the recommendation projection short-circuits when the derived file is not unknown', () => {
        const t = tempProject();
        resetDb(t.dir);
        writeFileSync(t.report, '## Recommendation\n\nThe evaluation leans positive but stops short of a verdict.\n');
        writeFileSync(t.rec, 'proceed\n');
        runShell(t.dir, REC_PROJECTION);
        expect(readFileSync(t.rec, 'utf8')).toBe('proceed\n');
        expect(decisionRows(t.dir)).toHaveLength(0);
    });

    test('R3: corrupt needs-design JSON falls back to {"needs_design": true} (the design default)', () => {
        const t = tempProject();
        resetDb(t.dir);
        writeFileSync(t.report, '## Recommendation\n\nproceed - the idea is worth building.\n');
        writeFileSync(t.nd, 'not-json');
        runDiscoveryShells(t.dir);
        // The projection's non-model/absent-row fallback is `design` (needs_design true), which is
        // the catalog entry's `fallback: design` — no default path may auto-skip the design pass.
        expect(readFileSync(t.nd, 'utf8')).toBe('{"needs_design": true}\n');
        expect(decisionRows(t.dir)).toHaveLength(0);
        expect(discoveryDecideIds()).toEqual(['idea-recommendation', 'needs-design']);
    });
});
