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
import { join, resolve } from 'node:path';
// Repo-command precedent (0775): spur-app has no root workspace link.
import { computeProofInputFingerprint } from '../../packages/app/src/workflow/proof-input-fingerprint';

export const CERT_RELATIVE_PATH = join('.coverage', 'coverage-certification.json');
export const LCOV_RELATIVE_PATH = join('.coverage', 'lcov.info');

/** Recovery hint every refusal carries (AC5: the documented canonical route). */
export const CANONICAL_RECOVERY =
    'bun run test:full — a completed successful canonical full-suite run republishes certification';

const SCHEMA_VERSION = 1;

export type CertificationStatus = 'pending' | 'certified';

export interface CertificationMarker {
    schemaVersion: number;
    status: CertificationStatus;
    runId: string;
    pid: number;
    startedAt: string;
    /** Tree fingerprint captured when the canonical run launched. */
    treeDigest: string;
    /** Set when this pending marker replaced earlier evidence (supersede chain). */
    supersedes?: string;
    certifiedAt?: string;
    /** sha256 of the certified lcov.info bytes. */
    lcovDigest?: string;
}

export interface CanonicalRunStart {
    runId: string;
    treeDigest: string;
    startedAt: string;
    coverageDir: string;
}

export type CertificationRefusalReason =
    | 'superseded'
    | 'stale-tree'
    | 'missing-lcov'
    | 'malformed-lcov'
    | 'publication-locked';

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

export async function treeFingerprint(cwd: string): Promise<string> {
    return computeProofInputFingerprint({ cwd });
}

/**
 * Invalidate any prior certification and open this run's pending window. The
 * previous marker's runId (when present) is recorded as `supersedes` so the
 * post-check can name a replaced-artifact refusal distinctly from an interrupted
 * run (AC4: a later start deterministically supersedes an earlier run).
 */
export async function startCanonicalRun(cwd: string): Promise<CanonicalRunStart> {
    const startedAt = new Date().toISOString();
    const treeDigest = await treeFingerprint(cwd);
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
            ...(previous !== undefined ? { supersedes: previous.runId } : {}),
        });
    });
    return { runId, treeDigest, startedAt, coverageDir };
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
): Promise<{ ok: true } | { ok: false; reason: CertificationRefusalReason; message: string }> {
    const current = readMarker(cwd);
    if (current === undefined || current.status !== 'pending' || current.runId !== start.runId) {
        return {
            ok: false,
            reason: 'superseded',
            message: `run ${start.runId.slice(0, 8)} no longer owns the pending window — a later canonical run superseded it`,
        };
    }
    const finishDigest = await treeFingerprint(cwd);
    if (finishDigest !== start.treeDigest) {
        return {
            ok: false,
            reason: 'stale-tree',
            message:
                'working tree changed during the canonical run — the tested fingerprint is stale, certification refused',
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
            renameSync(producedPath, lcovPath(cwd));
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
    let currentTree: string;
    try {
        currentTree = await treeFingerprint(cwd);
    } catch (error) {
        return { ok: false, reason: 'tree-unavailable', message: `cannot capture tested tree: ${String(error)}` };
    }
    if (currentTree !== marker.treeDigest) {
        return {
            ok: false,
            reason: 'stale-tree',
            message: 'working tree changed after the certified run — evidence no longer describes this tree',
        };
    }
    return { ok: true, marker };
}
