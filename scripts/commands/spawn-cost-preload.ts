/**
 * Spawn-cost preload — counts the child processes one test file spawns (task 1475 R1).
 *
 * A subprocess-lane file's wall time is dominated by the children it spawns (the `spur` CLI, `git`,
 * nested `bun`, `sh`), so the measurement wraps the entry points every spawn funnels through.
 * Bun's `node:child_process` is a shim over `Bun.spawn`/`Bun.spawnSync`, so patching the Bun
 * functions counts a shimmed spawn exactly once: the depth guard swallows the shim's inner call.
 *
 * One line is appended per child rather than one line per process: Bun's test runner exits without
 * emitting `process` exit events, so a flush-at-exit receipt would silently lose every count.
 *
 * Inert unless `SPUR_SPAWN_COST_OUT` is set, so the module is importable from the driver's tests.
 * The driver (`test-lanes --spawn-cost`) sets it per file and tallies the appended lines.
 */
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getEnvVar } from '@gobing-ai/spur-config';

/** Child buckets the receipt separates. */
export type SpawnKind = 'spur-cli' | 'git' | 'bun' | 'sh' | 'other';

/** Per-kind child counts for one measured file. */
export type SpawnCounts = Record<SpawnKind, number>;

/** Every bucket, in receipt order. */
export const SPAWN_KINDS: readonly SpawnKind[] = ['spur-cli', 'git', 'bun', 'sh', 'other'];

/** Shell executables that count as the `sh` bucket rather than `other`. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);

/** A zeroed counter. */
export function emptySpawnCounts(): SpawnCounts {
    return { 'spur-cli': 0, git: 0, bun: 0, sh: 0, other: 0 };
}

/**
 * Tallies per-kind lines appended by this preload.
 *
 * @param lines - The `{kind}` records read from the receipt file, unparseable rows included.
 * @returns Per-kind counts; unknown kinds count as `other`.
 */
export function tallySpawnLines(lines: readonly string[]): SpawnCounts {
    const counts = emptySpawnCounts();
    for (const line of lines) {
        if (line.trim() === '') continue;
        let kind: SpawnKind = 'other';
        try {
            const parsed = JSON.parse(line) as { kind?: SpawnKind };
            kind = SPAWN_KINDS.find((candidate) => candidate === parsed.kind) ?? 'other';
        } catch {
            kind = 'other';
        }
        counts[kind] += 1;
    }
    return counts;
}

/**
 * Buckets a child's argv.
 *
 * The CLI bucket is matched before the executable bucket: a `bun run apps/cli/src/index.ts` child is
 * a CLI spawn, not a `bun` one, and that is the spawn the conversions target.
 *
 * @param parts - The child's argv (or a shell template's strings).
 * @returns The bucket this child counts under.
 */
export function classifySpawnKind(parts: readonly unknown[]): SpawnKind {
    const argv = parts.map((part) => String(part));
    const joined = argv.join(' ');
    if (
        joined.includes('apps/cli/src/index.ts') ||
        joined.includes('spur.js') ||
        /(^|\s)\S*\/spur(\s|$)/.test(joined)
    ) {
        return 'spur-cli';
    }
    const executable = basename(argv[0] ?? '');
    if (executable === 'git') return 'git';
    if (executable === 'bun' || argv[0] === process.execPath) return 'bun';
    if (SHELLS.has(executable)) return 'sh';
    return 'other';
}

/** Reads the argv out of a `Bun.spawn`/`Bun.spawnSync` first argument. */
function spawnArgv(first: unknown): readonly unknown[] {
    if (Array.isArray(first)) return first;
    const cmd = (first as { cmd?: unknown } | undefined)?.cmd;
    return Array.isArray(cmd) ? cmd : [];
}

/**
 * Installs the counting wrappers; each counted child appends one `{kind}` line to the receipt.
 *
 * A no-op without `SPUR_SPAWN_COST_OUT`: importing this module from a normal test run must not touch
 * the spawn surface.
 */
export function installSpawnCostCounter(): void {
    const out = getEnvVar('SPUR_SPAWN_COST_OUT');
    if (out === undefined || out === '') return;
    let depth = 0;
    const record = (argv: readonly unknown[]): void => {
        if (depth > 0) return;
        appendFileSync(out, `${JSON.stringify({ kind: classifySpawnKind(argv) })}\n`);
    };
    const guard = <T>(run: () => T): T => {
        depth++;
        try {
            return run();
        } finally {
            depth--;
        }
    };
    const spawn = Bun.spawn;
    Bun.spawn = ((...args: never[]) => {
        record(spawnArgv((args as unknown[])[0]));
        return guard(() => (spawn as unknown as (...inner: never[]) => unknown)(...args));
    }) as typeof Bun.spawn;
    const spawnSync = Bun.spawnSync;
    Bun.spawnSync = ((...args: never[]) => {
        record(spawnArgv((args as unknown[])[0]));
        return guard(() => (spawnSync as unknown as (...inner: never[]) => unknown)(...args));
    }) as typeof Bun.spawnSync;
    const shell = Bun.$;
    const callShell = shell as unknown as (
        strings: TemplateStringsArray,
        ...values: unknown[]
    ) => ReturnType<typeof shell>;
    Bun.$ = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
        record([...strings, ...values]);
        return callShell(strings, ...values);
    }, shell) as typeof Bun.$;
}

installSpawnCostCounter();
