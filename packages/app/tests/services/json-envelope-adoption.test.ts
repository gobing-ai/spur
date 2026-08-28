import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { apiSuccessSchema } from '@gobing-ai/spur-contracts';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import { AgentService } from '../../src/services/agent-service';
import type { Colorize } from '../../src/services/rule-service';
import { RuleService } from '../../src/services/rule-service';
import baseline from '../fixtures/json-raw-baseline.json';

/**
 * Task 0697 / ADR-091: the four service-emitting verbs (`agent list`, `agent doctor`,
 * `rule run`, `rule validate`) emit their `--json` from `packages/app`, so the CLI's
 * `--json-envelope` flag reaches them through an `enveloped` option rather than through
 * `apps/cli/src/output.ts`. These tests pin both halves of the contract:
 *
 * - AC2 — enveloped output parses against `apiSuccessSchema`, and the explicit flag and
 *   `SPUR_JSON_ENVELOPE=1` produce the identical document.
 * - AC3 — raw output (neither flag nor env) is byte-identical to the baseline captured
 *   in `../fixtures/json-raw-baseline.json` BEFORE the seam relocation.
 */

// ── harness ──────────────────────────────────────────────────────────────────

interface Captured {
    messages: string[];
    write(message: string): void;
    error(message: string): void;
}

function capture(): Captured {
    return {
        messages: [],
        write(message: string): void {
            this.messages.push(message);
        },
        error(): void {},
    };
}

function noColor(): Colorize {
    const id = (text: string): string => text;
    return { enabled: false, dim: id, red: id, green: id, yellow: id, cyan: id };
}

/** Frozen detector rowset — the baseline fixture was captured against exactly this input. */
const AGENTS = [
    { name: 'claude', installed: true, version: '1.2.3', channels: [], error: null },
    { name: 'codex', installed: false, version: null, channels: [], error: null },
];
const DOCTOR_RESULTS = [
    { agent: 'claude', installed: true, usable: true, tier: 1, version: '1.2.3', authenticated: true, notes: [] },
];

const envelopeOf = apiSuccessSchema(z.unknown());

let previousEnv: string | undefined;
beforeEach(() => {
    previousEnv = process.env.SPUR_JSON_ENVELOPE;
    delete process.env.SPUR_JSON_ENVELOPE;
});
afterEach(() => {
    if (previousEnv === undefined) delete process.env.SPUR_JSON_ENVELOPE;
    else process.env.SPUR_JSON_ENVELOPE = previousEnv;
});

async function agentList(enveloped?: boolean): Promise<string> {
    const out = capture();
    const svc = new AgentService({ cwd: process.cwd(), env: {}, output: out });
    await svc.list({ json: true, ...(enveloped === undefined ? {} : { enveloped }) }, {
        detector: { detectAll: async () => AGENTS },
    } as never);
    return out.messages.join('\n');
}

async function agentDoctor(enveloped?: boolean): Promise<string> {
    const out = capture();
    const svc = new AgentService({ cwd: process.cwd(), env: {}, output: out });
    await svc.doctor({ json: true, ...(enveloped === undefined ? {} : { enveloped }) }, {
        doctorRunner: { runAll: async () => DOCTOR_RESULTS },
        fileSystem: createNodeFileSystem(await mkdtemp(join(tmpdir(), 'spur-0697-'))),
        now: () => 0,
    } as never);
    return out.messages.join('\n');
}

async function ruleProject(): Promise<{ cwd: string; file: string }> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-0697-rule-'));
    await Bun.write(join(cwd, 'package.json'), `${JSON.stringify({ name: 'fixture', type: 'module' }, null, 2)}\n`);
    const file = join(cwd, 'rules.yaml');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
        file,
        [
            'rules:',
            '  - id: sample-rule',
            '    description: Sample rule',
            '    evaluator:',
            '      type: path',
            '      config:',
            '        paths:',
            '          - package.json',
        ].join('\n'),
    );
    return { cwd, file };
}

async function ruleRun(enveloped?: boolean): Promise<string> {
    const { cwd, file } = await ruleProject();
    const out = capture();
    await new RuleService({ cwd, env: {}, fs: createNodeFileSystem(), output: out }).evaluate({
        preset: 'x',
        file,
        failOn: 'error',
        json: true,
        verbose: false,
        color: noColor(),
        ...(enveloped === undefined ? {} : { enveloped }),
    });
    return out.messages.join('\n').replaceAll(file, '<FILE>').replaceAll(cwd, '<CWD>');
}

async function ruleValidate(enveloped?: boolean): Promise<string> {
    const { cwd, file } = await ruleProject();
    const out = capture();
    await new RuleService({ cwd, env: {}, fs: createNodeFileSystem(), output: out }).validate({
        source: { kind: 'file', value: file },
        json: true,
        ...(enveloped === undefined ? {} : { enveloped }),
    });
    return out.messages.join('\n').replaceAll(file, '<FILE>').replaceAll(cwd, '<CWD>');
}

async function ruleValidateInvalid(enveloped?: boolean): Promise<string> {
    const { cwd } = await ruleProject();
    const out = capture();
    await new RuleService({ cwd, env: {}, fs: createNodeFileSystem(), output: out }).validate({
        source: { kind: 'file', value: join(cwd, 'missing.yaml') },
        json: true,
        ...(enveloped === undefined ? {} : { enveloped }),
    });
    return out.messages.join('\n').replaceAll(cwd, '<CWD>');
}

const VERBS: ReadonlyArray<{ name: keyof typeof baseline; emit: (enveloped?: boolean) => Promise<string> }> = [
    { name: 'agent list', emit: agentList },
    { name: 'agent doctor', emit: agentDoctor },
    { name: 'rule run', emit: ruleRun },
    { name: 'rule validate', emit: ruleValidate },
    { name: 'rule validate invalid', emit: ruleValidateInvalid },
];

// ── AC3: raw default is byte-identical to the pre-relocation baseline ─────────

describe('service-layer --json raw default (AC3)', () => {
    for (const { name, emit } of VERBS) {
        test(`${name} raw output is byte-identical to the pre-change baseline`, async () => {
            expect(await emit(undefined)).toBe(baseline[name]);
        });

        test(`${name} raw output is unchanged when the flag is explicitly false`, async () => {
            expect(await emit(false)).toBe(baseline[name]);
        });
    }
});

// ── AC2: enveloped output parses against apiSuccessSchema; flag ≡ env ─────────

describe('service-layer --json-envelope (AC2)', () => {
    for (const { name, emit } of VERBS) {
        test(`${name} enveloped output parses against apiSuccessSchema`, async () => {
            const doc = JSON.parse(await emit(true));
            expect(envelopeOf.safeParse(doc).success).toBe(true);
            // All four emit flat objects — the paginated {ok, data, meta} form does not apply.
            expect(doc.meta).toBeUndefined();
            expect(doc.data).toEqual(JSON.parse(baseline[name]));
        });

        test(`${name} SPUR_JSON_ENVELOPE=1 produces the identical document to the flag`, async () => {
            const viaFlag = await emit(true);
            process.env.SPUR_JSON_ENVELOPE = '1';
            const viaEnv = await emit(undefined);
            expect(viaEnv).toBe(viaFlag);
        });

        test(`${name} explicit --json-envelope=false wins over SPUR_JSON_ENVELOPE=1`, async () => {
            process.env.SPUR_JSON_ENVELOPE = '1';
            expect(await emit(false)).toBe(baseline[name]);
        });
    }
});
