import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type DbAdapter, ProjectClaimDao, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { normalizeProjectPath } from './project-registry';
import { laneBranch, type WorktreeLaneService } from './worktree-lane-service';
import { persistWorktreeRuns } from './worktree-persist';

/**
 * The fleet integration queue (G76 task 1342, ADR-149): the serialized, engine-owned landing
 * path for finished write lanes. A lane's commits and status edits are invisible to the base
 * until they land here, which is why admission waits for `fleet.task.integrated` rather than
 * for corpus status (design `fleet-orchestration-lanes.md` §4.4/§4.6).
 */

/** One lane waiting to land: a successful attempt with no `fleet.task.integrated` event yet. */
export interface IntegrationCandidate {
    wbs: string;
    attempt: number;
    /**
     * G76 1345: `<remote>/<branch>` a remote writer reported. It is fetched into
     * `sp/remote-<wbs>-<attempt>` and lands through the identical path; absent = a local lane.
     */
    remoteBranch?: string;
}

/** What one drain did: a landing, a retained rebase conflict, or a retained gate failure. */
export type IntegrationOutcome =
    | {
          kind: 'landed';
          wbs: string;
          attempt: number;
          baseBefore: string;
          baseAfter: string;
          treeHash: string;
          gateReceiptId: string;
      }
    | { kind: 'conflict'; wbs: string; attempt: number; path: string; branch: string }
    | { kind: 'gate-failed'; wbs: string; attempt: number; gateReceiptId: string }
    | { kind: 'not-started'; wbs: string; attempt: number; reason: string };

/** The gate verdict for one tree. `PASS` also covers a receipt reused at the same tree hash. */
export type IntegrationGateVerdict = 'PASS' | 'FAIL';

/** Injected seams: candidate selection, gating, feature sync and lane lifecycle stay outside. */
export interface FleetIntegrationQueueDeps {
    /** The base branch landings fast-forward — whatever the base tree has checked out. */
    baseBranch: string;
    /** Lane lifecycle: listing, retention on a non-landing outcome, disposal after a landing. */
    lanes: Pick<WorktreeLaneService, 'list' | 'retain' | 'dispose' | 'open'>;
    /** The BASE project's db: claims, events and lane rows live beside the base tree. */
    getDb: () => Promise<DbAdapter>;
    /** Successful attempts, oldest receipt first — the receipt is the completion evidence. */
    candidates: () => Promise<IntegrationCandidate[]>;
    /** Runs the project gate for one wbs in one tree; its receipt is keyed by that tree's hash. */
    runGate: (wbs: string, cwd: string) => Promise<IntegrationGateVerdict>;
    /** The task's linked feature, so a feature syncs once after its last landing. */
    featureOf: (wbs: string) => Promise<string | null>;
    syncFeature: (featureId: string) => Promise<void>;
    /** The merged task file whose `.spur/run` citations the evidence copy must keep resolvable. */
    taskFileOf?: (wbs: string) => Promise<string | null>;
}

/** `integrate` claim identity + lease: one landing at a time across every host of the project. */
const INTEGRATE_HOLDER = 'integration-queue';
const INTEGRATE_TTL_MS = 5 * 60_000;

/** The integrated marker: a landed attempt is never re-queued. */
const INTEGRATED_EVENT = 'fleet.task.integrated';

/**
 * The serialized landing consumer (G76 1342). One `drainOne` call lands at most one finished
 * lane, under the `integrate` claim, so landings never overlap — and the queue itself is derived
 * from receipts plus events, so a crash costs no bookkeeping.
 */
export class FleetIntegrationQueue {
    constructor(private readonly deps: FleetIntegrationQueueDeps) {}

    /**
     * Land at most one lane (design §4.4). Null when nothing is queued or another host holds the
     * `integrate` claim — the tick drives the queue, never a daemon.
     */
    async drainOne(projectPath: string, opts: { ownerEpoch: number }): Promise<IntegrationOutcome | null> {
        const base = normalizeProjectPath(projectPath);
        const db = await this.deps.getDb();
        const claims = new ProjectClaimDao(db);
        if ((await claims.get(base, 'integrate')) !== null) return null;
        const queued = await this.pending(db);
        const candidate = queued[0];
        if (candidate === undefined) return null;
        const claim = await claims.claim(base, 'integrate', INTEGRATE_HOLDER, INTEGRATE_TTL_MS, opts.ownerEpoch);
        if (claim === null) return null;
        try {
            return await this.land(base, candidate, queued);
        } finally {
            await claims.release(base, 'integrate', INTEGRATE_HOLDER, claim.ownerEpoch);
        }
    }

    /** Candidates minus the attempts already marked integrated (derived each tick, no queue table). */
    private async pending(db: DbAdapter): Promise<Array<IntegrationCandidate & { branch?: string; path?: string }>> {
        const integrated = new Set<string>();
        for (const row of await new SystemEventDao(db).query({ name: INTEGRATED_EVENT, limit: 500 })) {
            const payload = JSON.parse(row.payload_json ?? '{}') as { wbs?: unknown; attempt?: unknown };
            if (typeof payload.wbs === 'string' && typeof payload.attempt === 'number') {
                integrated.add(`${payload.wbs}:${payload.attempt}`);
            }
        }
        const lanes = new Map((await this.deps.lanes.list()).map((lane) => [`${lane.wbs}:${lane.attempt}`, lane]));
        const pending: Array<IntegrationCandidate & { branch?: string; path?: string }> = [];
        for (const candidate of await this.deps.candidates()) {
            const key = `${candidate.wbs}:${candidate.attempt}`;
            if (integrated.has(key)) continue;
            const lane = lanes.get(key);
            // A remote writer's lane does not exist yet: it is fetched and opened at drain time.
            // A local candidate with no worktree (disposed, or never opened) cannot be rebased.
            if (lane !== undefined) pending.push({ ...candidate, branch: lane.branch, path: lane.path });
            else if (candidate.remoteBranch !== undefined) pending.push(candidate);
        }
        return pending;
    }

    /** rebase → gate (receipt-keyed) → `--ff-only` → persist evidence → marker → sync → dispose. */
    private async land(
        base: string,
        candidate: IntegrationCandidate & { branch?: string; path?: string },
        queued: IntegrationCandidate[],
    ): Promise<IntegrationOutcome> {
        const { wbs, attempt } = candidate;
        // G76 1345: a remote writer's branch is fetched into the queue's own namespace and opened
        // as the lane. A missing branch or an unknown remote is `not-started` for INTEGRATION — the
        // remote turn is never replayed (ADR-126 A4).
        let lane = { branch: candidate.branch ?? '', path: candidate.path ?? '' };
        if (lane.path === '' && candidate.remoteBranch !== undefined) {
            const fetched = await this.fetchRemote(base, candidate.remoteBranch, wbs, attempt);
            if ('reason' in fetched) return { kind: 'not-started', wbs, attempt, reason: fetched.reason };
            try {
                const opened = await this.deps.lanes.open(wbs, attempt, { branch: fetched.branch });
                lane = { branch: opened.branch, path: opened.path };
            } catch (error) {
                return {
                    kind: 'not-started',
                    wbs,
                    attempt,
                    reason: `lane open failed: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
        }
        if (lane.path === '') return { kind: 'not-started', wbs, attempt, reason: 'no lane for this attempt' };
        const { branch, path } = lane;
        const baseBefore = await this.git(['rev-parse', 'HEAD'], base);
        // 1. Rebase the lane onto the base tip. A conflict aborts and retains — never a resolution.
        try {
            await this.git(['rebase', this.deps.baseBranch], path);
        } catch {
            await this.git(['rebase', '--abort'], path).catch(() => '');
            await this.deps.lanes.retain(wbs, attempt, 'integration-conflict');
            return { kind: 'conflict', wbs, attempt, path, branch };
        }
        // 2. Gate the rebased tree. The gate's receipt is keyed by the tree hash, so an unchanged
        //    tree reuses its PASS and a moved tree is gated again — no second hash mechanism here.
        const verdict = await this.deps.runGate(wbs, path);
        const receipt = await this.gateReceipt(path, wbs);
        if (verdict !== 'PASS') {
            await this.deps.lanes.retain(wbs, attempt, 'gate-failed');
            return { kind: 'gate-failed', wbs, attempt, gateReceiptId: receipt.path };
        }
        // 3. Fast-forward only: no merge commit, and a base that moved under us retains the lane.
        try {
            await this.git(['merge', '--ff-only', branch], base);
        } catch {
            await this.deps.lanes.retain(wbs, attempt, 'integration-conflict');
            return { kind: 'conflict', wbs, attempt, path, branch };
        }
        // 4. Evidence before disposal: a throw here must not lose the lane's run rows.
        const taskFile = await this.deps.taskFileOf?.(wbs);
        try {
            await persistWorktreeRuns({
                fromWorkdir: path,
                toWorkdir: base,
                ...(taskFile !== null && taskFile !== undefined ? { taskFiles: [taskFile] } : {}),
            });
        } catch (error) {
            await this.deps.lanes.retain(wbs, attempt, 'evidence-persist-failed');
            throw error;
        }
        const baseAfter = await this.git(['rev-parse', 'HEAD'], base);
        const outcome: IntegrationOutcome = {
            kind: 'landed',
            wbs,
            attempt,
            baseBefore,
            baseAfter,
            treeHash: receipt.treeHash,
            gateReceiptId: receipt.path,
        };
        await this.emit(INTEGRATED_EVENT, { ...outcome });
        // 5. Sync each feature once, after its last un-landed slice.
        const feature = await this.deps.featureOf(wbs);
        if (feature !== null) {
            const siblings = queued.filter((other) => other.wbs !== wbs);
            const siblingFeatures = await Promise.all(siblings.map((other) => this.deps.featureOf(other.wbs)));
            if (!siblingFeatures.includes(feature)) await this.deps.syncFeature(feature);
        }
        await this.deps.lanes.dispose(wbs, attempt);
        // A fetched remote branch is Spur's own ref, so it goes with the lane; `dispose` only knows
        // this attempt's local name.
        if (branch !== laneBranch(wbs, attempt)) await this.git(['branch', '-D', branch], base).catch(() => '');
        return outcome;
    }

    /**
     * Fetch `<remote>/<branch>` into `sp/remote-<wbs>-<attempt>` (G76 1345). The operator's own git
     * config and credential helpers do the work; Spur stores no URL and no credential (R4).
     */
    private async fetchRemote(
        base: string,
        remoteBranch: string,
        wbs: string,
        attempt: number,
    ): Promise<{ branch: string } | { reason: string }> {
        const [remote, ...rest] = remoteBranch.split('/');
        const source = rest.join('/');
        if (remote === undefined || remote === '' || source === '') {
            return { reason: `remoteBranch '${remoteBranch}' is not '<remote>/<branch>'` };
        }
        try {
            await this.git(['remote', 'get-url', remote], base);
        } catch {
            return { reason: `remote '${remote}' is not configured in ${base}` };
        }
        const branch = `sp/remote-${wbs}-${attempt}`;
        try {
            await this.git(['fetch', remote, `${source}:${branch}`], base);
        } catch (error) {
            return {
                reason: `fetch ${remoteBranch} failed: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        return { branch };
    }

    /** The gate receipt's tree hash + repo-relative path, read from the lane the gate just judged. */
    private async gateReceipt(lanePath: string, wbs: string): Promise<{ path: string; treeHash: string }> {
        const path = join('.spur', 'run', `${wbs}-check-receipt.json`);
        try {
            const parsed = JSON.parse(await createNodeFileSystem(lanePath).readFile(path)) as { inputDigest?: unknown };
            return { path, treeHash: typeof parsed.inputDigest === 'string' ? parsed.inputDigest : '' };
        } catch {
            // No receipt (a gate that never wrote one) is not a landing blocker: the verdict above
            // is the decision, and an empty hash only weakens the record.
            return { path, treeHash: '' };
        }
    }

    private async emit(name: string, payload: Record<string, unknown>): Promise<void> {
        await new SystemEventDao(await this.deps.getDb()).insert({
            id: randomUUID(),
            event_name: name,
            occurred_at: new Date().toISOString(),
            actor: 'fleet',
            payload_json: JSON.stringify(payload),
            entity_kind: 'task',
            entity_id: typeof payload.wbs === 'string' ? payload.wbs : null,
        });
    }

    /** Every landing git call goes through one argv-only executor (no shell, no `child_process`). */
    private async git(args: string[], cwd: string): Promise<string> {
        const res = await new NodeProcessExecutor().run({ command: 'git', args, cwd, rejectOnError: false });
        if (res.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${(res.stderr ?? '').trim()}`);
        return (res.stdout ?? '').trim();
    }
}
