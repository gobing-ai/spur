#!/usr/bin/env bun
/**
 * inline-run-setup — authoritative inline full-pipeline run identity (task 0804 R1).
 *
 * Unlike the subprocess path (`spur workflow run`), the interactive inline driver
 * allocated a run id but never persisted an authoritative `runs` row, so bound
 * `run.artifact` registration (0785 R3) correctly refused every inline record. This
 * script is the thin delegate the driver now runs at Run setup: it loads the source
 * app service when the SPUR_BIN chain identifies a checkout, otherwise its generated bundle
 * (`createOrAttachInlineRun` / `openInlineRunProjectDb` from packages/app), and lets it
 * resolve the SAME project/registered/shared definition the engine would launch, compute the
 * canonical definition digest with the exported hash machinery, and create-or-attach the
 * run row through the existing engine persistence adapter.
 *
 * The script itself contains NO direct SQL, NO second hasher and NO persistence policy —
 * every rule lives in packages/app (0804 D1). On a bundle-only install, the existing
 * workflow-show projection selects the CLI's definition; the bundled app revalidates its
 * schema and digest before recording the selected layer. It never creates an unbound run.
 *
 * The setup outcome is written into the two-file run record (task 0927 R1) — machine state
 * at `.spur/run/<run-id>.state.json` (atomic replace) plus the `.spur/run/<run-id>.md`
 * run-start header — so the driver can seed the inline var overlay (`__runId`,
 * `__definitionDigest`) that proof capture and bound registration verify against. The
 * pre-0927 `<run-id>-inline-setup.json` sidecar is no longer written. Exit 0 = authoritative
 * identity ready (created or idempotently attached); exit 1 = fail closed, the driver must stop.
 *
 * Standard script (ADR-065): the generated Node-runnable twin re-enters Bun for the
 * existing SQLite runtime. Bun on PATH is required; a monorepo checkout is not.
 *
 * Usage:
 *   bun plugins/sp/scripts/inline-run-setup.ts --run-id <id> --file <definition> [--spur-bin <path>]
 *   bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <path> [--feature-file <path>] [--spur-bin <path>]
 *   bun plugins/sp/scripts/inline-run-setup.ts --action --run-id <id> --node <state> --kind <kind> \
 *   bun plugins/sp/scripts/inline-run-setup.ts --decide --run-id <id> --node <state> --options-json <file> [--spur-bin <path>]
 *       --status <done|failed> --ok <true|false> --duration-ms <n> [--spur-bin <path>]
 *   bun plugins/sp/scripts/inline-run-setup.ts --close --run-id <id> --status <done|failed|paused> [--reason <terminal-reason>] [--spur-bin <path>]
 *
 * The `--fingerprint` mode prints the engine's proof-input digest for the given spec files and
 * creates nothing (task 0862 R5).
 *
 * The `--action` / `--close` modes are the inline driver's ADR-117 emission boundary (task
 * 0868): `--action` records one completed action boundary as an `action_runs` row through the
 * shared `WorkflowActionTraceWriter`, `--close` marks the run row terminal through the same
 * writer. `--action` is best-effort: a persistence failure is appended to
 * `.spur/run/<run-id>.md` and the script still exits 0 with `{"ok":false}` on stdout, so
 * observation never wedges the run. `--close` is NOT best-effort: the run-row closure is
 * bookkeeping, so a missing run row or a persistence failure exits 1 with a named error.
 * The `--decide` mode (task 0941 R5) executes the non-pausing decide action through the SAME
 * app runner the engine registers (`runDecideForInlineRun`), writing the same resultFile row
 * and recording the same `action_runs` trace row (`kind=decide`, best-effort). A degraded
 * decision is still `ok: true` — the run continues — so exit 0 covers every model-level
 * outcome; only an invalid options schema exits 1 (fail closed).
 *
 * Exit 2 is reserved for usage errors.
 *
 * Env: SPUR_BIN
 */

import { spawnSync } from 'node:child_process';
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getEnvVar } from '../lib/env';

/** Setup outcome projected into the run-record state `.spur/run/<run-id>.state.json` (0927 R1). */
interface SetupOutcome {
    readonly ok: boolean;
    readonly runId: string;
    readonly attached?: boolean;
    readonly definitionDigest?: string;
    readonly workflowName?: string;
    readonly workflowVersion?: string | null;
    readonly resolvedPath?: string;
    readonly layer?: string;
    readonly workdir?: string;
    readonly status?: string;
    readonly error?: string;
}

function usage(): never {
    console.error(
        'Usage: bun plugins/sp/scripts/inline-run-setup.ts --run-id <id> --file <definition> [--spur-bin <path>]',
    );
    console.error(
        '       bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <path> [--feature-file <path>] [--spur-bin <path>]',
    );
    console.error(
        '       bun plugins/sp/scripts/inline-run-setup.ts --action --run-id <id> --node <state> --kind <kind> ' +
            '--status <done|failed> --ok <true|false> --duration-ms <n> [--spur-bin <path>]',
    );
    console.error(
        '       bun plugins/sp/scripts/inline-run-setup.ts --close --run-id <id> --status <done|failed|paused> [--reason <terminal-reason>] [--spur-bin <path>]',
    );
    console.error(
        '       bun plugins/sp/scripts/inline-run-setup.ts --decide --run-id <id> --node <state> --options-json <file> [--spur-bin <path>]',
    );
    process.exit(2);
}

/**
 * The run id becomes filenames under `.spur/run/` (`<run-id>.state.json` + `<run-id>.md`),
 * so it must be a single safe filename component before anything is written — the same guard class the
 * task-pipeline.yaml route-reason action applies to `$__runId` (task 0804 R8). The allowlist
 * refuses path separators, dot traversal (leading `.`), unresolved interpolation (`$`/`{`/`}`) and
 * every other shell/unspecified metachar; valid UUID/timestamp-slug ids pass.
 */
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function refuseUnsafeRunId(runId: string): never {
    // Refuse BEFORE any outcome write: an unsafe id must never reach
    // `.spur/run/<run-id>.state.json` / `.md` (no traversal, no unintended file).
    console.error(`inline-run-setup: refusing unsafe run id: ${runId}`);
    console.error(
        '  The run id must be a single safe filename component (alphanumeric/._-, no leading dot, ' +
            'no path separators, interpolation or traversal; same class as the task-pipeline ' +
            'route-reason guard, task 0804 R8). Allocate a fresh run id (uuid or timestamp slug) and retry.',
    );
    process.exit(1);
}

/**
 * Resolve the spur repo checkout the same way the other prechecks resolve the CLI
 * (--spur-bin > SPUR_BIN > monorepo-local CLI entry > PATH `spur`), then derive the repo
 * root from the resolved main module. `bun <repo>/apps/cli/src/index.ts` → repo root is
 * three levels up. A bundle-only install (`spur` on PATH, a bundled `spur.js`, or a spur
 * binary without the app workspace) uses the adjacent generated application bundle.
 */
function resolveAppEntry(spurBin: string): { entry: string; portable: boolean } {
    let candidates: string[] = [];
    if (spurBin !== '') {
        candidates = [spurBin];
    } else {
        // scripts/ -> plugins/sp/ -> <repo>/apps/cli/src/index.ts (fileURLToPath — raw
        // pathname breaks on %-encoded paths, e.g. spaces in the checkout directory).
        candidates = [fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url))];
    }
    for (const candidate of candidates) {
        const tokens = candidate.split(/\s+/).filter(Boolean);
        // The main module is the last path-like token (tolerates `bun <path>` /
        // `bun run <path>` lead tokens). Only a TypeScript source entry proves a repo
        // checkout; a bundled `spur.js` or a bare `spur` binary does not.
        const mainModule = [...tokens].reverse().find((t) => t.endsWith('.ts'));
        if (mainModule === undefined || !existsSync(mainModule)) continue;
        // <repo>/apps/cli/src/index.ts → repo root; then require the app package source.
        const srcDir = dirname(mainModule);
        const repoRoot = resolve(srcDir, '..', '..', '..');
        const appEntry = join(repoRoot, 'packages', 'app', 'src', 'index.ts');
        if (existsSync(appEntry)) return { entry: appEntry, portable: false };
    }
    const entry = fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url));
    if (!existsSync(entry)) {
        throw new Error('inline application bundle is missing — rebuild/install the sp plugin before running inline');
    }
    return { entry, portable: true };
}

/** Let the selected CLI own config and layer resolution, then revalidate its snapshot in the app. */
async function readInstalledInventory(file: string, spurBin: string): Promise<unknown> {
    const localCli = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url));
    const bundle = fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url));
    const { splitLaunchCommand } = (await import(bundle)) as typeof import('../lib/inline-run.generated.mjs');
    const launch = spurBin
        ? splitLaunchCommand(spurBin, 'inline-run-setup "spurBin"')
        : existsSync(localCli)
          ? { command: 'bun', leadingArgs: [localCli] }
          : { command: 'spur', leadingArgs: [] };
    if ('error' in launch) throw new Error(launch.error);
    const result = spawnSync(
        launch.command,
        [...launch.leadingArgs, 'workflow', 'show', file, '--format', 'todo', '--json'],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (result.status !== 0) {
        throw new Error(
            `could not resolve the workflow definition with the installed CLI: ${result.error?.message ?? result.stderr}`,
        );
    }
    const value: unknown = JSON.parse(result.stdout);
    // Honor the existing optional JSON envelope without inventing another projection format.
    if (value && typeof value === 'object' && 'ok' in value && 'data' in value && value.ok === true) {
        return value.data;
    }
    return value;
}

/**
 * Project the setup outcome into the two-file run record (task 0927 R1): the machine state
 * merges into `.spur/run/<run-id>.state.json` (atomic same-directory temp + rename, the
 * 0925 R1 pattern) and `.spur/run/<run-id>.md` receives its run-start header exactly once.
 * A re-setup of the same run id rewrites the state from the current outcome but keeps the
 * prior `startedAt` instead of resurrecting setup time. Identity/provenance fields only —
 * never prompt bodies — so the record carries no secret-bearing content by construction
 * (0927 AC2). The retired `<run-id>-inline-setup.json` sidecar is not written (0927 R4);
 * its readers were migrated to the pair state in the same change.
 */
function writeOutcome(runId: string, outcome: SetupOutcome): void {
    const runDir = join(process.cwd(), '.spur', 'run');
    if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
    const statePath = join(runDir, `${runId}.state.json`);
    const markdownPath = join(runDir, `${runId}.md`);
    let prior: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(readFileSync(statePath, 'utf8'));
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            prior = parsed as Record<string, unknown>;
        }
    } catch {
        // No prior state (new run) or unreadable file — the outcome alone defines the state.
    }
    const at = new Date().toISOString();
    const state = {
        schemaVersion: 1 as const,
        runId,
        ...(outcome.workflowName !== undefined ? { workflowName: outcome.workflowName } : {}),
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        startedAt: typeof prior.startedAt === 'string' ? prior.startedAt : at,
        updatedAt: at,
        ...(outcome.attached !== undefined ? { attached: outcome.attached } : {}),
        ...(outcome.definitionDigest !== undefined ? { definitionDigest: outcome.definitionDigest } : {}),
        ...(outcome.workflowVersion !== undefined ? { workflowVersion: outcome.workflowVersion } : {}),
        ...(outcome.resolvedPath !== undefined ? { resolvedPath: outcome.resolvedPath } : {}),
        ...(outcome.layer !== undefined ? { layer: outcome.layer } : {}),
        ...(outcome.workdir !== undefined ? { workdir: outcome.workdir } : {}),
        // 0948 R7: project the setup outcome itself, so the retired `-inline-setup.json`
        // sidecar's `ok` is still readable from the pair, and a SUCCESSFUL re-setup
        // explicitly drops any prior `error` — a stale failure message must not outlive
        // the failure it described (the state object is rebuilt, never merged with `prior`).
        ok: outcome.ok,
        ...(outcome.ok === false && outcome.error !== undefined ? { error: outcome.error } : {}),
    };
    const temp = `${statePath}.tmp`;
    try {
        writeFileSync(temp, `${JSON.stringify(state, null, 4)}\n`);
        renameSync(temp, statePath);
    } catch {
        // Best-effort: a failing record write must not wedge setup reporting — and never
        // leaves `.tmp` residue behind (0926 R1).
        try {
            unlinkSync(temp);
        } catch {
            // Nothing to clean (temp was never created).
        }
    }
    // 0948 R7: create the header with `wx` (O_EXCL) instead of `existsSync` → `appendFileSync`.
    // The check-then-append pair could append a SECOND header when two setups raced, and it
    // kept "header present" as a separate fact from the identity write. One exclusive create
    // makes exactly-one-header atomic; EEXIST just means it is already there.
    let headerFd: number | undefined;
    try {
        headerFd = openSync(markdownPath, 'wx');
        writeSync(
            headerFd,
            `# spur inline run ${runId} — ${outcome.workflowName ?? 'unknown workflow'} — setup ${at}\n`,
        );
    } catch {
        // EEXIST (already written) or an unwritable path — the human header is not the setup
        // identity, so this stays best-effort exactly like the state write above.
    } finally {
        if (headerFd !== undefined) closeSync(headerFd);
    }
}

/**
 * `--fingerprint` mode (task 0862 R5): print the engine's proof-input digest for a task file
 * (plus optional feature file) instead of creating a run, so the inline driver can capture the
 * fresh digest bound `run.artifact` registration checks against.
 *
 * The digest itself comes from the exported app functions — never reimplemented here — and the
 * options mirror `ProofFingerprintActionRunner` (cwd, spec contents, fileSystem; no `--expect`).
 * Returns the process exit code: 0 printed, 1 read/resolve failure.
 */
async function printFingerprint(taskFile: string, featureFile: string, spurBin: string): Promise<number> {
    const { entry } = resolveAppEntry(spurBin);
    const app = (await import(entry)) as {
        computeProofInputFingerprint: (options: Record<string, unknown>) => Promise<string>;
        readProofInputContents: (
            fileSystem: unknown,
            workdir: string,
            options: { taskFile?: unknown; featureFile?: unknown },
        ) => Promise<{ ok: true; taskContent?: string; featureContent?: string } | { ok: false; error: string }>;
    };

    const workdir = process.cwd();
    // `undefined` fs takes readProofInputContents' node-filesystem default — the same default its
    // sibling createGitAlternateTree applies, and the same Node FS the CLI's runner injects.
    const inputs = await app.readProofInputContents(undefined, workdir, {
        taskFile,
        ...(featureFile.trim() !== '' ? { featureFile } : {}),
    });
    if (!inputs.ok) {
        console.error(`inline-run-setup: FAIL — ${inputs.error}`);
        return 1;
    }

    const digest = await app.computeProofInputFingerprint({
        cwd: workdir,
        ...(inputs.taskContent !== undefined ? { taskContent: inputs.taskContent } : {}),
        ...(inputs.featureContent !== undefined ? { featureContent: inputs.featureContent } : {}),
    });
    process.stdout.write(`${digest}\n`);
    return 0;
}

/** Terminal statuses the inline driver may declare when closing its run row. */
const CLOSE_STATUSES = new Set(['done', 'failed', 'paused']);

/**
 * 0937 R2: closed terminal-reason vocabulary the driver may declare on `--close`.
 * COPIED from packages/app/src/workflow/terminal-reason.ts — the plugin standalone
 * contract forbids a value import of app code; the parity test asserts the copy
 * equals the app export.
 */
const TERMINAL_REASONS = new Set([
    'done',
    'paused-operator',
    'failed-check',
    'failed-agent',
    'failed-timeout',
    'failed-guard',
    'cancelled',
    'interrupted',
    'retry-exhausted',
]);

/** Finalize statuses — a finish emission is terminal, so only done|failed are valid (0868 #4). */
const ACTION_STATUSES = new Set(['done', 'failed']);

/** Input for the ADR-117 emission modes (`--action` / `--close`). */
import type { WorkflowActionTraceWriter } from '@gobing-ai/spur-app';

interface TraceModeInput {
    readonly runId: string;
    readonly close: boolean;
    readonly node: string;
    readonly kind: string;
    /** Declared terminal reason (0937 R2) — validated against TERMINAL_REASONS before this point. */
    readonly reason?: string;
    readonly status: string;
    readonly ok: boolean;
    readonly durationMs: number;
    readonly spurBin: string;
}

/**
 * The run-record file for appended driver lines (task 0927 R1): `.spur/run/<run-id>.md`
 * for pair-based runs. A legacy run that predates the pair keeps appending to its declared
 * `.spur/run/<run-id>.log` — the same precedence as `readWorkflowRunRecord` (the pair wins,
 * legacy stays readable in place).
 */
function runRecordLogPath(runDir: string, runId: string): string {
    const markdownPath = join(runDir, `${runId}.md`);
    const legacyLogPath = join(runDir, `${runId}.log`);
    if (existsSync(legacyLogPath) && !existsSync(markdownPath)) return legacyLogPath;
    return markdownPath;
}

/**
 * Append one emission-failure line to the run record markdown — `.spur/run/<run-id>.md`,
 * the run log the inline driver already owns. Best-effort and synchronous (the process may
 * exit immediately after), and never throws: an unwritable log must not wedge the run
 * (ADR-117 R3).
 */
function appendTraceFailureLine(runId: string, detail: string): void {
    try {
        const runDir = join(process.cwd(), '.spur', 'run');
        if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
        const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, '_');
        const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        appendFileSync(runRecordLogPath(runDir, safeRunId), `[${stamp}] ${detail}\n`);
    } catch {
        // Best-effort (R3): the run continues even when the failure cannot be recorded.
    }
}

/**
 * Emit one trace write through the SHARED `WorkflowActionTraceWriter` (task 0868 R5/R7).
 * `--action` is best-effort: an emission failure is recorded to the run log and reported
 * on stdout as `{"ok":false}`, and the script exits 0 so the run still reaches its declared
 * terminal state (R3/R12). `--close` is bookkeeping, so a missing run row or a persistence
 * failure fails loudly with exit 1 (review findings #1/#4).
 */
async function runTraceMode(input: TraceModeInput): Promise<number> {
    const operation = input.close ? 'run.close' : 'action.finish';
    const fail = (error: string): number => {
        appendTraceFailureLine(
            input.runId,
            `trace-emission-failed operation=${operation} run=${input.runId}` +
                `${input.node === '' ? '' : ` node=${input.node}`}${input.kind === '' ? '' : ` kind=${input.kind}`}: ${error}`,
        );
        process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, error })}\n`);
        // The action boundary is best-effort (exit 0); the run-row closure fails loudly (exit 1).
        return input.close ? 1 : 0;
    };

    // Compile-time link (0868 finding #5): the writer half is typed by the real packages/app
    // export (type-only import, erased at runtime) so a signature drift breaks THIS file's
    // typecheck instead of hiding behind the hand-declared cast.
    let projectDb: { adapter: unknown; close: () => void } | undefined;
    try {
        const { entry } = resolveAppEntry(input.spurBin);
        const app = (await import(entry)) as {
            openInlineRunProjectDb: (workdir: string) => Promise<{ adapter: unknown; close: () => void }>;
            createWorkflowActionTraceWriter: (
                db: unknown,
                recordFailure?: (failure: unknown) => void,
            ) => WorkflowActionTraceWriter;
        };

        projectDb = await app.openInlineRunProjectDb(process.cwd());
        const writer = app.createWorkflowActionTraceWriter(projectDb.adapter, (failure: unknown) => {
            const detail = failure as { operation?: string; error?: string };
            appendTraceFailureLine(
                input.runId,
                `trace-emission-failed operation=${detail.operation ?? operation} run=${input.runId}: ${detail.error ?? 'unknown error'}`,
            );
        });
        const result = (
            input.close
                ? await writer.closeRun(input.runId, input.status, undefined, input.reason)
                : await writer.recordAction({
                      runId: input.runId,
                      node: input.node,
                      kind: input.kind,
                      status: input.status,
                      ok: input.ok,
                      durationMs: input.durationMs,
                  })
        ) as Record<string, unknown>;
        if (result.ok !== true && result.failure !== undefined) {
            // One stdout shape for emission failures (0868 finding #1): flatten the guard's
            // nested failure object to the same `{ok, runId, error}` the direct paths emit.
            const failure = result.failure as { error?: string };
            return fail(failure.error ?? 'unknown trace emission failure');
        }
        process.stdout.write(`${JSON.stringify({ ...result, runId: input.runId })}\n`);
        return 0;
    } catch (error) {
        if (input.close && (error as { name?: string }).name === 'RunRowNotFoundError') {
            // The run row must exist before --close can mark it terminal (R6); a missing row
            // is a loud correctness failure, not a best-effort emission failure (finding #4).
            const message = error instanceof Error ? error.message : String(error);
            appendTraceFailureLine(input.runId, `trace-close-failed run=${input.runId}: ${message}`);
            process.stdout.write(
                `${JSON.stringify({ ok: false, runId: input.runId, error: message, code: 'RUN_NOT_FOUND' })}\n`,
            );
            return 1;
        }
        return fail(error instanceof Error ? error.message : String(error));
    } finally {
        projectDb?.close();
    }
}

/**
 * `--decide` mode (task 0941 R5): execute the non-pausing decide action through the same app
 * function the engine registers (`runDecideForInlineRun` → `DecideActionRunner`), then record
 * the `action_runs` trace row through the shared writer. The decide-enabled switch
 * (`workflow.decideDecisionMaker`) is resolved HERE at the driver boundary (ADR-082) through
 * the bridged facade derivation and passed into the app runner as an explicit parameter —
 * app services never load Spur config. Degraded outcomes (`disabled`,
 * `no-backend`, `error`, `timeout`, `low-confidence`) are normal — the value is the declared
 * default and the run continues — so they print `ok: true` and exit 0. Only an invalid options
 * schema, an unreadable options file, or a failed config load fails closed with exit 1.
 */
async function runDecideMode(input: {
    runId: string;
    node: string;
    optionsFile: string;
    spurBin: string;
}): Promise<number> {
    type DecideOutcome = {
        ok: boolean;
        error?: string;
        value?: string;
        degraded?: boolean;
        reason?: string;
        backend?: string | null;
        confidence?: number | null;
        resultFile?: string;
        durationMs?: number;
    };
    const decideFailed = (error: string): number => {
        process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, error })}\n`);
        return 1;
    };
    let outcome: DecideOutcome;
    try {
        const { entry, portable } = resolveAppEntry(input.spurBin);
        const app = (await import(entry)) as {
            runDecideForInlineRun: (input2: {
                workdir: string;
                optionsFile: string;
                enabled: boolean;
            }) => Promise<DecideOutcome>;
        };
        // Config switch at the driver boundary (ADR-082 / task 0941 gate fix): the flag comes
        // from the bridged facade derivation in the generated lib — the same committed bundle
        // the inventory flow imports — never a @gobing-ai/* value import. Embedded schemas
        // ride along only in the portable layout, mirroring the setup mode's load posture.
        const lib = (await import(
            fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url))
        )) as typeof import('../lib/inline-run.generated.mjs');
        const enabled = await lib.resolveDecideDecisionMakerEnabled(
            process.cwd(),
            portable ? { embeddedSchemas: lib.EMBEDDED_SPUR_SCHEMAS } : undefined,
        );
        outcome = await app.runDecideForInlineRun({
            workdir: process.cwd(),
            optionsFile: input.optionsFile,
            enabled,
        });
    } catch (error) {
        return decideFailed(error instanceof Error ? error.message : String(error));
    }
    if (!outcome.ok) return decideFailed(outcome.error ?? 'decide failed without an error message');
    process.stdout.write(`${JSON.stringify({ ok: true, runId: input.runId, node: input.node, ...outcome })}\n`);
    // Trace row is best-effort, exactly like --action: an emission failure never wedges the run.
    return await runTraceMode({
        runId: input.runId,
        close: false,
        node: input.node,
        kind: 'decide',
        status: 'done',
        ok: true,
        durationMs: outcome.durationMs ?? 0,
        spurBin: input.spurBin,
    });
}

async function main(): Promise<void> {
    // The portable Node twin has no workspace imports; SQLite still uses Spur's existing Bun runtime.
    if (!process.versions.bun) {
        const child = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
            stdio: 'inherit',
        });
        if (child.error) console.error(`inline-run-setup requires Bun on PATH: ${child.error.message}`);
        process.exit(child.status ?? 1);
    }
    let runId = '';
    let file = '';
    let fingerprint = false;
    let taskFile = '';
    let featureFile = '';
    let action = false;
    let close = false;
    let decide = false;
    let optionsJson = '';
    let node = '';
    let kind = '';
    let status = '';
    let reason = '';
    let okRaw = '';
    let durationRaw = '';
    let spurBin = getEnvVar('SPUR_BIN') ?? '';
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--run-id') runId = argv[++i] ?? '';
        else if (argv[i] === '--file') file = argv[++i] ?? '';
        else if (argv[i] === '--fingerprint') fingerprint = true;
        else if (argv[i] === '--task-file') taskFile = argv[++i] ?? '';
        else if (argv[i] === '--feature-file') featureFile = argv[++i] ?? '';
        else if (argv[i] === '--action') action = true;
        else if (argv[i] === '--close') close = true;
        else if (argv[i] === '--decide') decide = true;
        else if (argv[i] === '--options-json') optionsJson = argv[++i] ?? '';
        else if (argv[i] === '--node') node = argv[++i] ?? '';
        else if (argv[i] === '--kind') kind = argv[++i] ?? '';
        else if (argv[i] === '--status') status = argv[++i] ?? '';
        else if (argv[i] === '--reason') reason = argv[++i] ?? '';
        else if (argv[i] === '--ok') okRaw = argv[++i] ?? '';
        else if (argv[i] === '--duration-ms') durationRaw = argv[++i] ?? '';
        else if (argv[i] === '--spur-bin') spurBin = argv[++i] ?? spurBin;
    }

    // Two mutually exclusive modes share this entry point: create/attach a run (run-id + file), or
    // print the proof digest for the inline driver (task 0862 R5). Mixing them is a usage error.
    if (fingerprint) {
        if (runId !== '' || file !== '' || taskFile.trim() === '') usage();
        process.exit(await printFingerprint(taskFile, featureFile, spurBin));
    }

    // ADR-117 emission modes (task 0868): the inline driver reports one completed action
    // boundary, or closes its run row at the declared terminal state. Both share the run-id
    // filename guard, the app-entry resolution chain and the best-effort failure contract.
    // Non-pausing decide action (0941 R5): --decide is mutually exclusive with the run-setup,
    // fingerprint, and trace modes; it requires the run id (filename-guarded), the state id
    // for the trace row, and the options JSON file.
    if (decide) {
        if (action || close || fingerprint || file !== '' || taskFile !== '') usage();
        if (runId.trim() === '' || node.trim() === '' || optionsJson.trim() === '') usage();
        if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);
        process.exit(await runDecideMode({ runId, node, optionsFile: optionsJson, spurBin }));
    }

    if (action || close) {
        if (action && close) usage();
        if (runId.trim() === '' || status.trim() === '') usage();
        if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);
        if (close) {
            if (!CLOSE_STATUSES.has(status)) usage();
            // 0937 R2: a failed close requires a declared reason, and any declared reason
            // must be a closed-enum value — both fail loudly BEFORE any write happens.
            if (reason.trim() === '') {
                if (status === 'failed') usage();
            } else if (!TERMINAL_REASONS.has(reason)) {
                usage();
            }
            process.exit(
                await runTraceMode({
                    runId,
                    close: true,
                    node: '',
                    kind: '',
                    status,
                    ok: true,
                    durationMs: 0,
                    spurBin,
                    ...(reason.trim() === '' ? {} : { reason }),
                }),
            );
        }
        if (node.trim() === '' || kind.trim() === '') usage();
        if (!ACTION_STATUSES.has(status)) usage();
        // `--ok` and `--duration-ms` are required and exact for the action mode
        // (review finding #2): a miscased `--ok True` or an omitted `--duration-ms`
        // must be a loud usage error, never a silently-defaulted `ok=0` /
        // `duration_ms=0` row.
        if (okRaw !== 'true' && okRaw !== 'false') usage();
        const ok = okRaw === 'true';
        const durationMs = Number(durationRaw);
        if (durationRaw.trim() === '' || !Number.isFinite(durationMs) || durationMs < 0) usage();
        process.exit(await runTraceMode({ runId, close: false, node, kind, status, ok, durationMs, spurBin }));
    }

    if (runId.trim() === '' || file.trim() === '') usage();
    if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);

    const { entry, portable } = resolveAppEntry(spurBin);

    // Dynamic import by absolute path: the app source graph resolves its own workspace
    // dependencies from the repo checkout, never from this plugin script's location.
    const app = (await import(entry)) as {
        createOrAttachInlineRun: (input: {
            workdir: string;
            getDb: () => Promise<unknown>;
            file: string;
            runId: string;
            inventory?: unknown;
            embeddedSchemas?: ReadonlyMap<string, string>;
        }) => Promise<SetupOutcome & { ok: boolean }>;
        openInlineRunProjectDb: (workdir: string) => Promise<{ adapter: unknown; close: () => void }>;
        EMBEDDED_SPUR_SCHEMAS?: ReadonlyMap<string, string>;
    };

    const workdir = process.cwd();
    let inventory: unknown;
    try {
        inventory = await readInstalledInventory(file, spurBin);
    } catch (error) {
        const message = `could not resolve the workflow definition: ${error instanceof Error ? error.message : String(error)}`;
        writeOutcome(runId, { ok: false, runId, error: message });
        throw new Error(message);
    }
    const projectDb = await app.openInlineRunProjectDb(workdir);
    let exitCode = 0;
    try {
        const result = await app.createOrAttachInlineRun({
            workdir,
            getDb: async () => projectDb.adapter,
            file,
            runId,
            inventory,
            ...(portable ? { embeddedSchemas: app.EMBEDDED_SPUR_SCHEMAS } : {}),
        });
        writeOutcome(runId, result);
        if (!result.ok) {
            console.error(`inline-run-setup: FAIL for run ${runId}`);
            console.error(`  ${result.error}`);
            exitCode = 1;
        } else {
            console.error(
                `inline-run-setup: ${result.attached ? 'attached' : 'created'} run ${runId} ` +
                    `(${result.workflowName}, layer ${result.layer}, digest ${result.definitionDigest}, status ${result.status})`,
            );
        }
    } finally {
        projectDb.close();
    }
    process.exit(exitCode);
}

main().catch((e: unknown) => {
    console.error(`inline-run-setup: FAIL — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
});
