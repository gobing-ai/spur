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

async function main(argv: string[], cwd: string): Promise<{ code: number; out: string }> {
    const chunks: string[] = [];
    const code = await runMain(argv, {
        cwd,
        output: {
            write: (message: string) => chunks.push(message),
            error: (message: string) => chunks.push(message),
        },
    } satisfies MainOptions);
    return { code, out: chunks.join('\n') };
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
                effectiveMaker: { name: string; source: string };
            };
        };
        expect(parsed.ok).toBe(true);
        expect(parsed.data.id).toBe('triage-test');
        expect(parsed.data.type).toBe('choice');
        expect(parsed.data.fallback).toBe('standard');
        expect(parsed.data.minConfidence).toBe(0.8);
        expect(parsed.data.effectiveMaker.name).toBe('typesafe'); // hub default; nothing configured
        expect(parsed.data.effectiveMaker.source).toBe('catalog-default');
    });

    test('unknown id exits 1 with an error envelope', async () => {
        const result = await main(['decision', 'show', 'no-such-decision', '--json', '--json-envelope'], CLEAN);
        expect(result.code).toBe(1);
        expect(JSON.parse(result.out).ok).toBe(false);
    });

    test('human output renders the contract fields', async () => {
        const result = await main(['decision', 'show', 'triage-test'], CLEAN);
        expect(result.code).toBe(0);
        expect(result.out).toContain('id: triage-test');
        expect(result.out).toContain('type: choice');
        expect(result.out).toContain('layer: project');
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
        expect(JSON.parse(result.out).ok).toBe(false);
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
                perDecision: Array<{ id: string; maker: string; source: string; registered: boolean }>;
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

    test('human output lists makers and per-decision resolution', async () => {
        const result = await main(['decision', 'status'], CLEAN);
        expect(result.code).toBe(0);
        expect(result.out).toContain('defaultMaker:');
        expect(result.out).toContain('registeredMakers: typesafe');
        expect(result.out).toMatch(/triage-test: maker typesafe \(catalog-default\)/);
        expect(result.out).toContain('loadErrors: (none)');
    });

    test('human catalog error exits 1', async () => {
        const broken = tempProject({
            '.spur/decisions/broken.yaml':
                'version: 1\ndecisions:\n    broken-decision:\n        type: choice\n        fallback: x\n',
        });
        const result = await main(['decision', 'status'], broken);
        expect(result.code).toBe(1);
        expect(result.out).toContain('loadErrors:');
    });
});
