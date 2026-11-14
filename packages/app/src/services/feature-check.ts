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
    featureFrontmatterSchema,
    MarkdownDocument,
    normalizeTitle,
    parseChecklist,
    stripAcFence,
    validateAcceptanceCriteria,
    WAYFINDER_MAP_TAG,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    captureFeatureReceiptDigest,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    FEATURE_VERIFIER_DEFINITION,
    type FeatureReceiptRejection,
    type FeatureReceiptRunPort,
    type FeatureVerifierIdentity,
    isProofCaptureError,
    validateFeatureVerificationReceipt,
} from '../workflow/feature-verification-receipt';
import { resolveWorkflowDefinition } from '../workflow/workflow-resolver';
import { checkInventoryCoverage } from './feature-inventory';
import {
    type CheckFindings,
    FINDING_CODES,
    type FindingCode,
    type MatrixEntry,
    PlanningCheckService,
    type SectionMatrix,
    type Severity,
} from './planning-check-base';
import type { PlanningSnapshot } from './planning-snapshot';
import { applyStructuralRepairs, type StructuralRepair } from './structural-repair';
import { TaskLocator } from './task-locator';

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
    // Pinned at construction: the L4 receipt capture must not re-read process.cwd()
    // mid-flight — a concurrent chdir (parallel test suite) fails the capture with a
    // foreign root (git exit 128 → L4.feature-receipt-stale).
    private readonly projectRoot: string = process.cwd();

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
            /** Parsed inputs for this operation; --fix always falls back to live reads. */
            snapshot?: PlanningSnapshot;
            /**
             * Read-only run-store ports for receipt validation (D63 task 0915):
             * terminal run-row status, persisted definition identity/vars and
             * artifact registration. The CLI command wires `RunDao`/`ArtifactDao`;
             * omitted when the caller cannot observe the run store (those checks
             * are then skipped, the remaining contract checks still enforce).
             */
            receiptRunPort?: FeatureReceiptRunPort;
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
            /** 1132 R3: transition callback for feature-reopen repair under --fix. */
            transitionPort?: (
                id: string,
                to: string,
            ) => Promise<{ fromStatus?: string; toStatus?: string } | undefined>;
            /**
             * Inventory-report text (1004 R1): cross-check the report's
             * `## Requirement inventory` items against the feature's AC
             * `# covers:` lines (rule `inventory-coverage`). Set by
             * `feature check --inventory <report>`.
             */
            inventory?: string;
        },
    ): Promise<CheckFeatureResult> {
        const strict = options?.strict === true;
        const snapshotFeature =
            options?.fix === true
                ? undefined
                : options?.snapshot?.features.find((feature) => feature.filePath === filePath);
        const rawSource = snapshotFeature?.raw ?? (await this.fs.readFile(filePath));
        let raw = rawSource;
        let repairs: StructuralRepair[] = [];
        // Declared before the --fix block so the 1137 R1 no-port reopen refusal can
        // report its error finding from inside the repair phase.
        const findings: CheckFeatureFindings[] = [];
        if (options?.fix === true) {
            const probe = snapshotFeature?.document ?? MarkdownDocument.parse(rawSource, 'feature');
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

            // 1132 R3: feature check --fix reopens a verifying or done feature to active
            // when it has linked live tasks (backlog|todo|wip|testing|blocked).
            if (probeStatus === 'verifying' || probeStatus === 'done') {
                const taskScanDirs =
                    options?.tasksDirs && options.tasksDirs.length > 0
                        ? options.tasksDirs
                        : options?.tasksDir
                          ? [options.tasksDir]
                          : [];
                let hasLiveTask = false;
                if (options?.fix !== true && options?.snapshot !== undefined) {
                    hasLiveTask = options.snapshot.tasks.some(
                        (task) =>
                            task.featureId === featureId &&
                            ['backlog', 'todo', 'wip', 'testing', 'blocked'].includes(task.status),
                    );
                } else {
                    for (const td of taskScanDirs) {
                        try {
                            const entries = await this.fs.readDir(td);
                            for (const entry of entries) {
                                if (!/^\d{4}_.+\.md$/.test(entry)) continue;
                                try {
                                    const tr = await this.fs.readFile(`${td}/${entry}`);
                                    const tDoc = MarkdownDocument.parse(tr, 'task');
                                    const tfm = tDoc.frontmatterData ?? {};
                                    const tfid =
                                        (tfm.feature_id as string | undefined) ??
                                        (tfm['feature-id'] as string | undefined);
                                    if (tfid === featureId) {
                                        const st = (tfm.status as string | undefined) ?? 'backlog';
                                        if (['backlog', 'todo', 'wip', 'testing', 'blocked'].includes(st)) {
                                            hasLiveTask = true;
                                            break;
                                        }
                                    }
                                } catch {
                                    // ignore unparseable
                                }
                            }
                            if (hasLiveTask) break;
                        } catch {
                            // ignore unreadable dir
                        }
                    }
                }
                if (hasLiveTask) {
                    if (options?.transitionPort !== undefined) {
                        await options.transitionPort(featureId, 'active');
                        raw = await this.fs.readFile(filePath);
                        repairs.push({
                            kind: 'feature-reopen',
                            section: 'Frontmatter',
                            detail: `reopened feature ${featureId} (${probeStatus} -> active) due to linked live task(s)`,
                        });
                    } else {
                        // 1137 R1: a missing transition port must NOT degrade to a raw
                        // frontmatter write — a lifecycle status change without the
                        // guarded transition skips validation, the History entry and the
                        // feature.transitioned event. Report an actionable error finding
                        // and leave the file byte-identical instead.
                        findings.push({
                            layer: 'L4',
                            code: FINDING_CODES.FEATURE_REOPEN_UNAVAILABLE,
                            severity: 'error',
                            section: 'Frontmatter',
                            message:
                                `Feature ${featureId} is ${probeStatus} with linked live task(s) and needs a reopen to active, ` +
                                'but no transition port was supplied, so the status was left unchanged. ' +
                                `Recovery: run \`spur feature check ${featureId} --fix\` from the CLI, ` +
                                `or call \`spur feature update ${featureId} active\`.`,
                        });
                    }
                }
            }
        }
        const doc = this.runL1(raw, featureId, findings, snapshotFeature?.document);
        if (doc === null) {
            return { id: featureId, ...this.summarizeWithStatus('', findings, strict, options?.severityOverrides) };
        }

        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        // D61 task 0765 R1 (target-aware): the lifecycle guard passes `--as
        // <target>` so the rules below evaluate the post-transition state and
        // never deny the exit they would relieve. `effectiveStatus` drives the
        // matrix selection, L2/L4 status-dependent rules, the L4 done-time
        // severity escalation, and the reported check status. When `asStatus`
        // is omitted, `effectiveStatus` falls back to the on-disk frontmatter
        // status (fully behavior-compatible with the pre-0765 implementation).
        const effectiveStatus = options?.asStatus ?? status;
        // Group features are umbrellas: their leaf children own Acceptance Criteria, so requiring
        // AC on the parent would duplicate the children's scope and strand every group at the L2
        // gate. `resolveMatrixEntry` already falls back to `standard` for unknown variants.
        const entry = this.resolveMatrixEntry(isGroupFeature(fm), effectiveStatus);

        // ── L2: Section presence (warning-first, gate:true hard) ──
        this.runL2(doc, entry, findings, raw);

        // ── L3: Format rules — BDD AC validation + structural rules ──
        this.runL3(doc, findings, fm);

        // ── L3: One-active-goal + children-limit (corpus-derived) ──
        if (options?.featuresDir) {
            await this.checkOneActiveGoal(fm, featureId, options.featuresDir, findings, options.asStatus);
            await this.checkChildrenLimit(featureId, options.featuresDir, findings);
        }

        // ── D63 task 0915 (R2): completion evaluates CURRENT verification evidence ──
        // The receipt demand binds to the completion boundary — the transition
        // target `--as done` — not to plain on-disk `done` reads, so archival
        // re-checks and all-features scans stay advisory for features that
        // predate receipts (no backfill burden). Every real completion path
        // (`feature advance`, the engine verifying→done guard via
        // `feature check --strict --as done`) passes the hint and enforces.
        if (options?.asStatus === 'done' && options?.runDir) {
            await this.checkFeatureVerificationReceipt(
                featureId,
                raw,
                options.runDir,
                findings,
                options.receiptRunPort,
            );
        }

        // ── L4: Traceability — incoming feature_id edges + orphan scenarios ──
        const taskScanDirs =
            options?.tasksDirs && options.tasksDirs.length > 0
                ? options.tasksDirs
                : options?.tasksDir
                  ? [options.tasksDir]
                  : [];
        await this.runL4(doc, featureId, effectiveStatus, taskScanDirs, findings, options?.snapshot);

        // ── 1004 R1: requirement-inventory ↔ AC coverage (feature check --inventory) ──
        if (typeof options?.inventory === 'string') {
            const acText = doc.getSection('Acceptance Criteria') ?? '';
            findings.push(...checkInventoryCoverage(options.inventory, acText));
        }

        return {
            id: featureId,
            ...this.summarizeWithStatus(effectiveStatus, findings, strict, options?.severityOverrides),
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

    /**
     * Completion-boundary receipt validation (D63 task 0915, R2). Resolves the
     * currently selected `feature-lifecycle` definition (project override wins;
     * 1246 R3) to obtain the expected verifier identity and configured command,
     * captures the current checked-input digest — including gitignored
     * `.spur/context/learnings.md`, which the digest chain must see — via the
     * shared proof-input engine, and validates the feature's receipt against
     * both. Every rejection is an unsuppressible error finding — changed tree,
     * changed spec, changed learnings, changed check contract, changed
     * selected definition, wrong identity, non-terminal recording run, failed
     * or missing evidence cannot satisfy completion, while unchanged valid
     * evidence is reused without rerunning. Resolution and digest-capture
     * failures are fail-closed (0751 R1 semantics), never a pass.
     */
    private async checkFeatureVerificationReceipt(
        featureId: string,
        featureContent: string,
        runDir: string,
        findings: CheckFeatureFindings[],
        runPort?: FeatureReceiptRunPort,
    ): Promise<void> {
        // Fail-closed verifier-contract evaluation: without the selected
        // definition there is no identity/command to validate the receipt
        // against, so completion is denied rather than waved through.
        let verifier: FeatureVerifierIdentity;
        let configuredCmd: string;
        try {
            const selected = await resolveWorkflowDefinition(this.projectRoot, FEATURE_VERIFIER_DEFINITION);
            verifier = {
                name: FEATURE_VERIFIER_DEFINITION,
                sourcePath: selected.path,
                layer: selected.layer,
                definitionDigest: selected.digest,
            };
            // 1246 R5: the retired wrapper's `verificationCmd` var is gone — record-time and
            // completion-time read the same constant, so the two contracts cannot drift.
            configuredCmd = DEFAULT_FEATURE_VERIFICATION_CMD;
        } catch (err) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_FEATURE_RECEIPT_CONTRACT,
                severity: 'error',
                section: '',
                message: `Feature "${featureId}" completion evidence could not be evaluated against the selected ${FEATURE_VERIFIER_DEFINITION} definition (fail-closed): ${String(err)}`,
            });
            return;
        }

        // Learnings live under gitignored .spur/context; fold their content into
        // the digest explicitly so learning appends after a pass go stale.
        let learningsContent: string | undefined;
        try {
            learningsContent = await this.fs.readFile(join(this.projectRoot, '.spur', 'context', 'learnings.md'));
        } catch {
            learningsContent = undefined;
        }
        let currentDigest: string;
        try {
            currentDigest = await captureFeatureReceiptDigest(this.projectRoot, featureContent, learningsContent);
        } catch (err) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_FEATURE_RECEIPT_STALE,
                severity: 'error',
                section: '',
                message:
                    `Feature "${featureId}" completion evidence could not be captured (fail-closed): ` +
                    (isProofCaptureError(err) ? err.message : String(err)),
            });
            return;
        }
        const outcome = await validateFeatureVerificationReceipt(this.fs, {
            featureId,
            runDir,
            currentDigest,
            currentVerifier: verifier,
            currentVerificationCmd: configuredCmd,
            runPort,
        });
        if (outcome.ok) return;
        const codeByReason: Record<FeatureReceiptRejection, FindingCode> = {
            missing: FINDING_CODES.L4_FEATURE_RECEIPT_MISSING,
            malformed: FINDING_CODES.L4_FEATURE_RECEIPT_MALFORMED,
            'cross-feature': FINDING_CODES.L4_FEATURE_RECEIPT_CROSS_FEATURE,
            divergent: FINDING_CODES.L4_FEATURE_RECEIPT_DIVERGENT,
            failed: FINDING_CODES.L4_FEATURE_RECEIPT_FAILED,
            run: FINDING_CODES.L4_FEATURE_RECEIPT_RUN,
            stale: FINDING_CODES.L4_FEATURE_RECEIPT_STALE,
            'contract-mismatch': FINDING_CODES.L4_FEATURE_RECEIPT_CONTRACT,
        };
        findings.push({
            layer: 'L4',
            code: codeByReason[outcome.reason],
            severity: 'error',
            section: '',
            message:
                `Feature "${featureId}" completion evidence rejected (${outcome.reason}): ${outcome.detail}. ` +
                // Name the verb: `bun run spur-check-feature` alone runs the same checks but records no receipt.
                `Re-run the feature-scoped verification pass to record current evidence: spur feature verify ${featureId}.`,
        });
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
        findings: CheckFeatureFindings[],
        snapshot?: PlanningSnapshot,
    ): Promise<void> {
        if (tasksDirs.length === 0) return;

        // Tasks reference features via `feature_id` (one direction, DD-07). A
        // feature's "edges" are the tasks pointing at it. Scan every registered
        // phase folder (active + archive) so edges in docs/tasks2 still count.
        let linkedTasks = 0;
        const incompleteTasks: string[] = [];
        if (snapshot !== undefined) {
            for (const task of snapshot.tasks) {
                if (task.featureId !== featureId) continue;
                linkedTasks += 1;
                if (task.status !== 'done' && task.status !== 'cancelled') {
                    incompleteTasks.push(task.wbs);
                }
            }
        } else {
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
        }

        // DD-13 verifying-readiness: a feature in (or entering) `verifying` should
        // have all its linked tasks done/cancelled. Pre-completion this is a
        // WARNING (non-blocking) so the operator is warned but not stopped
        // (R2/0059, `active→verifying` guard).
        // D61 task 0765 R1: at the effective done-time transition the rule
        // escalates to ERROR so incomplete work cannot become done (the code is
        // unsuppressible per REQUIRED_FINDING_CODES in planning-check-base.ts).
        if (status === 'verifying' && incompleteTasks.length > 0) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_VERIFYING_INCOMPLETE_TASKS,
                severity: 'warning',
                section: '',
                message: `Feature "${featureId}" is verifying but ${incompleteTasks.length} linked task(s) are not done/cancelled: ${incompleteTasks.join(', ')}`,
            });
        }
        if (status === 'done' && incompleteTasks.length > 0) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_VERIFYING_INCOMPLETE_TASKS,
                severity: 'error',
                section: '',
                message: `Feature "${featureId}" is done but ${incompleteTasks.length} linked task(s) are not done/cancelled: ${incompleteTasks.join(', ')}`,
            });
        }
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
 * Verdict-matching key for one feature scenario: raw title, normalized title, 1-based `AC-<n>`
 * alias, and the optional `R<n>` label that enables the embedded-reference branch of
 * `rowMatchesScenario` (0958 R1).
 */
interface ScenarioKey {
    title: string;
    normalized: string;
    alias: string;
    /** `R<n>` label from the title's leading id; absent when the title carries none (extractor branch off). */
    label?: string;
}

/**
 * 0958 R1: a scenario's `R<n>` label — the leading id `stripScenarioPrefixes` removes
 * (`@gobing-ai/spur-domain` bdd/coverage), so bracket tags and a `Scenario:` prefix come off
 * first with the same loop rule. `undefined` when the title carries no `R<n>` prefix: only the
 * embedded-reference branch is disabled for that scenario; title and alias matching are untouched.
 */
function scenarioRLabel(title: string): string | undefined {
    let t = title.trim();
    let previous: string;
    do {
        previous = t;
        t = t
            .replace(/^\[[^\]]*\]\s*/, '')
            .replace(/^Scenario:\s*/i, '')
            .trim();
    } while (t !== previous);
    const m = /^R(\d+)\b/.exec(t);
    return m?.[1] === undefined ? undefined : `R${m[1]}`;
}

/** Feature scenario titles in `AC-<n>` order (index n-1) — the ordinal space verdict `AC-<n>` rows key into. */
export function featureScenarioTitles(ac: string): string[] {
    return indexScenarioAliases(ac).map((sc) => sc.title);
}

/**
 * Index the scenario lines of an AC body with their 1-based AC-N aliases and `R<n>` labels.
 *
 * Enumeration mirrors `parseFeature` (`packages/domain/src/bdd/parser.ts`) — the done gate's
 * enumerator — so the certify-time matching and the gate cannot disagree (0958 re-review):
 * `Scenario Outline:` entries count (name = text after the prefix) and `"""` doc-string content
 * is skipped, in the parser's line order, so AC-N ordinals are identical on both sides.
 */
function indexScenarioAliases(ac: string): ScenarioKey[] {
    const keys: ScenarioKey[] = [];
    let inDocString = false;
    for (const raw of ac.split('\n')) {
        const trimmed = raw.trim();
        if (trimmed.startsWith('"""')) {
            inDocString = !inDocString;
            continue;
        }
        if (inDocString) continue;
        const m = /^(?:Scenario Outline|Scenario):[ \t]*(.+)$/.exec(trimmed);
        if (m === null) continue;
        const title = (m[1] ?? '').trim();
        keys.push({
            title,
            normalized: normalizeTitle(title),
            alias: `AC-${keys.length + 1}`,
            label: scenarioRLabel(title),
        });
    }
    return keys;
}

/** Filesystem port and folder paths the gap check resolves the task and its linked feature through. */
export interface VerdictScenarioKeyGapDeps {
    fs: FileSystem;
    /** Active tasks directory (absolute); searched first, before configured folders. */
    tasksDir: string;
    /** Optional multi-folder config; folder keys resolve against the fs root (same as {@link TaskLocator}). */
    foldersConfig?: { folders: Record<string, unknown> };
    /** Features directory (absolute); omitted → never a gap (no feature resolution). */
    featuresDir?: string;
}

/** `<id>_<slug>.md` match without a RegExp: the id is operator input (`.*` must not match, `(` must not throw). */
export function isFeatureFile(name: string, id: string): boolean {
    return name.startsWith(`${id}_`) && name.endsWith('.md') && name.length > id.length + 4;
}

/**
 * Raw markdown of `<featuresDir>/<featureId>_*.md`, or `null` on any miss — the single
 * `<id>_<slug>.md` prefix-scan resolution shared with `task-service` (the AC-only form
 * delegates here).
 */
export async function readFeatureBody(fs: FileSystem, featuresDir: string, featureId: string): Promise<string | null> {
    try {
        for (const name of await fs.readDir(featuresDir)) {
            if (!isFeatureFile(name, featureId)) continue;
            return await fs.readFile(`${featuresDir}/${name}`);
        }
    } catch {
        // Features dir or file unreadable — no resolution; the done gate stays the backstop.
    }
    return null;
}

/**
 * Fence-stripped Acceptance Criteria of `<featuresDir>/<featureId>_*.md`, or `null` on any miss —
 * the single `<id>_<slug>.md` prefix-scan resolution shared with `task-service`.
 */
export async function readFeatureAcBody(
    fs: FileSystem,
    featuresDir: string,
    featureId: string,
): Promise<string | null> {
    const raw = await readFeatureBody(fs, featuresDir, featureId);
    if (raw === null) return null;
    try {
        const doc = MarkdownDocument.parse(raw, 'feature');
        const ac = stripAcFence(doc.getSection('Acceptance Criteria') ?? '');
        return ac.trim().length > 0 ? ac : null;
    } catch {
        return null;
    }
}

/**
 * The task file's own `## Acceptance Criteria` section, as written by the task author. The
 * verdict derivation reads evidence-rule exemption tags only from here (P2). An unresolvable
 * task yields '' (no exemptions), so a missing task can never widen the evidence rule.
 */
export async function readTaskAcceptanceCriteria(wbs: string, deps: VerdictScenarioKeyGapDeps): Promise<string> {
    try {
        const hit = await new TaskLocator({
            fs: deps.fs,
            tasksDir: deps.tasksDir,
            ...(deps.foldersConfig !== undefined ? { foldersConfig: deps.foldersConfig } : {}),
        }).findByWbs(wbs);
        if (hit === null) return '';
        const doc = MarkdownDocument.parse(await deps.fs.readFile(hit.filePath), 'task');
        return stripAcFence(doc.getSection('Acceptance Criteria') ?? '');
    } catch {
        return '';
    }
}
