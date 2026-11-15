import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessExecutor, ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import { A2aCliService } from '../../src/services/a2a-member-transport';

class FakeProcess implements ProcessExecutor {
    readonly calls: ProcessOptions[] = [];
    constructor(private readonly payload: unknown) {}
    async run(options: ProcessOptions): Promise<ProcessResult> {
        this.calls.push(options);
        return {
            command: options.command,
            args: options.args ?? [],
            stdout: JSON.stringify(this.payload),
            stderr: '',
            exitCode: 0,
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
            const cli = new A2aCliService({ cwd: dir, env: {}, process });
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
