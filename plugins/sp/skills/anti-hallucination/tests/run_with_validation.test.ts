import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import {
    extractResponseText,
    formatRunWithValidationUsage,
    main,
    parseCliArgs,
    runWrappedCommand,
} from '../scripts/run_with_validation';

const repoRoot = resolve(import.meta.dir, '../../../../..');
const wrapperScriptPath = join(repoRoot, 'plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts');

function runWrapper(args: string[]) {
    const result = Bun.spawnSync({
        cmd: ['bun', wrapperScriptPath, ...args],
        cwd: repoRoot,
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
    });

    return {
        exitCode: result.exitCode,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
    };
}

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

describe('extractResponseText', () => {
    it('returns stdout by default', () => {
        expect(extractResponseText('out', 'err', 'stdout')).toBe('out');
    });

    it('returns stderr when requested', () => {
        expect(extractResponseText('out', 'err', 'stderr')).toBe('err');
    });

    it('combines stdout and stderr when requested', () => {
        expect(extractResponseText('out', 'err', 'combined')).toBe('out\nerr');
    });
});

describe('parseCliArgs', () => {
    it('formats usage text', () => {
        const usage = formatRunWithValidationUsage();
        expect(usage).toContain('run_with_validation.ts');
        expect(usage).toContain('Wrap a non-hook, non-interactive agent command');
    });

    it('parses wrapped command after separator', () => {
        expect(parseCliArgs(['--', 'echo', 'hello'])).toEqual({
            source: 'stdout',
            command: ['echo', 'hello'],
        });
    });

    it('parses custom source mode', () => {
        expect(parseCliArgs(['--source', 'stderr', '--', 'echo', 'hello'])).toEqual({
            source: 'stderr',
            command: ['echo', 'hello'],
        });
    });

    it('parses command without explicit separator after wrapper options', () => {
        expect(parseCliArgs(['--source', 'combined', 'bun', '-e', 'console.log(1)'])).toEqual({
            source: 'combined',
            command: ['bun', '-e', 'console.log(1)'],
        });
    });

    it('parses inline source assignment', () => {
        expect(parseCliArgs(['--source=stderr', 'echo', 'hello'])).toEqual({
            source: 'stderr',
            command: ['echo', 'hello'],
        });
    });

    it('throws when source value is missing', () => {
        expect(() => parseCliArgs(['--source'])).toThrow('Missing value for --source.');
    });

    it('throws when command is missing', () => {
        expect(() => parseCliArgs([])).toThrow('Missing wrapped command. Pass it after -- or after wrapper options.');
    });

    it('throws when source value is invalid', () => {
        expect(() => parseCliArgs(['--source=invalid', 'echo', 'hello'])).toThrow('Invalid --source value: invalid');
    });

    it('shows help and exits with code 0', () => {
        expect(() =>
            withMockExit(() =>
                captureStreams(() => {
                    parseCliArgs(['--help']);
                }),
            ),
        ).toThrow('EXIT:0');
    });
});

describe('runWrappedCommand', () => {
    it('captures stdout and stderr from the wrapped command', () => {
        const result = runWrappedCommand([
            'bun',
            '-e',
            "console.log('wrapped stdout'); console.error('wrapped stderr')",
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('wrapped stdout');
        expect(result.stderr).toContain('wrapped stderr');
    });
});

describe('run_with_validation CLI', () => {
    it('direct main passes through compliant output', () => {
        const { result, stdout } = captureStreams(() =>
            main([
                '--',
                'bun',
                '-e',
                "console.log('According to the official documentation at https://api.example.com, the method is getUser(id: string): User. **Confidence**: HIGH. Source: https://api.example.com/docs')",
            ]),
        );

        expect(result).toBe(0);
        expect(stdout).toContain('According to the official documentation');
    });

    it('direct main blocks non-compliant output', () => {
        const { result, stdout, stderr } = captureStreams(() =>
            main([
                '--',
                'bun',
                '-e',
                "console.log('The library API added a new method in version 3.1 without any cited source or confidence level.')",
            ]),
        );

        expect(result).toBe(1);
        expect(stdout).toBe('');
        expect(stderr).toContain('"ok":false');
    });

    it('direct main propagates child command failures', () => {
        const { result, stderr } = captureStreams(() =>
            main(['--', 'bun', '-e', "console.error('child failed'); process.exit(7)"]),
        );

        expect(result).toBe(7);
        expect(stderr).toContain('child failed');
    });

    it('direct main prints usage when argument parsing fails', () => {
        const { result, stderr } = captureStreams(() => main(['--source']));

        expect(result).toBe(1);
        expect(stderr).toContain('Missing value for --source.');
        expect(stderr).toContain('Usage: run_with_validation.ts');
    });

    it('passes through compliant output', () => {
        const result = runWrapper([
            '--',
            'bun',
            '-e',
            "console.log('According to the official documentation at https://api.example.com, the method is getUser(id: string): User. **Confidence**: HIGH. Source: https://api.example.com/docs')",
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('According to the official documentation');
    });

    it('blocks non-compliant output', () => {
        const result = runWrapper([
            '--',
            'bun',
            '-e',
            "console.log('The library API added a new method in version 3.1 without any cited source or confidence level.')",
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('"ok":false');
    });

    it('propagates wrapped command failures', () => {
        const result = runWrapper(['--', 'bun', '-e', "console.error('child failed'); process.exit(7)"]);

        expect(result.exitCode).toBe(7);
        expect(result.stderr).toContain('child failed');
    });
});
