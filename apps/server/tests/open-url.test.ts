import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ProcessExecutor, ProcessResult } from '@gobing-ai/ts-runtime';
import { openUrl } from '../src/open-url';

function okResult(command: string, args: string[]): ProcessResult {
    return { command, args, exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
}

function mockExecutor(): {
    executor: ProcessExecutor;
    calls: { command: string; args: string[] }[];
} {
    const calls: { command: string; args: string[] }[] = [];
    const executor = {
        run: mock(async (options: { command: string; args?: string[] }) => {
            const args = options.args ?? [];
            calls.push({ command: options.command, args });
            return okResult(options.command, args);
        }),
        runStreaming: mock(() => {
            throw new Error('runStreaming not used by openUrl');
        }),
    } as unknown as ProcessExecutor;
    return { executor, calls };
}

const originalPlatform = process.platform;

afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('openUrl', () => {
    test('on darwin, runs `open <url>` via ProcessExecutor', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        const { executor, calls } = mockExecutor();
        await openUrl('http://localhost:9999', { executor });
        expect(calls).toEqual([{ command: 'open', args: ['http://localhost:9999'] }]);
    });

    test('on win32, runs `cmd /c start "" <url>`', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        const { executor, calls } = mockExecutor();
        await openUrl('http://localhost:9999', { executor });
        expect(calls).toEqual([{ command: 'cmd', args: ['/c', 'start', '', 'http://localhost:9999'] }]);
    });

    test('on linux, runs `xdg-open <url>`', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        const { executor, calls } = mockExecutor();
        await openUrl('http://localhost:9999', { executor });
        expect(calls).toEqual([{ command: 'xdg-open', args: ['http://localhost:9999'] }]);
    });

    test('exports as a function', () => {
        expect(typeof openUrl).toBe('function');
    });
});
