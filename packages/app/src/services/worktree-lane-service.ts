import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { AgentFleet } from '@gobing-ai/spur-config';
import { type DbAdapter, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem, type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { normalizeProjectPath } from './project-registry';

/**
 * Fleet worktree lanes (G76 task 1341, ADR-149): one git worktree per write dispatch
 * attempt. This module is the ONLY orchestration code that runs `git worktree`.
 */

const KEY_PATTERN = /^fleet:task:([^:]+):(\d+)$/;

/** The lane branch for one attempt: `sp/run-<wbs>-<attempt>`. */
export function laneBranch(wbs: string, attempt: number): string {
    return `sp/run-${wbs}-${attempt}`;
}

/** The lane parent dir: `laneRoot` resolved against the project, default `../<repo>.spur-lanes`. */
export function resolveLaneRoot(projectPath: string, laneRoot: string | undefined): string {
    const project = normalizeProjectPath(projectPath);
    const root = resolve(project, laneRoot ?? `../${basename(project)}.spur-lanes`);
    const rel = relative(project, root);
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
        throw new Error(`agent.fleet.laneRoot must lie outside the repository: ${root} is inside ${project}`);
    }
    return root;
}

/** The lane path for one attempt: `<laneRoot>/<repo>-<wbs>-<attempt>`. */
export function lanePath(projectPath: string, laneRoot: string | undefined, wbs: string, attempt: number): string {
    const project = normalizeProjectPath(projectPath);
    return join(normalizeProjectPath(resolveLaneRoot(project, laneRoot)), `${basename(project)}-${wbs}-${attempt}`);
}

/**
 * The lane a keyed dispatch runs in, derived from its request key `fleet:task:<wbs>:<n>`
 * and the project config — no inbox or wire change. Null when lane mode is off
 * (`maxWriters` absent) or the key is not a fleet task key.
 */
export function laneForRequestKey(
    projectPath: string,
    fleetCfg: Pick<AgentFleet, 'maxWriters' | 'laneRoot'> | null | undefined,
    key: string,
): string | null {
    if (fleetCfg?.maxWriters === undefined) return null;
    const match = KEY_PATTERN.exec(key);
    if (match === null) return null;
    return lanePath(projectPath, fleetCfg.laneRoot, match[1] ?? '', Number(match[2]));
}

/** True when `path` is one of this project's lanes (lane mode on, under laneRoot, `<repo>-` prefixed). */
export function isProjectLane(
    projectPath: string,
    fleetCfg: Pick<AgentFleet, 'maxWriters' | 'laneRoot'> | null | undefined,
    path: string,
): boolean {
    if (fleetCfg?.maxWriters === undefined) return false;
    const project = normalizeProjectPath(projectPath);
    const candidate = normalizeProjectPath(path);
    return (
        dirname(candidate) === normalizeProjectPath(resolveLaneRoot(project, fleetCfg.laneRoot)) &&
        basename(candidate).startsWith(`${basename(project)}-`)
    );
}

/** A named A2A member uses its already-registered lane worktree when lane mode is enabled. */
export async function a2aMemberLane(
    projectPath: string,
    fleetCfg: Pick<AgentFleet, 'maxWriters' | 'laneRoot'> | null | undefined,
    localId: string | undefined,
): Promise<{ cwd: string; branch: string } | null> {
    if (fleetCfg?.maxWriters === undefined || localId === undefined) return null;
    const result = await new NodeProcessExecutor().run({
        command: 'git',
        args: ['worktree', 'list', '--porcelain', '-z'],
        cwd: projectPath,
        timeout: 5_000,
        rejectOnError: false,
    });
    if (result.exitCode !== 0) return null;
    const branch = `lane/${localId}`;
    for (const record of result.stdout.split('\0\0')) {
        const fields = record.split('\0');
        const path = fields[0]?.replace(/^worktree /, '');
        if (path && fields.includes(`branch refs/heads/${branch}`) && isProjectLane(projectPath, fleetCfg, path)) {
            if (await createNodeFileSystem(projectPath).exists(path))
                return { cwd: normalizeProjectPath(path), branch };
        }
    }
    return null;
}

/** One live lane, parsed from `git worktree list --porcelain`. */
export interface Lane {
    path: string;
    branch: string;
    wbs: string;
    attempt: number;
}

/** What reconcile needs to know about an attempt: in flight, settled, or never dispatched. */
export type LaneAttemptState = 'open' | 'terminal' | 'none';

/** Construction inputs for {@link WorktreeLaneService}. */
export interface WorktreeLaneServiceDeps {
    projectPath: string;
    laneRoot?: string;
    /** The BASE project's db: lane events live beside the claims and inbox. */
    getDb: () => Promise<DbAdapter>;
}

/** Opens, retains, disposes and reconciles one project's lanes (design §4.4–4.5). */
export class WorktreeLaneService {
    private readonly project: string;
    private readonly root: string;
    private readonly fs: FileSystem;

    constructor(private readonly deps: WorktreeLaneServiceDeps) {
        this.project = normalizeProjectPath(deps.projectPath);
        this.root = resolveLaneRoot(this.project, deps.laneRoot);
        this.fs = createNodeFileSystem(this.project);
    }

    /**
     * Open (or reuse) the lane for one attempt: idempotent per (wbs, attempt). Bootstraps
     * `.spur/run` — `.spur/config.yaml` is tracked, so the checkout already carries config.
     */
    async open(wbs: string, attempt: number, opts: { branch?: string } = {}): Promise<Lane & { reused: boolean }> {
        // G76 1345: a fetched remote branch is checked out AS the lane, so the integration queue
        // lands it through the identical rebase/gate/ff-only path. Absent = this attempt's own name.
        const branch = opts.branch ?? laneBranch(wbs, attempt);
        const path = lanePath(this.project, this.deps.laneRoot, wbs, attempt);
        const existing = (await this.list()).find((lane) => lane.path === path);
        if (existing === undefined) {
            await this.fs.ensureDir(this.root);
            const branchExists = (await this.git('branch', '--list', branch)) !== '';
            if (branchExists) await this.git('worktree', 'add', path, branch);
            else if (opts.branch !== undefined) {
                // A fetched branch must exist; creating it here would silently land an empty lane.
                throw new Error(`lane open: branch ${branch} does not exist in ${this.project}`);
            } else await this.git('worktree', 'add', '-b', branch, path, 'HEAD');
            await this.fs.ensureDir(join(path, '.spur', 'run'));
        }
        const lane = { path: normalizeProjectPath(path), branch, wbs, attempt };
        await this.emit('fleet.lane.opened', { ...lane, ...(existing !== undefined ? { reused: true } : {}) });
        return { ...lane, reused: existing !== undefined };
    }

    /** A non-landing outcome leaves the lane in place (design §4.4 inv. 5); this records why. */
    async retain(wbs: string, attempt: number, reason: string): Promise<void> {
        const path = lanePath(this.project, this.deps.laneRoot, wbs, attempt);
        await this.emit('fleet.lane.retained', { wbs, attempt, path, branch: laneBranch(wbs, attempt), reason });
    }

    /** Remove the lane and its branch. Callers dispose only after a landing receipt (1342) or an orphan prune. */
    async dispose(wbs: string, attempt: number, reason = 'landed'): Promise<void> {
        const path = lanePath(this.project, this.deps.laneRoot, wbs, attempt);
        const branch = laneBranch(wbs, attempt);
        if (await this.fs.exists(path)) await this.git('worktree', 'remove', '--force', path);
        await this.git('worktree', 'prune');
        if ((await this.git('branch', '--list', branch)) !== '') await this.git('branch', '-D', branch);
        await this.emit('fleet.lane.disposed', { wbs, attempt, path, branch, reason });
    }

    /** This project's lanes: worktrees under laneRoot named `<repo>-<wbs>-<attempt>`. */
    async list(): Promise<Lane[]> {
        const root = normalizeProjectPath(this.root);
        const prefix = `${basename(this.project)}-`;
        const lanes: Lane[] = [];
        for (const block of (await this.git('worktree', 'list', '--porcelain')).split(/\n\n+/)) {
            const path = /^worktree (.+)$/m.exec(block)?.[1];
            const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
            if (path === undefined || branch === undefined || dirname(path) !== root) continue;
            const name = basename(path);
            const match = /^(.+)-(\d+)$/.exec(name.slice(prefix.length));
            if (!name.startsWith(prefix) || match === null) continue;
            lanes.push({ path, branch, wbs: match[1] ?? '', attempt: Number(match[2]) });
        }
        return lanes;
    }

    /**
     * Crash reconciliation (design §4.5), write side only. An open attempt's lane is
     * reused (re-emits `fleet.lane.opened` with `reused`); a lane with no attempt row and
     * no commits beyond HEAD is pruned; a settled attempt's lane stays (1342's queue or a
     * retained failure). Mid-rebase/merge lanes are 1342's.
     */
    async reconcile(attemptOf: (wbs: string, attempt: number) => Promise<LaneAttemptState>): Promise<void> {
        for (const lane of await this.list()) {
            const state = await attemptOf(lane.wbs, lane.attempt);
            if (state === 'open') {
                await this.emit('fleet.lane.opened', { ...lane, reused: true });
            } else if (state === 'none' && (await this.git('rev-list', '--count', `HEAD..${lane.branch}`)) === '0') {
                await this.dispose(lane.wbs, lane.attempt, 'orphan');
            }
        }
    }

    private async git(...args: string[]): Promise<string> {
        const res = await new NodeProcessExecutor().run({
            command: 'git',
            args,
            cwd: this.project,
            rejectOnError: false,
        });
        if (res.exitCode !== 0) {
            throw new Error(`git ${args.join(' ')} failed in ${this.project}: ${(res.stderr ?? '').trim()}`);
        }
        return (res.stdout ?? '').trim();
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
}
