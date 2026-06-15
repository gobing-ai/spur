import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { validateResponseText } from './validate_response';

export interface FixedAgentWrapperConfig {
    agent: string;
    agentLabel: string;
    scriptName: string;
}

export interface FixedAgentWrapperOptions {
    acpxBin: string;
    prompt: string;
}

type ReadTextFile = (path: string, encoding: 'utf-8') => string;

export function formatFixedAgentUsage(config: FixedAgentWrapperConfig): string {
    return `Usage: ${config.scriptName} [--acpx-bin <path>] [--file <path>|-] [prompt]

Run a one-shot ${config.agentLabel} ACP exec command and validate the final answer.

Examples:
  bun plugins/sp/skills/anti-hallucination/scripts/${config.scriptName} "summarize this repo"
  bun plugins/sp/skills/anti-hallucination/scripts/${config.scriptName} --file prompt.txt
  printf '%s\n' "summarize this repo" | bun plugins/sp/skills/anti-hallucination/scripts/${config.scriptName} --file -
`;
}

function printUsage(config: FixedAgentWrapperConfig): void {
    process.stderr.write(formatFixedAgentUsage(config));
}

export function readPromptFromFile(path: string, readTextFile: ReadTextFile = readFileSync): string {
    if (path === '-') {
        return readTextFile('/dev/stdin', 'utf-8');
    }

    return readTextFile(path, 'utf-8');
}

export function parseFixedAgentCliArgs(argv: string[], config: FixedAgentWrapperConfig): FixedAgentWrapperOptions {
    const parsed = parseArgs({
        args: argv,
        options: {
            'acpx-bin': {
                type: 'string',
            },
            file: {
                type: 'string',
                short: 'f',
            },
            help: {
                type: 'boolean',
                short: 'h',
            },
        },
        allowPositionals: true,
        strict: true,
    });

    if (parsed.values.help) {
        printUsage(config);
        process.exit(0);
    }

    const acpxBin = parsed.values['acpx-bin'] ?? Bun.env.ACPX_BIN ?? 'acpx';
    const filePath = parsed.values.file;
    const positionalPrompt = parsed.positionals.join(' ').trim();
    const prompt = filePath ? readPromptFromFile(filePath).trim() : positionalPrompt;

    if (prompt.length === 0) {
        throw new Error('Missing prompt text.');
    }

    return {
        acpxBin,
        prompt,
    };
}

export function buildFixedAgentExecCommand(
    options: FixedAgentWrapperOptions,
    config: FixedAgentWrapperConfig,
): string[] {
    return [options.acpxBin, '--format', 'quiet', config.agent, 'exec', options.prompt];
}

export function runAcpxExec(command: string[]): {
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

export function runFixedAgentMain(config: FixedAgentWrapperConfig, argv = process.argv.slice(2)): number {
    let options: FixedAgentWrapperOptions;
    try {
        options = parseFixedAgentCliArgs(argv, config);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        printUsage(config);
        return 1;
    }

    const wrapped = runAcpxExec(buildFixedAgentExecCommand(options, config));

    if (wrapped.exitCode !== 0) {
        if (wrapped.stdout.length > 0) {
            process.stdout.write(wrapped.stdout);
        }
        if (wrapped.stderr.length > 0) {
            process.stderr.write(wrapped.stderr);
        }
        return wrapped.exitCode;
    }

    const validation = validateResponseText(wrapped.stdout);
    if (!validation.ok) {
        process.stderr.write(`${JSON.stringify(validation)}\n`);
        return 1;
    }

    process.stdout.write(wrapped.stdout);
    return 0;
}
