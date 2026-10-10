#!/usr/bin/env bun
/** Inline dispatch fail-fast facade (task 1134 R1–R4): argv/env only. The classification, the
 *  decision artifact and the durable availability write all live in the app runners
 *  (`recordInlineRunAttribution`, `runInlineRunDispatchFailure`), reached through the same
 *  `loadInlineApp` seam the setup facade uses. It is a SEPARATE script from `inline-run-setup.ts`
 *  because it is a separate operation and the ADR-130 glue budget is per script. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Type-only namespace import (erased before bundling; the smoke scanner exempts `import type`).
import type * as spurApp from '@gobing-ai/spur-app';
import { getEnvVar } from '../lib/env';
import { loadInlineApp } from '../lib/inline-run-app';

// EMBEDDED_SPUR_SCHEMAS is declared by the bundle twin, never exported by the barrel.
type InlineApp = typeof spurApp & { EMBEDDED_SPUR_SCHEMAS?: ReadonlyMap<string, string> };

function usage(): never {
    console.error(
        [
            'Usage: bun plugins/sp/scripts/inline-run-dispatch.ts --attribution --run-id <id> --stage <state> [--executor <name>] [--agent <name>] [--model <m>] [--spur-bin <path>]',
            '       bun plugins/sp/scripts/inline-run-dispatch.ts --dispatch-failure --run-id <id> --stage <state> --decision <escalate|stop|host-inline> (--text <record> | --text-file <path>) [--executor <name>] [--agent <name>] [--model <m>] [--spur-bin <path>]',
            '       --attribution writes .spur/run/<run-id>-attribution.jsonl; an omitted/empty --executor records the explicit no-attribution marker.',
            '       --dispatch-failure classifies the record upstream, writes .spur/run/<run-id>-dispatch-fallback.json, and carries an attributed capacity exhaustion onto the durable availability path.',
        ].join('\n'),
    );
    process.exit(2);
}

/** Run ids become filenames under `.spur/run/` — single safe component only (0804 R8). */
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Resolve the app entry: --spur-bin/SPUR_BIN main module if it proves a repo checkout, else the bundle. */
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

async function main(): Promise<void> {
    // The portable Node twin has no workspace imports; the app bundle still uses Spur's Bun runtime.
    if (!process.versions.bun) {
        const child = spawnSync('bun', [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
            stdio: 'inherit',
        });
        if (child.error) console.error(`inline-run-dispatch requires Bun on PATH: ${child.error.message}`);
        process.exit(child.status ?? 1);
    }
    const flags = new Map<string, string>();
    let attribution = false;
    let dispatchFailure = false;
    let spurBin = getEnvVar('SPUR_BIN') ?? '';
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--attribution') attribution = true;
        else if (flag === '--dispatch-failure') dispatchFailure = true;
        else if (flag === '--spur-bin') spurBin = argv[++i] ?? spurBin;
        else if (flag !== undefined) flags.set(flag, argv[++i] ?? '');
    }
    const runId = flags.get('--run-id') ?? '';
    const stage = flags.get('--stage') ?? '';
    const decision = flags.get('--decision') ?? '';
    const text = flags.get('--text') ?? '';
    const textFile = flags.get('--text-file') ?? '';
    const executor = flags.get('--executor') ?? '';
    const agent = flags.get('--agent') ?? '';
    const model = flags.get('--model') ?? '';

    if (attribution === dispatchFailure) usage();
    if (runId.trim() === '' || stage.trim() === '' || !SAFE_RUN_ID_RE.test(runId)) usage();
    // R3: the executor identity the inline stage actually used. An omitted/empty `--executor` is the
    // explicit no-attribution marker — never a silent drop.
    const identity = {
        executor: executor.trim() === '' ? null : executor,
        agent: agent.trim() === '' ? null : agent,
        ...(model.trim() === '' ? {} : { model }),
    };
    const { app, portable } = await loadInlineApp<InlineApp>(spurBin, resolveAppEntry, [
        'recordInlineRunAttribution',
        'runInlineRunDispatchFailure',
    ]);

    if (attribution) {
        app.recordInlineRunAttribution(process.cwd(), runId, {
            stage,
            ...identity,
            observedAt: new Date().toISOString(),
        });
        process.stdout.write(`${JSON.stringify({ ok: true, runId, stage })}\n`);
        process.exit(0);
    }

    if (decision.trim() === '' || (text === '') === (textFile === '')) usage();
    // ADR-082: this facade is the composition root, so it loads the effective config once and
    // threads the merged result into the app runner (never a per-slice load in packages/app).
    const { app: lib } = await loadInlineApp<typeof import('../lib/inline-run.generated.mjs')>(
        spurBin,
        () => ({ entry: fileURLToPath(new URL('../lib/inline-run.generated.mjs', import.meta.url)), portable }),
        ['loadSpurConfig'],
    );
    const spurConfig = await lib.loadSpurConfig(
        process.cwd(),
        portable ? { embeddedSchemas: lib.EMBEDDED_SPUR_SCHEMAS } : undefined,
    );
    process.exit(
        await app.runInlineRunDispatchFailure({
            runId,
            stage,
            decision: decision as 'escalate' | 'stop' | 'host-inline',
            ...(text === '' ? { textFile } : { text }),
            ...identity,
            spurConfig,
        }),
    );
}

main().catch((e: unknown) => {
    console.error(`inline-run-dispatch: FAIL — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
});
