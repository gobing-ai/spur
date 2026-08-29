import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiErrorSchema, apiSuccessSchema, paginatedResponseSchema } from '@gobing-ai/spur-contracts';
import { z } from 'zod';
import { main } from '../src/index';
import type { CommandOutput } from '../src/output';
import { envelopeEnabled, toEnvelopeError, toEnvelopeJson, toJson, writeJsonError } from '../src/output';

// ── raw byte-identity (ADR-091 regression guard: the 0688 break class) ──

describe('toEnvelopeJson raw path', () => {
    test('unenveloped output is byte-identical to toJson for flat objects without ok (task update --section family)', () => {
        const payload = { ref: { id: '0693', filePath: 'x.md' }, warnings: [] };
        expect(toEnvelopeJson(payload, { enveloped: false })).toBe(toJson(payload));
    });

    test('unenveloped output is byte-identical for bare arrays (feature check family)', () => {
        const payload = [{ id: 'F95', status: 'backlog', findings: [] }];
        expect(toEnvelopeJson(payload, { enveloped: false, kind: 'list' })).toBe(toJson(payload));
    });

    test('unenveloped output is byte-identical for flat objects with ok (task check --corpus family)', () => {
        const payload = { observed: 1, baselined: 0, newErrors: [], ok: true };
        expect(toEnvelopeJson(payload, { enveloped: false })).toBe(toJson(payload));
    });

    test('error opts never alter the raw payload', () => {
        const raw = { ok: false, error: { code: 'wbs-collision', message: 'boom' } };
        expect(
            toEnvelopeJson(raw, {
                enveloped: false,
                error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'wbs-collision' } },
            }),
        ).toBe(toJson(raw));
    });
});

// ── envelope shapes (ADOPTION-091) ──

describe('toEnvelopeJson envelope mode', () => {
    test('wraps a payload as {ok: true, data}', () => {
        expect(JSON.parse(toEnvelopeJson({ a: 1 }, { enveloped: true }))).toEqual({ ok: true, data: { a: 1 } });
    });

    test('list kind emits the paginated {ok, data[], meta} form', () => {
        const out = JSON.parse(toEnvelopeJson([{ a: 1 }, { a: 2 }], { enveloped: true, kind: 'list' }));
        expect(out.ok).toBe(true);
        expect(out.data).toEqual([{ a: 1 }, { a: 2 }]);
        expect(out.meta).toEqual({ hasMore: false, limit: 2 });
    });

    test('error opts emit the {ok: false, error} envelope, ignoring the payload', () => {
        const out = JSON.parse(
            toEnvelopeJson(
                { ok: false, error: { code: 'wbs-collision', message: 'boom' } },
                {
                    enveloped: true,
                    error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'wbs-collision' } },
                },
            ),
        );
        expect(out).toEqual({
            ok: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom', details: { cliCode: 'wbs-collision' } },
        });
    });

    test('toEnvelopeError omits details when absent', () => {
        expect(JSON.parse(toEnvelopeError('NOT_FOUND', 'nope'))).toEqual({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'nope' },
        });
    });
});

// ── opt-in precedence: explicit flag > SPUR_JSON_ENVELOPE=1 > raw default ──

describe('envelopeEnabled precedence', () => {
    const ENV = 'SPUR_JSON_ENVELOPE';

    test('explicit true wins over a disabling env', () => {
        process.env[ENV] = '1';
        expect(envelopeEnabled(true)).toBe(true);
        expect(envelopeEnabled(false)).toBe(false);
    });

    test('undefined defers to the env', () => {
        process.env[ENV] = '1';
        expect(envelopeEnabled(undefined)).toBe(true);
        process.env[ENV] = '0';
        expect(envelopeEnabled(undefined)).toBe(false);
        delete process.env[ENV];
        expect(envelopeEnabled(undefined)).toBe(false);
    });

    test('raw default when neither flag nor env is set', () => {
        delete process.env[ENV];
        expect(JSON.parse(toEnvelopeJson({ a: 1 }))).toEqual({ a: 1 });
    });
});

// ── contract validation: adoption, not re-spelling ──

describe('envelope outputs validate against contracts schemas', () => {
    test('success envelope parses against apiSuccessSchema', () => {
        const out = JSON.parse(toEnvelopeJson({ wbs: '0693', filePath: 'x' }, { enveloped: true }));
        expect(apiSuccessSchema(z.unknown()).safeParse(out).success).toBe(true);
    });

    test('list envelope parses against paginatedResponseSchema', () => {
        const out = JSON.parse(toEnvelopeJson([{ id: 1 }], { enveloped: true, kind: 'list' }));
        expect(paginatedResponseSchema(z.unknown()).safeParse(out).success).toBe(true);
    });

    test('error envelope parses against apiErrorSchema with a frozen API_ERROR_CODES member', () => {
        const out = JSON.parse(toEnvelopeError('GUARD_DENIED', 'lifecycle guard denied'));
        expect(apiErrorSchema.safeParse(out).success).toBe(true);
        expect([
            'NOT_FOUND',
            'VALIDATION_FAILED',
            'GUARD_DENIED',
            'LOCK_TIMEOUT',
            'CONFLICT',
            'INTERNAL_ERROR',
        ]).toContain(out.error.code);
    });
});

// ── service-emitting verbs end-to-end (task 0697 AC2) ──
// These four verbs emit from packages/app services; the enveloped decision is threaded
// through the moved seam (packages/app/src/output/envelope.ts), not re-implemented.

function captureSink(): CommandOutput & { text: string } {
    let text = '';
    return {
        write(message: string): void {
            text += message;
        },
        error(_message: string): void {},
        get text() {
            return text;
        },
    };
}

const ENVELOPE_ENV = 'SPUR_JSON_ENVELOPE';

/** The four confirmed service-emitting verbs (task 0697 Background table). */
const SERVICE_VERBS: Array<{ label: string; argv: string[]; assertExit: boolean }> = [
    { label: 'agent list', argv: ['agent', 'list'], assertExit: true },
    // doctor exits 1 when a tier-1 agent is unusable on the host — the enveloped
    // document is still a success-shaped payload about agents, so exit is not asserted.
    { label: 'agent doctor', argv: ['agent', 'doctor'], assertExit: false },
    { label: 'rule run', argv: ['rule', 'run'], assertExit: true },
    {
        label: 'rule validate',
        argv: ['rule', 'validate', '--kind', 'preset', 'recommended-pre-check'],
        assertExit: true,
    },
];

describe('service-emitting verbs honor --json-envelope end-to-end (0697 AC2)', () => {
    for (const { label, argv, assertExit } of SERVICE_VERBS) {
        test(`${label}: flag and SPUR_JSON_ENVELOPE=1 produce the identical {ok:true,data} document`, async () => {
            delete process.env[ENVELOPE_ENV];
            // Fresh cwd per invocation: doctor's cache read would flip hit/ageMs between runs.
            const byFlag = captureSink();
            const flagCode = await main([...argv, '--json', '--json-envelope'], {
                cwd: mkdtempSync(join(tmpdir(), 'spur-envflag-')),
                output: byFlag,
            });
            if (assertExit) expect(flagCode).toBe(0);
            const flagDoc = JSON.parse(byFlag.text) as unknown;
            expect(apiSuccessSchema(z.unknown()).safeParse(flagDoc).success).toBe(true);

            process.env[ENVELOPE_ENV] = '1';
            try {
                const byEnv = captureSink();
                const envCode = await main([...argv, '--json'], {
                    cwd: mkdtempSync(join(tmpdir(), 'spur-envvar-')),
                    output: byEnv,
                });
                if (assertExit) expect(envCode).toBe(0);
                expect(byEnv.text).toBe(byFlag.text);
            } finally {
                delete process.env[ENVELOPE_ENV];
            }
        }, 30000);
    }
});

// ── agent run env opt-in (0697 review-fix F-R1) ──
// `agent run` threads --json-envelope tri-state into AgentService.run. A failing --cwd
// exercises the service error branch (run()'s !outcome.ok envelope emit) deterministically
// without spawning a real agent.

const RUN_ENV_FAIL_ARGV = ['agent', 'run', '--json', '--cwd', '/nonexistent-0697-cwd', 'hi'] as const;

describe('agent run honors SPUR_JSON_ENVELOPE end-to-end (0697 F-R1)', () => {
    test('env opt-in envelops, explicit flag wins with env off, default stays raw', async () => {
        delete process.env[ENVELOPE_ENV];
        const raw = captureSink();
        const rawCode = await main([...RUN_ENV_FAIL_ARGV], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-run-raw-')),
            output: raw,
        });
        expect(rawCode).toBe(2);
        const rawDoc = JSON.parse(raw.text) as { ok?: unknown };
        expect(rawDoc.ok).toBeUndefined(); // failure pseudo-envelope, not the {ok:false} envelope

        process.env[ENVELOPE_ENV] = '1';
        try {
            const byEnv = captureSink();
            const envCode = await main([...RUN_ENV_FAIL_ARGV], {
                cwd: mkdtempSync(join(tmpdir(), 'spur-run-env-')),
                output: byEnv,
            });
            expect(envCode).toBe(2);
            expect(apiErrorSchema.safeParse(JSON.parse(byEnv.text)).success).toBe(true);
        } finally {
            delete process.env[ENVELOPE_ENV];
        }

        const byFlag = captureSink();
        const flagCode = await main([...RUN_ENV_FAIL_ARGV, '--json-envelope'], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-run-flag-')),
            output: byFlag,
        });
        expect(flagCode).toBe(2);
        expect(apiErrorSchema.safeParse(JSON.parse(byFlag.text)).success).toBe(true);
    }, 30000);
});

// ── raw-default byte-identity (task 0697 AC3/R3) ──
// The fixture was captured BEFORE any source edit (plan step 1) via the same in-process
// harness: `rule run --json` / `rule validate --json --kind preset recommended-pre-check`
// in a fresh temp project. The agent verbs emit host-detected payloads, so a committed
// byte fixture would be machine-specific; their identity is pinned structurally instead:
// raw bytes === toJson(enveloped document data), which fails if the conversion changes the
// payload, its key order, or the serialization settings.

describe('raw default byte-identity vs pre-change baseline (0697 AC3)', () => {
    const fixtureDir = join(import.meta.dir, 'fixtures', 'raw-json-baseline');

    // Pin the rule catalog to the repo's tracked rule directory so the baseline does
    // not drift with the machine's global ~/.config/spur/rules (a stale global preset
    // shadowed the bundled catalog and silently produced a different ruleCount).
    const REPO_RULES_DIR = join(import.meta.dir, '..', '..', '..', 'config', 'rules');

    test('rule run --json emits the captured pre-change fixture bytes', async () => {
        delete process.env[ENVELOPE_ENV];
        const out = captureSink();
        const code = await main(['rule', 'run', '--json'], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-baseline-')),
            output: out,
            env: { ...process.env, SPUR_GLOBAL_RULES_DIR: REPO_RULES_DIR },
        });
        expect(code).toBe(0);
        const fixture = readFileSync(join(fixtureDir, 'rule-run.json'), 'utf8');
        expect(out.text).toBe(fixture);
    }, 20000);

    test('rule validate --json --kind preset emits the captured pre-change fixture bytes', async () => {
        delete process.env[ENVELOPE_ENV];
        const out = captureSink();
        const code = await main(['rule', 'validate', '--json', '--kind', 'preset', 'recommended-pre-check'], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-baseline-')),
            output: out,
            env: { ...process.env, SPUR_GLOBAL_RULES_DIR: REPO_RULES_DIR },
        });
        expect(code).toBe(0);
        const fixture = readFileSync(join(fixtureDir, 'rule-validate-preset.json'), 'utf8');
        expect(out.text).toBe(fixture);
    }, 20000);

    test('agent list --json raw bytes equal toJson of the enveloped document data', async () => {
        delete process.env[ENVELOPE_ENV];
        const enveloped = captureSink();
        await main(['agent', 'list', '--json', '--json-envelope'], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-raw-')),
            output: enveloped,
        });
        const raw = captureSink();
        await main(['agent', 'list', '--json'], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-raw-')),
            output: raw,
        });
        expect(raw.text).toBe(toJson(JSON.parse(enveloped.text).data));
    }, 30000);

    test('agent doctor --json raw bytes equal toJson of the enveloped document data', async () => {
        delete process.env[ENVELOPE_ENV];
        const enveloped = captureSink();
        await main(['agent', 'doctor', '--json', '--json-envelope'], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-raw-')),
            output: enveloped,
        });
        const raw = captureSink();
        await main(['agent', 'doctor', '--json'], {
            cwd: mkdtempSync(join(tmpdir(), 'spur-raw-')),
            output: raw,
        });
        expect(raw.text).toBe(toJson(JSON.parse(enveloped.text).data));
    }, 30000);
});

// ── jsonEnvelope registration sweep (task 0697 AC4/R4) ──
// Every `.command()` block registering SHARED_OPTIONS.jsonEnvelope must either reference an
// envelope emitter, pass options.jsonEnvelope onward to a service, or be a documented
// delegated emitter whose verb has a row in docs/04_DESIGN.md §4.1. Default-deny: a new
// flag-registering verb that ignores the flag fails here instead of shipping silently.

describe('jsonEnvelope registration sweep (0697 AC4)', () => {
    const commandsDir = join(import.meta.dir, '..', 'src', 'commands');
    const modules = readdirSync(commandsDir)
        .filter((f) => f.endsWith('.ts') && f !== 'shared-options.ts')
        .map((f) => ({ file: f, src: readFileSync(join(commandsDir, f), 'utf8') }));

    /** Verbs whose action delegates to a helper/service that emits through the seam. */
    const DELEGATED_EMITTERS: Record<string, { helper: string; file: string }> = {
        'agent.ts:run': { helper: 'handleRunOutput', file: 'packages/app/src/services/agent-service.ts' },
        'agent.ts:create': { helper: 'runAgentCreate', file: 'apps/cli/src/commands/agent.ts' },
        'message.ts:inbox': { helper: 'runMessageInbox', file: 'apps/cli/src/commands/message.ts' },
        'message.ts:reply': { helper: 'runMessageReply', file: 'apps/cli/src/commands/message.ts' },
        'team.ts:status': { helper: 'runTeamStatus', file: 'apps/cli/src/commands/team.ts' },
        'team.ts:start': { helper: 'runTeamStart', file: 'apps/cli/src/commands/team.ts' },
        'team.ts:up': { helper: 'runTeamUp', file: 'apps/cli/src/commands/team.ts' },
        'team.ts:down': { helper: 'runTeamDown', file: 'apps/cli/src/commands/team.ts' },
    };

    const EMITTER_RE = /toEnvelopeJson|toEnvelopeError|writeJsonError/;

    function sweepTargets(): Array<{ key: string; chunk: string }> {
        const targets: Array<{ key: string; chunk: string }> = [];
        for (const { file, src } of modules) {
            const starts = [...src.matchAll(/\.command\(/g)].map((m) => m.index ?? 0);
            for (let i = 0; i < starts.length; i++) {
                const chunk = src.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : src.length);
                if (!chunk.includes('SHARED_OPTIONS.jsonEnvelope')) continue;
                const verb = /\.command\(\s*['"`]([^'"`]+)['"`]/.exec(chunk)?.[1] ?? '?';
                targets.push({ key: `${file}:${verb}`, chunk });
            }
        }
        return targets;
    }

    test('every flag-registering verb emits through the seam, threads the flag, or is documented delegated', () => {
        const targets = sweepTargets();
        expect(targets.length).toBeGreaterThan(50); // scan sanity: the sweep actually sees the surface
        const offenders: string[] = [];
        for (const { key, chunk } of targets) {
            const actionRegion = chunk.split('.action(', 2)[1] ?? '';
            const emits = EMITTER_RE.test(chunk);
            const threads = actionRegion.includes('jsonEnvelope');
            if (emits || threads) continue;
            const delegated = DELEGATED_EMITTERS[key];
            if (!delegated) {
                offenders.push(`${key} registers --json-envelope but neither emits, threads, nor is documented`);
                continue;
            }
            const delegateSrc = readFileSync(join(import.meta.dir, '..', '..', '..', delegated.file), 'utf8');
            if (!delegateSrc.includes(delegated.helper) || !EMITTER_RE.test(delegateSrc)) {
                offenders.push(`${key}: delegated emitter ${delegated.helper} not found emitting in ${delegated.file}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('delegated emitters carry a §4.1 inventory row', () => {
        const design = readFileSync(join(import.meta.dir, '..', '..', '..', 'docs', '04_DESIGN.md'), 'utf8');
        const missing = Object.keys(DELEGATED_EMITTERS).filter((key) => {
            const sep = key.indexOf(':');
            const noun = key.slice(0, sep).replace('.ts', '');
            const verb = key.slice(sep + 1);
            // First row of a noun block carries the emit-count suffix: `| team (6) | status |`.
            const row = new RegExp(`\\| ${noun}( \\(\\d+\\))? \\| ${verb} \\|`);
            return !row.test(design);
        });
        expect(missing).toEqual([]);
    });
});

// ── writeJsonError capability (task 0699 R2): code + details + prefix strip ──

function captureBoth(): CommandOutput & { out: string; err: string } {
    let out = '';
    let err = '';
    return {
        write(message: string): void {
            out += message;
        },
        error(message: string): void {
            err += message;
        },
        get out() {
            return out;
        },
        get err() {
            return err;
        },
    };
}

describe('writeJsonError code/details capability (0699 R2)', () => {
    test('default code stays INTERNAL_ERROR with no details', () => {
        const sink = captureBoth();
        process.env[ENVELOPE_ENV] = '1';
        try {
            writeJsonError(sink, { json: true }, 'boom');
            expect(JSON.parse(sink.out)).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } });
        } finally {
            delete process.env[ENVELOPE_ENV];
        }
    });

    test('explicit code and details pass through to the envelope', () => {
        const sink = captureBoth();
        process.env[ENVELOPE_ENV] = '1';
        try {
            writeJsonError(sink, { json: true }, 'Task 9999 not found', 'INTERNAL_ERROR', { cliCode: 'NOT_FOUND' });
            expect(JSON.parse(sink.out)).toEqual({
                ok: false,
                error: { code: 'INTERNAL_ERROR', message: 'Task 9999 not found', details: { cliCode: 'NOT_FOUND' } },
            });
        } finally {
            delete process.env[ENVELOPE_ENV];
        }
    });

    test('a leading "Error: " is stripped in the enveloped branch only', () => {
        const sink = captureBoth();
        process.env[ENVELOPE_ENV] = '1';
        try {
            writeJsonError(sink, { json: true }, 'Error: Task 9999 not found in any registered task folder');
            expect((JSON.parse(sink.out) as { error: { message: string } }).error.message).toBe(
                'Task 9999 not found in any registered task folder',
            );
        } finally {
            delete process.env[ENVELOPE_ENV];
        }
    });

    test('raw branch keeps the message byte-identical on stderr (AC4)', () => {
        const sink = captureBoth();
        writeJsonError(sink, { json: true }, 'Error: keep me as-is');
        expect(sink.out).toBe('');
        expect(sink.err).toBe('Error: keep me as-is');
    });
});

const API_ERROR_CODES = [
    'NOT_FOUND',
    'VALIDATION_FAILED',
    'GUARD_DENIED',
    'LOCK_TIMEOUT',
    'CONFLICT',
    'INTERNAL_ERROR',
] as const;

// ── honest failure surface end-to-end (task 0699 R1): a --json-envelope verb never
// prints {ok:true} on a non-zero exit and never exits non-zero with no JSON at all ──

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

const FAILURE_CASES: Array<{
    label: string;
    argv: string[];
    exit: number;
    code: string;
    cliCode?: string;
    viaEnv?: boolean;
}> = [
    { label: 'task check 9999 (not-found fall-through)', argv: ['task', 'check', '9999'], exit: 1, code: 'NOT_FOUND' },
    {
        label: 'feature check F999 (not-found fall-through)',
        argv: ['feature', 'check', 'F999'],
        exit: 1,
        code: 'NOT_FOUND',
    },
    { label: 'task path 9999', argv: ['task', 'path', '9999'], exit: 1, code: 'NOT_FOUND' },
    { label: 'task resolve /nope/nope.ts', argv: ['task', 'resolve', '/nope/nope.ts'], exit: 1, code: 'NOT_FOUND' },
    { label: 'feature show F999', argv: ['feature', 'show', 'F999'], exit: 1, code: 'NOT_FOUND' },
    {
        label: 'task show 9999 (cliCode collapse per ADR-091)',
        argv: ['task', 'show', '9999'],
        exit: 1,
        code: 'INTERNAL_ERROR',
        cliCode: 'NOT_FOUND',
    },
    { label: 'rule trace --last 0', argv: ['rule', 'trace', '--last', '0'], exit: 1, code: 'VALIDATION_FAILED' },
    { label: 'task check --as bogus', argv: ['task', 'check', '--as', 'bogus'], exit: 2, code: 'VALIDATION_FAILED' },
    {
        label: 'task check --fix --corpus',
        argv: ['task', 'check', '--fix', '--corpus'],
        exit: 2,
        code: 'VALIDATION_FAILED',
    },
    {
        label: 'workflow show missing file (env opt-in: verb declares --json only)',
        argv: ['workflow', 'show', 'nope-0699.yaml', '--json'],
        exit: 1,
        code: 'NOT_FOUND',
        viaEnv: true,
    },
    // 0699 R1 close-out: verbs whose failure paths were bare stderr until the sweep.
    { label: 'feature refresh with no scope', argv: ['feature', 'refresh'], exit: 2, code: 'VALIDATION_FAILED' },
    { label: 'feature sync with no id', argv: ['feature', 'sync'], exit: 2, code: 'VALIDATION_FAILED' },
    { label: 'task deps unknown op', argv: ['task', 'deps', '0693', 'bogus'], exit: 2, code: 'VALIDATION_FAILED' },
    {
        label: 'task sections unknown op',
        argv: ['task', 'sections', '0693', 'bogus'],
        exit: 2,
        code: 'VALIDATION_FAILED',
    },
    {
        label: 'workflow trace --poll below the floor',
        argv: ['workflow', 'trace', 'r1', '--poll', '0'],
        exit: 1,
        code: 'VALIDATION_FAILED',
    },
];

describe('enveloped failure surface is honest end-to-end (0699 R1/R2)', () => {
    for (const { label, argv, exit, code, cliCode, viaEnv } of FAILURE_CASES) {
        test(`${label}: {ok:false,error:{code,message}} on stdout, exit ${exit}`, async () => {
            delete process.env[ENVELOPE_ENV];
            if (viaEnv) process.env[ENVELOPE_ENV] = '1';
            try {
                const sink = captureBoth();
                const exitCode = await main([...argv, ...(viaEnv ? [] : ['--json', '--json-envelope'])], {
                    cwd: REPO_ROOT,
                    output: sink,
                });
                expect(exitCode).toBe(exit);
                const doc = JSON.parse(sink.out) as {
                    ok?: unknown;
                    error?: { code?: string; message?: string; details?: { cliCode?: string } };
                };
                expect(doc.ok).toBe(false); // never a success envelope on a failure path
                const emittedCode = doc.error?.code;
                expect(emittedCode).toBeDefined();
                expect(API_ERROR_CODES as readonly string[]).toContain(emittedCode as string);
                expect(emittedCode).toBe(code);
                expect(doc.error?.message).toBeTruthy();
                expect(doc.error?.message?.startsWith('Error: ') ?? false).toBe(false); // R2 prefix strip
                if (cliCode === undefined) {
                    expect(doc.error?.details).toBeUndefined();
                } else {
                    expect(doc.error?.details?.cliCode).toBe(cliCode);
                }
                expect(sink.err).toBe(''); // no bare stderr line standing in for the envelope
            } finally {
                delete process.env[ENVELOPE_ENV];
            }
        }, 30000);
    }

    test('raw --json failure path stays byte-identical: bare stderr, no envelope (AC4)', async () => {
        delete process.env[ENVELOPE_ENV];
        const sink = captureBoth();
        const exitCode = await main(['task', 'path', '9999', '--json'], { cwd: REPO_ROOT, output: sink });
        expect(exitCode).toBe(1);
        expect(sink.out).toBe('');
        expect(sink.err).toContain('Task 9999 not found');
    }, 30000);
});
