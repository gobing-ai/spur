import {
    checkAcCoverage,
    DEFAULT_TASK_VARIANT,
    MarkdownDocument,
    parseChecklist,
    stripAcFence,
    TASK_CANONICAL_SECTIONS,
    type TaskSection,
    UNIVERSAL_SECTIONS,
} from '@gobing-ai/spur-domain';
import { FINDING_CODES } from './planning-check-base';
import type { EntityRef, PlanningWriteService, WriteResult } from './planning-write-service';
import { structuralFindings } from './structural-repair';
import { GATE_LANGUAGE_SECTIONS, hasGateLanguage, hasSolutionFileLineCitation } from './task-check';
import type { TaskFeatureLink } from './task-feature-link';
import type { TaskFiles } from './task-files';
import { isTaskFrozen, undeprecateTaskCommand } from './task-freeze';
import { renderSectionGuidanceBody, stripLeadingSectionHeader } from './task-section-bodies';
import { normalizeTaskSection } from './task-section-normalizer';
import type { SectionMutationResult, TaskServiceContext } from './task-service';
import { DependencyMutationError, SectionMutationError } from './task-service-errors';
import { evaluateTaskSize } from './task-size-precheck';

/**
 * `spur task update` verbs for {@link TaskService}: status, assignee, frontmatter fields, tags,
 * dependencies, sections and body writes, plus their advisory warnings (freeze, AC subset).
 */
export class TaskUpdateOps {
    constructor(
        private readonly ctx: TaskServiceContext,
        private readonly writeService: PlanningWriteService,
        private readonly files: TaskFiles,
        private readonly featureLink: TaskFeatureLink,
    ) {}

    /** Implementation of {@link TaskService.updateStatus} (see its doc comment for the contract). */
    async updateStatus(wbs: string, toStatus: string, actor?: string): Promise<WriteResult> {
        const filePath = await this.files.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        const result = await this.writeService.transition(ref, toStatus, actor ?? this.ctx.actor ?? 'system');
        if (toStatus === 'done' && result.toStatus === 'done') {
            try {
                await this.ctx.onTaskReachedDone?.(wbs);
            } catch {
                // Refresh enqueue must not fail a completed status transition.
            }
        }
        return result;
    }

    /** Implementation of {@link TaskService.assign} (see its doc comment for the contract). */
    async assign(wbs: string, agentId: string): Promise<WriteResult> {
        const filePath = await this.files.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return await this.writeService.updateFrontmatter(ref, 'assignee', agentId);
    }

    /** Implementation of {@link TaskService.updateField} (see its doc comment for the contract). */
    async updateField(wbs: string, key: string, value: string, noReopen?: boolean): Promise<WriteResult> {
        // `done_forced` / `done_reason` are set by the CLI verdict-guard override
        // path (R3, task 0292) — they record an operator's explicit decision to
        // advance a non-PASS task to `done`. Status itself stays on `updateStatus`.
        // `ac_numbering` opts a task into the L3 Requirements↔AC coverage check. It is
        // settable post-create because the templates only ship it on NEW tasks — without
        // this, a task authored before the standard could never adopt it. Opting in is
        // safe for traceability: `normalizeTitle` strips the `R\d+` prefix before DD-09
        // matching, so renumbering AC scenarios cannot break feature coverage.
        // `ac_altitude` opts a task out of the DD-09 feature-AC subset rule when its
        // scenarios are intentionally task-local (task-check.ts:1431). Closes the writer
        // gap where the checker honors the field but the CLI could not set it — without
        // this, every intentional task-local task either permanently carries 8 L4
        // warnings or needs a hook-bypassing raw frontmatter edit.
        const allowed: Record<string, true> = {
            feature_id: true,
            parent_wbs: true,
            priority: true,
            done_forced: true,
            done_reason: true,
            ac_numbering: true,
            ac_altitude: true,
            estimate_hours: true,
        };
        if (!(key in allowed)) {
            throw new Error(`Field "${key}" is not settable via update; allowed: ${Object.keys(allowed).join(', ')}.`);
        }
        // estimate_hours is a YAML number; a string write would quote it (`"4"`).
        let fmValue: string | number = value;
        if (key === 'estimate_hours') {
            fmValue = Number(value);
            if (value.trim() === '' || !Number.isFinite(fmValue) || fmValue <= 0) {
                throw new Error(`estimate_hours must be a positive number, got "${value}".`);
            }
        }
        const filePath = await this.files.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        // 1132 R2: the same guard apply-time as create — a terminal feature rejects the
        // re-point, a verifying feature reopens first.
        const featureReopened =
            key === 'feature_id' ? await this.featureLink.guardParentFeature(value, noReopen) : undefined;
        let result = await this.writeService.updateFrontmatter(ref, key, fmValue);
        if (featureReopened !== undefined) result = { ...result, featureReopened };
        // Attaching a feature AFTER the AC was written is the common idea-pipeline
        // order; re-run the DD-09 subset warning against the AC already on disk so the
        // orphan scenarios surface now rather than at the next `task check`.
        if (key === 'feature_id') {
            const ac = MarkdownDocument.parse(await this.ctx.fs.readFile(filePath), 'task').getSection(
                'Acceptance Criteria',
            );
            if (ac !== null && ac.trim().length > 0) {
                const warnings = await this.checkAcSubsetWarning(filePath, ac);
                if (warnings.length > 0) result = { ...result, warnings: [...(result.warnings ?? []), ...warnings] };
            }
        }
        return result;
    }

    /** Implementation of {@link TaskService.updateTags} (see its doc comment for the contract). */
    async updateTags(wbs: string, add: string[], remove: string[]): Promise<WriteResult & { tags: string[] }> {
        const blank = [...add, ...remove].find((tag) => tag.trim() === '');
        if (blank !== undefined) throw new Error('tags must be non-empty strings');
        const filePath = await this.files.resolveTaskFile(wbs);
        const raw = MarkdownDocument.parse(await this.ctx.fs.readFile(filePath), 'task').frontmatterData?.tags;
        const current = Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === 'string') : [];
        const next = current.filter((tag) => !remove.includes(tag));
        for (const tag of add) if (!next.includes(tag)) next.push(tag);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        const result = await this.writeService.updateFrontmatterArray(ref, 'tags', next);
        return { ...result, tags: next };
    }

    /** Implementation of {@link TaskService.mutateDependencies} (see its doc comment for the contract). */
    async mutateDependencies(
        wbs: string,
        op: 'set' | 'add' | 'remove' | 'clear',
        values: string[] = [],
    ): Promise<WriteResult & { dependencies: string[] }> {
        if (op === 'clear') {
            if (values.length > 0) {
                throw new DependencyMutationError('usage', `clear takes no values; got ${values.length}`);
            }
        } else if (values.length === 0) {
            throw new DependencyMutationError('usage', `${op} requires at least one WBS value`);
        }

        // Load the current array (empty if the field is absent).
        const filePath = await this.files.resolveTaskFile(wbs);
        const current = await this.files.readDependencyArray(filePath);

        // Compute the next array per `op`.
        let next: string[];
        if (op === 'clear') {
            next = [];
        } else if (op === 'set') {
            next = [...values];
        } else if (op === 'add') {
            next = [...current];
            for (const v of values) {
                if (!next.includes(v)) next.push(v);
            }
        } else {
            // remove
            next = current.filter((v) => !values.includes(v));
        }

        // 1. WBS format.
        for (const v of next) {
            if (!/^\d{4}$/.test(v)) {
                throw new DependencyMutationError('format', `Not a 4-digit WBS: "${v}"`);
            }
        }

        // 2. WBS existence (each value must resolve to a sibling task file). Kept for step 6.
        const targets = new Map<string, string>();
        for (const v of next) {
            const target = await this.files.findTaskFileName(v);
            if (target === null) {
                throw new DependencyMutationError('not-found', `No task file for WBS ${v}`);
            }
            targets.set(v, target.filePath);
        }

        // 3. Self-edge.
        if (next.includes(wbs)) {
            throw new DependencyMutationError('self-edge', `Task ${wbs} cannot depend on itself`);
        }

        // 4. Duplicates (defensive — `add` dedupes, but `set` could carry them).
        if (new Set(next).size !== next.length) {
            throw new DependencyMutationError('duplicate', `Duplicate WBS in dependencies: ${next.join(', ')}`);
        }

        // 5. Cycle detection — DFS over the graph that *would* result.
        await this.assertNoCycle(wbs, next);

        // 6. Deprecated target (ADR-137, task 1190 R1): a NEW edge onto a frozen task is
        // refused before any write, naming the un-deprecate exit. The freeze is prospective —
        // an edge already present in `current` is neither dropped nor rewritten by this guard
        // (it is reported by `L4.task-deprecated` instead), so keeping a pre-existing edge
        // while editing the rest of the array still works.
        for (const v of next) {
            if (current.includes(v)) continue;
            const targetPath = targets.get(v);
            if (targetPath === undefined) continue; // unreachable: step 2 resolved every value
            if (!isTaskFrozen(await this.files.readTaskStatus(targetPath))) continue;
            throw new DependencyMutationError(
                'deprecated',
                `Task ${v} is deprecated (frozen) — a new dependency edge onto it is refused; re-point at live work, or un-deprecate it (\`${undeprecateTaskCommand(v)}\`)`,
            );
        }

        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        const result = await this.writeService.updateFrontmatterArray(ref, 'dependencies', next);
        return { ...result, dependencies: next };
    }

    /** Implementation of {@link TaskService.mutateSections} (see its doc comment for the contract). */
    async mutateSections(
        wbs: string,
        op: 'init' | 'add' | 'list',
        sectionName?: string,
    ): Promise<SectionMutationResult> {
        if (op === 'add' && sectionName === undefined) {
            throw new SectionMutationError('usage', 'add requires a section name');
        }
        if (op !== 'add' && sectionName !== undefined) {
            throw new SectionMutationError('usage', `${op} takes no section name; got "${sectionName}"`);
        }

        const filePath = await this.files.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };

        const raw = await this.ctx.fs.readFile(filePath);
        const doc = MarkdownDocument.parse(raw, 'task');
        const fm = doc.frontmatterData ?? {};
        const variant = typeof fm.template === 'string' ? fm.template : DEFAULT_TASK_VARIANT;
        const status = typeof fm.status === 'string' ? fm.status : 'backlog';

        const matrix = this.ctx.sectionMatrix;
        const entry = matrix?.variants[variant]?.[status] ?? matrix?.variants.standard?.[status];
        if (entry === undefined) {
            throw new SectionMutationError(
                'no-matrix',
                `No section matrix for variant "${variant}" status "${status}"`,
            );
        }
        const required = entry.required ?? [];
        const optional = entry.optional ?? [];
        const forbidden = entry.forbidden ?? [];
        const present = doc.sectionNames;

        if (op === 'list') {
            return {
                op: 'list',
                ref,
                variant,
                status,
                added: [],
                matrix: { required: [...required], optional: [...optional], forbidden: [...forbidden] },
                present,
                missing: required.filter((s) => !present.includes(s)),
                warnings: [],
            };
        }

        if (op === 'add') {
            const name = sectionName as string;
            if (
                !TASK_CANONICAL_SECTIONS.includes(name as TaskSection) &&
                !(UNIVERSAL_SECTIONS as readonly string[]).includes(name)
            ) {
                throw new SectionMutationError('unknown-section', `Unknown section: "${name}"`);
            }
            if (forbidden.includes(name)) {
                throw new SectionMutationError('forbidden', `Section "${name}" is forbidden for status "${status}"`);
            }
            if (present.includes(name)) {
                // No write happened, so no PlanningEvent was emitted — leave
                // `eventName` undefined rather than claiming one fired.
                return {
                    op: 'add',
                    ref,
                    variant,
                    status,
                    added: [],
                    warnings: [`Section "${name}" already present; no change`],
                };
            }
            const body = renderSectionGuidanceBody(name as TaskSection);
            const result = await this.writeService.updateSection(ref, name, body);
            return {
                op: 'add',
                ref,
                variant,
                status,
                added: [name],
                eventName: result.eventName,
                warnings: result.warnings ?? [],
            };
        }

        // op === 'init'
        const missing = required.filter((s) => !present.includes(s));
        if (missing.length === 0) {
            // No write happened — see the `add` no-op above.
            return {
                op: 'init',
                ref,
                variant,
                status,
                added: [],
                warnings: ['All required sections already present; no change'],
            };
        }
        // Each `updateSection` is individually atomic, but the set is not: a failure
        // part-way through leaves the earlier sections on disk. Batching them would
        // need a new write-pipeline kind, which D3 rules out — so instead report
        // exactly what landed, since `init` is idempotent and a re-run completes
        // the remainder. Without this the throw would discard that progress.
        const written: string[] = [];
        let last: WriteResult | undefined;
        for (const s of missing) {
            const body = renderSectionGuidanceBody(s as TaskSection);
            try {
                last = await this.writeService.updateSection(ref, s, body);
            } catch (err) {
                const landed = written.length > 0 ? written.join(', ') : '(none)';
                throw new Error(
                    `init failed while writing section "${s}"; sections already written: ${landed}. ` +
                        `Re-run init to complete the rest (it is idempotent). Cause: ${String(err)}`,
                );
            }
            written.push(s);
        }
        return {
            op: 'init',
            ref,
            variant,
            status,
            added: written,
            eventName: last?.eventName ?? 'task.updated',
            warnings: last?.warnings ?? [],
        };
    }

    /**
     * DFS cycle check: starting from `rootWbs`, walk the dependency graph that
     * *would* exist after writing `nextDeps` to `rootWbs`, and fail if the
     * traversal revisits `rootWbs` (a self-feeding cycle through any chain).
     */
    private async assertNoCycle(rootWbs: string, nextDeps: string[]): Promise<void> {
        const visiting = new Set<string>();
        const seen = new Set<string>();
        const stack: string[] = [...nextDeps];
        while (stack.length > 0) {
            const current = stack.pop();
            if (current === undefined) break;
            if (current === rootWbs) {
                throw new DependencyMutationError(
                    'cycle',
                    `Dependency cycle detected: ${rootWbs} -> ... -> ${rootWbs}`,
                );
            }
            if (seen.has(current)) continue;
            if (visiting.has(current)) continue;
            visiting.add(current);
            const found = await this.files.findTaskFileName(current);
            if (found !== null) {
                const deps = await this.files.readDependencyArray(found.filePath);
                for (const d of deps) {
                    if (!seen.has(d) && !visiting.has(d)) stack.push(d);
                }
            }
            seen.add(current);
        }
    }

    /** Implementation of {@link TaskService.updateBody} (see its doc comment for the contract). */
    async updateBody(wbs: string, body: string, _actor?: string): Promise<WriteResult> {
        const filePath = await this.files.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.updateBody(ref, body);
    }

    /** Implementation of {@link TaskService.updateSection} (see its doc comment for the contract). */
    async updateSection(wbs: string, sectionName: string, sourceFile: string, append = false): Promise<WriteResult> {
        const filePath = await this.files.resolveTaskFile(wbs);
        const raw = await this.ctx.fs.readFile(sourceFile);
        // 1132 R1: normalize lossless authoring shapes at write time (Requirements / AC)
        // so write-time and `task check` share one predicate and the write→check→rewrite
        // loop disappears. Gherkin-only AC bodies instead imply the task-local frontmatter.
        const normalization = normalizeTaskSection(sectionName, stripLeadingSectionHeader(raw, sectionName));
        const body = normalization.body;
        // R1 (0510): an explicit Solution update must carry a recognized `file:line`
        // citation. Reject before any write so an invalid authored Solution never lands
        // on disk for a later lifecycle check to reject — the same predicate the L3
        // checker uses, so write-time and `task check` behavior cannot drift. The write
        // service is never reached, so file content, `updated_at`, and history are
        // unchanged. Placeholder creation via task templates / `sections init` uses the
        // `writeService.updateSection` path directly and is unaffected.
        if (sectionName === 'Solution' && !hasSolutionFileLineCitation(body)) {
            throw new SectionMutationError(
                'invalid-solution',
                'Solution must contain at least one `file:line` citation',
            );
        }
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        // ADR-137 (S6): a section write is a RECORD write, not a status move, so it is
        // exempt from the deprecated freeze — but the operator gets a note on the result
        // so a recorded write is never mistaken for resuming frozen work.
        const freezeWarning = await this.sectionWriteFreezeWarning(wbs, filePath);
        const noteFreeze = (written: WriteResult): WriteResult =>
            freezeWarning === null ? written : { ...written, warnings: [...(written.warnings ?? []), freezeWarning] };
        let result = await this.writeService.updateSection(ref, sectionName, body, append);

        // 1132 R1: report what was normalized, and let gherkin-only AC imply the
        // task-local flags (skipped when already set — idempotent re-writes stay no-ops).
        if (normalization.normalized.length > 0) result = { ...result, normalized: normalization.normalized };
        if (normalization.frontmatter !== undefined) {
            const fm = MarkdownDocument.parse(await this.ctx.fs.readFile(filePath), 'task').frontmatterData;
            const pending = Object.entries(normalization.frontmatter).filter(([k, v]) => fm?.[k] !== v);
            for (const [k, v] of pending) {
                await this.writeService.updateFrontmatter(ref, k, v);
            }
            // 1132 review P4 (direct fix): report only what changed. A repeat write of the same
            // gherkin AC used to report `kind: 'ac-altitude'` while touching nothing, which is the
            // same class of lying report the batch-create finding was.
            if (pending.length === 0) {
                const reported = (result.normalized ?? []).filter((n) => n.kind !== 'ac-altitude');
                result =
                    reported.length > 0 ? { ...result, normalized: reported } : { ...result, normalized: undefined };
            }
        }

        if (sectionName === 'Acceptance Criteria') {
            const warnings = await this.checkAcSubsetWarning(filePath, body);
            if (warnings.length > 0) {
                result = { ...result, warnings: [...(result.warnings ?? []), ...warnings] };
            }
        }

        // Write-time mirror of L4.gate-language: same predicate and same
        // `dependencies[]` exemption as `task check`, surfaced when the prose is
        // authored instead of at the next check.
        if ((GATE_LANGUAGE_SECTIONS as readonly string[]).includes(sectionName) && hasGateLanguage(body)) {
            const deps = MarkdownDocument.parse(await this.ctx.fs.readFile(filePath), 'task').frontmatterData
                ?.dependencies;
            if (!Array.isArray(deps) || deps.length === 0) {
                result = {
                    ...result,
                    warnings: [
                        ...(result.warnings ?? []),
                        `L4.gate-language: ${sectionName} contains gate language (HITL/approval/approved/merged/…) — say "operator answer"/"accepted", or model the gate as a frontmatter dependency`,
                    ],
                };
            }
        }

        // 0575 R1: authoring-time size warning — re-run the same evaluation the
        // pipeline precheck uses, at the moment an oversize is authored. Counts
        // the whole post-write body (a Plan write must still see the file's
        // R-items). Advisory only: the write above has already landed, and the
        // reasons ride the existing `warnings[]` channel (stderr in human mode,
        // inside the payload under `--json`) with no CLI change.
        if (sectionName === 'Requirements' || sectionName === 'Plan') {
            const written = await this.ctx.fs.readFile(filePath);
            const warnings: string[] = [];
            // Same predicate as `task check` (L3.requirements-checkbox), surfaced at the
            // moment the R-items are authored so the exact form is learned once, here.
            if (sectionName === 'Requirements') {
                for (const f of structuralFindings(written, 'task')) {
                    if (f.code === FINDING_CODES.L3_REQUIREMENTS_CHECKBOX) warnings.push(`${f.code}: ${f.message}`);
                }
            }
            const report = evaluateTaskSize(written);
            if (!report.ok) warnings.push(...report.reasons);
            if (warnings.length > 0) {
                return noteFreeze({
                    ...result,
                    warnings: [...(result.warnings ?? []), ...warnings],
                });
            }
        }

        return noteFreeze(result);
    }

    /**
     * ADR-137 (S6): the advisory appended to a successful section write on a `deprecated`
     * (frozen) task, or null for every other status. The write is exempt from the freeze —
     * it records what already happened — so this is a note on the result, never a refusal.
     */
    private async sectionWriteFreezeWarning(wbs: string, filePath: string): Promise<string | null> {
        try {
            const fm = MarkdownDocument.parse(await this.ctx.fs.readFile(filePath), 'task').frontmatterData ?? {};
            if (!isTaskFrozen(typeof fm.status === 'string' ? fm.status : null)) return null;
            return (
                `Task ${wbs} is deprecated (frozen, ADR-137) — the section write was recorded, but status ` +
                `moves stay refused until it is un-deprecated (\`${undeprecateTaskCommand(wbs)}\`)`
            );
        } catch {
            return null;
        }
    }

    /**
     * R3 (0479): DD-09 subset warning on section write.
     * When writing Acceptance Criteria, warn if task scenarios are not a subset of feature AC.
     *
     * Honors the declared `ac_altitude` (task 0584 R3/R4) exactly as `task check` does. This is
     * the SECOND surface that enforces DD-09 — if only the checker honored the field, an author
     * who correctly declared `task-local` would still be warned every time they wrote their AC,
     * which is the notation-switching pressure 0584 exists to remove.
     */
    private async checkAcSubsetWarning(taskFilePath: string, acBody: string): Promise<string[]> {
        try {
            const raw = await this.ctx.fs.readFile(taskFilePath);
            const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
            const resolved = await this.featureLink.resolveFeatureAcBody(taskFilePath);
            if (resolved === null) return [];

            const taskAc = stripAcFence(acBody);
            const taskChecklist = parseChecklist(taskAc);
            const acAltitude = fm.ac_altitude as 'graduating' | 'task-local' | undefined;
            const coverage = checkAcCoverage(resolved.ac, taskAc, taskChecklist, acAltitude);

            const warnings: string[] = [];
            for (const scenario of coverage.uncovered) {
                warnings.push(
                    `Task scenario "${scenario}" is not in feature "${resolved.featureId}"'s AC (DD-09 subset rule)`,
                );
            }
            return warnings;
        } catch {
            return [];
        }
    }
}
