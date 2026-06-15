import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildFixedAgentExecCommand,
    type FixedAgentWrapperConfig,
    formatFixedAgentUsage,
    parseFixedAgentCliArgs,
    readPromptFromFile,
    runAcpxExec,
    runFixedAgentMain,
} from '../scripts/acpx_agent_wrapper';

const tempRoot = mkdtempSync(join(tmpdir(), 'anti-hallucination-acpx-wrapper-'));

function createMockAcpxScript(mode: 'pass' | 'fail' | 'error'): string {
    const path = join(tempRoot, `mock-acpx-${mode}.sh`);
    let body = '#!/bin/sh\n';

    if (mode === 'pass') {
        body +=
            "printf '%s\\n' 'According to the official documentation at https://api.example.com, the method is getUser(id: string): User. **Confidence**: HIGH. Source: https://api.example.com/docs'\n";
    } else if (mode === 'fail') {
        body +=
            "printf '%s\\n' 'The library API added a new method in version 3.1 without any cited source or confidence level.'\n";
    } else {
        body += "printf '%s\\n' 'acpx child failed' >&2\nexit 9\n";
    }

    writeFileSync(path, body, 'utf-8');
    chmodSync(path, 0o755);
    return path;
}

const config: FixedAgentWrapperConfig = {
    agent: 'codex',
    agentLabel: 'Codex',
    scriptName: 'run_codex_with_validation.ts',
};

function captureStreams<T>(fn: () => T): { result: T; stdout: string; stderr: string } {
    let stdout = '';
    let stderr = '';
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk: string | Uint8Array) => {
        stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
        stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        return true;
    }) as typeof process.stderr.write;

    try {
        return { result: fn(), stdout, stderr };
    } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
}

function withMockExit<T>(fn: () => T): T {
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
        throw new Error(`EXIT:${code ?? 0}`);
    }) as typeof process.exit;

    try {
        return fn();
    } finally {
        process.exit = originalExit;
    }
}

describe('acpx agent wrapper helpers', () => {
    afterEach(() => {
        Bun.env.ACPX_BIN = undefined;
    });

    it('parses positional prompt text', () => {
        expect(parseFixedAgentCliArgs(['summarize', 'this', 'repo'], config)).toEqual({
            acpxBin: 'acpx',
            prompt: 'summarize this repo',
        });
    });

    it('formats usage text', () => {
        const usage = formatFixedAgentUsage(config);
        expect(usage).toContain('run_codex_with_validation.ts');
        expect(usage).toContain('Run a one-shot Codex ACP exec command');
    });

    it('reads prompt text from stdin marker through injected reader', () => {
        const prompt = readPromptFromFile('-', (path, encoding) => {
            expect(path).toBe('/dev/stdin');
            expect(encoding).toBe('utf-8');
            return 'stdin prompt';
        });

        expect(prompt).toBe('stdin prompt');
    });

    it('uses ACPX_BIN override', () => {
        Bun.env.ACPX_BIN = '/tmp/mock-acpx';

        expect(parseFixedAgentCliArgs(['summarize this repo'], config)).toEqual({
            acpxBin: '/tmp/mock-acpx',
            prompt: 'summarize this repo',
        });
    });

    it('reads prompt text from a file', () => {
        const promptPath = join(tempRoot, 'prompt.txt');
        writeFileSync(promptPath, 'summarize this repo', 'utf-8');

        expect(parseFixedAgentCliArgs(['--file', promptPath], config)).toEqual({
            acpxBin: 'acpx',
            prompt: 'summarize this repo',
        });
    });

    it('builds the expected acpx exec command', () => {
        expect(
            buildFixedAgentExecCommand(
                {
                    acpxBin: 'acpx',
                    prompt: 'summarize this repo',
                },
                config,
            ),
        ).toEqual(['acpx', '--format', 'quiet', 'codex', 'exec', 'summarize this repo']);
    });

    it('runs the wrapped acpx command and captures stdout/stderr', () => {
        const result = runAcpxExec(['bun', '-e', "console.log('wrapped stdout'); console.error('wrapped stderr')"]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('wrapped stdout');
        expect(result.stderr).toContain('wrapped stderr');
    });

    it('shows help and exits with code 0', () => {
        expect(() =>
            withMockExit(() =>
                captureStreams(() => {
                    parseFixedAgentCliArgs(['--help'], config);
                }),
            ),
        ).toThrow('EXIT:0');
    });

    it('throws for missing prompt text', () => {
        expect(() => parseFixedAgentCliArgs([], config)).toThrow('Missing prompt text.');
    });
});

describe('runFixedAgentMain', () => {
    const passScript = createMockAcpxScript('pass');
    const failScript = createMockAcpxScript('fail');
    const errorScript = createMockAcpxScript('error');

    beforeEach(() => {
        Bun.env.ACPX_BIN = undefined;
    });

    afterEach(() => {
        Bun.env.ACPX_BIN = undefined;
    });

    it('passes through compliant agent output', () => {
        const stdoutPath = join(tempRoot, 'pass-stdout.txt');
        const stderrPath = join(tempRoot, 'pass-stderr.txt');
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalStderrWrite = process.stderr.write.bind(process.stderr);

        writeFileSync(stdoutPath, '', 'utf-8');
        writeFileSync(stderrPath, '', 'utf-8');

        process.stdout.write = ((chunk: string | Uint8Array) => {
            const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            writeFileSync(stdoutPath, readFileSync(stdoutPath, 'utf-8') + text, 'utf-8');
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: string | Uint8Array) => {
            const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            writeFileSync(stderrPath, readFileSync(stderrPath, 'utf-8') + text, 'utf-8');
            return true;
        }) as typeof process.stderr.write;

        try {
            const exitCode = runFixedAgentMain(
                {
                    ...config,
                    agent: 'codex',
                },
                ['--acpx-bin', passScript, 'summarize this repo'],
            );

            expect(exitCode).toBe(0);
            expect(readFileSync(stdoutPath, 'utf-8')).toContain('According to the official documentation');
        } finally {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }
    });

    it('blocks non-compliant agent output', () => {
        const stdoutPath = join(tempRoot, 'fail-stdout.txt');
        const stderrPath = join(tempRoot, 'fail-stderr.txt');
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalStderrWrite = process.stderr.write.bind(process.stderr);

        writeFileSync(stdoutPath, '', 'utf-8');
        writeFileSync(stderrPath, '', 'utf-8');

        process.stdout.write = ((chunk: string | Uint8Array) => {
            const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            writeFileSync(stdoutPath, readFileSync(stdoutPath, 'utf-8') + text, 'utf-8');
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: string | Uint8Array) => {
            const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            writeFileSync(stderrPath, readFileSync(stderrPath, 'utf-8') + text, 'utf-8');
            return true;
        }) as typeof process.stderr.write;

        try {
            const exitCode = runFixedAgentMain(config, ['--acpx-bin', failScript, 'summarize this repo']);

            expect(exitCode).toBe(1);
            expect(readFileSync(stdoutPath, 'utf-8')).toBe('');
            expect(readFileSync(stderrPath, 'utf-8')).toContain('"ok":false');
        } finally {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }
    });

    it('propagates acpx execution failures', () => {
        const stdoutPath = join(tempRoot, 'error-stdout.txt');
        const stderrPath = join(tempRoot, 'error-stderr.txt');
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalStderrWrite = process.stderr.write.bind(process.stderr);

        writeFileSync(stdoutPath, '', 'utf-8');
        writeFileSync(stderrPath, '', 'utf-8');

        process.stdout.write = ((chunk: string | Uint8Array) => {
            const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            writeFileSync(stdoutPath, readFileSync(stdoutPath, 'utf-8') + text, 'utf-8');
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: string | Uint8Array) => {
            const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
            writeFileSync(stderrPath, readFileSync(stderrPath, 'utf-8') + text, 'utf-8');
            return true;
        }) as typeof process.stderr.write;

        try {
            const exitCode = runFixedAgentMain(config, ['--acpx-bin', errorScript, 'summarize this repo']);

            expect(exitCode).toBe(9);
            expect(readFileSync(stderrPath, 'utf-8')).toContain('acpx child failed');
        } finally {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }
    });

    it('prints usage and returns 1 when argument parsing fails', () => {
        const { result, stderr } = captureStreams(() => runFixedAgentMain(config, []));

        expect(result).toBe(1);
        expect(stderr).toContain('Missing prompt text.');
        expect(stderr).toContain('Usage: run_codex_with_validation.ts');
    });
});

afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});
