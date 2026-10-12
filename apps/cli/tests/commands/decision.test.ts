import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MainOptions, main as runMain } from '../../src/index';

/**
 * E2E CLI tests for `spur decision` (task 1093, feature P ACs R1–R5). Runs the real
 * command surface in-process against a temp project whose `.spur/decisions` fixture
 * joins the bundled shared catalog; makers stay offline (built-in `typesafe`).
 */

const dirs: string[] = [];
function tempProject(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-decision-cli-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.spur', 'decisions'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        mkdirSync(join(dir, name, '..'), { recursive: true });
        writeFileSync(join(dir, name), content);
    }
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function main(
    argv: string[],
    cwd: string,
): Promise<{ code: number; out: string; stdout: string; stderr: string }> {
    const chunks: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runMain(argv, {
        cwd,
        output: {
            write: (message: string) => {
                chunks.push(message);
                stdout.push(message);
            },
            error: (message: string) => {
                chunks.push(message);
                stderr.push(message);
            },
        },
    } satisfies MainOptions);
    return { code, out: chunks.join('\n'), stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const FIXTURE = `version: 1
defaults:
    minConfidence: 0.8
decisions:
    triage-test:
        type: choice
        description: Which lane?
        parameters:
            wbs:
                type: string
                description: Task WBS.
        criteria:
            low: Small.
            standard: Ordinary.
            high: Broad.
        fallback: standard
    gate-test:
        type: choice
        description: Fix or stop?
        parameters:
            attempts:
                type: number
                description: Repair attempts so far.
        criteria:
            fix: Fixable.
            stop: Not fixable.
        fallback: fix
    scale-test:
        type: score
        description: How confident is the tree?
        parameters:
            depth:
                type: boolean
                description: Deep scan?
        criteria:
            - '1: thin payload'
            - '5: rich payload'
        fallback: 1
    audit-test:
        type: score
        description: Audit the payload?
        parameters:
            payload:
                type: json
                description: Arbitrary audit payload.
        criteria:
            - '1: thin payload'
            - '5: rich payload'
        fallback: 1
`;

const CLEAN = tempProject({ '.spur/decisions/fixture.yaml': FIXTURE });

describe('spur decision list (AC1)', () => {
    test('lists fixture plus shipped shared decisions; --layer filters', async () => {
        const all = await main(['decision', 'list', '--json', '--json-envelope'], CLEAN);
        expect(all.code).toBe(0);
        const parsed = JSON.parse(all.out) as {
            ok: boolean;
            data: Array<{ id: string; layer: string; source: string }>;
        };
        expect(parsed.ok).toBe(true);
        const ids = parsed.data.map((entry) => entry.id);
        expect(ids).toContain('triage-test');
        expect(ids).toContain('task-triage'); // shipped shared catalog
        const fixture = parsed.data.find((entry) => entry.id === 'triage-test');
        expect(fixture?.layer).toBe('project');
        expect(fixture?.source.endsWith('fixture.yaml')).toBe(true);

        const shared = await main(['decision', 'list', '--layer', 'shared', '--json', '--json-envelope'], CLEAN);
        expect(shared.code).toBe(0);
        const sharedIds = (JSON.parse(shared.out) as { data: Array<{ id: string }> }).data.map((entry) => entry.id);
        expect(sharedIds).toContain('task-triage');
        expect(sharedIds).not.toContain('triage-test');
    });

    test('human output is one line per decision', async () => {
        const result = await main(['decision', 'list', '--layer', 'project'], CLEAN);
        expect(result.code).toBe(0);
        const lines = result.out.split('\n').filter((line) => line.trim() !== '');
        expect(lines.length).toBe(4);
        expect(lines[0]).toContain('triage-test');
    });

    test('unknown --layer exits 1 instead of listing nothing', async () => {
        const result = await main(['decision', 'list', '--layer', 'bogus', '--json', '--json-envelope'], CLEAN);
        expect(result.code).toBe(1);
        const parsed = JSON.parse(result.out) as { ok: boolean; error: { code: string; message: string } };
        expect(parsed.error.code).toBe('VALIDATION_FAILED');
        expect(parsed.error.message).toContain('project, registered, shared');
    });

    test('broken catalog still lists surviving decisions at exit 0 (design §3.4)', async () => {
        const broken = tempProject({
            '.spur/decisions/broken.yaml':
                'version: 1\ndecisions:\n    broken-decision:\n        type: choice\n        fallback: x\n',
        });
        const result = await main(['decision', 'list'], broken);
        expect(result.code).toBe(0);
        expect(result.out).toContain('task-triage'); // shared catalog still serves; broken file is dropped
    });
});

describe('spur decision show (AC2)', () => {
    test('returns the served contract with effective maker and source', async () => {
        const result = await main(['decision', 'show', 'triage-test', '--json', '--json-envelope'], CLEAN);
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.out) as {
            ok: boolean;
            data: {
                id: string;
                type: string;
                fallback: string;
                minConfidence: number;
                criteria: unknown;
                effectiveMaker: { name: string; source: string };
            };
        };
        expect(parsed.ok).toBe(true);
        expect(parsed.data.id).toBe('triage-test');
        expect(parsed.data.type).toBe('choice');
        expect(parsed.data.fallback).toBe('standard');
        expect(parsed.data.minConfidence).toBe(0.8);
        // The closed answer vocabulary is part of the served contract (feature scenario R2).
        expect(JSON.stringify(parsed.data.criteria)).toContain('standard');
        expect(parsed.data.effectiveMaker.name).toBe('typesafe'); // hub default; nothing configured
        expect(parsed.data.effectiveMaker.source).toBe('catalog-default');
    });

    test('unknown id exits 1 with an error envelope', async () => {
        const result = await main(['decision', 'show', 'no-such-decision', '--json', '--json-envelope'], CLEAN);
        expect(result.code).toBe(1);
        const parsed = JSON.parse(result.out) as { ok: boolean; error: { code: string } };
        expect(parsed.ok).toBe(false);
        expect(parsed.error.code).toBe('NOT_FOUND');
    });

    test('human output renders the contract fields', async () => {
        const result = await main(['decision', 'show', 'triage-test'], CLEAN);
        expect(result.code).toBe(0);
        expect(result.out).toContain('id: triage-test');
        expect(result.out).toContain('type: choice');
        expect(result.out).toContain('layer: project');
        expect(result.out).toContain('criteria: ');
        expect(result.out).toContain('model: ');
        expect(result.out).toContain('effectiveMaker: typesafe');
        expect(result.out).toContain('makerSource: catalog-default');
    });

    test('human unknown id writes the message and exits 1', async () => {
        const result = await main(['decision', 'show', 'no-such-decision'], CLEAN);
        expect(result.code).toBe(1);
        expect(result.out).toContain('no-such-decision');
    });
});

describe('spur decision run (AC3)', () => {
    test('serves the closed vocabulary and exits 0; never writes a resultFile', async () => {
        const result = await main(
            ['decision', 'run', 'triage-test', '--param', 'wbs=1093', '--json', '--json-envelope'],
            CLEAN,
        );
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.out) as {
            ok: boolean;
            data: { id: string; type: string; value: string; source: string; maker: string };
        };
        expect(parsed.ok).toBe(true);
        expect(['low', 'standard', 'high']).toContain(parsed.data.value);
        expect(['model', 'default']).toContain(parsed.data.source);
        expect(parsed.data.maker).toBe('typesafe');

        const human = await main(['decision', 'run', 'triage-test', '--param', 'wbs=1093'], CLEAN);
        expect(human.code).toBe(0);
        expect(human.out.split('\n').filter((line) => line.trim() !== '')).toHaveLength(1);
        // no workflow resultFile side effects in the project
        expect(await Array.fromAsync(new Bun.Glob('**/*.decision').scan({ cwd: CLEAN }))).toEqual([]);
    });

    test('exposes the derived confidenceLevel next to the raw confidence (design §3.5)', async () => {
        const result = await main(
            ['decision', 'run', 'triage-test', '--param', 'wbs=1093', '--json', '--json-envelope'],
            CLEAN,
        );
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.out) as {
            ok: boolean;
            data: { confidence: number | null; confidenceLevel: string };
        };
        // The level is a receipt field of its own, in the closed vocabulary — not something the
        // caller has to re-derive from `confidence`.
        expect(['HIGH', 'MEDIUM', 'LOW']).toContain(parsed.data.confidenceLevel);
        // Thresholds are written out here rather than imported, so this checks the boundary against
        // the documented contract instead of replaying the implementation's own helper.
        const observed = parsed.data.confidence;
        const expected = observed === null ? 'LOW' : observed >= 0.8 ? 'HIGH' : observed >= 0.5 ? 'MEDIUM' : 'LOW';
        expect(parsed.data.confidenceLevel).toBe(expected);
        // No key in this environment → the hub answers with the declared fallback, so the level must
        // read fail-conservative: an absent confidence can never present as HIGH or MEDIUM.
        expect(observed).toBeNull();
        expect(parsed.data.confidenceLevel).toBe('LOW');
    });

    test('attaches redacted, bounded evidence and coerces declared types', async () => {
        writeFileSync(join(CLEAN, 'ev.txt'), 'diff ok SECRET_TOKEN=abc123 inside\n');
        const result = await main(
            [
                'decision',
                'run',
                'gate-test',
                '--param',
                'attempts=2',
                '--evidence',
                'ev.txt',
                '--json',
                '--json-envelope',
            ],
            CLEAN,
        );
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.out) as { ok: boolean; data: { value: string } };
        expect(parsed.ok).toBe(true);
        expect(['fix', 'stop']).toContain(parsed.data.value);

        const score = await main(
            ['decision', 'run', 'scale-test', '--param', 'depth=true', '--json', '--json-envelope'],
            CLEAN,
        );
        expect(score.code).toBe(0);
        const scoreParsed = JSON.parse(score.out) as { ok: boolean; data: { type: string } };
        expect(scoreParsed.data.type).toBe('score');
    });
});

describe('spur decision run caller mistakes (AC4)', () => {
    test.each([
        ['unknown id', ['decision', 'run', 'no-such-decision']],
        ['unknown param', ['decision', 'run', 'triage-test', '--param', 'nope=1']],
        ['missing required param', ['decision', 'run', 'gate-test']],
        ['type-invalid param', ['decision', 'run', 'gate-test', '--param', 'attempts=not-a-number']],
        ['unregistered maker', ['decision', 'run', 'triage-test', '--maker', 'bogus-maker']],
    ])('%s exits 1', async (_label, argv) => {
        const result = await main([...argv, '--json', '--json-envelope'], CLEAN);
        expect(result.code).toBe(1);
        const parsed = JSON.parse(result.out) as { ok: boolean; error: { code: string } };
        expect(parsed.ok).toBe(false);
        // Caller mistakes are never reported as internal failures.
        expect(parsed.error.code).not.toBe('INTERNAL_ERROR');
    });

    test('invalid JSON param exits 1; human path reports the message', async () => {
        const bad = await main(['decision', 'run', 'audit-test', '--param', 'payload={nope'], CLEAN);
        expect(bad.code).toBe(1);
        expect(bad.out).toContain('expects valid JSON');
    });

    test('unreadable evidence exits 1', async () => {
        const result = await main(
            [
                'decision',
                'run',
                'triage-test',
                '--param',
                'wbs=1',
                '--evidence',
                'missing.txt',
                '--json',
                '--json-envelope',
            ],
            CLEAN,
        );
        expect(result.code).toBe(1);
        expect(JSON.parse(result.out).error.message).toContain('unreadable');
    });
});

describe('spur decision status (AC5)', () => {
    test('clean project exits 0 with layer counts and makers', async () => {
        const result = await main(['decision', 'status', '--json', '--json-envelope'], CLEAN);
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.out) as {
            ok: boolean;
            data: {
                layers: Record<string, number>;
                registeredMakers: string[];
                perDecision: Array<{
                    id: string;
                    type: string;
                    maker: string;
                    source: string;
                    registered: boolean;
                    layer: string;
                    minConfidence: number;
                    evidence: { recorded: number; accepted: number; lastSeen: string | null };
                }>;
                errors: string[];
            };
        };
        expect(parsed.ok).toBe(true);
        expect(parsed.data.layers.project).toBeGreaterThanOrEqual(1); // layer counts are files
        expect(parsed.data.layers.shared).toBeGreaterThanOrEqual(1);
        expect(parsed.data.registeredMakers).toContain('typesafe');
        const triage = parsed.data.perDecision.find((row) => row.id === 'triage-test');
        expect(triage?.maker).toBe('typesafe');
        expect(triage?.registered).toBe(true);
        expect(parsed.data.errors).toEqual([]);
    });

    test('catalog error exits 1', async () => {
        const broken = tempProject({
            '.spur/decisions/broken.yaml':
                'version: 1\ndecisions:\n    broken-decision:\n        type: choice\n        fallback: x\n',
        });
        const result = await main(['decision', 'status', '--json', '--json-envelope'], broken);
        expect(result.code).toBe(1);
    });

    test('human output is a sectioned readiness report, not a flat key dump', async () => {
        // Own project: the shared CLEAN fixture accumulates recorded rows from the run tests.
        const clean = tempProject({ '.spur/decisions/fixture.yaml': FIXTURE });
        const result = await main(['decision', 'status'], clean);
        expect(result.code).toBe(0);
        expect(result.out).toMatch(
            /^decision status — OK · \d+ decisions · \d+ makers · default maker \S+ · 0 recorded$/m,
        );
        // Aligned tables with a header row: the operator can read what each column is.
        expect(result.out).toMatch(/^ST\s+MAKER\s+CONFIGURED BY\s+SERVES\s+RECORDED\s+ACCEPTED\s+LAST SEEN$/m);
        expect(result.out).toMatch(
            /^ST\s+DECISION\s+TYPE\s+MAKER\s+SOURCE\s+MIN\s+LAYER\s+RECORDED\s+ACCEPTED\s+LAST SEEN$/m,
        );
        expect(result.out).toMatch(
            /^✓\s+triage-test\s+choice\s+typesafe\s+catalog-default\s+0.8\s+project\s+0\s+0\s+—$/m,
        );
        expect(result.out).toMatch(/^Catalog$/m);
        expect(result.out).toMatch(/^ {2}layers {6}project 1 · registered 0 · shared 5$/m);
        expect(result.out).toMatch(/^ {2}duplicates {2}\(none\)$/m);
        // Object values never render as a JSON blob (the old output did).
        expect(result.out).not.toContain('"project":');
        expect(result.out).not.toContain('defaultMaker:');
    });

    test('human catalog error exits 1 with the error above the tables', async () => {
        const broken = tempProject({
            '.spur/decisions/broken.yaml':
                'version: 1\ndecisions:\n    broken-decision:\n        type: choice\n        fallback: x\n',
        });
        const result = await main(['decision', 'status'], broken);
        expect(result.code).toBe(1);
        expect(result.out).toMatch(
            /^decision status — FAILED \(1 error\) · \d+ decisions · \d+ makers · default maker /m,
        );
        expect(result.out).toMatch(/^Errors \(1\)$/m);
        expect(result.out).toContain('load error in project layer');
        // Errors render before the tables, so a failing run reads top-down.
        expect(result.out.indexOf('Errors (1)')).toBeLessThan(result.out.indexOf('\nMakers\n'));
    });
});

describe('spur decision status readiness marks (feature P11)', () => {
    const CLEAN_JSON = (
        out: string,
    ): {
        data: {
            makers: Array<{
                name: string;
                registered: boolean;
                configuredBy: string[];
                serves: string[];
                evidence: { recorded: number; accepted: number; lastSeen: string | null };
            }>;
            perDecision: Array<{ id: string; evidence: { recorded: number; accepted: number } }>;
            probes?: Array<{ maker: string; ok: boolean; value: unknown; reason: string; durationMs: number }>;
            configDecisionMakers: Record<string, string>;
        };
    } => JSON.parse(out) as ReturnType<typeof CLEAN_JSON>;

    test('R2/R3/R4: makers carry registration, configuration and served count; decisions carry evidence', async () => {
        const project = tempProject({
            '.spur/decisions/fixture.yaml': FIXTURE,
            '.spur/config.yaml': 'decisions:\n    maker: typesafe\n    makers:\n        triage-test: fm-local\n',
        });
        const result = await main(['decision', 'status', '--json', '--json-envelope'], project);
        expect(result.code).toBe(0);
        const { data } = CLEAN_JSON(result.out);
        const typesafe = data.makers.find((maker) => maker.name === 'typesafe');
        const fm = data.makers.find((maker) => maker.name === 'fm-local');
        // Configured: `decisions.maker` names typesafe, `decisions.makers.triage-test` names fm-local.
        expect(typesafe).toMatchObject({ registered: true, configuredBy: ['decisions.maker'] });
        expect(fm).toMatchObject({ registered: true, configuredBy: ['decisions.makers.triage-test'] });
        expect(fm?.serves).toEqual(['triage-test']);
        expect(typesafe?.evidence).toEqual({ recorded: 0, accepted: 0, lastSeen: null });
        expect(data.configDecisionMakers).toEqual({ 'triage-test': 'fm-local' });
        // Every pre-existing status field survives: the overlay is additive only.
        const raw = JSON.parse(result.out) as { data: Record<string, unknown> };
        expect(Object.keys(raw.data)).toEqual(
            expect.arrayContaining([
                'ok',
                'layers',
                'loadErrors',
                'duplicateIds',
                'registeredMakers',
                'configDefaultMaker',
                'configDecisionMakers',
                'perDecision',
                'errors',
                'makers',
            ]),
        );
        expect(data.probes).toBeUndefined();
    });

    test('R2/R3/R4: recorded invocations show up as evidence per decision and per maker', async () => {
        const project = tempProject({ '.spur/decisions/fixture.yaml': FIXTURE });
        for (const _ of [1, 2]) {
            expect((await main(['decision', 'run', 'triage-test', '--param', 'wbs=1'], project)).code).toBe(0);
        }
        const json = CLEAN_JSON((await main(['decision', 'status', '--json', '--json-envelope'], project)).out);
        const row = json.data.perDecision.find((entry) => entry.id === 'triage-test');
        expect(row?.evidence.recorded).toBe(2);
        expect(json.data.makers.find((maker) => maker.name === 'typesafe')?.evidence.recorded).toBe(2);

        // The human report carries the same counts in the decision row.
        const human = await main(['decision', 'status'], project);
        const line = human.out.split('\n').find((entry) => entry.includes('triage-test') && entry.includes('typesafe'));
        const cells = (line ?? '').split(/\s{2,}/);
        expect(cells[1]).toBe('triage-test');
        expect(cells.at(-3)).toBe('2'); // RECORDED — two served invocations
        expect(cells.at(-2)).toMatch(/^\d+$/); // ACCEPTED depends on the backend, the count is what is shown
        expect(cells.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/); // LAST SEEN preserves the timestamp
    });

    test('R5: --probe asks each effective maker once and leaves the recorded evidence untouched', async () => {
        const project = tempProject({ '.spur/decisions/fixture.yaml': FIXTURE });
        const probed = await main(['decision', 'status', '--probe'], project);
        expect(probed.code).toBe(0);
        expect(probed.out).toMatch(/^ST\s+MAKER\s+CONFIGURED BY\s+SERVES\s+RECORDED\s+ACCEPTED\s+LAST SEEN\s+PROBE$/m);
        // The streamed progress line and the table cell both carry a glyph + value + a duration.
        expect(probed.stderr).toMatch(/probing typesafe: [✓✗] .+ · \d+\.\ds/);
        const makerLine = probed.out.split('\n').find((line) => /^[✓✗]\s+typesafe\s/.test(line));
        expect(makerLine).toMatch(/[✓✗] .+ · \d+\.\ds$/);
        // The cell spells the reason for an operator; the raw taxonomy token stays in --json.
        expect(makerLine).toMatch(/via (accepted|low confidence|no backend|timed out|errored)/);
        expect(makerLine).not.toMatch(/via (no-backend|low-confidence|timeout|error)\b/);
        // A probe writes no decision log row: the evidence the report shows cannot be
        // satisfied by the probe that checked it.
        const after = CLEAN_JSON((await main(['decision', 'status', '--json', '--json-envelope'], project)).out);
        expect(after.data.makers.find((maker) => maker.name === 'typesafe')?.evidence.recorded).toBe(0);
    });

    test('R5: --probe --json stays one parseable document and carries the probe results', async () => {
        const project = tempProject({ '.spur/decisions/fixture.yaml': FIXTURE });
        const result = await main(['decision', 'status', '--probe', '--json', '--json-envelope'], project);
        expect(result.code).toBe(0);
        const json = CLEAN_JSON(result.stdout);
        expect(result.stderr).toMatch(/probing typesafe: [✓✗]/);
        expect(result.stdout).not.toContain('probing ');
        expect(json.data.probes).toHaveLength(1);
        // A probe outcome is data whatever the backend does: the assertions stay true whether the
        // maker answers or falls back, which is exactly the "reported, not raised" contract.
        const probeRow = json.data.probes?.[0];
        expect(probeRow?.maker).toBe('typesafe');
        expect(typeof probeRow?.ok).toBe('boolean');
        expect(['accepted', 'low-confidence', 'no-backend', 'timeout', 'error']).toContain(probeRow?.reason ?? 'none');
        expect(typeof probeRow?.durationMs).toBe('number');
        const raw = await main(['decision', 'status', '--probe', '--json'], project);
        expect(raw.code).toBe(0);
        expect(JSON.parse(raw.stdout).probes).toHaveLength(1);
    });

    test('R7: a catalog without the liveness entry fails --probe loudly and calls no maker', async () => {
        // A project catalog wins per basename, so this shadows the shipped maker-liveness.yaml
        // with one that serves a different id — the liveness decision is then unresolvable.
        const project = tempProject({
            '.spur/decisions/maker-liveness.yaml':
                'version: 1\ndecisions:\n    shadow-decision:\n        type: choice\n        criteria:\n            a: A.\n            b: B.\n        fallback: a\n',
        });
        const result = await main(['decision', 'status', '--probe'], project);
        expect(result.code).toBe(1);
        expect(result.out).toContain('maker-liveness');
        expect(result.out).not.toContain('probing ');
    });

    test('R8: --probe with --reliability is refused before any maker call', async () => {
        const result = await main(['decision', 'status', '--probe', '--reliability'], CLEAN);
        expect(result.code).toBe(1);
        expect(result.out).toContain('--probe and --reliability cannot be combined');
        expect(result.out).not.toContain('probing ');
    });
});

describe('spur decision status --reliability (task 1096)', () => {
    // A dedicated project so the recorded sample counts are known exactly.
    const RELIABILITY = tempProject({ '.spur/decisions/fixture.yaml': FIXTURE });

    test('reports recorded groups, fallback reasons and the evidence-none fill; plain path unchanged', async () => {
        for (const _ of [1, 2, 3]) {
            const run = await main(['decision', 'run', 'triage-test', '--param', 'wbs=1'], RELIABILITY);
            expect(run.code).toBe(0);
        }
        const once = await main(['decision', 'run', 'gate-test', '--param', 'attempts=1'], RELIABILITY);
        expect(once.code).toBe(0);

        const result = await main(['decision', 'status', '--reliability', '--json', '--json-envelope'], RELIABILITY);
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.out) as {
            ok: boolean;
            data: {
                generatedAt: string;
                groups: Array<{
                    decisionId: string;
                    maker: string;
                    evidence: string;
                    samples: number;
                    accepted: number;
                    acceptedRate: number;
                    fallbacks: Record<string, number>;
                    medianConfidence: number | null;
                    p50DurationMs: number | null;
                    p95DurationMs: number | null;
                }>;
            };
        };
        expect(parsed.ok).toBe(true);
        expect(parsed.data.generatedAt).toBeDefined();

        const triage = parsed.data.groups.find((g) => g.decisionId === 'triage-test');
        expect(triage).toMatchObject({
            maker: 'typesafe',
            evidence: 'recorded',
            samples: 3,
            accepted: 0, // offline typesafe maker serves the fallback every time
            acceptedRate: 0,
            fallbacks: { 'no-backend': 3 },
            medianConfidence: null,
        });
        const gate = parsed.data.groups.find((g) => g.decisionId === 'gate-test');
        expect(gate).toMatchObject({ evidence: 'recorded', samples: 1 });
        // Catalog ids without rows report evidence none (shared catalog included).
        const shared = parsed.data.groups.find((g) => g.decisionId === 'review-failure-class');
        expect(shared).toMatchObject({ evidence: 'none', samples: 0 });
        // A recorded id is never duplicated as a none row.
        expect(parsed.data.groups.filter((g) => g.decisionId === 'triage-test')).toHaveLength(1);

        // Plain status output and exit code stay unchanged alongside the new flag.
        const plain = await main(['decision', 'status', '--json', '--json-envelope'], RELIABILITY);
        expect(plain.code).toBe(0);
        const plainParsed = JSON.parse(plain.out) as { data: { layers: Record<string, number> } };
        expect(plainParsed.data.layers).toBeDefined();
    });

    test('human reliability output is one line per group', async () => {
        const result = await main(['decision', 'status', '--reliability'], RELIABILITY);
        expect(result.code).toBe(0);
        const lines = result.out.split('\n').filter((line) => line.trim() !== '');
        expect(lines.length).toBeGreaterThanOrEqual(2);
        expect(lines[0]).toContain('triage-test');
        expect(lines.join('\n')).toContain('none');
    });

    test('an invalid --since timestamp exits 1', async () => {
        const result = await main(
            ['decision', 'status', '--reliability', '--since', 'not-a-date', '--json', '--json-envelope'],
            RELIABILITY,
        );
        expect(result.code).toBe(1);
        const parsed = JSON.parse(result.out) as { ok: boolean; error: { code: string; message: string } };
        expect(parsed.ok).toBe(false);
        expect(parsed.error.message).toContain('invalid --since');
    });

    test('--since without --reliability is a caller mistake and plain status stays exit-coded', async () => {
        const bad = await main(['decision', 'status', '--since', '2026-10-01T00:00:00Z'], RELIABILITY);
        expect(bad.code).toBe(1);
        expect(bad.out).toContain('--since is only valid together with --reliability');
    });
});
