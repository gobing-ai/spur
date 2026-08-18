/**
 * Anchor qualification pass (task 0583 R1–R3) — mechanical repair of in-repo
 * evidence anchors that cite a bare filename or wrong-prefix path whose basename
 * resolves to exactly one tracked repository path.
 *
 * Distinct from the corpus migrator on purpose: the migrator's invariant is
 * "body sections are never rewritten — M-rules touch frontmatter + append-only
 * History only" (`corpus-migrator.ts:11-12`), and anchor citations live in
 * `## Testing` / `## Solution` **bodies**. So this is a standalone pass that
 * rewrites body citations through the sanctioned CLI write path
 * (`PlanningWriteService.updateSection` — the same path `spur task update
 * --section` uses), reusing the migrator's dry-run report shape and idempotency
 * contract but not its transform pipeline.
 *
 * The qualification index comes from `git ls-files` so untracked and gitignored
 * files can never be a target — a gitignored `.spur/run/**` artifact is external
 * evidence (task 0584's form), never a qualification candidate.
 *
 * Line numbers are out of scope (R3): a qualified path keeps its original line
 * range byte-for-byte. A still-stale line is caught by subject matching, not by
 * this pass rewriting the author's intended line.
 */

import { basename, join } from 'node:path';
import { resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';

// ── Types ────────────────────────────────────────────────────────────────────

/** One qualified citation rewrite. */
export interface QualifiedAnchor {
    /** Path as cited (before). */
    oldPath: string;
    /** Repo-relative replacement path (after). */
    newPath: string;
    /** The raw backticked citation, e.g. `` `Badge.tsx:42` ``. */
    raw: string;
    /** Line range preserved verbatim. */
    lineSpec: string;
}

/** Per-file qualification outcome. */
export interface AnchorFileReport {
    path: string;
    wbs: string;
    modified: boolean;
    qualified: QualifiedAnchor[];
    /** Ambiguous basenames — reported, never rewritten. */
    ambiguous: Array<{ cited: string; candidates: string[] }>;
}

/** Aggregate qualification report (mirrors MigrationReport shape). */
export interface AnchorQualifyReport {
    filesScanned: number;
    filesModified: number;
    filesSkipped: number;
    fileReports: AnchorFileReport[];
}

/** Options for a qualification run. */
export interface AnchorQualifyOptions {
    /** Produce the full report but write nothing. */
    dryRun?: boolean;
}

/** Options for an anchor qualifier. */
export interface AnchorQualifierOptions {
    fs: FileSystem;
    /** Resolved absolute task directory/directories to scan. */
    taskDirs?: string[];
    /** Writer callback: (ref, section, newBody) => Promise<void> via updateSection. */
    write?: (filePath: string, wbs: string, section: string, newBody: string) => Promise<void>;
    /** Resolve the planning folders (used when taskDirs not provided). */
    resolveFolders?: () => Promise<string[]>;
    /** Repo root for the git tracked-file index. Defaults to `git rev-parse --show-toplevel`. */
    projectRoot?: string;
}

const ANCHOR_RE = /`([^`\n]+?):(\d+)(?:-(\d+))?`/g;

/**
 * Resolve the repository root from `git rev-parse --show-toplevel` (falls back
 * to `process.cwd()`). The tracked-file index must be built from the repo root,
 * not `dirname(taskDirs[0])` — task dirs live under `docs/`, so deriving the
 * root from them runs `git ls-files` inside a subdirectory and returns paths
 * relative to it, which then qualify already-correct `docs/…` anchors backwards.
 */
export async function resolveRepoRoot(projectRoot: string | undefined): Promise<string> {
    if (projectRoot) return projectRoot;
    try {
        const result = await new NodeProcessExecutor().run({
            command: 'git',
            args: ['rev-parse', '--show-toplevel'],
            cwd: process.cwd(),
            maxOutput: 64 * 1024,
            forceBuffered: true,
            rejectOnError: false,
        });
        if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim();
    } catch {
        // fall through to cwd
    }
    return process.cwd();
}

/**
 * Build the tracked-basename index from `git ls-files`.
 *
 * Returns basename(lowercased) → full repo-relative tracked paths sharing it.
 * Untracked and gitignored files are invisible to git, so they can never be a
 * qualification target — exactly the external/form boundary task 0584 draws.
 */
export async function buildTrackedBasenameIndex(projectRoot: string): Promise<Map<string, string[]>> {
    const index = new Map<string, string[]>();
    let out: string;
    try {
        const result = await new NodeProcessExecutor().run({
            command: 'git',
            args: ['ls-files'],
            cwd: projectRoot,
            maxOutput: 64 * 1024 * 1024,
            forceBuffered: true,
            rejectOnError: false,
        });
        if (result.exitCode !== 0) return index;
        out = result.stdout;
    } catch {
        return index;
    }
    for (const line of out.split('\n')) {
        const p = line.trim();
        if (!p) continue;
        if (/\.spur(\/|$)/.test(p)) continue;
        const key = basename(p).toLowerCase();
        const list = index.get(key) ?? [];
        list.push(p);
        index.set(key, list);
    }
    return index;
}

/**
 * Compute the qualified body for a section: rewrite every backticked anchor whose
 * basename resolves to exactly one tracked path into its repo-relative form,
 * preserving the line spec byte-for-byte (R3). Ambiguous basenames are recorded
 * and left untouched (R2). Returns the new body (unchanged if no qualification).
 */
export function qualifySectionBody(
    body: string,
    index: Map<string, string[]>,
): { newBody: string; qualified: QualifiedAnchor[]; ambiguous: Array<{ cited: string; candidates: string[] }> } {
    const qualified: QualifiedAnchor[] = [];
    const ambiguous: Array<{ cited: string; candidates: string[] }> = [];
    let newBody = body;

    ANCHOR_RE.lastIndex = 0;
    let m: RegExpExecArray | null = ANCHOR_RE.exec(newBody);
    while (m !== null) {
        const raw = m[1] ?? '';
        const lineSpec = m[2] + (m[3] !== undefined ? `-${m[3]}` : '');
        // Split path from trailing :line / :start-end
        const pathPart = raw.replace(/:(\d+)(?:-(\d+))?$/, '');
        if (!pathPart) {
            m = ANCHOR_RE.exec(newBody);
            continue;
        }
        const key = basename(pathPart).toLowerCase();
        const candidates = index.get(key);
        if (candidates === undefined || candidates.length === 0) {
            m = ANCHOR_RE.exec(newBody);
            continue; // untracked / external — not a qualification candidate
        }
        if (candidates.length > 1) {
            const cited = pathPart;
            if (!ambiguous.some((a) => a.cited === cited)) {
                ambiguous.push({ cited, candidates });
            }
            m = ANCHOR_RE.exec(newBody);
            continue; // R2 — reported, never guessed
        }
        const [newPath] = candidates;
        if (!newPath) {
            m = ANCHOR_RE.exec(newBody);
            continue;
        }
        if (pathPart === newPath) {
            m = ANCHOR_RE.exec(newBody);
            continue; // already repo-relative — nothing to do (idempotency)
        }
        // Path-only rewrite (R3): keep the line spec byte-for-byte. oldToken is the
        // full match m[0] (path + line), NOT raw (path only) — replacing on raw would
        // silently no-op (\`Badge.tsx\` is absent from the body) and loop forever on
        // the re-scan below.
        const oldToken = m[0];
        const newToken = `\`${newPath}:${lineSpec}\``;
        newBody = newBody.split(oldToken).join(newToken);
        qualified.push({ oldPath: pathPart, newPath, raw: oldToken, lineSpec });
        // Re-scan after rewrite (the new path is repo-relative and will no-op).
        ANCHOR_RE.lastIndex = 0;
        m = ANCHOR_RE.exec(newBody);
    }
    return { newBody, qualified, ambiguous };
}

/**
 * Resolve the configured task directories (every configured folder, not only the
 * active one — same contract as the corpus sweep's `structuralSweep`).
 */
export async function resolveConfiguredTaskDirs(fs: FileSystem): Promise<string[]> {
    const planning = await resolvePlanningFolders(fs);
    const dirs = Object.keys(planning.foldersConfig.folders).map((dir) => fs.resolve(dir));
    const active = fs.resolve(planning.foldersConfig.active_folder);
    if (!dirs.includes(active)) dirs.unshift(active);
    return dirs;
}

/**
 * Convenience entrypoint for CLI wiring: build the tracked-index, resolve the
 * configured task dirs, and run the qualification pass. `dryRun` computes and
 * reports each rewrite without writing; on apply, writes through `write`.
 */
export async function anchorQualify(
    fs: FileSystem,
    opts: AnchorQualifyOptions & {
        taskDirs?: string[];
        write?: AnchorQualifierOptions['write'];
        /**
         * Repo root for the tracked-file index. Forwarded so a caller can scope the
         * pass to the project it is operating on. Without it `resolveRepoRoot` falls
         * back to `process.cwd()`, which ignores the caller's context entirely — the
         * pass then indexes whatever directory the process happens to sit in and
         * reports `Files scanned: 0` for any other target.
         */
        projectRoot?: string;
    },
): Promise<AnchorQualifyReport> {
    return qualifyAnchors(fs, {
        fs,
        dryRun: opts.dryRun ?? false,
        taskDirs: opts.taskDirs,
        write: opts.write,
        projectRoot: opts.projectRoot,
    });
}

/**
 * Run the anchor-qualification pass over every configured task folder.
 *
 * With `dryRun`, computes each new body and reports without writing. On apply,
 * writes through the provided `write` callback (the `updateSection` CLI path).
 * Idempotent: a second run changes zero files (already-qualified anchors no-op).
 */
export async function qualifyAnchors(
    fs: FileSystem,
    opts: AnchorQualifyOptions & AnchorQualifierOptions,
): Promise<AnchorQualifyReport> {
    const taskDirs = opts.taskDirs ?? (await resolveConfiguredTaskDirs(fs));
    const dryRun = opts.dryRun ?? false;
    const projectRoot = await resolveRepoRoot(opts.projectRoot);
    const index = await buildTrackedBasenameIndex(projectRoot);

    const fileReports: AnchorFileReport[] = [];
    for (const dir of taskDirs) {
        let entries: string[];
        try {
            entries = await fs.readDir(dir);
        } catch {
            continue;
        }
        const mdFiles = entries
            .filter((name) => name.endsWith('.md') && name !== 'kanban.md')
            .map((name) => join(dir, name))
            .sort();
        for (const filePath of mdFiles) {
            let raw: string;
            try {
                raw = await fs.readFile(filePath);
            } catch {
                continue;
            }
            const doc = MarkdownDocument.parse(raw, 'task');
            const wbs = (doc.frontmatterData?.wbs as string | undefined) ?? basename(filePath).replace(/_\d{4}_.*/, '');
            let modified = false;
            const qualified: QualifiedAnchor[] = [];
            const ambiguous: Array<{ cited: string; candidates: string[] }> = [];
            for (const section of ['Testing', 'Solution'] as const) {
                const body = doc.getSection(section);
                if (body === null) continue;
                const result = qualifySectionBody(body, index);
                qualified.push(...result.qualified);
                for (const a of result.ambiguous) {
                    if (!ambiguous.some((x) => x.cited === a.cited)) ambiguous.push(a);
                }
                if (result.newBody !== body && !dryRun) {
                    if (opts.write) {
                        await opts.write(filePath, wbs, section, result.newBody);
                    }
                    modified = true;
                } else if (result.newBody !== body) {
                    modified = true; // dry-run still reports the would-be change
                }
            }
            if (qualified.length > 0 || ambiguous.length > 0 || modified) {
                fileReports.push({ path: filePath, wbs, modified, qualified, ambiguous });
            }
        }
    }

    const filesModified = fileReports.filter((r) => r.modified).length;
    const filesSkipped = 0;
    return { filesScanned: fileReports.length, filesModified, filesSkipped, fileReports };
}
