#!/usr/bin/env bun
/**
 * inline-run-setup — authoritative inline full-pipeline run identity (task 0804 R1).
 *
 * Unlike the subprocess path (`spur workflow run`), the interactive inline driver
 * allocated a run id but never persisted an authoritative `runs` row, so bound
 * `run.artifact` registration (0785 R3) correctly refused every inline record. This
 * script is the thin delegate the driver now runs at Run setup: it resolves the spur
 * repo checkout from the SPUR_BIN chain, imports the real app service
 * (`createOrAttachInlineRun` / `openInlineRunProjectDb` from packages/app), and lets it
 * resolve the SAME project-or-bundled definition the engine would launch, compute the
 * canonical definition digest with the exported hash machinery, and create-or-attach the
 * run row through the existing engine persistence adapter.
 *
 * The script itself contains NO direct SQL, NO second hasher and NO persistence policy —
 * every rule lives in packages/app (0804 D1). On a bundle-only install there is no repo
 * checkout to import the app service from, so the setup fails closed with actionable
 * remediation guidance (point SPUR_BIN at a repo checkout); it never falls back to an
 * unbound run (0804 R1 failure policy).
 *
 * Outcome JSON is written to `.spur/run/<run-id>-inline-setup.json` so the driver can
 * seed the inline var overlay (`__runId`, `__definitionDigest`) that proof capture and
 * bound registration verify against. Exit 0 = authoritative identity ready (created or
 * idempotently attached); exit 1 = fail closed, the driver must stop.
 *
 * Repo-only script (ADR-065): it imports the app workspace source, so it runs under bun
 * against a monorepo checkout only — the same posture as task-size-precheck.ts and
 * task-evidence-precheck.ts.
 *
 * Usage:
 *   bun plugins/sp/scripts/inline-run-setup.ts --run-id <id> --file <definition> [--spur-bin <path>]
 *
 * Env: SPUR_BIN
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Outcome document written to `.spur/run/<run-id>-inline-setup.json`. */
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
    process.exit(1);
}

/**
 * The run id becomes a filename under `.spur/run/` (`<run-id>-inline-setup.json`), so it must be a
 * single safe filename component before anything is written — the same guard class the
 * task-pipeline.yaml route-reason action applies to `$__runId` (task 0804 R8). The allowlist
 * refuses path separators, dot traversal (leading `.`), unresolved interpolation (`$`/`{`/`}`) and
 * every other shell/unspecified metachar; valid UUID/timestamp-slug ids pass.
 */
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function refuseUnsafeRunId(runId: string): never {
    // Refuse BEFORE any outcome write: an unsafe id must never reach
    // `.spur/run/<run-id>-inline-setup.json` (no traversal, no unintended file).
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
 * binary without the app workspace) has no app entry to import — the caller fails that
 * closed with remediation guidance.
 */
function resolveAppEntry(
    spurBin: string,
): { entry: string; repoRoot: string } | { entry: null; repoRoot: null; chain: string } {
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
        if (existsSync(appEntry)) return { entry: appEntry, repoRoot };
        return { entry: null, repoRoot: null, chain: `${candidate} (no ${appEntry})` };
    }
    return { entry: null, repoRoot: null, chain: spurBin === '' ? 'PATH spur (bundle-only install)' : spurBin };
}

function writeOutcome(runId: string, outcome: SetupOutcome): void {
    const runDir = join(process.cwd(), '.spur', 'run');
    if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, `${runId}-inline-setup.json`), `${JSON.stringify(outcome, null, 4)}\n`);
}

async function main(): Promise<void> {
    let runId = '';
    let file = '';
    let spurBin = process.env.SPUR_BIN ?? '';
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--run-id') runId = argv[++i] ?? '';
        else if (argv[i] === '--file') file = argv[++i] ?? '';
        else if (argv[i] === '--spur-bin') spurBin = argv[++i] ?? spurBin;
    }
    if (runId.trim() === '' || file.trim() === '') usage();
    if (!SAFE_RUN_ID_RE.test(runId)) refuseUnsafeRunId(runId);

    const { entry, repoRoot, chain } = resolveAppEntry(spurBin);
    if (entry === null || repoRoot === null) {
        const outcome: SetupOutcome = {
            ok: false,
            runId,
            error:
                `inline run setup failed closed: no monorepo checkout of spur is reachable via ${chain}. ` +
                'The authoritative run identity must be persisted by the app service ' +
                '(packages/app/src/services/inline-run-setup.ts); a bundle-only install cannot do this. ' +
                'Remediation: point SPUR_BIN at a repo checkout, e.g. ' +
                'SPUR_BIN="bun /path/to/spur/apps/cli/src/index.ts". The pipeline must not run unbound.',
        };
        writeOutcome(runId, outcome);
        console.error(`inline-run-setup: FAIL for run ${runId}`);
        console.error(`  ${outcome.error}`);
        process.exit(1);
    }

    // Dynamic import by absolute path: the app source graph resolves its own workspace
    // dependencies from the repo checkout, never from this plugin script's location.
    const app = (await import(entry)) as {
        createOrAttachInlineRun: (input: {
            workdir: string;
            getDb: () => Promise<unknown>;
            file: string;
            runId: string;
        }) => Promise<SetupOutcome & { ok: boolean }>;
        openInlineRunProjectDb: (workdir: string) => Promise<{ adapter: unknown; close: () => void }>;
    };

    const workdir = process.cwd();
    const projectDb = await app.openInlineRunProjectDb(workdir);
    try {
        const result = await app.createOrAttachInlineRun({
            workdir,
            getDb: async () => projectDb.adapter,
            file,
            runId,
        });
        writeOutcome(runId, result);
        if (!result.ok) {
            console.error(`inline-run-setup: FAIL for run ${runId}`);
            console.error(`  ${result.error}`);
            process.exit(1);
        }
        console.error(
            `inline-run-setup: ${result.attached ? 'attached' : 'created'} run ${runId} ` +
                `(${result.workflowName}, layer ${result.layer}, digest ${result.definitionDigest}, status ${result.status})`,
        );
        process.exit(0);
    } finally {
        projectDb.close();
    }
}

main().catch((e: unknown) => {
    console.error(`inline-run-setup: FAIL — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
});
