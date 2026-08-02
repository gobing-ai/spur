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
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { readVerdictArtifact as readGuardVerdictArtifact } from './done-transition-guard';
import {
    type CheckFindings,
    FINDING_CODES,
    type MatrixEntry,
    PlanningCheckService,
    type SectionMatrix,
    type Severity,
} from './planning-check-base';

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
    },
};

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
            tasksDir?: string;
            dogfoodDir?: string;
            /** Directory containing `<wbs>-verdict.json` artifacts (default: <tasksDir parent>/.spur/run). */
            runDir?: string;
            severityOverrides?: Record<string, 'error' | 'warning' | 'off'>;
        },
    ): Promise<CheckFeatureResult> {
        const strict = options?.strict === true;
        const raw = await this.fs.readFile(filePath);
        const findings: CheckFeatureFindings[] = [];

        // ── L1: Schema validation (hard) ──
        const doc = this.runL1(raw, featureId, findings);
        if (doc === null) {
            return { id: featureId, ...this.summarizeWithStatus('', findings, strict, options?.severityOverrides) };
        }

        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        const entry = this.resolveMatrixEntry('standard', status);

        // ── L2: Section presence (warning-first, gate:true hard) ──
        this.runL2(doc, entry, findings);

        // ── L3: Format rules — BDD AC validation + structural rules ──
        this.runL3(doc, findings);

        // ── L3: One-active-goal + children-limit (corpus-derived) ──
        if (options?.featuresDir) {
            await this.checkOneActiveGoal(fm, featureId, options.featuresDir, findings);
            await this.checkChildrenLimit(featureId, options.featuresDir, findings);
        }

        // ── L4: Traceability — incoming feature_id edges + orphan scenarios ──
        const dogfoodDir =
            options?.dogfoodDir ?? (options?.featuresDir ? join(dirname(options.featuresDir), 'dogfood') : undefined);
        // Verdict artifacts live at <repo>/.spur/run (CLI cwd), not under docs/.
        // When tasksDir is `docs/tasks*` (this monorepo layout), dirname(tasksDir)
        // is `docs` — walking one extra level reaches the repo root. Callers that
        // know the root should pass `runDir` explicitly.
        const runDir = options?.runDir ?? (options?.tasksDir ? defaultVerdictRunDir(options.tasksDir) : undefined);
        await this.runL4(doc, featureId, status, options?.tasksDir, dogfoodDir, runDir, findings);

        return { id: featureId, ...this.summarizeWithStatus(status, findings, strict, options?.severityOverrides) };
    }

    // ── L3: Format rules ──
    private runL3(doc: MarkdownDocument, findings: CheckFeatureFindings[]): void {
        // Acceptance Criteria: two-tier AC (B08) — Gherkin OR checklist, via the
        // shared BDD module (never a private parser). Strip the markdown code
        // fence the template/corpus wrap Gherkin in before validating.
        const rawAc = doc.getSection('Acceptance Criteria');
        if (rawAc !== null && rawAc.trim().length > 0) {
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

    // ── L3: One-active-goal — at most one P0 feature in {active, verifying} ──
    private async checkOneActiveGoal(
        fm: Record<string, unknown>,
        currentId: string,
        featuresDir: string,
        findings: CheckFeatureFindings[],
    ): Promise<void> {
        type Priority = string;
        type Status = string;
        const priority = fm.priority as Priority | undefined;
        const status = fm.status as Status | undefined;

        // Only check P0 features in active/verifying status
        if (priority !== 'P0') return;
        if (status !== 'active' && status !== 'verifying') return;

        // Read all feature files in the directory and check for other P0 active/verifying
        try {
            const entries = await this.fs.readDir(featuresDir);
            for (const entry of entries) {
                if (!entry.endsWith('.md')) continue;

                const otherPath = `${featuresDir}/${entry}`;
                // Extract ID from filename: <ID>_<slug>.md
                const match = /^([A-Z][1-9]*)_/.exec(entry);
                if (!match) continue;
                const otherId = match[1];

                // Skip self
                if (otherId === currentId) continue;

                try {
                    const raw = await this.fs.readFile(otherPath);
                    const doc = MarkdownDocument.parse(raw, 'feature');
                    const otherFm = doc.frontmatterData ?? {};
                    const otherPriority = otherFm.priority as Priority | undefined;
                    const otherStatus = otherFm.status as Status | undefined;

                    if (otherPriority === 'P0' && (otherStatus === 'active' || otherStatus === 'verifying')) {
                        findings.push({
                            layer: 'L3',
                            code: FINDING_CODES.L3_ONE_ACTIVE_GOAL,
                            severity: 'error',
                            section: '',
                            message: `One-active-goal violated: P0 feature "${otherId}" is already ${otherStatus}`,
                        });
                        // Only report the first conflict
                        return;
                    }
                } catch {
                    // Skip unparseable files in the directory scan
                }
            }
        } catch {
            // Directory unreadable — skip the one-active-goal check
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
        tasksDir: string | undefined,
        dogfoodDir: string | undefined,
        runDir: string | undefined,
        findings: CheckFeatureFindings[],
    ): Promise<void> {
        if (tasksDir === undefined) return;

        // Tasks reference features via `feature_id` (one direction, DD-07). A
        // feature's "edges" are the tasks pointing at it. Verify those tasks
        let linkedTasks = 0;
        const incompleteTasks: string[] = [];
        const linkedTaskAc: string[] = [];
        const linkedTaskSolutions: string[] = [];
        // Per-task linkage record for scenario-satisfaction classification (0340).
        // A scenario is "covered" by a task when DD-09 normalized-title matching
        // links them; "verified" only when that task is done AND carries a PASS
        // verdict artifact whose matching requirement row is MET.
        const linkedTaskRecords: Array<{ wbs: string; status: string; ac: string }> = [];
        try {
            const entries = await this.fs.readDir(tasksDir);
            for (const entry of entries) {
                if (!/^\d{4}_.+\.md$/.test(entry)) continue;
                try {
                    const raw = await this.fs.readFile(`${tasksDir}/${entry}`);
                    const taskDoc = MarkdownDocument.parse(raw, 'task');
                    const tfm = taskDoc.frontmatterData ?? {};
                    const tfid = (tfm.feature_id as string | undefined) ?? (tfm['feature-id'] as string | undefined);
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
                    linkedTaskRecords.push({ wbs, status: tStatus, ac: tac });
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
            // Tasks directory unreadable — skip incoming-edge resolution.
            return;
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
        // scenario, check whether any covering task is `done` AND carries a PASS
        // verdict artifact whose matching requirement row is MET. Unverified
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
                    const entries = await this.fs.readDir(dogfoodDir);
                    hasDogfood = entries.some((f) => f.includes(featureId));
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
     * unverified against per-task verdict artifacts. A scenario is verified when
     * ANY covering task is `done` AND its `<wbs>-verdict.json` shows verdict PASS
     * with a matching requirement row of status MET. Otherwise the scenario is
     * linked-but-unverified → L4.scenario-unverified (warning; elevated by strict).
     */
    private async checkScenarioSatisfaction(
        featureAc: string,
        linkedTasks: Array<{ wbs: string; status: string; ac: string }>,
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
        for (const wbs of doneWbs) {
            const artifact = await this.readVerdictArtifact(runDir, wbs);
            artifacts.set(wbs, artifact);
            const diagnosticParts: string[] = [];
            if (artifact.diagnostics.artifactError !== undefined) {
                diagnosticParts.push(artifact.diagnostics.artifactError);
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
     * A scenario is verified when ANY covering task is `done` AND its verdict
     * artifact shows verdict PASS with a matching requirement **or acceptanceCriteria**
     * row of status MET. Matching id = normalized scenario title, optional
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
            if (artifact.verdict !== 'PASS') continue;
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

/** Canonical coverage row after verdict parsing (0410). */
interface VerdictRow {
    id: string;
    status: string;
}

/** Structured result of reading a verdict artifact (0410). */
interface ParsedVerdictArtifact {
    path: string;
    verdict?: string;
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
    return (
        normalizeTitle(id) === sc.normalized ||
        normalizeTitle(stripped) === sc.normalized ||
        id === sc.alias ||
        stripped === sc.alias
    );
}
