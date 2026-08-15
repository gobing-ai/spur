/**
 * feature-sync-bounded — bounded retry-suppression wrapper for `feature sync` (task 0411).
 *
 * During a batch (`/sp:dev-runall`) or wrap-up (`/sp:dev-wrapall`), the per-task `record` step
 * and the wrap-up `feature-transition` step each invoke `spur feature sync <id> --json`. If the
 * feature is L4-gate-blocked, the identical blocked result repeats on every call with no
 * intervening input change — 4 redundant sync calls observed in the H9 dogfood.
 *
 * This wrapper classifies the structured `feature sync --json` result, persists a blocked-state
 * record, and suppresses a duplicate blocked attempt **until a relevant input changes**
 * (feature file content, linked-task statuses, or verdict artifact mtimes). Applied and no-op
 * results pass through unchanged (R5). No mandatory `--dry-run` is added (R4).
 *
 * Pure functions (`classifySyncResult`, `computeFingerprint`, `shouldSuppressBlocked`,
 * `decideBoundedSync`, `processSyncResult`, `serializeBlockedState`, `parseBlockedState`,
 * `parseBoundedSyncCliArgs`) are exported for unit testing; `runBoundedCli` does the I/O.
 *
 * Mirrors the batch-preflight.ts pattern (task 0279): pure logic + thin CLI entry, local types
 * to avoid importing service packages into the plugin tree.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Local types (match packages/app FeatureService shapes; no package import) ───────────

export interface FeatureSyncProposal {
    featureId: string;
    from: string;
    to: string;
    reason: string;
    requiresConfirm?: boolean;
    gateBlocked?: boolean;
    gateFindings?: unknown[];
    hops?: string[];
}

export interface FeatureSyncResult {
    proposal: FeatureSyncProposal;
    applied: boolean;
    appliedHops: string[];
}

export type SyncClassification = 'applied' | 'no-op' | 'blocked';

// ── Pure classification logic ────────────────────────────────────────────────────────────

/**
 * Classify a structured feature-sync result.
 *
 * `gateBlocked` is checked FIRST: a gate-blocked proposal with a partial hop can report
 * `applied: true` (e.g. backlog→active applied, but the engine stopped before the gate-blocked
 * done transition). That must still classify as 'blocked' so the suppressed record is written
 * and identical retries are avoided.
 *
 * After that: `applied === true` → 'applied'; `from !== to` (and not applied) → 'blocked'
 * (covers requiresConfirm-deferred hops); otherwise 'no-op' (from === to).
 */
export function classifySyncResult(result: FeatureSyncResult): SyncClassification {
    if (result.proposal.gateBlocked === true) return 'blocked';
    if (result.applied === true) return 'applied';
    if (result.proposal.from !== result.proposal.to) return 'blocked';
    return 'no-op';
}

// ── Input fingerprint ────────────────────────────────────────────────────────────────────

export interface FingerprintInput {
    /** Hash of the feature file content (e.g. sha256 of the markdown body from `feature show`). */
    featureContentHash: string;
    /** Stable vector of `<wbs>:<status>` for all linked tasks, WBS-sorted. */
    taskStatusVector: string[];
    /** Stable vector of `<wbs>:<mtime>` for verdict artifacts that exist, WBS-sorted. */
    verdictMtimeVector: string[];
}

/**
 * Deterministic SHA-256 fingerprint over the three input signals that can invalidate a blocked
 * suppression: the feature file itself, the linked task statuses, and the verdict artifact
 * mtimes. Sliced to 32 hex chars for a compact, collision-safe key.
 */
export function computeFingerprint(input: FingerprintInput): string {
    // Sort the vectors so the fingerprint is order-insensitive: the CLI may return tasks or
    // verdict files in any order, and only the *set* of statuses/mtimes matters for detecting a
    // genuine input change.
    const material = [
        input.featureContentHash,
        ...[...input.taskStatusVector].sort(),
        ...[...input.verdictMtimeVector].sort(),
    ].join('\n');
    return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

// ── Blocked-state record (persisted) ─────────────────────────────────────────────────────

export interface BlockedState {
    featureId: string;
    inputFingerprint: string;
    proposal: FeatureSyncProposal;
    classification: SyncClassification;
    result: FeatureSyncResult;
    persistedAt: string;
}

export const blockedStateFile = (featureId: string, runDir: string): string =>
    `${runDir.replace(/\/$/, '')}/feature-sync-blocked-${featureId}.json`;

export function serializeBlockedState(state: BlockedState): string {
    return `${JSON.stringify(state)}\n`;
}

export function parseBlockedState(raw: string): BlockedState | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
        const parsed = JSON.parse(trimmed) as BlockedState;
        if (
            typeof parsed.featureId !== 'string' ||
            typeof parsed.inputFingerprint !== 'string' ||
            typeof parsed.proposal !== 'object' ||
            parsed.proposal === null
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

// ── Suppression decision ────────────────────────────────────────────────────────────────

/**
 * Given a persisted blocked state and the current input fingerprint, decide whether the new
 * attempt should be suppressed (identical inputs, same blocked proposal) or allowed (inputs
 * changed, or no prior blocked record).
 *
 * Returns `suppress: true` when the prior blocked result should be replayed without invoking
 * `feature sync` again.
 */
export function shouldSuppressBlocked(
    prior: BlockedState | null,
    currentFingerprint: string,
): { suppress: boolean; replay?: FeatureSyncResult } {
    if (!prior) return { suppress: false };
    if (prior.inputFingerprint === currentFingerprint) {
        return { suppress: true, replay: prior.result };
    }
    return { suppress: false };
}

// ── Orchestration decision (pure) ────────────────────────────────────────────────────────

export type BoundedSyncOutcome = { kind: 'invoke' } | { kind: 'suppress'; replay: FeatureSyncResult };

/**
 * Decide whether to actually invoke `feature sync` given the persisted blocked state and the
 * current input fingerprint. This is the pure heart of the retry-suppression policy (R1–R3):
 *
 * - No prior blocked state → invoke (fresh attempt).
 * - Prior blocked state + identical fingerprint → suppress and replay the prior result.
 * - Prior blocked state + changed fingerprint → invoke (inputs changed; R3 allows a new attempt).
 */
export function decideBoundedSync(prior: BlockedState | null, currentFingerprint: string): BoundedSyncOutcome {
    const decision = shouldSuppressBlocked(prior, currentFingerprint);
    if (decision.suppress && decision.replay) {
        return { kind: 'suppress', replay: decision.replay };
    }
    return { kind: 'invoke' };
}

// ── Result processing (pure) ─────────────────────────────────────────────────────────────

export interface ProcessSyncResultOutcome {
    classification: SyncClassification;
    /** The result to emit to stdout (replayed for suppressed, live for invoked). */
    emit: FeatureSyncResult;
    /** When classification === 'blocked', the state to persist. */
    persist?: BlockedState;
    /** Human-readable one-line annotation for the run report (may be empty). */
    annotation: string;
}

/**
 * Process a live or replayed feature-sync result: classify it, and — if blocked — produce the
 * blocked-state record to persist. Applied/no-op results clear any annotation and never persist.
 */
export function processSyncResult(
    result: FeatureSyncResult,
    currentFingerprint: string,
    persistedAt: string,
    wasSuppressed: boolean,
): ProcessSyncResultOutcome {
    const classification = classifySyncResult(result);

    if (classification === 'blocked') {
        return {
            classification,
            emit: result,
            persist: {
                featureId: result.proposal.featureId,
                inputFingerprint: currentFingerprint,
                proposal: result.proposal,
                classification,
                result,
                persistedAt,
            },
            annotation: wasSuppressed
                ? `feature-sync-bounded: suppressed duplicate blocked sync for ${result.proposal.featureId} (inputs unchanged)`
                : `feature-sync-bounded: blocked proposal for ${result.proposal.featureId} — ${result.proposal.reason}`,
        };
    }

    return {
        classification,
        emit: result,
        annotation: '',
    };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────

export interface BoundedSyncCliArgs {
    featureId: string;
    spurBin: string;
    runDir: string;
    json: boolean;
    help: boolean;
}

export const BOUNDED_SYNC_CLI_USAGE = `Usage:
  bun plugins/sp/scripts/feature-sync-bounded.ts <feature-id> \\
    --spur-bin <spur|bun apps/cli/src/index.ts> \\
    [--run-dir .spur/run] [--json]

Wraps 'spur feature sync <id> --json' with bounded retry-suppression: an identical
blocked proposal is reported once and suppressed until feature file content, linked
task statuses, or verdict artifact mtimes change. Applied and no-op results pass
through unchanged.

Exit: 0 = sync handled (applied / no-op / suppressed-blocked / live-blocked).`;

/**
 * Resolve the spur CLI command in a monorepo-safe way:
 * --spur-bin > SPUR_BIN > monorepo-local CLI entry > PATH `spur`.
 * The plugin's own CI always passes an explicit --spur-bin; this fallback chain
 * keeps ad-hoc invocations from silently hitting a stale PATH install.
 */
export function defaultSpurBin(): string {
    if (process.env.SPUR_BIN) return process.env.SPUR_BIN;
    // scripts/ -> plugins/sp/ -> <repo>/apps/cli/src/index.ts
    const local = new URL('../../../apps/cli/src/index.ts', import.meta.url).pathname;
    if (existsSync(local)) return `bun ${local}`;
    return 'spur';
}

export function parseBoundedSyncCliArgs(argv: string[]): BoundedSyncCliArgs {
    let featureId = '';
    let spurBin = defaultSpurBin();
    let runDir = '.spur/run';
    let json = false;
    let help = false;

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') help = true;
        else if (a === '--json') json = true;
        else if (a === '--spur-bin') spurBin = argv[++i] ?? spurBin;
        else if (a === '--run-dir') runDir = argv[++i] ?? runDir;
        else if (!a.startsWith('--') && featureId === '') featureId = a;
    }
    return { featureId, spurBin, runDir, json, help };
}

type SpawnResult = { stdout: string; stderr: string; exitCode: number; ok: boolean };
function runSpurJson(spurBin: string, args: string[]): SpawnResult {
    const binParts = spurBin.split(/\s+/).filter(Boolean);
    const cmd = binParts[0] ?? 'spur';
    const cmdArgs = [...binParts.slice(1), ...args];
    const r = Bun.spawnSync({ cmd: [cmd, ...cmdArgs], stdio: ['ignore', 'pipe', 'pipe'] });
    const decode = (b: unknown): string =>
        typeof b === 'string' ? b : Buffer.from((b as Uint8Array) ?? []).toString('utf8');
    return {
        stdout: decode(r.stdout),
        stderr: decode(r.stderr),
        exitCode: r.exitCode ?? 0,
        ok: (r.exitCode ?? 0) === 0,
    };
}

function readFeatureContentHash(spurBin: string, featureId: string): string | null {
    const r = runSpurJson(spurBin, ['feature', 'show', featureId, '--json']);
    if (!r.ok) return null;
    try {
        const parsed = JSON.parse(r.stdout) as { content?: string };
        if (typeof parsed.content !== 'string') return null;
        return createHash('sha256').update(parsed.content).digest('hex');
    } catch {
        return null;
    }
}

function readTaskStatusVector(spurBin: string, featureId: string): string[] | null {
    const r = runSpurJson(spurBin, ['task', 'list', '--feature', featureId, '--json']);
    if (!r.ok) return null;
    try {
        const parsed = JSON.parse(r.stdout) as Array<{ wbs?: string; status?: string }>;
        return parsed
            .filter((t) => typeof t.wbs === 'string' && typeof t.status === 'string')
            .map((t) => `${t.wbs}:${t.status}`)
            .sort();
    } catch {
        return null;
    }
}

function readVerdictMtimeVector(runDir: string): string[] {
    // Verdict artifacts live in <runDir>/<wbs>-verdict.json. Missing files contribute nothing
    // (a task with no verdict yet is a stable "absent" signal captured by its absence).
    //
    // Read via node:fs rather than `ls` + `stat` subprocesses: BSD `stat -f %m` (macOS) and GNU
    // `stat -c %Y` (Linux) disagree, so the shell form silently yielded an empty mtime vector on
    // Linux servers — dropping the verdict signal from the fingerprint and making suppression
    // sticky across verdict changes (R3). statSync is portable and avoids a spawn per file.
    const dir = runDir.replace(/\/$/, '');
    let entries: string[];
    try {
        entries = readdirSync(dir).filter((f) => f.endsWith('-verdict.json'));
    } catch {
        return [];
    }

    const vector: string[] = [];
    for (const entry of entries) {
        try {
            const mtime = statSync(`${dir}/${entry}`).mtimeMs;
            vector.push(`${entry.replace('-verdict.json', '')}:${mtime}`);
        } catch {
            // Removed between readdir and stat — treat as absent.
        }
    }
    return vector.sort();
}

function writeBlockedState(state: BlockedState, path: string): void {
    try {
        // Create the run dir if absent: without it the write throws and suppression silently
        // degrades to "invoke every time" — the exact defect this wrapper exists to fix.
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, serializeBlockedState(state));
    } catch (err) {
        // Persistence stays best-effort (the live sync result is still correct), but a failure
        // must be visible: a silent degrade is indistinguishable from the bug.
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`feature-sync-bounded: could not persist blocked state to ${path} — ${reason}\n`);
    }
}

function readBlockedState(path: string): BlockedState | null {
    try {
        const f = Bun.file(path);
        const text = f.size > 0 ? readFileSync(path, 'utf8') : '';
        return parseBlockedState(text);
    } catch {
        return null;
    }
}

/**
 * Run the bounded-sync CLI. Does all I/O (subprocess calls, file read/write) but delegates
 * every decision to the pure functions above. Falls back to a direct `feature sync` invocation
 * if any pre-check call fails (R4: no mandatory dry-run, and pre-check failure must not block
 * the real sync).
 */
export function runBoundedCli(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
    const args = parseBoundedSyncCliArgs(argv);
    if (args.help) return { exitCode: 0, stdout: '', stderr: BOUNDED_SYNC_CLI_USAGE };
    if (!args.featureId) return { exitCode: 1, stdout: '', stderr: BOUNDED_SYNC_CLI_USAGE };

    const statePath = blockedStateFile(args.featureId, args.runDir);
    const prior = readBlockedState(statePath);

    // Pre-check input fingerprint. If any signal is unreadable, fall back to a direct live sync
    // (correctness over suppression).
    const featureContentHash = readFeatureContentHash(args.spurBin, args.featureId);
    const taskStatusVector = readTaskStatusVector(args.spurBin, args.featureId);
    if (featureContentHash === null || taskStatusVector === null) {
        return invokeLiveSync(args, statePath);
    }
    const verdictMtimeVector = readVerdictMtimeVector(args.runDir);

    const currentFingerprint = computeFingerprint({
        featureContentHash,
        taskStatusVector,
        verdictMtimeVector,
    });

    const decision = decideBoundedSync(prior, currentFingerprint);

    if (decision.kind === 'suppress') {
        const processed = processSyncResult(decision.replay, currentFingerprint, new Date().toISOString(), true);
        emitResult(processed.emit, processed.annotation, args.json);
        return { exitCode: 0, stdout: '', stderr: '' };
    }

    return invokeLiveSync(args, statePath, currentFingerprint);
}

function invokeLiveSync(
    args: BoundedSyncCliArgs,
    statePath: string,
    fingerprint?: string,
): { exitCode: number; stdout: string; stderr: string } {
    const r = runSpurJson(args.spurBin, ['feature', 'sync', args.featureId, '--json']);
    if (!r.ok) {
        // The underlying sync failed (non-zero exit). Surface its stderr verbatim; do not
        // fabricate a blocked classification from an error.
        return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    }

    let result: FeatureSyncResult;
    try {
        result = JSON.parse(r.stdout) as FeatureSyncResult;
    } catch {
        // Unparseable sync output — surface it raw rather than guessing.
        return { exitCode: r.exitCode, stdout: r.stdout, stderr: '' };
    }
    // Shape guard (review finding 1): a parseable envelope that is not a FeatureSyncResult
    // (missing `proposal`) must fail loudly with a message, not a TypeError in
    // classifySyncResult. Mirrors the validation the read side already performs.
    if (!result || typeof result !== 'object' || !result.proposal) {
        return {
            exitCode: r.exitCode,
            stdout: r.stdout,
            stderr: 'unrecognized feature sync envelope: missing proposal',
        };
    }

    // If we have no fingerprint (pre-check fallback path), recompute minimal signals so we can
    // still persist a blocked record. Missing signals yield an empty-string fingerprint, which
    // still suppresses identical retries within the same batch (the inputs haven't changed from
    // our view either). A real input change the next time will still invalidate because the
    // pre-check will succeed and produce a real fingerprint.
    const currentFingerprint =
        fingerprint ??
        computeFingerprint({
            featureContentHash: readFeatureContentHash(args.spurBin, args.featureId) ?? '',
            taskStatusVector: readTaskStatusVector(args.spurBin, args.featureId) ?? [],
            verdictMtimeVector: readVerdictMtimeVector(args.runDir),
        });

    const processed = processSyncResult(result, currentFingerprint, new Date().toISOString(), false);
    if (processed.persist) writeBlockedState(processed.persist, statePath);
    emitResult(processed.emit, processed.annotation, args.json);
    return { exitCode: 0, stdout: '', stderr: '' };
}

function emitResult(result: FeatureSyncResult, annotation: string, json: boolean): void {
    if (json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
        process.stdout.write(
            `${result.proposal.featureId}: ${result.proposal.from} → ${result.proposal.to} (applied=${result.applied})\n`,
        );
    }
    if (annotation.length > 0) process.stderr.write(`${annotation}\n`);
}

if (import.meta.main) {
    const { exitCode, stdout, stderr } = runBoundedCli(Bun.argv.slice(2));
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    process.exit(exitCode);
}
