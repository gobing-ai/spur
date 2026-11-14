/**
 * Task check — four-layer validation per design §3.
 *
 * L1: Zod schema (hard error).
 * L2: Section-Status-Matrix presence (warning-first, gate:true hard).
 * L3: Per-section format rules (warning-first; 3 hard-core rules).
 * L4: Traceability (warning-first).
 */

import { dirname, join } from 'node:path';
import { DEFAULT_TASK_VARIANT, MarkdownDocument, stripAcFence, taskFrontmatterSchema } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { isFeatureFile } from './feature-check';
import {
    type CheckFindings,
    FINDING_CODES,
    type MatrixEntry,
    PlanningCheckService,
    type SectionMatrix,
    type Severity,
} from './planning-check-base';
import { applyStructuralRepairs, type StructuralRepair } from './structural-repair';
import { evaluateTaskEvidence, type TaskEvidenceDeps } from './task-evidence-precheck';
import { isTaskFrozen, undeprecateTaskCommand } from './task-freeze';
import { TaskLocator } from './task-locator';
import { evaluateTaskSize } from './task-size-precheck';

// ─── Types ──────────────────────────────────────────────────────────────

export type { CheckFindings, MatrixEntry, SectionMatrix, Severity };

/** Result of a `spur task check` validation run. */
export interface CheckResult {
    wbs: string;
    status: string;
    findings: CheckFindings[];
    /** Required sections for the current status (for `--json` reporting). */
    requiredSections: string[];
    /** Missing required sections for the current status. */
    missingSections: string[];
    /** Whether the check passed (no hard errors). */
    pass: boolean;
    /** Structural repairs applied by `--fix` (empty when `--fix` was not given or nothing was repairable). */
    repairs?: StructuralRepair[];
}

interface TaskSnapshot {
    wbs: string;
    status: string;
    dependencies: string[];
}

/**
 * A section body is a placeholder when, after stripping HTML guidance comments
 * (`<!-- … -->`) and blockquote `> TBD`-style markers, nothing substantive
 * remains. Used to skip format rules for sections not yet authored (e.g. an
 * empty Solution at todo/wip before implementation).
 */
function isPlaceholderBody(body: string): boolean {
    const stripped = body
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^\s*>\s*TBD\s*$/gim, '')
        .trim();
    return stripped.length === 0;
}

/** Backtick `path:line` / `path:start-end` citations (skips URLs and bare numbers). */
export function extractBacktickLineAnchors(
    body: string,
): Array<{ raw: string; path: string; startLine: number; endLine?: number }> {
    const out: Array<{ raw: string; path: string; startLine: number; endLine?: number }> = [];
    const re = /`([^`\n]+?:(\d+)(?:-(\d+))?)`/g;
    let m: RegExpExecArray | null = re.exec(body);
    while (m !== null) {
        const raw = m[1] ?? '';
        const startStr = m[2];
        const endStr = m[3];
        if (startStr) {
            // Split path from trailing :line / :start-end
            const pathPart = raw.replace(/:(\d+)(?:-(\d+))?$/, '');
            const hasExt = /\.\w{1,8}$/.test(pathPart.split('/').pop() ?? '');
            if (pathPart && !pathPart.includes('://') && hasExt) {
                const startLine = Number(startStr);
                const endLine = endStr !== undefined ? Number(endStr) : undefined;
                if (Number.isFinite(startLine) && startLine >= 1) {
                    out.push({ raw, path: pathPart, startLine, endLine });
                }
            }
        }
        m = re.exec(body);
    }
    return out;
}

// ─── TaskCheckService ───────────────────────────────────────────────────

/** Four-layer task validator (design §3). L1 schema → L2 matrix → L3 format → L4 traceability. */
export class TaskCheckService extends PlanningCheckService {
    /**
     * Locator for the L4 relational checks. When absent, those checks fall back to
     * the checked file's own directory — correct for a single-folder corpus, but it
     * cannot see sibling folders, so callers with a folder config should inject one.
     */
    private readonly locator?: TaskLocator;

    constructor(fs: FileSystem, matrix: SectionMatrix, locator?: TaskLocator) {
        super({
            fs,
            matrix,
            docKind: 'task',
            frontmatterSchema: taskFrontmatterSchema,
            parse: (raw, kind) => MarkdownDocument.parse(raw, kind),
        });
        this.locator = locator;
    }

    /**
     * The folder set the L4 edge checks search. Without an injected locator the
     * corpus is assumed to be the checked task's own directory.
     */
    private locatorFor(tasksDir: string): TaskLocator {
        return this.locator ?? TaskLocator.forSingleDir(this.fs, tasksDir);
    }

    /**
     * Human-readable rendering of the folders an edge check actually searched, so a
     * "not found" finding names the real search scope rather than one directory.
     */
    private searchedFolders(tasksDir: string): string {
        return this.locatorFor(tasksDir).folderDirs().join(', ');
    }

    /** Run the four-layer validation against a task file. */
    async check(
        filePath: string,
        wbs: string,
        options?: {
            strict?: boolean;
            /**
             * Optional target status to evaluate the task AS (F92 R2) — the
             * lifecycle guards pass the transition target so testing→done checks
             * the `done` row instead of the current `testing` row. Frontmatter
             * schema validation (L1) still reads the REAL document; only the
             * lifecycle-dependent L2/L3/L4 policy evaluates as `effectiveStatus =
             * asStatus ?? frontmatter.status`. Omitted `--as` is fully
             * behavior-compatible (current-status diagnostics).
             */
            asStatus?: string;
            severityOverrides?: Record<string, 'error' | 'warning' | 'off'>;
            /**
             * Operation-scoped child index (`parent_wbs` -> children). A batch caller such as the
             * readiness projection supplies one pass of parsed records instead of paying the
             * documented O(tasks) rollup scan on every row, which made N checks O(N^2) parses.
             * Absent -> the original per-check scan, unchanged.
             */
            childIndex?: ReadonlyMap<string, ReadonlyArray<{ wbs: string; status: string }>>;
            /** Repair structural findings (heading presence/level/order, R-item checkboxes) in place before validating (task 0619). */
            fix?: boolean;
            /**
             * Implement-readiness prechecks (1002 R1): evaluate the size limits and the
             * evidence-channel rule on top of the four-layer check; failures are error
             * findings (codes `precheck-size` / `precheck-evidence`, unsuppressible).
             * Absent → the plain four-layer check, byte-for-byte unchanged.
             */
            precheck?: boolean;
            /**
             * Evidence DB counter (1002 R3): the caller (CLI) injects it because domain is
             * the sole ts-db consumer. Required when `precheck` is set; a missing counter
             * fails closed (null → error finding).
             */
            countArgsRaw?: (source: string) => Promise<number | null>;
        },
    ): Promise<CheckResult> {
        const strict = options?.strict === true;
        const rawSource = await this.fs.readFile(filePath);
        let raw = rawSource;
        let repairs: StructuralRepair[] = [];
        if (options?.fix === true) {
            const probe = MarkdownDocument.parse(rawSource, 'task');
            const probeFm = probe.frontmatterData ?? {};
            const probeStatus = (probeFm.status as string) ?? 'backlog';
            const probeEffective = options?.asStatus ?? probeStatus;
            const probeVariant = (probeFm.template as string) ?? DEFAULT_TASK_VARIANT;
            const fixEntry = this.resolveMatrixEntry(probeVariant, probeEffective);
            const fixed = applyStructuralRepairs(rawSource, 'task', fixEntry);
            if (fixed.changed) {
                await this.fs.writeFile(filePath, fixed.content);
                repairs = fixed.repairs;
                raw = fixed.content;
            }
        }
        const findings: CheckFindings[] = [];

        // ── L1: Schema validation (hard) — always reads the REAL frontmatter ──
        const doc = this.runL1(raw, wbs, findings);
        if (doc === null) {
            return {
                wbs,
                ...this.summarizeWithStatus('', findings, strict, options?.severityOverrides),
            };
        }

        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        // Target-aware policy status (F92 R2): `asStatus` (the transition target)
        // overrides the on-disk status for matrix + status-dependent rules, so a
        // lifecycle guard evaluates the rules the target status will require.
        const effectiveStatus = options?.asStatus ?? status;
        // The template variant is the unified section-layout axis (§3.2); `template`
        // frontmatter selects it, defaulting to `default`. (`type` is the orthogonal
        // task/brainstorm corpus-compat field, not the matrix key.)
        const variant = (fm.template as string) ?? DEFAULT_TASK_VARIANT;
        const entry = this.resolveMatrixEntry(variant, effectiveStatus);

        // ── L1 identity: one WBS, one file (2026-10-12). WBS allocation is per-tree, so two
        // worktrees cut from one base both mint the same number and the collision only appears at
        // integration. The corpus-wide `task check` reports duplicates (0416 R6) but nothing
        // enforced the invariant on the per-task path every pipeline guard actually runs — which is
        // how two `1183` files reached an integration in this repo (see execution-worktree-landing.md
        // § WT-4 for the sweep the same gap required before this check existed).
        await this.runWbsCollisionCheck(dirname(filePath), wbs, findings);

        // ── L2: Section presence (warning-first, gate:true hard) ──
        this.runL2(doc, entry, findings, raw);

        // ── L3: Format rules (warning-first, 3 hard-core) ──
        this.runL3(doc, entry, findings);
        // ── L4: Traceability — feature_id edges, parent_wbs, dependencies, AC coverage
        const tasksDir = dirname(filePath);
        const featuresDir = join(dirname(tasksDir), 'features');
        await this.runL4(fm, effectiveStatus, findings, featuresDir, tasksDir, wbs);

        // ── L4 roll-up (0121, R1–R3): parent↔child status drift + roster presence.
        // Inert unless one or more sibling tasks declare parent_wbs == this wbs.
        await this.runL4Rollup(wbs, effectiveStatus, findings, tasksDir, options?.childIndex);

        // ── L4 readiness (0211/R4): dependencies and gate-like prose are prerequisites.
        // Terminal tasks are completion records, not readiness candidates.
        if (effectiveStatus !== 'done' && effectiveStatus !== 'cancelled') {
            await this.runL4Readiness(fm, wbs, effectiveStatus, findings, tasksDir);
        }

        // ── Implement-readiness prechecks (1002 R1): size limits + evidence channel.
        // Only under `--precheck`; evaluated on the body WITHOUT frontmatter, matching the
        // deleted plugin scripts that counted `task show --json` content.
        if (options?.precheck === true) {
            const size = evaluateTaskSize(doc.bodyWithoutFrontmatter);
            for (const reason of size.reasons) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.PRECHECK_SIZE,
                    severity: 'error',
                    section: '',
                    message: reason,
                });
            }
            // No counter injected → fail closed (1002 R1).
            const deps: TaskEvidenceDeps = { countArgsRaw: options.countArgsRaw ?? (async () => null) };
            const evidence = await evaluateTaskEvidence(doc.bodyWithoutFrontmatter, deps);
            for (const reason of evidence.reasons) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.PRECHECK_EVIDENCE,
                    severity: 'error',
                    section: '',
                    message: reason,
                });
            }
        }

        return {
            wbs,
            ...this.summarizeWithStatus(effectiveStatus, findings, strict, options?.severityOverrides, entry?.required),
            repairs,
        };
    }

    /**
     * Content-policy validation for a NOT-yet-persisted candidate task document
     * (F21 task 0787 R2): L1 schema → L2 matrix → L3 format — the SAME rules
     * `spur task check` enforces — with L4 traceability deliberately excluded.
     * L4 needs the persisted file and real corpus edges (feature dirs, sibling
     * tasks), and genuine missing-feature / dependency diagnostics must stay
     * visible on the persisted task rather than fail its creation. Synchronous
     * and fs-free, so creation can judge a candidate before the write lock
     * commits: a task is granted `todo` exactly when THIS policy passes
     * evaluated as `todo`, which is what makes creation and checking agree.
     */
    checkContentPolicy(
        raw: string,
        wbs: string,
        options?: {
            strict?: boolean;
            /**
             * Evaluate the matrix/L3 policy AS this status (F92 R2 semantics).
             * Creation passes the candidate's own status; the todo-eligibility
             * probe passes `todo`. Omitted → the candidate's frontmatter status.
             */
            asStatus?: string;
            severityOverrides?: Record<string, 'error' | 'warning' | 'off'>;
        },
    ): { doc: MarkdownDocument | null; findings: CheckFindings[]; entry?: MatrixEntry } {
        const findings: CheckFindings[] = [];
        const doc = this.runL1(raw, wbs, findings);
        if (doc === null) {
            return { doc: null, findings };
        }
        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        const effectiveStatus = options?.asStatus ?? status;
        const variant = (fm.template as string) ?? DEFAULT_TASK_VARIANT;
        const entry = this.resolveMatrixEntry(variant, effectiveStatus);
        this.runL2(doc, entry, findings, raw);
        this.runL3(doc, entry, findings);
        const { findings: effectiveFindings } = this.summarizeWithStatus(
            effectiveStatus,
            findings,
            options?.strict,
            options?.severityOverrides,
            entry?.required,
        );
        return { doc, findings: effectiveFindings, entry };
    }
    // ── L3: Format rules ──
    /**
     * L1 identity: this WBS must be claimed by exactly one file across the configured corpus
     * folders. Reuses {@link TaskLocator.findDuplicateWbs} — the same scan `task check` (corpus
     * mode) reports from, so the per-task gate and the corpus report cannot disagree.
     */
    private async runWbsCollisionCheck(tasksDir: string, wbs: string, findings: CheckFindings[]): Promise<void> {
        const group = (await this.locatorFor(tasksDir).findDuplicateWbs()).find((hits) => hits[0]?.wbs === wbs);
        if (group === undefined || group.length < 2) return;
        findings.push({
            layer: 'L1',
            code: FINDING_CODES.L1_WBS_COLLISION,
            severity: 'error',
            section: '',
            message:
                `WBS ${wbs} is claimed by ${group.length} task files: ${group.map((hit) => hit.filePath).join(', ')}. ` +
                'Keep one and re-create the other through `spur task create` (the allocator picks the next free ' +
                'number) — never renumber by hand.',
        });
    }

    private runL3(doc: MarkdownDocument, entry: MatrixEntry | undefined, findings: CheckFindings[]): void {
        // ── F21 task 0787 (R1): a placeholder-only body (HTML comments, `> TBD`,
        // whitespace) is an obligation only where the Section-Status-Matrix
        // declares the section REQUIRED at the effective status. A fresh capture
        // legitimately carries the guidance-comment scaffold in optional sections
        // (Requirements, AC at backlog) — the old unconditional errors made
        // `create` → `check` disagree: creation shipped the scaffold, checking
        // failed on it. Required sections keep the hard error (a todo candidate
        // with placeholder-only Background/AC/Design/Plan is not ready), and the
        // same required-set drives the Testing/Solution scaffold check below.
        // Fires only when the section heading exists; a missing section is L2's
        // job (matrix-driven presence). L2 drives presence, this drives substance.
        const requiredAtStatus = new Set(entry?.required ?? []);
        const reqBodyRaw = doc.getSection('Requirements');
        if (requiredAtStatus.has('Requirements') && reqBodyRaw !== null && isPlaceholderBody(reqBodyRaw)) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_REQUIREMENTS_EMPTY,
                severity: 'error',
                section: 'Requirements',
                message: 'Requirements is placeholder-only — a task with no requirements is unverifiable',
            });
        }
        const acBodyRaw = doc.getSection('Acceptance Criteria');
        if (
            requiredAtStatus.has('Acceptance Criteria') &&
            acBodyRaw !== null &&
            isPlaceholderBody(stripAcFence(acBodyRaw))
        ) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_AC_EMPTY,
                severity: 'error',
                section: 'Acceptance Criteria',
                message: 'Acceptance Criteria is placeholder-only — populate with real scenarios',
            });
        }
    }

    // ── L4: Traceability — feature_id edges, parent_wbs, dependencies, AC coverage ──
    private async runL4(
        fm: Record<string, unknown>,
        status: string,
        findings: CheckFindings[],
        featuresDir: string,
        tasksDir: string,
        wbs: string,
    ): Promise<void> {
        // Resolve feature_id from either snake_case or legacy kebab-case key.
        const featureId = (fm.feature_id as string | undefined) ?? (fm['feature-id'] as string | undefined);
        const parentWbs = (fm.parent_wbs as string | undefined) ?? (fm['parent-wbs'] as string | undefined);
        const deps = fm.dependencies as string[] | undefined;

        // ── feature_id edge ──
        if (featureId && featureId.length > 0) {
            const featurePath = await this.findFeatureFile(featuresDir, featureId);
            if (featurePath === null) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_FEATURE_NOT_FOUND,
                    severity: 'warning',
                    section: '',
                    message: `Feature "${featureId}" not found in ${featuresDir}`,
                });
            } else {
                const featureStatus = await this.readFeatureStatus(featurePath);
                // Task 0339 (R1/R2): a terminal task under a terminal feature is the
                // correct end state — flag only when the task itself is still live
                // (backlog/todo/wip/testing/blocked), since that genuinely needs re-parenting.
                const featureTerminal = featureStatus === 'done' || featureStatus === 'cancelled';
                // ADR-137: `deprecated` is retained-and-frozen, not live work — the frozen record must
                // not fail its own check under a terminal feature (it cannot be re-parented or
                // reopened into live work anyway). The live set is the comment's own list.
                const taskTerminal = status === 'done' || status === 'cancelled' || status === 'deprecated';
                if (featureTerminal && !taskTerminal) {
                    const reopenGuide =
                        featureStatus === 'done'
                            ? `Reopen: \`spur feature update ${featureId} active\` (or \`spur feature sync ${featureId} --force\` when non-terminal tasks are already linked). Alternatively re-parent: \`spur task update <wbs> --feature <otherId>\`.`
                            : `Feature is cancelled — re-parent or unlink this live task (\`spur task update <wbs> --feature <otherId>\`).`;
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_FEATURE_TERMINAL,
                        severity: 'error',
                        section: '',
                        message: `Feature "${featureId}" is ${featureStatus} — live tasks cannot stay linked without action. ${reopenGuide}`,
                    });
                }
                // 1180 R2: `deprecated` is non-terminal, so the error above never fires for it.
                // A live task under a frozen feature is a warning (re-parent or cancel); a
                // terminal task is the correct end state and gets no finding.
                if (featureStatus === 'deprecated' && !taskTerminal) {
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_FEATURE_DEPRECATED,
                        severity: 'warning',
                        section: '',
                        message: `Feature "${featureId}" is deprecated (frozen) — re-parent this live task (\`spur task update <wbs> --feature <otherId>\`) or cancel it.`,
                    });
                }
            }
        } else {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_MISSING_FEATURE_ID,
                severity: 'warning',
                section: '',
                message:
                    'Missing feature_id — every task should reference a feature (one direction, DD-07). To link: `spur task update <wbs> --feature <id>`, or use the sp:spur-dev feature-link helper.',
            });
        }

        // ── parent_wbs edge ──
        if (parentWbs && parentWbs.length > 0) {
            const parentPath = await this.findTaskFile(tasksDir, parentWbs);
            if (parentPath === null) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_PARENT_NOT_FOUND,
                    severity: 'warning',
                    section: '',
                    message: `Parent task ${parentWbs} not found in ${this.searchedFolders(tasksDir)}`,
                });
            }
        }

        // ── dependency edges ──
        // ADR-137 (task 1190 R4): a *live* dependent of a `deprecated` task gets
        // `L4.task-deprecated` — the edge recorded before the deprecation keeps holding
        // live work behind frozen material, so it is reported with the two remedies
        // (re-point, or un-deprecate). A terminal dependent is the retained end state and
        // gets no finding, and the edge is never rewritten: the freeze is prospective.
        const taskLive = status !== 'done' && status !== 'cancelled' && status !== 'deprecated';
        if (deps && deps.length > 0) {
            for (const dep of deps) {
                // Dependencies can be WBS numbers ("0001") or WBS+name strings ("0001: some desc")
                const wbsMatch = /^(\d{4})/.exec(dep.trim());
                if (wbsMatch) {
                    const depWbs = wbsMatch[1];
                    if (!depWbs) continue;
                    const depPath = await this.findTaskFile(tasksDir, depWbs);
                    if (depPath === null) {
                        findings.push({
                            layer: 'L4',
                            code: FINDING_CODES.L4_DEPENDENCY_NOT_FOUND,
                            severity: 'warning',
                            section: '',
                            message: `Dependency "${dep}" not found in ${this.searchedFolders(tasksDir)}`,
                        });
                        continue;
                    }
                    if (!taskLive) continue;
                    // Read the already-resolved file rather than re-locating it via readTaskSnapshot.
                    let depStatus: unknown;
                    try {
                        depStatus = MarkdownDocument.parse(await this.fs.readFile(depPath), 'task').frontmatterData
                            ?.status;
                    } catch {
                        continue;
                    }
                    if (!isTaskFrozen(typeof depStatus === 'string' ? depStatus : null)) continue;
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_TASK_DEPRECATED,
                        severity: 'warning',
                        section: '',
                        message: `Task ${wbs} depends on deprecated task ${depWbs} (frozen) — re-point the dependency at live work or un-deprecate it (\`${undeprecateTaskCommand(depWbs)}\`)`,
                    });
                }
            }
        }
    }

    /**
     * L4 roll-up (0121): a task that is a decomposition parent — one or more
     * sibling tasks whose `parent_wbs` points at it — has its parent↔child
     * status relationship validated. Three advisory (warning) findings:
     *
     *  1. parent `done` while a kid is not `done`/`cancelled` (R1, drift down);
     *  2. all kids `done`/`cancelled` while the parent is still open (R1, drift up);
     *  3. parent `## Plan` carries no sub-task roster table (R2, the 0109 omission).
     *
     * Severity is `warning`; `--strict` elevates per the shared base. Inert for a
     * task with zero kids (R3) — the dir scan finds nothing and returns early.
     *
     * Without an operation-scoped child index, L4 does NOT pre-load the corpus — `check()` is
     * invoked per-task and resolves the *current* task's edges by reading individual
     * files. Finding kids therefore requires one `readDir` + frontmatter scan of
     * the tasks dir here; it cannot "reuse the same pass" as the Design assumed. The
     * scan is O(n) over the tasks dir, once per check, and short-circuits when no
     * kid references this wbs. Batch readers pass an index from their parsed snapshot instead.
     */
    private async runL4Rollup(
        wbs: string,
        status: string,
        findings: CheckFindings[],
        tasksDir: string,
        childIndex?: ReadonlyMap<string, ReadonlyArray<{ wbs: string; status: string }>>,
    ): Promise<void> {
        const kids =
            childIndex !== undefined ? [...(childIndex.get(wbs) ?? [])] : await this.findChildren(tasksDir, wbs);
        if (kids.length === 0) return; // not a parent — inert (R3)

        const closed = (s: string): boolean => s === 'done' || s === 'cancelled';
        // ADR-137: a deprecated kid is frozen work, not an open kid — it must not raise
        // `sub-tasks still open` under a settled parent. A deprecated *parent* stays unsettled here
        // on purpose: the freeze does not claim the parent's own work finished, so the rollup still
        // asks the operator to close or deprecate it.
        const kidResolved = (s: string): boolean => closed(s) || s === 'deprecated';
        const parentClosed = closed(status);
        const openKids = kids.filter((c) => !kidResolved(c.status));

        // R1a: parent done/cancelled but a kid is still open.
        if (parentClosed && openKids.length > 0) {
            const list = openKids.map((c) => c.wbs).join(', ');
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_ROLLUP_SUBTASKS_OPEN,
                severity: 'warning',
                section: '',
                message: `Parent is ${status} but sub-task(s) still open: ${list} — close or re-parent them`,
            });
        }

        // R1b: every kid closed but the parent is still open.
        if (!parentClosed && openKids.length === 0) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_ROLLUP_PARENT_OPEN,
                severity: 'warning',
                section: '',
                message: `All ${kids.length} sub-task(s) are done/cancelled/deprecated but parent is still ${status} — close the parent`,
            });
        }
    }

    private async runL4Readiness(
        fm: Record<string, unknown>,
        wbs: string,
        status: string,
        findings: CheckFindings[],
        tasksDir: string,
    ): Promise<void> {
        if (status === 'blocked') {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_READINESS_BLOCKED,
                severity: 'warning',
                section: '',
                message: `Task ${wbs} is blocked — readiness is false until the blocker is resolved or explicitly forced`,
            });
        }

        for (const depWbs of this.extractDependencyWbs(fm.dependencies)) {
            if (depWbs === wbs) continue;
            await this.checkDependencyReadiness(depWbs, wbs, findings, tasksDir, new Set([wbs]), false);
        }
    }

    private extractDependencyWbs(raw: unknown): string[] {
        if (!Array.isArray(raw)) return [];
        const deps: string[] = [];
        for (const item of raw) {
            if (typeof item !== 'string') continue;
            const match = /^(\d{4})/.exec(item.trim());
            if (match?.[1] !== undefined) deps.push(match[1]);
        }
        return deps;
    }

    /**
     * Walk the prerequisite rule for `depWbs`, pushing the same L4 findings as
     * always, and ADDITIONALLY return the first blocking prerequisite wbs in
     * walk order (null = satisfied). The return value is additive — the sole
     * existing caller (`runL4Readiness`) ignores it — so finding behavior is
     * unchanged. 0838's {@link firstBlockingPrerequisite} reuses this same walk
     * (never a second implementation) to source the strategy's injected
     * `dependencyBlocked` gate.
     */
    private async checkDependencyReadiness(
        depWbs: string,
        rootWbs: string,
        findings: CheckFindings[],
        tasksDir: string,
        seen: Set<string>,
        transitive: boolean,
        proseSeeded = false,
    ): Promise<string | null> {
        if (seen.has(depWbs)) {
            // R3: report a cycle only when it rests on at least one frontmatter
            // dependencies[] edge. A loop reached solely through a prose-inferred seed
            // edge is a parser artifact, not a corpus defect.
            if (!proseSeeded) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_PREREQUISITE_CYCLE,
                    severity: 'warning',
                    section: '',
                    message: `Prerequisite cycle detected while checking ${rootWbs}: ${[...seen, depWbs].join(' -> ')}`,
                });
            }
            return null;
        }

        const dep = await this.readTaskSnapshot(tasksDir, depWbs);
        if (dep === null) return null;

        let firstBlocked: string | null = null;
        if (dep.status !== 'done') {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_PREREQUISITE_NOT_DONE,
                severity: 'warning',
                section: '',
                message: `${transitive ? 'Transitive prerequisite' : 'Prerequisite'} ${depWbs} is ${dep.status}; task ${rootWbs} is not ready until it is done`,
            });
            firstBlocked = depWbs;
        }

        const nextSeen = new Set(seen);
        nextSeen.add(depWbs);
        for (const childDep of dep.dependencies) {
            firstBlocked ??= await this.checkDependencyReadiness(
                childDep,
                rootWbs,
                findings,
                tasksDir,
                nextSeen,
                true,
                proseSeeded,
            );
        }
        return firstBlocked;
    }

    /**
     * 0838 R3: dispatch readiness as a value — the first blocking prerequisite
     * for `wbs` under the L4 readiness rule (the same
     * {@link checkDependencyReadiness} walk, transitive form and cycle guard
     * included), or null when satisfied. Declared frontmatter `dependencies[]`
     * edges only (no prose seeding): batch ordering (`dev-runall`/`dev-verifyall`)
     * topo-sorts `dependencies[]`, so that is the edge set dispatch must honor.
     * The strategy runtime never parses `dependencies[]` itself — this method IS
     * the injected `dependencyBlocked` source (Q&A: injected, sourced from the
     * checker that gates the corpus, never a second parse).
     */
    async firstBlockingPrerequisite(tasksDir: string, wbs: string): Promise<string | null> {
        const root = await this.readTaskSnapshot(tasksDir, wbs);
        if (root === null) return null;
        const findings: CheckFindings[] = [];
        for (const dep of root.dependencies) {
            const blocked = await this.checkDependencyReadiness(
                dep,
                wbs,
                findings,
                tasksDir,
                new Set([wbs]),
                false,
                false,
            );
            if (blocked !== null) return blocked;
        }
        return null;
    }

    private async readTaskSnapshot(tasksDir: string, wbs: string): Promise<TaskSnapshot | null> {
        const path = await this.findTaskFile(tasksDir, wbs);
        if (path === null) return null;
        try {
            const raw = await this.fs.readFile(path);
            const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
            return {
                wbs,
                status: (fm.status as string | undefined) ?? 'backlog',
                dependencies: this.extractDependencyWbs(fm.dependencies),
            };
        } catch {
            return null;
        }
    }

    /**
     * Scan the tasks dir for sibling tasks whose `parent_wbs` resolves to `wbs`.
     * Returns each sub-task's wbs + status. Self-referential and malformed files are
     * skipped; a missing/unreadable dir yields no sub-tasks (the check stays inert).
     */
    private async findChildren(tasksDir: string, wbs: string): Promise<{ wbs: string; status: string }[]> {
        const kids: { wbs: string; status: string }[] = [];
        for (const dir of this.locatorFor(tasksDir).folderDirs()) {
            let entries: string[];
            try {
                entries = await this.fs.readDir(dir);
            } catch {
                continue; // folder may not exist yet
            }
            for (const name of entries) {
                const m = /^(\d{4})_.+\.md$/.exec(name);
                if (m === null) continue;
                const kidWbs = m[1];
                if (kidWbs === undefined || kidWbs === wbs) continue; // skip self
                try {
                    const raw = await this.fs.readFile(`${dir}/${name}`);
                    const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
                    const parent = (fm.parent_wbs as string | undefined) ?? (fm['parent-wbs'] as string | undefined);
                    if (parent !== wbs) continue;
                    kids.push({ wbs: kidWbs, status: (fm.status as string) ?? 'backlog' });
                } catch {
                    // Unreadable/malformed sibling — skip; it surfaces under its own check.
                }
            }
        }
        return kids;
    }

    /** Find a feature file by ID (filename prefix match: `{id}_`). */
    private async findFeatureFile(featuresDir: string, id: string): Promise<string | null> {
        try {
            const entries = await this.fs.readDir(featuresDir);
            for (const name of entries) {
                if (isFeatureFile(name, id)) {
                    return `${featuresDir}/${name}`;
                }
            }
        } catch {
            // Directory doesn't exist or can't be read
        }
        return null;
    }

    /** Read the status from a feature file's frontmatter. */
    private async readFeatureStatus(featurePath: string): Promise<string | null> {
        try {
            const raw = await this.fs.readFile(featurePath);
            const doc = MarkdownDocument.parse(raw, 'feature');
            const fm = doc.frontmatterData ?? {};
            return (fm.status as string) ?? null;
        } catch {
            return null;
        }
    }

    /** Find a task file by WBS number across every registered task folder. */
    private async findTaskFile(tasksDir: string, wbs: string): Promise<string | null> {
        return await this.locatorFor(tasksDir).findPathByWbs(wbs);
    }
}
