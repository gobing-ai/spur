import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * 1097 R2–R4 E2E — the discovery onEnter rescue steps of the tracked idea-pipeline
 * workflow YAML are driven for real: the exact shell commands run via `sh -c` in a
 * temp project with the source CLI as $spurBin and the offline built-in `typesafe`
 * maker, then derived files and the recorded decision lifecycle (system_events)
 * are asserted. Rescue-only contract: a parse that succeeds must not call the
 * catalog at all (R4); a rescue failure leaves today's routing in place (file
 * stays `unknown` / `needs_design: true`).
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const WORKFLOW = join(REPO_ROOT, 'config', 'workflows', 'idea-pipeline.yaml');
const CLI_ENTRY = join(import.meta.dir, '..', '..', 'src', 'index.ts');

interface ShellAction {
    kind: string;
    options: { command: string };
}
interface WorkflowDef {
    states: { id: string; onEnter?: ShellAction[] }[];
}

const def = parseYaml(readFileSync(WORKFLOW, 'utf8')) as WorkflowDef;
const shellCommands = (def.states.find((s) => s.id === 'discovery')?.onEnter ?? [])
    .filter((a) => a.kind === 'shell')
    .map((a) => a.options.command.trim());
// [0] awk recommendation derivation (0769), [1] recommendation rescue (1097 R2),
// [2] needs-design rescue (1097 R3).
const REC_RESCUE = shellCommands[1];
if (shellCommands.length !== 3 || REC_RESCUE === undefined) {
    throw new Error('expected 3 discovery onEnter shell actions with the 1097 rescue steps');
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
        env: rescueEnv(),
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

    test('R2: prose report keeps unknown and records one no-backend fallback lifecycle', () => {
        const t = tempProject();
        resetDb(t.dir);
        writeFileSync(t.report, '## Recommendation\n\nThe evaluation leans positive but stops short of a verdict.\n');
        writeFileSync(t.nd, '{"needs_design": true}'); // valid boolean: the R2 lifecycle is recommendation-only
        runDiscoveryShells(t.dir);
        expect(readFileSync(t.rec, 'utf8')).toBe('unknown\n');
        const rows = decisionRows(t.dir);
        expect(rows.map((r) => r.event)).toEqual(['decision.start', 'decision.failure', 'decision.end']);
        const invocationIds = new Set(rows.map((r) => r.data.invocationId));
        expect(invocationIds.size).toBe(1);
        for (const row of rows) {
            expect(row.data.decisionId).toBe('idea-recommendation');
            expect(row.data.caller).toBe('cli');
        }
        const failure = rows.find((r) => r.event === 'decision.failure');
        expect(failure?.data.reason).toBe('no-backend');
        expect(failure?.data.fallbackValue).toBe('unknown');
        const end = rows.find((r) => r.event === 'decision.end');
        expect(end?.data.source).toBe('default');
    });

    test('R2: recommendation rescue short-circuits when the derived file is not unknown', () => {
        const t = tempProject();
        resetDb(t.dir);
        writeFileSync(t.report, '## Recommendation\n\nThe evaluation leans positive but stops short of a verdict.\n');
        writeFileSync(t.rec, 'proceed\n');
        runShell(t.dir, REC_RESCUE);
        expect(readFileSync(t.rec, 'utf8')).toBe('proceed\n');
        expect(decisionRows(t.dir)).toHaveLength(0);
    });

    test('R3: corrupt needs-design JSON falls back to {"needs_design": true} via the catalog decision', () => {
        const t = tempProject();
        resetDb(t.dir);
        writeFileSync(t.report, '## Recommendation\n\nproceed - the idea is worth building.\n');
        writeFileSync(t.nd, 'not-json');
        runDiscoveryShells(t.dir);
        expect(readFileSync(t.nd, 'utf8')).toBe('{"needs_design": true}\n');
        const rows = decisionRows(t.dir);
        expect(rows.length).toBe(3);
        const invocationIds = new Set(rows.map((r) => r.data.invocationId));
        expect(invocationIds.size).toBe(1);
        for (const row of rows) {
            expect(row.data.decisionId).toBe('needs-design');
            expect(row.data.caller).toBe('cli');
        }
        const failure = rows.find((r) => r.event === 'decision.failure');
        expect(failure?.data.fallbackValue).toBe('design');
        const end = rows.find((r) => r.event === 'decision.end');
        expect(end?.data.source).toBe('default');
    });
});
