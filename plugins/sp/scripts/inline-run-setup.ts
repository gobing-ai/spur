#!/usr/bin/env bun
/** Inline run setup driver (ADR-117/1006 R3): thin glue — argv/env, app-entry resolution, the installed-CLI
 *  handshake, mode dispatch. Mode bodies live in the bundled app service (`runInlineRun*` exports); the `.mjs`
 *  twin re-enters Bun in `main()` (SQLite) and imports the bundle dynamically, so bare `node` never loads app code. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Type-only namespace import (erased before bundling; the smoke scanner exempts `import type`).
import type * as spurApp from '@gobing-ai/spur-app';
import { getEnvVar } from '../lib/env';
import { loadInlineApp } from '../lib/inline-run-app';

// EMBEDDED_SPUR_SCHEMAS: declared by the bundle twin, never exported by the barrel — optional
// intersection member, exactly what the previous structural cast expressed.
type InlineApp = typeof spurApp & { EMBEDDED_SPUR_SCHEMAS?: ReadonlyMap<string, string> };

function usage(): never {
    const text = [
        'Usage: bun plugins/sp/scripts/inline-run-setup.ts --run-id <id> --file <definition> [--spur-bin <path>]',
        '       bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <path> [--feature-file <path>] [--spur-bin <path>]',
        '       bun plugins/sp/scripts/inline-run-setup.ts --action --run-id <id> --node <state> --kind <kind> --status <done|failed> --ok <true|false> --duration-ms <n> [--estimated] [--spur-bin <path>]',
        '       bun plugins/sp/scripts/inline-run-setup.ts --actions-file <json-file> --run-id <id> [--spur-bin <path>]  (1007 R5 batch trace emission)',
        '       bun plugins/sp/scripts/inline-run-setup.ts --close --run-id <id> --status <done|failed|paused> [--reason <terminal-reason>] [--spur-bin <path>]',
        '       bun plugins/sp/scripts/inline-run-setup.ts --persist-out --from <worktree-path> [--task-file <path>]... [--spur-bin <path>]',
        '       terminal-reason is a closed enum (0937 R2): done, paused-operator, failed-check, failed-agent, failed-timeout, failed-guard, cancelled, interrupted, retry-exhausted',
        '       close defaults (1051 AC1): --status done → reason done, --status paused → reason paused-operator; --status failed requires an explicit --reason',
        '       bun plugins/sp/scripts/inline-run-setup.ts --decide --run-id <id> --node <state> --options-json <file> [--spur-bin <path>]',
    ].join('\n');
    console.error(text);
    process.exit(2);
}

// Run ids become filenames under `.spur/run/` — single safe component only (0804 R8).
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function refuseUnsafeRunId(runId: string): never {
    console.error(`inline-run-setup: refusing unsafe run id: ${runId}`);
    console.error(
        '  The run id must be a single safe filename component (alphanumeric/._-, no leading dot, no path separators, interpolation or traversal; same class as the task-pipeline route-reason guard, task 0804 R8). Allocate a fresh run id (uuid or timestamp slug) and retry.',
    );
    process.exit(1);
}

/** Resolve the app entry: --spur-bin/SPUR_BIN main module if it proves a repo checkout, else the adjacent bundle. */
function resolveAppEntry(spurBin: string): { entry: string; portable: boolean } {
    const fallback = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url));
    const candidates = spurBin !== '' ? [spurBin] : [fallback];
    for (const candidate of candidates) {
        const tokens = candidate.split(/\s+/).filter(Boolean);
        // Main module = last path-like token; only a .ts source entry proves a repo checkout.
        const mainModule = [...tokens].reverse().find((t) => t.endsWith('.ts'));
        if (mainModule === undefined || !existsSync(mainModule)) continue;
        const repoRoot = resolve(dirname(mainModule), '..', '..', '..');
        const appEntry = join(repoRoot, 'packages', 'app', 'src', 'index.ts');
        if (existsSync(appEntry)) return { entry: appEntry, portable: false };
    }
    const entry = fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url));
    if (!existsSync(entry)) {
        throw new Error('inline application bundle is missing — rebuild/install the sp plugin before running inline');
    }
    return { entry, portable: true };
}

const TRACE_EXPORTS = ['runInlineRunTrace', 'isInlineRunCloseStatus', 'isInlineRunActionStatus'] as const;
const SETUP_EXPORTS = ['readInstalledInventory', 'runInlineRunSetup', 'writeInlineRunOutcome'] as const;

// 0937 R2 closed terminal-reason vocabulary for `--close`. COPIED from
// packages/app/src/workflow/terminal-reason.ts (no value import); parity test asserts equality.
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

async function main(): Promise<void> {
    // The portable Node twin has no workspace imports; SQLite still uses Spur's existing Bun runtime.
    if (!process.versions.bun) {
        const child = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
            stdio: 'inherit',
        });
        if (child.error) console.error(`inline-run-setup requires Bun on PATH: ${child.error.message}`);
        process.exit(child.status ?? 1);
    }
    const flags = new Map<string, string>();
    let fingerprint = false,
        action = false,
        close = false,
        decide = false,
        persistOut = false,
        estimated = false;
    const taskFiles: string[] = [];
    let spurBin = getEnvVar('SPUR_BIN') ?? '';
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--fingerprint') fingerprint = true;
        else if (flag === '--action') action = true;
        else if (flag === '--close') close = true;
        else if (flag === '--decide') decide = true;
        else if (flag === '--persist-out') persistOut = true;
        else if (flag === '--estimated') estimated = true;
        else if (flag === '--task-file') taskFiles.push(argv[++i] ?? '');
        else if (flag === '--spur-bin') spurBin = argv[++i] ?? spurBin;
        else if (flag !== undefined) flags.set(flag, argv[++i] ?? '');
    }
    // Repeated value flags: last occurrence wins (Map.set), matching the previous assignment chain.
    const runId = flags.get('--run-id') ?? '';
    const file = flags.get('--file') ?? '';
    const featureFile = flags.get('--feature-file') ?? '';
    const from = flags.get('--from') ?? '';
    const optionsJson = flags.get('--options-json') ?? '';
    const node = flags.get('--node') ?? '';
    const kind = flags.get('--kind') ?? '';
    const status = flags.get('--status') ?? '';
    const reason = flags.get('--reason') ?? '';
    const okRaw = flags.get('--ok') ?? '';
    const durationRaw = flags.get('--duration-ms') ?? '';
    const actionsFile = flags.get('--actions-file') ?? '';

    // `--estimated` labels a host-reported duration the driver did NOT time around the action
    // (1070 R2). Only `--action` carries one: every other mode is refused here, before any write.
    if (estimated && !action) usage();

    if (fingerprint) {
        if (runId !== '' || file !== '' || taskFiles.length !== 1 || (taskFiles[0] ?? '').trim() === '') usage();
        const { app } = await loadInlineApp<InlineApp>(spurBin, resolveAppEntry, ['runInlineRunFingerprint']);
        process.exit(await app.runInlineRunFingerprint({ taskFile: taskFiles[0] ?? '', featureFile }));
    }

    if (actionsFile !== '') {
        if (action || close || fingerprint || decide || persistOut || file !== '' || taskFiles.length > 0) usage();
        if (runId.trim() === '' || status !== '' || node !== '' || kind !== '') usage();
        if (okRaw !== '' || durationRaw !== '') usage();
        if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);
        const { app } = await loadInlineApp<InlineApp>(spurBin, resolveAppEntry, ['runInlineRunTraceBatch']);
        process.exit(await app.runInlineRunTraceBatch({ runId, actionsFile }));
    }

    if (decide) {
        if (action || close || fingerprint || file !== '' || taskFiles.length > 0) usage();
        if (runId.trim() === '' || node.trim() === '' || optionsJson.trim() === '') usage();
        if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);
        try {
            const { app, portable } = await loadInlineApp<InlineApp>(spurBin, resolveAppEntry, ['runInlineRunDecide']);
            // Decide switch + catalog config, resolved once (1094, ADR-082), behind the skew guard (1120 R2).
            const { app: lib } = await loadInlineApp<typeof import('../lib/inline-run.generated.mjs')>(
                spurBin,
                () => ({ entry: fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url)), portable }),
                ['resolveDecideDecisionMakerEnabled', 'loadSpurConfig'],
            );
            const loadOpts = portable ? { embeddedSchemas: lib.EMBEDDED_SPUR_SCHEMAS } : undefined;
            const [enabled, spurConfig] = await Promise.all([
                lib.resolveDecideDecisionMakerEnabled(process.cwd(), loadOpts),
                lib.loadSpurConfig(process.cwd(), loadOpts),
            ]);
            process.exit(await app.runInlineRunDecide({ runId, node, optionsFile: optionsJson, enabled, spurConfig }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            process.stdout.write(`${JSON.stringify({ ok: false, runId, error: message })}\n`);
            process.exit(1);
        }
    }

    if (persistOut) {
        if (fingerprint || decide || action || close || runId !== '' || file !== '') usage();
        if (from.trim() === '' || taskFiles.some((taskFile) => taskFile.trim() === '')) usage();
        const { app } = await loadInlineApp<InlineApp>(spurBin, resolveAppEntry, ['runInlineRunPersistOut']);
        process.exit(await app.runInlineRunPersistOut({ from, taskFiles }));
    }

    if (action || close) {
        if (action && close) usage();
        if (runId.trim() === '' || status.trim() === '') usage();
        if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);
        const { app } = await loadInlineApp<InlineApp>(spurBin, resolveAppEntry, TRACE_EXPORTS);
        if (close) {
            if (!app.isInlineRunCloseStatus(status)) usage();
            // 0937 R2: failed close needs a declared closed-enum reason — before any write.
            if (reason.trim() === '' ? status === 'failed' : !TERMINAL_REASONS.has(reason)) usage();
            process.exit(
                await app.runInlineRunTrace({
                    runId,
                    close: true,
                    node: '',
                    kind: '',
                    status,
                    ok: true,
                    durationMs: 0,
                    ...(reason.trim() === '' ? {} : { reason }),
                }),
            );
        }
        if (node.trim() === '' || kind.trim() === '') usage();
        if (!app.isInlineRunActionStatus(status)) usage();
        // `--ok` and `--duration-ms` are required and exact (0868 #2): no silent defaults.
        if (okRaw !== 'true' && okRaw !== 'false') usage();
        const durationMs = Number(durationRaw);
        if (durationRaw.trim() === '' || !Number.isFinite(durationMs) || durationMs < 0) usage();
        process.exit(
            await app.runInlineRunTrace({
                runId,
                close: false,
                node,
                kind,
                status,
                ok: okRaw === 'true',
                durationMs,
                ...(estimated ? { estimated: true } : {}),
            }),
        );
    }

    if (runId.trim() === '' || file.trim() === '') usage();
    if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);
    const { app, portable } = await loadInlineApp<InlineApp>(spurBin, resolveAppEntry, SETUP_EXPORTS);
    let inventory: unknown;
    try {
        // The CLI walk lives in the app service (ADR-130 glue budget): the script passes only the
        // paths it derives from its own module URL.
        inventory = await app.readInstalledInventory({
            file,
            spurBin,
            localCli: fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url)),
        });
    } catch (error) {
        const message = `could not resolve the workflow definition: ${error instanceof Error ? error.message : String(error)}`;
        app.writeInlineRunOutcome(runId, { ok: false, runId, error: message });
        throw new Error(message);
    }
    process.exit(
        await app.runInlineRunSetup({
            runId,
            file,
            inventory,
            ...(portable ? { embeddedSchemas: app.EMBEDDED_SPUR_SCHEMAS } : {}),
        }),
    );
}

main().catch((e: unknown) => {
    console.error(`inline-run-setup: FAIL — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
});
