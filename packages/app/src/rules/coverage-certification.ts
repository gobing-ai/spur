/**
 * Canonical coverage certification (task 1203).
 *
 * A canonical full-suite run (`bun run test`, `test:coverage`, `test:full` — all
 * launched through `run-tests.ts` with `--publish-coverage`) is the ONLY producer
 * allowed to certify `.coverage/lcov.info`. The certification marker binds the LCOV
 * bytes and the tested working-tree fingerprint, so the repository post-check can
 * refuse partial/stale/superseded artifacts BEFORE per-file coverage rules run.
 * Targeted `bun test` runs, heavy/repo-wide gates and interrupted producers never
 * touch the marker (or only invalidate it), so they can neither certify nor clobber
 * a certified artifact — a stale byte or tree mismatch fails the post-check closed.
 *
 * Each producer writes isolated LCOV. Publication and pending-window replacement
 * share a short exclusive lock; only the owning run can publish its own bytes.
 * The tree digest includes tracked and nonignored new files, excluding coverage output.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
    closeSync,
    existsSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { NodeProcessExecutor, NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';
import { computeProofInputFingerprintDetailed, DEFAULT_EXCLUDE_GLOBS } from '../workflow/proof-input-fingerprint';

/** Project-relative path of the certification marker the post-check reads. */
export const CERT_RELATIVE_PATH = join('.coverage', 'coverage-certification.json');
/** Project-relative path of the canonical tracefile a certification binds. */
export const LCOV_RELATIVE_PATH = join('.coverage', 'lcov.info');

/** Recovery hint every refusal carries (AC5: the documented canonical route). */
export const CANONICAL_RECOVERY =
    'bun run test:full — a completed successful canonical full-suite run republishes certification';

const SCHEMA_VERSION = 1;

/** Marker lifecycle: `pending` while a run owns the window, `certified` once it published. */
export type CertificationStatus = 'pending' | 'certified';

/** On-disk evidence: the run token, its tree fingerprint and the published tracefile digest. */
export interface CertificationMarker {
    schemaVersion: number;
    status: CertificationStatus;
    runId: string;
    pid: number;
    startedAt: string;
    /** Tree fingerprint captured when the canonical run launched. */
    treeDigest: string;
    /** Raw git-tree SHA backing `treeDigest` — lets a stale-tree refusal name the drifted paths. */
    gitTreeSha?: string;
    /** Set when this pending marker replaced earlier evidence (supersede chain). */
    supersedes?: string;
    certifiedAt?: string;
    /** sha256 of the certified lcov.info bytes. */
    lcovDigest?: string;
}

/** Identity of one canonical run: the token that owns the pending publication window. */
export interface CanonicalRunStart {
    runId: string;
    treeDigest: string;
    gitTree: string;
    startedAt: string;
    coverageDir: string;
}

/** Why a certification attempt was refused; each reason maps to one operator-facing message. */
export type CertificationRefusalReason =
    | 'superseded'
    | 'stale-tree'
    | 'missing-lcov'
    | 'malformed-lcov'
    | 'publication-locked';

/** Post-check verdict: certified evidence, or the reason it is refused. */
export type ValidationResult =
    | { ok: true; marker: CertificationMarker }
    | {
          ok: false;
          reason:
              | 'missing'
              | 'malformed'
              | 'pending'
              | 'superseded'
              | 'stale-tree'
              | 'missing-lcov'
              | 'lcov-mismatch'
              | 'tree-unavailable';
          message: string;
      };

function certPath(cwd: string): string {
    return resolve(cwd, CERT_RELATIVE_PATH);
}

function lcovPath(cwd: string): string {
    return resolve(cwd, LCOV_RELATIVE_PATH);
}

function sha256File(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeMarkerAtomic(cwd: string, marker: CertificationMarker): void {
    mkdirSync(resolve(cwd, '.coverage'), { recursive: true });
    const tmp = `${certPath(cwd)}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(marker, null, 4)}\n`);
    renameSync(tmp, certPath(cwd));
}

/** No awaits inside: a competing start cannot replace ownership during publication. */
function withPublicationLock<T>(cwd: string, visit: () => T): T {
    const path = resolve(cwd, '.coverage', 'publication.lock');
    mkdirSync(resolve(cwd, '.coverage'), { recursive: true });
    const fd = openSync(path, 'wx');
    try {
        return visit();
    } finally {
        closeSync(fd);
        unlinkSync(path);
    }
}

/** The tree digest a certification binds, for callers that only need the fingerprint. */
export async function treeFingerprint(cwd: string): Promise<string> {
    return (await treeCapture(cwd)).digest;
}

/**
 * Tree paths no test reads, so an edit mid-run cannot change the measured result. CHANGELOG.md is
 * rewritten by release/changelog commands that routinely land during a long canonical run. Docs
 * stay in: contract tests read ADRs and design satellites, so they are coverage inputs.
 */
const CERTIFICATION_EXCLUDE_GLOBS = [...DEFAULT_EXCLUDE_GLOBS, 'CHANGELOG.md'];

/** Composite digest plus the raw git-tree SHA it folds in. */
async function treeCapture(cwd: string): Promise<{ digest: string; gitTree: string }> {
    const { fingerprint, gitTree } = await computeProofInputFingerprintDetailed({
        cwd,
        excludeGlobs: CERTIFICATION_EXCLUDE_GLOBS,
    });
    return { digest: fingerprint, gitTree };
}

/**
 * Name the paths that differ between two captured git trees (best-effort: the
 * diagnostic enriches the refusal, it never decides it). `git write-tree`
 * objects persist in .git/objects, so a later diff still resolves. Untracked
 * drift appears as an added path — that is the case this exists for.
 */
function changedPathsBetween(cwd: string, beforeTree: string | undefined, afterTree: string): string {
    if (beforeTree === undefined || beforeTree === afterTree) return '';
    try {
        const executor = new NodeSyncProcessExecutor();
        const run = executor.runSync({ command: 'git', args: ['diff', '--name-only', beforeTree, afterTree], cwd });
        const paths = (run.stdout ?? '').split('\n').filter(Boolean);
        if (paths.length === 0) return '';
        const shown = paths.slice(0, 12).join(', ');
        return ` — changed paths: ${shown}${paths.length > 12 ? `, … (+${paths.length - 12} more)` : ''}`;
    } catch {
        return '';
    }
}

/**
 * Invalidate any prior certification and open this run's pending window. The
 * previous marker's runId (when present) is recorded as `supersedes` so the
 * post-check can name a replaced-artifact refusal distinctly from an interrupted
 * run (AC4: a later start deterministically supersedes an earlier run).
 */
export async function startCanonicalRun(cwd: string): Promise<CanonicalRunStart> {
    const startedAt = new Date().toISOString();
    const { digest: treeDigest, gitTree } = await treeCapture(cwd);
    const runId = randomUUID();
    const coverageDir = resolve(cwd, '.coverage', `run-${runId}`);
    mkdirSync(coverageDir, { recursive: true });
    withPublicationLock(cwd, () => {
        const previous = readMarker(cwd);
        writeMarkerAtomic(cwd, {
            schemaVersion: SCHEMA_VERSION,
            status: 'pending',
            runId,
            pid: process.pid,
            startedAt,
            treeDigest,
            gitTreeSha: gitTree,
            ...(previous !== undefined ? { supersedes: previous.runId } : {}),
        });
    });
    return { runId, treeDigest, gitTree, startedAt, coverageDir };
}

function readMarker(cwd: string): CertificationMarker | undefined {
    try {
        const marker = JSON.parse(readFileSync(certPath(cwd), 'utf8')) as CertificationMarker | null;
        return marker && typeof marker.runId === 'string' ? marker : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Certify this run's LCOV against the start fingerprint. Fail-closed refusals
 * leave the marker pending — certification is only published when the run token
 * still owns the pending window AND the tested tree is byte-identical start to
 * finish (R1/R4).
 */
export async function certifyCanonicalRun(
    cwd: string,
    start: CanonicalRunStart,
    options: { lcov?: string } = {},
): Promise<{ ok: true } | { ok: false; reason: CertificationRefusalReason; message: string }> {
    const current = readMarker(cwd);
    if (current === undefined || current.status !== 'pending' || current.runId !== start.runId) {
        return {
            ok: false,
            reason: 'superseded',
            message: `run ${start.runId.slice(0, 8)} no longer owns the pending window — a later canonical run superseded it`,
        };
    }
    const finish = await treeCapture(cwd);
    if (finish.digest !== start.treeDigest) {
        return {
            ok: false,
            reason: 'stale-tree',
            message:
                'working tree changed during the canonical run — the tested fingerprint is stale, certification refused' +
                changedPathsBetween(cwd, start.gitTree, finish.gitTree),
        };
    }
    const producedPath = join(start.coverageDir, 'lcov.info');
    if (!existsSync(producedPath)) {
        return { ok: false, reason: 'missing-lcov', message: `${LCOV_RELATIVE_PATH} was not produced by the run` };
    }
    const produced = readFileSync(producedPath);
    const records = produced.toString().trim().split('end_of_record');
    if (
        records.length < 2 ||
        records.pop()?.trim() !== '' ||
        records.some((record) => !/^SF:.+$/m.test(record) || !/^LF:\d+$/m.test(record) || !/^LH:\d+$/m.test(record))
    ) {
        return { ok: false, reason: 'malformed-lcov', message: 'run LCOV is empty or contains incomplete records' };
    }
    try {
        return withPublicationLock(cwd, () => {
            const owner = readMarker(cwd);
            if (owner?.status !== 'pending' || owner.runId !== start.runId) {
                return { ok: false, reason: 'superseded', message: 'a later run owns the publication window' } as const;
            }
            const publishTo = options.lcov !== undefined ? resolve(cwd, options.lcov) : lcovPath(cwd);
            // A caller-named target may live in a directory the project has not created yet.
            mkdirSync(dirname(publishTo), { recursive: true });
            renameSync(producedPath, publishTo);
            writeMarkerAtomic(cwd, {
                ...owner,
                status: 'certified',
                certifiedAt: new Date().toISOString(),
                lcovDigest: createHash('sha256').update(produced).digest('hex'),
            });
            return { ok: true } as const;
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        return {
            ok: false,
            reason: 'publication-locked',
            message: 'another coverage publisher holds publication.lock',
        };
    }
}

/**
 * Post-check precondition: the marker must certify the CURRENT lcov bytes and the
 * CURRENT tree, or the repository post-check must refuse with a distinct
 * coverage-artifact diagnostic before any per-file rule runs (R2).
 */
export async function validateCoverageCertification(cwd: string): Promise<ValidationResult> {
    const raw = (() => {
        try {
            return readFileSync(certPath(cwd), 'utf8');
        } catch {
            return undefined;
        }
    })();
    if (raw === undefined) {
        return {
            ok: false,
            reason: 'missing',
            message: 'no coverage certification found — the artifact was never produced by a canonical run',
        };
    }
    let marker: CertificationMarker;
    try {
        marker = JSON.parse(raw) as CertificationMarker;
        if (
            marker.schemaVersion !== SCHEMA_VERSION ||
            typeof marker.runId !== 'string' ||
            typeof marker.treeDigest !== 'string' ||
            (marker.supersedes !== undefined && typeof marker.supersedes !== 'string') ||
            (marker.gitTreeSha !== undefined && typeof marker.gitTreeSha !== 'string') ||
            (marker.status === 'certified' && typeof marker.lcovDigest !== 'string') ||
            (marker.status !== 'pending' && marker.status !== 'certified')
        ) {
            return {
                ok: false,
                reason: 'malformed',
                message: 'certification marker is structurally invalid (schemaVersion/status/digests)',
            };
        }
    } catch {
        return { ok: false, reason: 'malformed', message: 'certification marker is not valid JSON' };
    }
    if (marker.status !== 'certified') {
        return marker.supersedes !== undefined
            ? {
                  ok: false,
                  reason: 'superseded',
                  message: `run ${marker.runId.slice(0, 8)} superseded earlier certification (${marker.supersedes.slice(0, 8)}) and has not completed`,
              }
            : {
                  ok: false,
                  reason: 'pending',
                  message: `run ${marker.runId.slice(0, 8)} is pending — it was interrupted, failed, or is still in flight; never a green skip`,
              };
    }
    if (!existsSync(lcovPath(cwd))) {
        return { ok: false, reason: 'missing-lcov', message: `${LCOV_RELATIVE_PATH} named by certification is gone` };
    }
    const lcovDigest = sha256File(lcovPath(cwd));
    if (lcovDigest !== marker.lcovDigest) {
        return {
            ok: false,
            reason: 'lcov-mismatch',
            message: `${LCOV_RELATIVE_PATH} bytes changed after certification — a non-canonical producer overwrote the tracefile`,
        };
    }
    let currentTree: { digest: string; gitTree: string };
    try {
        currentTree = await treeCapture(cwd);
    } catch (error) {
        return { ok: false, reason: 'tree-unavailable', message: `cannot capture tested tree: ${String(error)}` };
    }
    if (currentTree.digest !== marker.treeDigest) {
        return {
            ok: false,
            reason: 'stale-tree',
            message:
                'working tree changed after the certified run — evidence no longer describes this tree' +
                changedPathsBetween(cwd, marker.gitTreeSha, currentTree.gitTree),
        };
    }
    return { ok: true, marker };
}

/** Environment variable carrying this run's isolated coverage directory to the child. */
export const COVERAGE_DIR_ENV = 'SPUR_COVERAGE_DIR';

/** Argv placeholder replaced with the run's coverage directory. */
export const COVERAGE_DIR_TOKEN = '{coverageDir}';

/** Runs the certified command; injected so tests never spawn a real suite. */
export type CertifyRunner = (argv: readonly string[], env: Record<string, string>) => Promise<number>;

/** Terminal outcome of {@link certifyCommand}. */
export type CertifyOutcome =
    | { kind: 'certified' }
    | { kind: 'child-failed'; code: number }
    | { kind: 'refused'; reason: CertificationRefusalReason; message: string };

/**
 * Default runner: the suite keeps the terminal (ts-runtime's `stream` policy inherits it and pipes
 * the same chunks) and runs in this process group, so an operator's SIGINT/SIGTERM reaches it
 * directly. No timeout here — a suite is bounded by the caller, not by the certification window.
 */
const defaultCertifyRunner: CertifyRunner = async (argv, env) => {
    const executor = new NodeProcessExecutor({ defaultTimeout: null, output: { mode: 'stream' } });
    const [command, ...args] = argv;
    if (command === undefined) return 1;
    const result = await executor.run({
        command,
        args: [...args],
        cwd: process.cwd(),
        env: Object.fromEntries(
            Object.entries({ ...getEnvVars(), ...env }).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
            ),
        ),
    });
    return result.exitCode ?? 1;
};

/**
 * `spur rule certify-coverage -- <command…>` (A94 1412 R2): open the pending window, run the
 * command against an isolated coverage directory, then certify and publish only when the command
 * exited 0 AND the tested tree is unchanged.
 *
 * A non-zero child exit leaves the marker `pending` and publishes nothing — a failed suite can never
 * certify, and the refusal names the canonical recovery.
 */
export async function certifyCommand(options: {
    cwd: string;
    argv: readonly string[];
    lcov?: string;
    run?: CertifyRunner;
}): Promise<CertifyOutcome> {
    const run = options.run ?? defaultCertifyRunner;
    const start = await startCanonicalRun(options.cwd);
    const argv = options.argv.map((token) => token.split(COVERAGE_DIR_TOKEN).join(start.coverageDir));
    const code = await run(argv, { [COVERAGE_DIR_ENV]: start.coverageDir });
    if (code !== 0) return { kind: 'child-failed', code };
    const certified = await certifyCanonicalRun(
        options.cwd,
        start,
        options.lcov !== undefined ? { lcov: options.lcov } : {},
    );
    if (!certified.ok) return { kind: 'refused', reason: certified.reason, message: certified.message };
    return { kind: 'certified' };
}
