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
 * Since 1089 R3 the pass also owns the one machine-specific reference the close
 * audit puts in tracked corpus: an absolute `done_reason` artifact path. It is
 * normalized to its repo-relative form by {@link normalizeDoneReason} through a
 * separate frontmatter writer, because a `PASS artifact at /Users/<someone>/…`
 * reason stops resolving once that worktree is removed.
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
    /**
     * Why this file's rewrite was skipped, when it was. Writes go through
     * `PlanningWriteService.updateSection`, which validates frontmatter first — and
     * the legacy corpora contain tasks that predate the current schema (80 carry a
     * baselined `L1.schema-validation`). One such file must not abort the pass: a
     * single unwritable legacy task was blocking 144 valid rewrites. Skip it, name
     * it, keep going — the same "reported, never guessed" discipline the ambiguous
     * case already follows.
     */
    skipped?: string;
    /**
     * Absolute `done_reason` artifact references normalized to a repo-relative path
     * (1089 R3). Reported on a dry run exactly like {@link qualified}, and written
     * through the frontmatter writer on apply.
     */
    doneReasons: Array<{ from: string; to: string }>;
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
    /**
     * Exact task files to scan (task 1109 R1) — the CLI resolves `--wbs` through the task
     * locator and passes the single resolved path, so a scoped repair cannot rewrite the
     * rest of the corpus (an unscoped run rewrote 119 unrelated files on 2026-10-07).
     * Absent = every file in every configured task folder.
     */
    files?: string[];
}

/** Options for an anchor qualifier. */
export interface AnchorQualifierOptions {
    fs: FileSystem;
    /** Resolved absolute task directory/directories to scan. */
    taskDirs?: string[];
    /** Writer callback: (ref, section, newBody) => Promise<void> via updateSection. */
    write?: (filePath: string, wbs: string, section: string, newBody: string) => Promise<void>;
    /**
     * Frontmatter writer callback for the `done_reason` rule (1089 R3):
     * (filePath, wbs, key, value) => Promise<void> via `updateFrontmatter`. Absent
     * means the reason is reported on a dry run and left unwritten on apply.
     */
    writeField?: (filePath: string, wbs: string, key: string, value: string) => Promise<void>;
    /** Resolve the planning folders (used when taskDirs not provided). */
    resolveFolders?: () => Promise<string[]>;
    /**
     * Exact task files to scan (task 1109 R1). Absent = every `.md` in every task dir.
     */
    files?: string[];
    /** Repo root for the git tracked-file index. Defaults to `git rev-parse --show-toplevel`. */
    projectRoot?: string;
}

const ANCHOR_RE = /`([^`\n]+?):(\d+)(?:-(\d+))?`/g;

/**
 * The unforced close reason's absolute-artifact shape (1089 R3).
 *
 * `task-transition.ts` writes `unforced close; PASS artifact at <path>`; before
 * 1089 R2 that path went in absolute, and for a `--worktree` close it pointed into
 * a tree the success path then deletes. Anchored on the full prefix on purpose —
 * a forced-close rationale, a research note, or an already-relative reason is
 * operator text and must be left exactly as written.
 */
const ABSOLUTE_DONE_REASON_RE = /^(unforced close; PASS artifact at )\/.*?\/(\.spur\/.*)$/;

/**
 * Normalize a `done_reason` artifact reference to repo-relative form. Returns the
 * replacement value, or `null` when the reason is not that shape (nothing to do).
 */
export function normalizeDoneReason(reason: string): string | null {
    const match = ABSOLUTE_DONE_REASON_RE.exec(reason);
    if (match === null) return null;
    const next = `${match[1] ?? ''}${match[2] ?? ''}`;
    return next === reason ? null : next;
}

/**
 * Resolve the repository root from `git rev-parse --show-toplevel` (falls back
 * to `process.cwd()`). The tracked-file index must be built from the repo root,
 * not `dirname(taskDirs[0])` — task dirs live under `docs/`, so deriving the
 * root from them runs `git ls-files` inside a subdirectory and returns paths
 * relative to it, which then qualify already-correct `docs/…` anchors backwards.
 *
 * `hintDir` scopes the git probe to a directory inside the target project so the
 * resolution no longer depends on the process cwd: without it a process sitting
 * outside the target project resolves (or falls back) to the wrong tree and the
 * pass reports `Files scanned: 0` (0692 R4). The hint only locates the repo —
 * the returned root is still the git toplevel, never the hint itself.
 */
export async function resolveRepoRoot(projectRoot: string | undefined, hintDir?: string): Promise<string> {
    if (projectRoot) return projectRoot;
    const probeDirs = [hintDir, process.cwd()].filter((d): d is string => Boolean(d));
    for (const probeDir of probeDirs) {
        try {
            const result = await new NodeProcessExecutor().run({
                command: 'git',
                args: ['rev-parse', '--show-toplevel'],
                cwd: probeDir,
                maxOutput: 64 * 1024,
                forceBuffered: true,
                rejectOnError: false,
            });
            if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim();
        } catch {
            // try next probe dir
        }
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
        /**
         * Exact task files to scan (task 1109 R1). Absent = every configured folder.
         */
        files?: string[];
        write?: AnchorQualifierOptions['write'];
        writeField?: AnchorQualifierOptions['writeField'];
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
        ...(opts.files === undefined ? {} : { files: opts.files }),
        write: opts.write,
        writeField: opts.writeField,
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
    const projectRoot = await resolveRepoRoot(opts.projectRoot, taskDirs[0]);
    const index = await buildTrackedBasenameIndex(projectRoot);

    const fileReports: AnchorFileReport[] = [];
    // 1109 R1: a scoped run receives the exact resolved paths, so the pass neither walks
    // the corpus nor re-derives a file identity from a filename.
    const scopedFiles = opts.files === undefined ? null : [...opts.files].sort();
    for (const dir of scopedFiles === null ? taskDirs : ['.']) {
        let entries: string[];
        try {
            entries = await fs.readDir(dir);
        } catch {
            continue;
        }
        const mdFiles =
            scopedFiles ??
            entries
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
            let skipped: string | undefined;
            const qualified: QualifiedAnchor[] = [];
            const doneReasons: Array<{ from: string; to: string }> = [];
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
                        try {
                            await opts.write(filePath, wbs, section, result.newBody);
                        } catch (err) {
                            skipped = String(err instanceof Error ? err.message : err);
                            break;
                        }
                    }
                    modified = true;
                } else if (result.newBody !== body) {
                    modified = true; // dry-run still reports the would-be change
                }
            }
            // 1089 R3: the same pass owns the other machine-specific reference in
            // tracked corpus. An unwritable legacy task was already reported via
            // `skipped` by the section loop — do not attempt a second gate-failing
            // write on the same file.
            const doneReason = doc.frontmatterData?.done_reason;
            const normalizedReason = typeof doneReason === 'string' ? normalizeDoneReason(doneReason) : null;
            if (normalizedReason !== null && skipped === undefined) {
                doneReasons.push({ from: doneReason as string, to: normalizedReason });
                if (!dryRun && opts.writeField !== undefined) {
                    try {
                        await opts.writeField(filePath, wbs, 'done_reason', normalizedReason);
                    } catch (err) {
                        skipped = String(err instanceof Error ? err.message : err);
                    }
                }
                if (skipped === undefined) modified = true;
            }
            if (
                qualified.length > 0 ||
                ambiguous.length > 0 ||
                doneReasons.length > 0 ||
                modified ||
                skipped !== undefined
            ) {
                fileReports.push({
                    path: filePath,
                    wbs,
                    modified: skipped === undefined && modified,
                    qualified,
                    ambiguous,
                    doneReasons,
                    ...(skipped === undefined ? {} : { skipped }),
                });
            }
        }
    }

    const filesModified = fileReports.filter((r) => r.modified).length;
    const filesSkipped = 0;
    return { filesScanned: fileReports.length, filesModified, filesSkipped, fileReports };
}
