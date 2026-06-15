#!/usr/bin/env bun

import { validateResponseText } from './validate_response';

type ResponseSource = 'stdout' | 'stderr' | 'combined';

interface WrapperOptions {
    source: ResponseSource;
    command: string[];
}

export function extractResponseText(stdout: string, stderr: string, source: ResponseSource): string {
    switch (source) {
        case 'stderr':
            return stderr;
        case 'combined':
            return [stdout, stderr].filter((part) => part.length > 0).join('\n');
        default:
            return stdout;
    }
}

export function formatRunWithValidationUsage(): string {
    return `Usage: run_with_validation.ts [--source stdout|stderr|combined] -- <command> [args...]

Wrap a non-hook, non-interactive agent command and validate its final response.

Examples:
  bun plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts -- your-agent-cli --prompt "..."
  bun plugins/sp/skills/anti-hallucination/scripts/run_with_validation.ts --source stderr -- your-agent-cli ...
`;
}

function printUsage(): void {
    process.stderr.write(formatRunWithValidationUsage());
}

export function parseCliArgs(argv: string[]): WrapperOptions {
    let source: ResponseSource = 'stdout';
    const command: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--') {
            command.push(...argv.slice(i + 1));
            break;
        }

        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }

        if (arg === '--source' || arg === '-s') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('Missing value for --source.');
            }
            source = value as ResponseSource;
            i++;
            continue;
        }

        if (arg.startsWith('--source=')) {
            source = arg.slice('--source='.length) as ResponseSource;
            continue;
        }

        command.push(...argv.slice(i));
        break;
    }

    if (command.length === 0) {
        throw new Error('Missing wrapped command. Pass it after -- or after wrapper options.');
    }

    if (source !== 'stdout' && source !== 'stderr' && source !== 'combined') {
        throw new Error(`Invalid --source value: ${source}`);
    }

    return { source, command };
}

export function runWrappedCommand(command: string[]): {
    exitCode: number;
    stdout: string;
    stderr: string;
} {
    const result = Bun.spawnSync({
        cmd: command,
        cwd: process.cwd(),
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

export function main(argv = process.argv.slice(2)): number {
    let options: WrapperOptions;
    try {
        options = parseCliArgs(argv);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        printUsage();
        return 1;
    }

    const wrapped = runWrappedCommand(options.command);

    if (wrapped.exitCode !== 0) {
        if (wrapped.stdout.length > 0) {
            process.stdout.write(wrapped.stdout);
        }
        if (wrapped.stderr.length > 0) {
            process.stderr.write(wrapped.stderr);
        }
        return wrapped.exitCode;
    }

    const responseText = extractResponseText(wrapped.stdout, wrapped.stderr, options.source);
    const validation = validateResponseText(responseText);

    if (!validation.ok) {
        process.stderr.write(`${JSON.stringify(validation)}\n`);
        return 1;
    }

    if (wrapped.stdout.length > 0) {
        process.stdout.write(wrapped.stdout);
    }
    if (wrapped.stderr.length > 0) {
        process.stderr.write(wrapped.stderr);
    }

    return 0;
}

if (import.meta.main) {
    process.exit(main());
}
