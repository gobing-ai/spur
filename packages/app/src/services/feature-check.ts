/**
 * Feature check — four-layer validation for feature files.
 *
 * L1: Zod schema (hard error).
 * L2: Section-Status-Matrix presence (warning-first, gate:true hard).
 * L3: Format rules — BDD AC validation, one-active-goal, children-limit.
 * L4: Traceability (warning-first, feature_id edge validation).
 */

import { dirname, join } from 'node:path';
import {
    checkAcCoverage,
    featureFrontmatterSchema,
    MarkdownDocument,
    normalizeTitle,
    parseChecklist,
    parseFeature,
    stripAcFence,
    validateAcceptanceCriteria,
    WAYFINDER_MAP_TAG,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { computeAggregate, readVerdictArtifact as readGuardVerdictArtifact } from './done-transition-guard';
import {
    type CheckFindings,
    FINDING_CODES,
    type MatrixEntry,
    PlanningCheckService,
    type SectionMatrix,
    type Severity,
} from './planning-check-base';
import { applyStructuralRepairs, type StructuralRepair } from './structural-repair';
import { parseTesting } from './task-record';
import { aggregateVerifyVerdict } from './verify-verdict';

// ─── Types ──────────────────────────────────────────────────────────────

// Feature-check keeps its historical type names as aliases over the shared
// scaffold types (the shapes are identical across task and feature checks).
/** Finding severity level for feature checks (`error` blocks the gate; `warning` is advisory). */
export type CheckFeatureSeverity = Severity;
/** A single validation finding from a feature check layer (L1–L4). */
export type CheckFeatureFindings = CheckFindings;
/** Section-Status-Matrix config shape for feature checks (design §3.2). */
export type FeatureSectionMatrix = SectionMatrix;
/** Per-status matrix entry defining required/optional/forbidden feature sections. */
export type FeatureMatrixEntry = MatrixEntry;

/** Result of a `spur feature check` validation run. */
export interface CheckFeatureResult {
    id: string;
    status: string;
    findings: CheckFeatureFindings[];
    /** Required sections for the current status. */
    requiredSections: string[];
    /** Missing required sections for the current status. */
    missingSections: string[];
    /** Whether the check passed (no hard errors). */
    pass: boolean;
    /** Structural repairs applied by `--fix` (empty when `--fix` was not given or nothing was repairable). */
    repairs?: StructuralRepair[];
}

/** Default feature section matrix — matches the canonical section vocabulary. */
export const DEFAULT_FEATURE_MATRIX: FeatureSectionMatrix = {
    variants: {
        standard: {
            backlog: {
                required: [],
                optional: ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks', 'Notes', 'History'],
            },
            active: {
                required: ['Goal', 'Scope', 'Acceptance Criteria'],
                optional: ['Tasks', 'Notes', 'History'],
                gate: true,
            },
            verifying: {
                required: ['Goal', 'Scope', 'Acceptance Criteria'],
                optional: ['Tasks', 'Notes', 'History'],
                gate: true,
            },
            blocked: {
                required: ['Goal', 'Notes'],
                optional: ['Scope', 'Acceptance Criteria', 'Tasks', 'History'],
            },
            done: {
                required: ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks'],
                optional: ['Notes', 'History'],
                gate: true,
            },
            cancelled: {
                required: ['Notes'],
                optional: ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks', 'History'],
            },
        },
        // Group (umbrella) features: identical to `standard` minus the Acceptance Criteria
        // requirement. AC lives on the leaf children; a group that carried its own would
        // duplicate or contradict them. Goal/Scope/Tasks stay required — an umbrella still has
        // to say what it covers and what hangs off it.
        group: {
            backlog: {
                required: [],
                optional: ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks', 'Notes', 'History'],
            },
            active: {
                required: ['Goal', 'Scope'],
                optional: ['Acceptance Criteria', 'Tasks', 'Notes', 'History'],
                gate: true,
            },
            verifying: {
                required: ['Goal', 'Scope'],
                optional: ['Acceptance Criteria', 'Tasks', 'Notes', 'History'],
                gate: true,
            },
            blocked: {
                required: ['Goal', 'Notes'],
                optional: ['Scope', 'Acceptance Criteria', 'Tasks', 'History'],
            },
            done: {
                required: ['Goal', 'Scope', 'Tasks'],
                optional: ['Acceptance Criteria', 'Notes', 'History'],
                gate: true,
            },
            cancelled: {
                required: ['Notes'],
                optional: ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks', 'History'],
            },
        },
    },
};

/**
 * Select the section-matrix variant for a feature. Features tagged `group` are umbrellas whose
 * Acceptance Criteria live on their leaf children (convention held by every group feature in the
 * corpus); everything else uses the standard matrix.
 */
function isGroupFeature(fm: Record<string, unknown>): string {
    const tags = fm.tags;
    return Array.isArray(tags) && tags.includes('group') ? 'group' : 'standard';
}

// ─── FeatureCheckService ────────────────────────────────────────────────

/** Four-layer feature validator. L1 schema → L2 matrix → L3 format → L4 traceability. */
export class FeatureCheckService extends PlanningCheckService {
    constructor(fs: FileSystem, matrix?: FeatureSectionMatrix) {
        super({
            fs,
            matrix: matrix ?? DEFAULT_FEATURE_MATRIX,
            docKind: 'feature',
            frontmatterSchema: featureFrontmatterSchema,
            parse: (raw, kind) => MarkdownDocument.parse(raw, kind),
        });
    }

    /** Run the four-layer validation against a feature file. */
    async check(
        filePath: string,
        featureId: string,
        options?: {
            strict?: boolean;
            featuresDir?: string;
            /** Active task folder (legacy single-dir). Prefer {@link tasksDirs}. */
            tasksDir?: string;
            /**
             * All registered task phase folders (docs/tasks, tasks2, tasks3, …).
             * When set, L4 `feature_id` edge resolution scans **every** folder —
             * matching `FeatureService.collectTasksByFeature` so archive-folder
             * edges (e.g. docs/tasks2) no longer look like orphan scenarios.
             */
            tasksDirs?: string[];
            dogfoodDir?: string;
            /** Directory containing `<wbs>-verdict.json` artifacts (default: <tasksDir parent>/.spur/run). */
            runDir?: string;
            severityOverrides?: Record<string, 'error' | 'warning' | 'off'>;
            /**
             * Transition-target hint (0418): evaluate the one-active-goal rule as if
             * the feature were already in this status. The lifecycle FSM guards pass
             * the edge's `to` status (`--as verifying` / `--as done`) so the rule
             * sees the post-transition state and never denies the exit it would
             * relieve. Only the one-active-goal rule consumes the hint; every other
             * layer keeps evaluating the current frontmatter.
             */
            asStatus?: string;
            /** Repair structural findings (heading presence/level/order, R-item checkboxes) in place before validating (task 0619). */
            fix?: boolean;
        },
    ): Promise<CheckFeatureResult> {
        const strict = options?.strict === true;
        const rawSource = await this.fs.readFile(filePath);
        let raw = rawSource;
        let repairs: StructuralRepair[] = [];
        if (options?.fix === true) {
            const probe = MarkdownDocument.parse(rawSource, 'feature');
            const probeFm = probe.frontmatterData ?? {};
            const probeStatus = (probeFm.status as string) ?? 'backlog';
            const probeEffective = options?.asStatus ?? probeStatus;
            const fixEntry = this.resolveMatrixEntry(isGroupFeature(probeFm), probeEffective);
            const fixed = applyStructuralRepairs(rawSource, 'feature', fixEntry);
            if (fixed.changed) {
                await this.fs.writeFile(filePath, fixed.content);
                repairs = fixed.repairs;
                raw = fixed.content;
            }
        }
        const findings: CheckFeatureFindings[] = [];

        // ── L1: Schema validation (hard) ──
        const doc = this.runL1(raw, featureId, findings);
        if (doc === null) {
            return { id: featureId, ...this.summarizeWithStatus('', findings, strict, options?.severityOverrides) };
        }

        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        // Group features are umbrellas: their leaf children own Acceptance Criteria, so requiring
        // AC on the parent would duplicate the children's scope and strand every group at the L2
        // gate. `resolveMatrixEntry` already falls back to `standard` for unknown variants.
        const entry = this.resolveMatrixEntry(isGroupFeature(fm), status);

        // ── L2: Section presence (warning-first, gate:true hard) ──
        this.runL2(doc, entry, findings, raw);

        // ── L3: Format rules — BDD AC validation + structural rules ──
        this.runL3(doc, findings, fm);

        // ── L3: One-active-goal + children-limit (corpus-derived) ──
        if (options?.featuresDir) {
            await this.checkOneActiveGoal(fm, featureId, options.featuresDir, findings, options.asStatus);
            await this.checkChildrenLimit(featureId, options.featuresDir, findings);
        }

        // ── L4: Traceability — incoming feature_id edges + orphan scenarios ──
        const dogfoodDir =
            options?.dogfoodDir ?? (options?.featuresDir ? join(dirname(options.featuresDir), 'dogfood') : undefined);
        // Verdict artifacts live at <repo>/.spur/run (CLI cwd), not under docs/.
        // When tasksDir is `docs/tasks*` (this monorepo layout), dirname(tasksDir)
        // is `docs` — walking one extra level reaches the repo root. Callers that
        // know the root should pass `runDir` explicitly.
        const primaryTasksDir = options?.tasksDir ?? options?.tasksDirs?.[0];
        const runDir = options?.runDir ?? (primaryTasksDir ? defaultVerdictRunDir(primaryTasksDir) : undefined);
        const taskScanDirs =
            options?.tasksDirs && options.tasksDirs.length > 0
                ? options.tasksDirs
                : options?.tasksDir
                  ? [options.tasksDir]
                  : [];
        await this.runL4(doc, featureId, status, taskScanDirs, dogfoodDir, runDir, findings);

        return {
            id: featureId,
            ...this.summarizeWithStatus(status, findings, strict, options?.severityOverrides),
            repairs,
        };
    }

    // ── L3: Format rules ──
    private runL3(doc: MarkdownDocument, findings: CheckFeatureFindings[], fm: Record<string, unknown>): void {
        // Acceptance Criteria: two-tier AC (B08) — Gherkin OR checklist, via the
        // shared BDD module (never a private parser). Strip the markdown code
        // fence the template/corpus wrap Gherkin in before validating.
        const rawAc = doc.getSection('Acceptance Criteria');
        if (rawAc !== null && rawAc.trim().length > 0) {
            // Wayfinder maps (task 0473): a map's target is its `## Goal` (destination),
            // not testable acceptance criteria — its AC section carries a deliberate
            // `### Not yet specified` disclaimer. Skip BDD/checklist AC validation for
            // tagged maps so the BDD gate stops blocking the charting workflow. Only
            // AC validation is suppressed; scope, one-active-goal, and L4 traceability
            // all remain live for maps.
            const tags = Array.isArray(fm.tags) ? (fm.tags as unknown[]) : [];
            const isWayfinderMap = tags.includes(WAYFINDER_MAP_TAG);
            if (!isWayfinderMap) {
                const acBody = stripAcFence(rawAc);

                // Checklist tier: `- [ ]`/`- [x]` items and no Gherkin keyword.
                const checklist = parseChecklist(acBody);
                const looksGherkin = /^\s*(Feature:|Scenario:|Scenario Outline:)/m.test(acBody);

                if (checklist.length > 0 && !looksGherkin) {
                    // Tier-2 checklist AC: require at least one non-empty item.
                    const emptyItems = checklist.filter((c) => c.text.length === 0);
                    for (const item of emptyItems) {
                        findings.push({
                            layer: 'L3',
                            code: FINDING_CODES.L3_AC_CHECKLIST_TEXT,
                            severity: 'warning',
                            section: 'Acceptance Criteria',
                            line: item.line,
                            message: 'Checklist item has no text',
                        });
                    }
                    return;
                }

                const bddResult = validateAcceptanceCriteria(acBody);

                for (const err of bddResult.errors) {
                    findings.push({
                        layer: 'L3',
                        code: FINDING_CODES.L3_AC_BDD_ERROR,
                        severity: 'error',
                        section: 'Acceptance Criteria',
                        line: err.line,
                        message: `BDD: ${err.message}`,
                    });
                }
                for (const warn of bddResult.warnings) {
                    findings.push({
                        layer: 'L3',
                        code: FINDING_CODES.L3_AC_BDD_WARNING,
                        severity: 'warning',
                        section: 'Acceptance Criteria',
                        line: warn.line,
                        message: `BDD: ${warn.message}`,
                    });
                }

                if (!bddResult.valid) {
                    findings.push({
                        layer: 'L3',
                        code: FINDING_CODES.L3_AC_BDD_INVALID,
                        severity: 'error',
                        section: 'Acceptance Criteria',
                        message: 'Acceptance Criteria validation failed; fix BDD syntax errors',
                    });
                }
            }
        }

        // Scope: should contain in/out delineation (warning)
        const scopeBody = doc.getSection('Scope');
        if (scopeBody !== null && scopeBody.trim().length > 0) {
            // The `In:` / `Out:` label forms are anchored per-line rather than written as
            // `/\b[Ii]n:\b/`: a `\b` after a colon only matches when a word character
            // follows, so that form could never match the `- In:` / `- Out:` bullets the
            // scaffold itself emits (feature-service.ts) — every scaffolded feature warned.
            // Optional leading bullet and `**bold**` wrapping are both accepted.
            const hasInOut =
                /\b[Ii]n\s*scope\b/.test(scopeBody) ||
                /\b[Oo]ut\s*of\s*scope\b/.test(scopeBody) ||
                /^\s*(?:[-*+]\s*)?\*{0,2}[Ii]n\*{0,2}\s*:/m.test(scopeBody) ||
                /^\s*(?:[-*+]\s*)?\*{0,2}[Oo]ut\*{0,2}\s*:/m.test(scopeBody);
            if (!hasInOut) {
                findings.push({
                    layer: 'L3',
                    code: FINDING_CODES.L3_SCOPE_DELINEATION,
                    severity: 'warning',
                    section: 'Scope',
                    message: 'Scope should delineate in-scope / out-of-scope items',
                });
            }
        }
    }

    // ── L3: One-active-goal — at most one P0 feature in `active` ──
    private async checkOneActiveGoal(
        fm: Record<string, unknown>,
        currentId: string,
        featuresDir: string,
        findings: CheckFeatureFindings[],
        asStatus?: string,
    ): Promise<void> {
        type Priority = string;
        const priority = fm.priority as Priority | undefined;
        const status = (fm.status as string | undefined) ?? 'backlog';

        // 0418 (direction-aware): `asStatus` is the transition target the lifecycle
        // FSM guard is moving this feature to. The rule evaluates the post-transition
        // state, so a transition that EXITS the active set (`active → verifying`,
        // `verifying → done`) is never denied by the same rule it relieves.
        const effectiveStatus = asStatus ?? status;

        // Only P0 features count as goals, and only `active` is a goal status: a P0
        // in `verifying` is terminal-bound (verification toward done, DD-13) and no
        // longer blocks a new active goal (0418).
        if (priority !== 'P0') return;
        if (effectiveStatus !== 'active') return;

        const conflict = await findOtherP0InStatus(this.fs, featuresDir, currentId, ['active']);
        if (conflict !== null) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_ONE_ACTIVE_GOAL,
                severity: 'error',
                section: '',
                message: `One-active-goal violated: P0 feature "${conflict.id}" is already ${conflict.status}`,
            });
        }
    }

    // ── L3: Children-limit — <=9 children per node (DD-14, corpus-derived) ──
    private async checkChildrenLimit(
        featureId: string,
        featuresDir: string,
        findings: CheckFeatureFindings[],
    ): Promise<void> {
        // Children count is DERIVED from the corpus, not stored in frontmatter: a
        // child's ID is this node's ID + exactly one more digit (DD-14, parent =
        // drop last char). Overflow is a "split the parent" signal, reported as a
        // finding — never engineered around.
        let children = 0;
        try {
            const entries = await this.fs.readDir(featuresDir);
            const childLength = featureId.length + 1;
            for (const entry of entries) {
                const match = /^([A-Z][1-9]*)_/.exec(entry);
                const otherId = match?.[1];
                if (otherId && otherId.length === childLength && otherId.startsWith(featureId)) {
                    children += 1;
                }
            }
        } catch {
            // Directory unreadable — skip the children-limit check.
            return;
        }
        if (children > 9) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_CHILDREN_LIMIT,
                severity: 'warning',
                section: '',
                message: `Feature "${featureId}" has ${children} children; DD-14 limit is <=9 per node — split the parent`,
            });
        }
    }

    private async runL4(
        doc: MarkdownDocument,
        featureId: string,
        status: string,
        tasksDirs: string[],
        dogfoodDir: string | undefined,
        runDir: string | undefined,
        findings: CheckFeatureFindings[],
    ): Promise<void> {
        if (tasksDirs.length === 0) return;

        // Tasks reference features via `feature_id` (one direction, DD-07). A
        // feature's "edges" are the tasks pointing at it. Scan every registered
        // phase folder (active + archive) so edges in docs/tasks2 still count.
        let linkedTasks = 0;
        const incompleteTasks: string[] = [];
        const linkedTaskAc: string[] = [];
        const linkedTaskSolutions: string[] = [];
        // Per-task linkage record for scenario-satisfaction classification (0340).
        // A scenario is "covered" by a task when DD-09 normalized-title matching
        // links them; "verified" only when that task is done AND its resolved
        // evidence is an internally consistent PASS with a matching MET row.
        const linkedTaskRecords: Array<{ wbs: string; status: string; ac: string; testing: string }> = [];
        for (const tasksDir of tasksDirs) {
            try {
                const entries = await this.fs.readDir(tasksDir);
                for (const entry of entries) {
                    if (!/^\d{4}_.+\.md$/.test(entry)) continue;
                    try {
                        const raw = await this.fs.readFile(`${tasksDir}/${entry}`);
                        const taskDoc = MarkdownDocument.parse(raw, 'task');
                        const tfm = taskDoc.frontmatterData ?? {};
                        const tfid =
                            (tfm.feature_id as string | undefined) ?? (tfm['feature-id'] as string | undefined);
                        if (tfid !== featureId) continue;
                        linkedTasks += 1;
                        const tStatus = (tfm.status as string | undefined) ?? 'backlog';
                        const wbs = entry.match(/^(\d{4})_/)?.[1] ?? entry;
                        if (tStatus !== 'done' && tStatus !== 'cancelled') {
                            incompleteTasks.push(wbs);
                        }
                        const tac = stripAcFence(taskDoc.getSection('Acceptance Criteria') ?? '');
                        if (tac.trim().length > 0) linkedTaskAc.push(tac);
                        linkedTaskSolutions.push(taskDoc.getSection('Solution') ?? '');
                        linkedTaskRecords.push({
                            wbs,
                            status: tStatus,
                            ac: tac,
                            testing: taskDoc.getSection('Testing') ?? '',
                        });
                    } catch {
                        // A task that references this feature but fails to parse is a
                        // dangling edge — surface it as a traceability warning.
                        findings.push({
                            layer: 'L4',
                            code: FINDING_CODES.L4_LINKED_TASK_PARSE_FAILED,
                            severity: 'warning',
                            section: '',
                            message: `Linked task file "${entry}" failed to parse — dangling feature_id edge`,
                        });
                    }
                }
            } catch {
                // One phase folder unreadable — continue scanning the others.
            }
        }

        // Orphan-scenario warning: AC scenarios exist but no task references this
        // feature, so the acceptance work is untraced (DD-07 expects >=1 owner).
        const acBody = stripAcFence(doc.getSection('Acceptance Criteria') ?? '');
        const hasScenarios = /^\s*Scenario:/m.test(acBody);
        if (hasScenarios && linkedTasks === 0) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_ORPHAN_SCENARIOS,
                severity: 'warning',
                section: 'Acceptance Criteria',
                message: `Feature "${featureId}" has acceptance scenarios but no linked task (orphan scenarios)`,
            });
        } else if (hasScenarios && linkedTaskAc.length > 0) {
            // R2 coverage-based orphans (DD-09): feature scenarios covered by no
            // linked task's AC — warnings only (a feature legitimately precedes
            // full decomposition). A feature scenario is orphaned only when NO
            // linked task covers it. `checkAcCoverage(featureAc, taskAc).orphans`
            // = scenarios not covered by THAT task; the intersection across all
            // tasks = scenarios covered by none. (Concatenating multiple `Feature:`
            // blocks would only parse the first, so check per-task.)
            // Start with all feature scenarios as orphans, then remove any covered
            // by at least one task (set difference accumulated across tasks).
            let stillOrphan = new Set(checkAcCoverage(acBody, '').orphans);
            for (const taskAc of linkedTaskAc) {
                if (stillOrphan.size === 0) break;
                const orphanedByThisTask = new Set(checkAcCoverage(acBody, taskAc, parseChecklist(taskAc)).orphans);
                // A scenario covered by THIS task drops out of the orphan set.
                stillOrphan = new Set([...stillOrphan].filter((o) => orphanedByThisTask.has(o)));
            }
            for (const orphan of stillOrphan) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_UNCOVERED_FEATURE_SCENARIO,
                    severity: 'warning',
                    section: 'Acceptance Criteria',
                    message: `Feature scenario "${orphan}" is not covered by any linked task (DD-09)`,
                });
            }
        }

        // 0340: Scenario-satisfaction classification. For each linked (non-orphan)
        // scenario, check whether any covering task is `done` AND resolves to an
        // internally consistent PASS with a matching MET row. Unverified
        // scenarios emit L4.scenario-unverified (warning by default; --strict
        // elevates to error). Orphans were already handled above and are excluded.
        await this.checkScenarioSatisfaction(acBody, linkedTaskRecords, runDir, findings);
        // DD-13 verifying-readiness: a feature in (or entering) `verifying` should
        // have all its linked tasks done/cancelled. This is a WARNING (non-blocking)
        // — it surfaces through the `active→verifying` guard (`spur feature check`,
        // exit 0 on warnings) so the operator is warned but not stopped (R2/0059).
        if (status === 'verifying' && incompleteTasks.length > 0) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_VERIFYING_INCOMPLETE_TASKS,
                severity: 'warning',
                section: '',
                message: `Feature "${featureId}" is verifying but ${incompleteTasks.length} linked task(s) are not done/cancelled: ${incompleteTasks.join(', ')}`,
            });
        }

        // ── P3: Dogfood requirement for self-referential workflow changes ──
        // When a feature touches Spur's own workflow infrastructure, a dogfood
        // artifact must exist in docs/dogfood/ before the feature can be marked
        // done. Fires as a warning; elevated to error by --strict during the
        // verifying→done lifecycle guard.
        if (status === 'verifying' || status === 'done') {
            const SELF_REFERENTIAL_PATTERNS = [
                /\.spur\/workflows\//,
                /plugins\/sp\//,
                /packages\/app\/src\/services\/\w*workflow/i,
                /packages\/app\/src\/workflow\//,
            ];
            const touchesSelfRef = linkedTaskSolutions.some((sol) =>
                SELF_REFERENTIAL_PATTERNS.some((p) => p.test(sol)),
            );
            if (touchesSelfRef && dogfoodDir !== undefined) {
                let hasDogfood = false;
                try {
                    // 0700 R4: the gate must read repository state, not
                    // machine-local files. docs/dogfood/ is gitignored, so a
                    // readdir decided feature readiness from evidence a fresh
                    // clone does not have (41 features passed on untracked
                    // reports). The tracked ledger docs/dogfood/INDEX.md is the
                    // evidence source when present; readdir stays as the
                    // fallback for a ledger-less tree.
                    let entries: string[];
                    try {
                        const ledger = await this.fs.readFile(`${dogfoodDir}/INDEX.md`);
                        entries = ledger.split('\n');
                    } catch {
                        entries = await this.fs.readDir(dogfoodDir);
                    }
                    // R5b (0625): anchor the match to a filename segment, not a raw
                    // substring. `f.includes('A3')` matched any filename merely
                    // CONTAINING `A3` — an unrelated report (or a report for another
                    // feature with A3 as an incidental substring) cleared this gate.
                    // The id must be delimited by `-`/`.`/`_`/boundary, so a filename
                    // segment must equal the feature id (feature ids are `[A-Z][0-9]*`,
                    // so the delimiters cannot be alphanumeric).
                    const segmentRe = new RegExp(`(^|[^A-Za-z0-9])${featureId}([^A-Za-z0-9]|$)`, 'i');
                    hasDogfood = entries.some((f) => segmentRe.test(f));
                } catch {
                    // Directory doesn't exist — no dogfood artifact.
                }
                if (!hasDogfood) {
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_DOGFOOD_MISSING,
                        severity: 'warning',
                        section: 'Dogfood',
                        message:
                            `Feature "${featureId}" touches self-referential workflow infrastructure ` +
                            'but no dogfood artifact exists in docs/dogfood/. ' +
                            'Run the dogfood workflow and write a report before marking the feature done.',
                    });
                }
            }
        }
    }

    /**
     * 0340: Classify each linked (non-orphan) AC scenario as verified or
     * unverified against resolved per-task evidence. A scenario is verified when
     * ANY covering task is `done` AND its artifact-first, tracked-Testing-fallback
     * evidence is an internally consistent PASS with a matching MET row. Otherwise
     * the scenario is linked-but-unverified → L4.scenario-unverified.
     */
    private async checkScenarioSatisfaction(
        featureAc: string,
        linkedTasks: Array<{ wbs: string; status: string; ac: string; testing: string }>,
        runDir: string | undefined,
        findings: CheckFeatureFindings[],
    ): Promise<void> {
        if (linkedTasks.length === 0 || runDir === undefined) return;
        const parsed = parseFeature(featureAc);
        if (parsed === null) return;
        if (parsed.scenarios.length === 0) return;

        // Index AC-N aliases (1-based ordinal) so verdict rows keyed by either
        // normalized title or AC-N ordinal both match.
        const scenarioAliases = parsed.scenarios.map((s, i) => ({
            title: s.name,
            normalized: normalizeTitle(s.name),
            alias: `AC-${i + 1}`,
        }));

        // Build covering-task sets per scenario using DD-09 normalized matching.
        // A scenario is "covered" by a task when that task's AC contains a
        // scenario whose normalized title matches (checkAcCoverage semantics).
        const covers: Record<string, Array<{ wbs: string; status: string }>> = {};
        for (const sc of scenarioAliases) {
            const linked: Array<{ wbs: string; status: string }> = [];
            for (const task of linkedTasks) {
                // checkAcCoverage returns `orphans` = feature scenarios NOT covered
                // by this task. If the scenario is NOT in orphans, this task covers it.
                const taskCov = checkAcCoverage(
                    `Feature: x\n  Scenario: ${sc.title}\n    Given x`,
                    task.ac,
                    parseChecklist(task.ac),
                );
                if (!taskCov.orphans.includes(sc.title)) {
                    linked.push({ wbs: task.wbs, status: task.status });
                }
            }
            covers[sc.title] = linked;
        }

        // 0410 R3/R4: pre-read each unique done-task artifact once, emit a bounded
        // L4.malformed-verdict-artifact finding per artifact with rejected rows,
        // then verify scenarios against the cache instead of re-reading files.
        const doneWbs = new Set<string>();
        for (const sc of scenarioAliases) {
            for (const task of covers[sc.title] ?? []) {
                if (task.status === 'done') doneWbs.add(task.wbs);
            }
        }
        const artifacts = new Map<string, ParsedVerdictArtifact>();
        // F93 (0672): the tracked `## Testing` section is the durable copy — thread it in
        // with zero extra I/O (the same already-parsed task document supplied `ac`).
        const testingByWbs = new Map(linkedTasks.map((t) => [t.wbs, t.testing]));
        for (const wbs of doneWbs) {
            const artifact = await this.readVerdictArtifact(runDir, wbs);
            artifacts.set(wbs, artifact);
            // F93 (0672): supersedes 0451 R7's "missing artifact ⇒ unverified for this
            // coverer only" path. Outcome unchanged (missing still never reads as
            // verified), but missing now consults the tracked `## Testing` section
            // first via parseTesting (0671). The artifact stays authoritative whenever
            // it exists; the fallback never merges and never tiebreaks.
            const missing = artifact.diagnostics.artifactError === 'artifact is missing';
            if (missing) {
                const parsed = parseTesting(testingByWbs.get(wbs) ?? '', wbs);
                if (parsed.kind === 'valid') {
                    artifacts.set(wbs, {
                        path: 'tracked ## Testing section',
                        verdict: parsed.verdict.verdict,
                        computedVerdict: aggregateVerifyVerdict({
                            requirements: parsed.verdict.requirements,
                            acceptanceCriteria: parsed.verdict.acceptanceCriteria,
                        }),
                        requirements: parsed.verdict.requirements.map((r) => ({ id: r.id, status: r.status })),
                        acceptanceCriteria: parsed.verdict.acceptanceCriteria.map((r) => ({
                            id: r.id,
                            status: r.status,
                        })),
                        diagnostics: {
                            rejectedRowCount: 0,
                            invalidFields: [],
                            arrayStates: { requirements: 'populated', acceptanceCriteria: 'populated' },
                        },
                    });
                } else {
                    // Evidence was never durably recorded — a named state that reads as
                    // neither verified nor failed (R3/R4). Distinct from
                    // L4.scenario-unverified ("we looked and it was not verified") and
                    // from L4.malformed-verdict-artifact (artifact exists, corrupt).
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_EVIDENCE_NOT_RECOVERABLE,
                        severity: 'warning',
                        section: 'Acceptance Criteria',
                        message:
                            `Task ${wbs} has no verdict artifact and its tracked ## Testing section ` +
                            `carries no recoverable coverage evidence (${parsed.kind}); its evidence ` +
                            'predates durable recording, so it is neither verified nor failed.',
                    });
                }
            }
            const diagnosticParts: string[] = [];
            if (artifact.diagnostics.artifactError !== undefined) {
                // Only flag as malformed when the artifact file exists but is corrupt.
                // A missing artifact is expected for archive tasks and was already
                // offered the tracked-Testing fallback above. Only an artifact that
                // exists but is corrupt belongs in this diagnostic.
                if (artifact.diagnostics.artifactError !== 'artifact is missing') {
                    diagnosticParts.push(artifact.diagnostics.artifactError);
                }
            }
            if (artifact.diagnostics.rejectedRowCount > 0) {
                diagnosticParts.push(`${artifact.diagnostics.rejectedRowCount} rejected coverage row(s)`);
            }
            if (artifact.diagnostics.invalidFields.length > 0) {
                diagnosticParts.push(`invalid fields: ${artifact.diagnostics.invalidFields.join(', ')}`);
            }
            if (diagnosticParts.length > 0) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT,
                    severity: 'warning',
                    section: 'Acceptance Criteria',
                    message:
                        `Task ${wbs} verdict artifact (${artifact.path}) is invalid: ${diagnosticParts.join('; ')}. ` +
                        'Rows were not silently dropped — verify the artifact uses canonical `id` ' +
                        '(or `scenario` alias) and `status` fields.',
                });
            }
        }

        // 0700 R3 (AC5): promote the verdict-time "no verdict row matches any
        // scenario" stderr warning to a finding here at the feature done gate,
        // where it can be acted on, instead of re-warning on every `task
        // verdict` derivation. Warning by default; --strict (the done gate)
        // elevates it to error, so done-task evidence keyed to nothing in the
        // feature cannot advance silently.
        for (const [taskWbs, artifact] of artifacts) {
            if (artifact.diagnostics.artifactError === 'artifact is missing') continue;
            const rows = [...artifact.requirements, ...artifact.acceptanceCriteria];
            if (rows.length === 0) continue;
            const anyMatch = rows.some((r) => scenarioAliases.some((sc) => rowMatchesScenario(r.id, sc)));
            if (!anyMatch) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_VERDICT_ROWS_MATCH_NO_SCENARIO,
                    severity: 'warning',
                    section: 'Acceptance Criteria',
                    message: `Task ${taskWbs} verdict evidence (${artifact.path}) carries ${rows.length} row(s) matching no scenario of this feature — key rows by scenario title or AC-N alias (repair: /sp:dev-verify ${taskWbs})`,
                });
            }
        }

        for (const sc of scenarioAliases) {
            const linked = covers[sc.title] ?? [];
            if (linked.length === 0) continue; // orphan — already handled above
            const verified = this.isScenarioVerified(sc, linked, artifacts);
            if (!verified) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_SCENARIO_UNVERIFIED,
                    severity: 'warning',
                    section: 'Acceptance Criteria',
                    message:
                        `Feature scenario "${sc.title}" is linked but unverified: covering task(s) ` +
                        `${linked.map((l) => l.wbs).join(', ')} have no PASS verdict with MET requirement`,
                });
            }
        }
    }

    /**
     * A scenario is verified when ANY covering task is `done` AND its resolved
     * evidence shows both stored and recomputed PASS with a matching
     * requirement **or acceptanceCriteria** row of status MET. Matching id =
     * normalized scenario title, optional
     * `Scenario: ` prefix, or AC-N alias.
     *
     * 0410: reads from the pre-built artifact cache (no per-scenario file I/O).
     */
    private isScenarioVerified(
        sc: { title: string; normalized: string; alias: string },
        linked: Array<{ wbs: string; status: string }>,
        artifacts: Map<string, ParsedVerdictArtifact>,
    ): boolean {
        for (const task of linked) {
            if (task.status !== 'done') continue;
            const artifact = artifacts.get(task.wbs);
            if (artifact === undefined) continue;
            if (artifact.verdict !== 'PASS' || artifact.computedVerdict !== 'PASS') continue;
            const rows = [...artifact.requirements, ...artifact.acceptanceCriteria];
            const matched = rows.find((r) => rowMatchesScenario(r.id, sc));
            if (matched !== undefined && matched.status === 'MET') return true;
        }
        return false;
    }

    /**
     * Read and parse `<runDir>/<wbs>-verdict.json` (0410: hardened parser).
     *
     * Returns accepted rows plus structured diagnostics for missing/unreadable
     * artifacts, malformed JSON/root values, absent/invalid arrays, and rejected
     * rows so callers can emit one bounded finding per artifact.
     *
     * Row acceptance (R1/R2): each row yields a canonical `{ id, status }` when:
     * - `status` is a string AND
     * - `id` is a string (canonical) OR `scenario` is a string (compatibility alias)
     * - When both `id` and `scenario` are present and differ → rejected (R2 conflict)
     */
    private async readVerdictArtifact(runDir: string, wbs: string): Promise<ParsedVerdictArtifact> {
        const loaded = await readGuardVerdictArtifact(this.fs, runDir, wbs);
        if (loaded.artifact === undefined) {
            return {
                path: loaded.path,
                requirements: [],
                acceptanceCriteria: [],
                diagnostics: {
                    artifactError: loaded.readError ?? 'artifact is missing',
                    rejectedRowCount: 0,
                    invalidFields: [],
                    arrayStates: { requirements: 'unavailable', acceptanceCriteria: 'unavailable' },
                },
            };
        }
        // SAFETY: readGuardVerdictArtifact returns the artifact only when the
        // JSON root parsed; every field is re-validated by decodeVerdictRows
        // below, so the unknown-shaped cast cannot smuggle a bad row through.
        const parsed = loaded.artifact as unknown as {
            verdict?: unknown;
            requirements?: unknown;
            acceptanceCriteria?: unknown;
        };
        const req = decodeVerdictRows(parsed.requirements, 'requirements', true);
        const ac = decodeVerdictRows(parsed.acceptanceCriteria, 'acceptanceCriteria', false);
        return {
            path: loaded.path,
            verdict: typeof parsed.verdict === 'string' ? parsed.verdict : undefined,
            computedVerdict: computeAggregate(loaded.artifact),
            requirements: req.rows,
            acceptanceCriteria: ac.rows,
            diagnostics: {
                artifactError: typeof parsed.verdict === 'string' ? undefined : 'invalid `verdict` field',
                rejectedRowCount: req.rejected + ac.rejected,
                invalidFields: [...new Set([...req.invalidFields, ...ac.invalidFields])],
                arrayStates: { requirements: req.state, acceptanceCriteria: ac.state },
            },
        };
    }
}

/**
 * Find the first other P0 feature in `featuresDir` whose status is one of `statuses`.
 * Shared by the one-active-goal rule (feature-check L3) and the activation-side
 * guard (FeatureService sync, 0418 R3) so both enforce the same WIP limit against
 * the same corpus scan. Returns `null` on an unreadable directory or no match;
 * unparseable sibling files are skipped.
 */
export async function findOtherP0InStatus(
    fs: FileSystem,
    featuresDir: string,
    currentId: string,
    statuses: readonly string[],
): Promise<{ id: string; status: string } | null> {
    try {
        const entries = await fs.readDir(featuresDir);
        for (const entry of entries) {
            if (!entry.endsWith('.md')) continue;

            const match = /^([A-Z][1-9]*)_/.exec(entry);
            if (match === null) continue;
            const otherId = match[1];
            if (otherId === undefined) continue;

            // Skip self
            if (otherId === currentId) continue;

            try {
                const raw = await fs.readFile(`${featuresDir}/${entry}`);
                const doc = MarkdownDocument.parse(raw, 'feature');
                const otherFm = doc.frontmatterData ?? {};
                const otherPriority = otherFm.priority as string | undefined;
                const otherStatus = (otherFm.status as string | undefined) ?? 'backlog';

                if (otherPriority === 'P0' && statuses.includes(otherStatus)) {
                    return { id: otherId, status: otherStatus };
                }
            } catch {
                // Skip unparseable files in the directory scan
            }
        }
    } catch {
        // Directory unreadable — no conflict found
    }
    return null;
}

/** Canonical coverage row after verdict parsing (0410). */
interface VerdictRow {
    id: string;
    status: string;
}

/** Structured result of reading a verdict artifact (0410). */
interface ParsedVerdictArtifact {
    path: string;
    verdict?: string;
    computedVerdict?: string;
    requirements: VerdictRow[];
    acceptanceCriteria: VerdictRow[];
    diagnostics: {
        artifactError?: string;
        rejectedRowCount: number;
        invalidFields: string[];
        arrayStates: {
            requirements: VerdictArrayState;
            acceptanceCriteria: VerdictArrayState;
        };
    };
}

type VerdictArrayState = 'unavailable' | 'absent' | 'empty' | 'invalid' | 'populated';

interface DecodedVerdictRows {
    rows: VerdictRow[];
    rejected: number;
    invalidFields: string[];
    state: VerdictArrayState;
}

/**
 * Decode a verdict coverage array into accepted canonical rows plus diagnostics
 * for rejected rows (0410 R1–R5).
 *
 * Acceptance rules per row:
 * - `status` must be a string.
 * - `id` (canonical) or `scenario` (compatibility alias) must be a string.
 * - Both present and equal → `id` wins (canonical).
 * - Both present and differ → rejected (conflict, R2).
 * - Neither → rejected (missing identifier).
 *
 * `sectionName` labels rejected-row diagnostics for the finding message.
 */
function decodeVerdictRows(source: unknown, sectionName: string, required: boolean): DecodedVerdictRows {
    if (source === undefined) {
        return {
            rows: [],
            rejected: 0,
            invalidFields: required ? [`${sectionName} (missing array)`] : [],
            state: 'absent',
        };
    }
    if (!Array.isArray(source)) {
        return {
            rows: [],
            rejected: 0,
            invalidFields: [`${sectionName} (expected array)`],
            state: 'invalid',
        };
    }
    const rows: VerdictRow[] = [];
    const invalidFields = new Set<string>();
    let rejected = 0;
    for (const r of source) {
        if (typeof r !== 'object' || r === null) {
            rejected++;
            invalidFields.add(`${sectionName}[non-object]`);
            continue;
        }
        const row = r as { id?: unknown; scenario?: unknown; status?: unknown };
        const hasId = Object.hasOwn(row, 'id');
        const hasScenario = Object.hasOwn(row, 'scenario');
        const idStr = typeof row.id === 'string';
        const scStr = typeof row.scenario === 'string';
        const statusOk = typeof row.status === 'string';
        if (!statusOk) {
            rejected++;
            invalidFields.add(`${sectionName}.status`);
            continue;
        }
        if (hasId && hasScenario) {
            if (idStr && scStr && row.id === row.scenario) {
                rows.push({ id: row.id as string, status: row.status as string });
            } else {
                rejected++;
                invalidFields.add(`${sectionName}.id/scenario conflict`);
            }
            continue;
        }
        if (hasId && idStr) {
            rows.push({ id: row.id as string, status: row.status as string });
        } else if (hasScenario && scStr) {
            rows.push({ id: row.scenario as string, status: row.status as string });
        } else {
            rejected++;
            invalidFields.add(`${sectionName}.id/scenario missing`);
        }
    }
    return {
        rows,
        rejected,
        invalidFields: [...invalidFields],
        state: source.length === 0 ? 'empty' : 'populated',
    };
}

/**
 * Resolve `<repo>/.spur/run` from a tasksDir that may be nested under `docs/tasks*`.
 * Prefer an explicit `runDir` from the CLI (cwd-based) when available.
 */
export function defaultVerdictRunDir(tasksDir: string): string {
    const norm = tasksDir.replace(/\\/g, '/');
    // Monorepo / spur-init layout: docs/tasks, docs/tasks2, docs/tasks3, …
    if (/\/docs\/tasks\d*$/.test(norm) || /\/docs\/tasks$/.test(norm)) {
        return join(dirname(dirname(tasksDir)), '.spur', 'run');
    }
    // Flat layout: <root>/tasks → <root>/.spur/run
    return join(dirname(tasksDir), '.spur', 'run');
}

/**
 * True when a verdict row id names the same scenario (title, `Scenario:` prefix, bracket tag, or
 * AC-N alias).
 *
 * `normalizeTitle` handles the title forms — including bracket tags since 0398 R7. The alias
 * comparison is a separate, non-normalized path, so it strips the same prefixes itself; otherwise
 * `[doc-only] AC-3` would fail to match the alias `AC-3` even though the title path is tolerant.
 */
function rowMatchesScenario(id: string, sc: { title: string; normalized: string; alias: string }): boolean {
    const stripped = id
        .replace(/^\[[^\]]*\]\s*/, '')
        .replace(/^Scenario:\s*/i, '')
        .replace(/^\[[^\]]*\]\s*/, '')
        .trim();
    // 0561 R1: a verdict row id may carry a trailing Gherkin body in parentheses
    // (e.g. `Scenario: R4 — <title> (Given … / Then …)`). Strip the whole greedy
    // trailing parenthetical — including any nested pairs and line breaks — as an
    // additional candidate form, so an embedded body cannot fail the scenario gate.
    // Additive only: the raw/stripped forms above are still evaluated, so a title
    // that legitimately ends in `(...)` still matches (R2).
    const bodyStripped = stripped.replace(/\s*\([\s\S]*\)\s*$/, '').trim();
    return (
        normalizeTitle(id) === sc.normalized ||
        normalizeTitle(stripped) === sc.normalized ||
        normalizeTitle(bodyStripped) === sc.normalized ||
        id === sc.alias ||
        stripped === sc.alias ||
        bodyStripped === sc.alias
    );
}

/**
 * True when at least one verdict row id names a scenario in the given AC body — by normalized title,
 * `Scenario:` prefix, bracket tag, or `AC-N` ordinal.
 *
 * `task verdict` warns when this returns false for the linked feature's AC: rows keyed by bare `R1`-style
 * ids parse and derive a verdict but are credited by NO scenario at the feature `verifying → done` gate,
 * surfacing only as opaque `L4.scenario-unverified` findings there (dogfood 2026-08-15, feature I3).
 */
export function verdictRowsMatchScenarios(rows: Array<{ id: string }>, ac: string): boolean {
    const scenarios = [...ac.matchAll(/^[ \t]*Scenario:[ \t]*(.+)$/gm)].map((m, i) => ({
        title: (m[1] ?? '').trim(),
        normalized: normalizeTitle((m[1] ?? '').trim()),
        alias: `AC-${i + 1}`,
    }));
    if (scenarios.length === 0 || rows.length === 0) return true;
    return rows.some((row) => scenarios.some((sc) => rowMatchesScenario(row.id, sc)));
}
