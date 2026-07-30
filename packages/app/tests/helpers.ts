/**
 * Per-workspace test helpers for `@gobing-ai/spur-app` (design §13, H05).
 *
 * Re-exports the domain temp-project and DB factories so app tests share the
 * same substrate, plus a canonical output sink and bare temp-dir helper.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb as createMigratedDbImpl, type DbAdapter } from '@gobing-ai/spur-domain';

// ─── Re-exported domain factories (R1, R3 shared substrate) ─────────────

export {
    createTempProject,
    makeFeatureFile,
    makeFeatureFrontmatter,
    makeTaskFile,
    makeTaskFrontmatter,
    type TempProject,
} from '@gobing-ai/spur-domain/tests/helpers';

/**
 * Create a fresh in-memory SQLite adapter with CLI migrations applied.
 *
 * Thin pass-through to the domain's canonical `createMigratedDb`. Each call
 * yields an independent database — callers own closing the adapter.
 */
export async function createMigratedDb(url = ':memory:'): Promise<DbAdapter> {
    return createMigratedDbImpl({ url });
}

/**
 * Bare temp-dir helper with a `spur-app-` prefix.
 *
 * For tests that need a throwaway directory without the full project scaffold.
 */
export async function makeTempDir(prefix = 'spur-app-'): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
}

// ─── Output sinks ───────────────────────────────────────────────────────

/** Minimal output sink shape used by all app services. */
export interface AppOutput {
    write(message: string): void;
    error(message: string): void;
}

/** A null output sink that discards all writes. */
export function nullOutput(): AppOutput {
    return { write: () => {}, error: () => {} };
}

/** Captured output sink that stores writes for assertions. */
export interface CapturedOutput extends AppOutput {
    messages: string[];
    errors: string[];
}

/** Create an output sink that records all writes for later assertions. */
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

// ─── Bun.spawn isolation ────────────────────────────────────────────────

/**
 * Minimal handle for a mocked detached `spur serve` spawn.
 *
 * `exitCode: null` means "still running" so startRegisteredProject's health
 * poll can succeed against a pre-opened test port without a real serve.
 */
export interface MockServeChild {
    exitCode: number | null;
    unref: () => void;
    pid: number;
    exited: Promise<number | null>;
}

/**
 * Install a Bun.spawn mock that intercepts only `spur serve …` argv and
 * delegates every other spawn to the real implementation.
 *
 * **Why passthrough is mandatory:** on Bun, `execa` (used by ProcessExecutor)
 * is implemented via `Bun.spawn`. A total stub returning `{ exitCode: null,
 * unref() {} }` hangs or null-exits concurrent workflow shell / agent / rule
 * tests across files. Only the serve-start path needs to be fake.
 *
 * @param serveExitCode - Exit code the fake serve child reports (`null` = still live).
 * @returns Restore function; call from `finally`.
 */
export function installServeSpawnMock(serveExitCode: number | null = null): () => void {
    const original = Bun.spawn;
    const fakeChild: MockServeChild = {
        exitCode: serveExitCode,
        unref: () => {},
        pid: 0,
        exited: Promise.resolve(serveExitCode),
    };

    // Bun.spawn has two call shapes: array argv, and options-object (execa).
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
