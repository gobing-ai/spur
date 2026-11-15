import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessExecutor, ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import { A2aCliService, a2aMutationReason } from '../../src/services/a2a-member-transport';

class FakeProcess implements ProcessExecutor {
    readonly calls: ProcessOptions[] = [];
    constructor(
        public payload: unknown,
        private readonly options: { stdout?: string; stderr?: string; exitCode?: number } = {},
    ) {}
    async run(options: ProcessOptions): Promise<ProcessResult> {
        this.calls.push(options);
        return {
            command: options.command,
            args: options.args ?? [],
            stdout: this.options.stdout ?? JSON.stringify(this.payload),
            stderr: this.options.stderr ?? '',
            exitCode: this.options.exitCode ?? 0,
            outcome: 'success',
            durationMs: 1,
            startTime: '',
            endTime: '',
            failed: false,
            isCanceled: false,
            killed: false,
            timedOut: false,
            signal: undefined,
            signalDescription: undefined,
            cwd: options.cwd ?? '',
            env: options.env ?? {},
            stdio: [],
            ipc: false,
            serialized: '',
            piped: false,
            all: '',
            output: '',
        } as unknown as ProcessResult;
    }
    runStreaming(): never {
        throw new Error('not used');
    }
}

describe('1334 R8: the a2a credential reaches only the child environment', () => {
    test('card/send/get/cancel carry no token in argv, output or the helper file', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'a2a-cli-test-'));
        try {
            const process = new FakeProcess({ supportedInterfaces: [{ protocolVersion: '1.0' }] });
            const cli = new A2aCliService({
                cwd: dir,
                env: { REMOTE_TOKEN: 'very-secret' },
                process,
                chmod: async () => undefined,
            });
            const member = { instanceId: 'proj-remote', a2a: 'http://localhost:1234', authEnv: 'REMOTE_TOKEN' };
            await cli.card(member);
            for (const call of process.calls) {
                expect(call.args?.join(' ')).not.toContain('very-secret');
                expect(call.env?.SPUR_A2A_AUTH_VALUE).toBe('very-secret');
            }
            const helper = readFileSync(join(dir, '.spur/run/a2a-credential-helper'), 'utf8');
            expect(helper).not.toContain('very-secret');
            expect(helper).toContain('SPUR_A2A_AUTH_VALUE');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('send uses a caller messageId and returnImmediately (async) in one payload', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'a2a-cli-test-'));
        try {
            const process = new FakeProcess({ task: { id: 'task-1', contextId: 'ctx-1' } });
            const cli = new A2aCliService({ cwd: dir, env: {}, process, chmod: async () => undefined });
            await cli.send({ instanceId: 'proj-remote', a2a: './card.json' }, 'read only', 'request-key');
            const call = process.calls[0];
            const payloadArg = call?.args?.[call.args.indexOf('--request-payload') + 1];
            const payload = JSON.parse(payloadArg ?? '{}') as {
                message: { messageId: string };
                configuration: { returnImmediately: boolean };
            };
            expect(payload.message.messageId).toBe('request-key');
            expect(payload.configuration.returnImmediately).toBe(true);
            expect(call?.args).not.toContain('--async');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('1334: a2a CLI grammar and failure boundaries', () => {
    test('version parses the installed binary line and rejects an unknown shape', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'a2a-cli-test-'));
        try {
            const cli = new A2aCliService({
                cwd: dir,
                env: {},
                process: new FakeProcess(null, { stdout: 'a2a 0.4.0\ncommit: abc\n' }),
            });
            expect(await cli.version()).toBe('a2a 0.4.0');
            const bad = new A2aCliService({
                cwd: dir,
                env: {},
                process: new FakeProcess(null, { stdout: 'not a2a\n' }),
            });
            await expect(bad.version()).rejects.toThrow('unknown shape');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('task get projects state/status/artifact text and cancel uses the same adapter', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'a2a-cli-test-'));
        try {
            const process = new FakeProcess({
                task: {
                    id: 'task-1',
                    contextId: 'ctx-1',
                    status: { state: 'TASK_STATE_FAILED', message: { parts: [{ text: 'remote failed' }] } },
                    artifacts: [{ parts: [{ text: 'one' }] }, { parts: [{ text: 'two' }] }],
                },
            });
            const cli = new A2aCliService({ cwd: dir, env: {}, process });
            const member = { instanceId: 'proj-remote', a2a: './card.json' };
            expect(await cli.get(member, 'task-1')).toEqual({
                id: 'task-1',
                contextId: 'ctx-1',
                state: 'TASK_STATE_FAILED',
                statusMessage: 'remote failed',
                artifactText: 'one\ntwo',
            });
            await cli.cancel(member, 'task-1');
            expect(process.calls[1]?.args).toContain('cancel');
            process.payload = { task: { id: 'missing-status' } };
            await expect(cli.get(member, 'missing-status')).rejects.toThrow('unknown task shape');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('cardRef, card protocol and nonzero CLI output fail loudly and redact the credential', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'a2a-cli-test-'));
        try {
            const cli = new A2aCliService({
                cwd: dir,
                env: { REMOTE_TOKEN: 'very-secret' },
                process: new FakeProcess(null, { stdout: 'very-secret', stderr: 'bad very-secret', exitCode: 3 }),
                chmod: async () => undefined,
            });
            await expect(cli.card({ instanceId: 'proj-remote' })).rejects.toThrow('no a2a Agent Card');
            const member = { instanceId: 'proj-remote', a2a: './card.json', authEnv: 'REMOTE_TOKEN' };
            await expect(cli.card(member)).rejects.toThrow(/bad \[redacted\]/);
            const noProtocol = new A2aCliService({ cwd: dir, env: {}, process: new FakeProcess({}) });
            await expect(noProtocol.card({ instanceId: 'proj-remote', a2a: './card.json' })).rejects.toThrow(
                'no supported protocol version',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('read-only admission is null only when no mutating declaration is present', () => {
        expect(a2aMutationReason(undefined)).toBeNull();
        expect(a2aMutationReason({})).toBeNull();
        expect(a2aMutationReason({ expectFiles: [], ownedSections: [], requireDiff: false })).toBeNull();
        expect(a2aMutationReason({ expectFile: 'x' })).toContain('read-only');
        expect(a2aMutationReason({ expectFiles: ['x'] })).toContain('read-only');
        expect(a2aMutationReason({ ownedSections: ['Solution'] })).toContain('read-only');
        expect(a2aMutationReason({ requireDiff: true })).toContain('read-only');
    });

    test('the default chmod seam makes the credential helper executable without a direct fs import', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'a2a-cli-test-'));
        try {
            const process = new FakeProcess({ supportedInterfaces: [{ protocolVersion: '1.0' }] });
            const cli = new A2aCliService({ cwd: dir, env: { REMOTE_TOKEN: 'very-secret' }, process });
            await cli.card({ instanceId: 'proj-remote', a2a: './card.json', authEnv: 'REMOTE_TOKEN' });
            expect(process.calls[0]?.command).toBe('chmod');
            expect(process.calls[0]?.args).toEqual(['700', join(dir, '.spur/run/a2a-credential-helper')]);
            expect(process.calls[1]?.command).toBe('a2a');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
