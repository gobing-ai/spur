import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandOutput } from '../src/output';

/** Captured command output for CLI tests. */
export interface CapturedOutput extends CommandOutput {
    messages: string[];
    errors: string[];
}

/** Create a temporary project directory with a package manifest. */
export async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-'));
    await Bun.write(join(dir, 'package.json'), `${JSON.stringify({ name: 'fixture', type: 'module' }, null, 2)}\n`);
    return dir;
}

/** Create a temporary project directory with only a .spur config (no package manifest). */
export async function createTempProjectStackNeutral(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-'));
    // Intentionally NO package.json — Spur is stack-neutral.
    return dir;
}

/** Create an output sink that stores writes for assertions. */
export function createCapturedOutput(): CapturedOutput {
    return {
        messages: [],
        errors: [],
        write(message: string): void {
            this.messages.push(message);
        },
        error(message: string): void {
            this.errors.push(message);
        },
    };
}

/**
 * Install a Bun.spawn mock that fakes only `spur serve …` and passthroughs
 * everything else. On Bun, execa uses Bun.spawn — a total stub breaks concurrent
 * ProcessExecutor tests (workflow shell, agent, rules) with exitCode null.
 *
 * @param serveExitCode - Fake serve child's exitCode (`null` = still running).
 * @returns Restore function for `finally`.
 */
export function installServeSpawnMock(serveExitCode: number | null = null): () => void {
    const original = Bun.spawn;
    const fakeChild = {
        exitCode: serveExitCode,
        unref: () => {},
        pid: 0,
        exited: Promise.resolve(serveExitCode),
    };
    Bun.spawn = ((first: unknown, second?: unknown) => {
        if (Array.isArray(first) && first.map(String).includes('serve')) {
            return fakeChild;
        }
        return (original as (...args: unknown[]) => unknown)(first, second);
    }) as typeof Bun.spawn;
    return () => {
        Bun.spawn = original;
    };
}

/** Result of a subprocess CLI invocation. */
export interface CliResult {
    /** Process exit code. `null` when the process was killed by a signal. */
    code: number | null;
    /** stdout captured as a UTF-8 string. */
    stdout: string;
    /** stderr captured as a UTF-8 string. */
    stderr: string;
    /** Parsed JSON object when stdout is valid JSON, otherwise `undefined`. */
    json?: unknown;
}

/**
 * Run the Spur CLI as a subprocess (verb-level integration, R4).
 *
 * Spawns `bun run apps/cli/src/index.ts` so the test exercises the real entry
 * point, argument parsing, and process lifecycle. When `--json` is present in
 * `args` and stdout parses as JSON, the parsed object is returned as
 * `result.json`.
 *
 * For most command tests, prefer the in-process `main()` helper — it is
 * faster and already covers dispatch. Use `runCli` when subprocess isolation
 * or real process exit codes are required.
 */
export async function runCli(args: string[], cwd?: string): Promise<CliResult> {
    const entryPath = join(import.meta.dir, '..', 'src', 'index.ts');
    const proc = Bun.spawn({
        cmd: ['bun', 'run', entryPath, ...args],
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    const result: CliResult = { code, stdout, stderr };
    if (args.includes('--json')) {
        try {
            result.json = JSON.parse(stdout);
        } catch {
            // stdout was not valid JSON despite --json — leave json undefined.
        }
    }
    return result;
}
