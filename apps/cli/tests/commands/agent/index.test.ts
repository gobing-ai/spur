/**
 * Comprehensive tests for apps/cli/src/commands/agent.ts.
 */
import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { _resetAgentServiceShimsForTest } from '@gobing-ai/spur-app';
import { AgentDetector } from '@gobing-ai/ts-ai-runner';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';

/**
 * CLI-spawning / fingerprint tests: `agent doctor` measures ~1.5s on a quiet host and 7-8s while
 * the agent fleet runs, against bun's 5000ms default — the calibration is recorded here once.
 */
const slowTest = (name: string, fn: () => Promise<void> | void): void => void test(name, fn, 30_000);

function captureOutput(): CommandOutput & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        stdout,
        stderr,
        write: (msg: string) => {
            stdout.push(msg);
        },
        error: (msg: string) => {
            stderr.push(msg);
        },
    };
}

// Warn-once shim markers are process-global; bun batches test files per worker
// process, so never inherit another file's marker state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

describe('agent command (main)', () => {
    test('unknown subcommand returns 1', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'unknown-cmd'], { output });
        expect(exitCode).toBe(1);
    });

    slowTest('list renders detected agent state through the CLI JSON action', async () => {
        // Installation probes have separate detector coverage. This command
        // fixture must not depend on every coding agent installed on the host.
        const agents = [{ name: 'claude' as const, installed: true, version: '1.0.0', channels: [], error: null }];
        const detect = spyOn(AgentDetector.prototype, 'detectAll').mockResolvedValue(agents);
        const output = captureOutput();
        try {
            const exitCode = await main(['agent', 'list', '--json'], { output });
            expect(exitCode).toBe(0);
            expect(JSON.parse(output.stdout.join(''))).toEqual({ agents });
            expect(detect).toHaveBeenCalledTimes(1);
        } finally {
            detect.mockRestore();
        }
    });
});
