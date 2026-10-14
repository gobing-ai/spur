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
 * Tree digest: content hash over the tracked working tree (path + on-disk bytes per
 * `git ls-files -z` entry); only start/finish equality of the SAME run is compared.
 * `.coverage/` is gitignored, so marker writes never move the fingerprint.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
}

export type CertificationRefusalReason = 'superseded' | 'stale-tree' | 'missing-lcov';

export type ValidationResult =
    | { ok: true; marker: CertificationMarker }
    | {
          ok: false;
          reason: 'missing' | 'malformed' | 'pending' | 'superseded' | 'stale-tree' | 'missing-lcov' | 'lcov-mismatch';
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

export async function treeFingerprint(cwd: string): Promise<string> {
    // Content hash over the tracked working tree. `git ls-files -s` alone only sees
    // the index, so a mid-run worktree edit (no `git add`) would slip through — the
    // digest must cover on-disk bytes of every tracked file. Untracked files are out
    // of scope: certification guards the committed source set the suite imported.
    const listed = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    if (listed.exitCode !== 0) {
        throw new Error(`coverage-certification: git ls-files failed: ${listed.stderr.toString().trim()}`);
    }
    const hash = createHash('sha256');
    for (const path of listed.stdout.toString().split('\0').filter(Boolean)) {
        hash.update(path).update('\0');
        try {
            hash.update(readFileSync(join(cwd, path)));
        } catch {
            hash.update('<missing>'); // tracked but deleted from the worktree
        }
    }
    return `sha256:${hash.digest('hex')}`;
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
    const previous = readMarker(cwd);
    const marker: CertificationMarker = {
        schemaVersion: SCHEMA_VERSION,
        status: 'pending',
        runId,
        pid: process.pid,
        startedAt,
        treeDigest,
        ...(previous !== undefined ? { supersedes: previous.runId } : {}),
    };
    writeMarkerAtomic(cwd, marker);
    return { runId, treeDigest, startedAt };
}

function readMarker(cwd: string): CertificationMarker | undefined {
    try {
        return JSON.parse(readFileSync(certPath(cwd), 'utf8')) as CertificationMarker;
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
    if (!existsSync(lcovPath(cwd))) {
        return { ok: false, reason: 'missing-lcov', message: `${LCOV_RELATIVE_PATH} was not produced by the run` };
    }
    const certified: CertificationMarker = {
        ...current,
        status: 'certified',
        certifiedAt: new Date().toISOString(),
        lcovDigest: sha256File(lcovPath(cwd)),
    };
    writeMarkerAtomic(cwd, certified);
    return { ok: true };
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
    const currentTree = await treeFingerprint(cwd);
    if (currentTree !== marker.treeDigest) {
        return {
            ok: false,
            reason: 'stale-tree',
            message: 'working tree changed after the certified run — evidence no longer describes this tree',
        };
    }
    return { ok: true, marker };
}
