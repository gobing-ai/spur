import { dirname, join, relative, sep } from 'node:path';
import { atomicWriteAsync, MarkdownDocument } from '@gobing-ai/spur-domain';
import { ValidationError } from '@gobing-ai/ts-utils';
import { GuardDeniedError } from '../errors';
import { resolveDurableArtifactPath } from '../workflow/actions/run-path';
import { reconcileExistingLifecycleRow, TASK_LIFECYCLE_PROFILE } from '../workflow/lifecycle-adapter';
import { extractRunCitations, RUN_CITATION_DIRS } from '../workflow/run-citation';
import { buildTrackedBasenameIndex, qualifySectionBody } from './anchor-qualifier';
import {
    defaultVerdictRunDir,
    featureScenarioTitles,
    matchedScenarioKeys,
    taskCoversAnyFeatureScenario,
} from './feature-check';
import { ensurePipelineRunLink, TASK_FORWARD_CHAIN } from './pipeline-run-link';
import type { EntityRef, PlanningWriteService } from './planning-write-service';
import { ensureDurablePlaneIgnored, runStoragePaths } from './run-storage';
import type { TaskFeatureLink } from './task-feature-link';
import type { TaskFiles } from './task-files';
import {
    flipVerifiedCheckboxes,
    gitDiffU0,
    isRecordAuthoredReview,
    isRecordAuthoredSolution,
    listUntrackedFiles,
    parseTesting,
    type RecordOptions,
    type RecordResult,
    readVerdictClassified,
    renderReview,
    renderSolutionFromDiff,
    renderTesting,
} from './task-record';
import { sectionIsBare } from './task-section-bodies';
import type { TaskService, TaskServiceContext } from './task-service';
import { reconcileDoneCloseAudit, runTransitionCheckGate } from './task-transition';
import type { VerifyVerdict as CanonicalVerifyVerdict } from './verify-verdict';

/**
 * R6 diagnostics: name the verdict row whose evidence carries the citation, so the operator
 * knows which producer answer to fix. Requirements/AC rows render into the Testing section
 * directly; a `checks[]` row is named when it is the only carrier.
 */
function citationOrigin(verdict: CanonicalVerifyVerdict, name: string): string {
    const needle = `.spur/run/${name}`;
    for (const row of verdict.requirements) {
        if (row.evidence.includes(needle)) return `requirement ${row.id}`;
    }
    for (const row of verdict.acceptanceCriteria) {
        if (row.evidence.includes(needle)) return `acceptance criterion ${row.id}`;
    }
    for (const row of verdict.checks) {
        if (row.evidence?.includes(needle)) return `check ${row.name}`;
    }
    return 'the verdict';
}

/**
 * `spur task record` for {@link TaskService}: verdict-driven Testing/Status writes, the
 * scenario-key regression and testing-citation checks, and terminal bookkeeping.
 */
export class TaskRecordOps {
    constructor(
        private readonly host: TaskService,
        private readonly ctx: TaskServiceContext,
        private readonly writeService: PlanningWriteService,
        private readonly featureLink: TaskFeatureLink,
        private readonly files: TaskFiles,
    ) {}

    /**
     * 0936 R1: record-time scenario-key carry-forward guard. Compares the feature
     * scenario keys the previous `## Testing` body matched with MET rows against
     * the keys the new verdict artifact matches with MET rows, and warns (never
     * blocks) on each dropped key — the write that would otherwise silently
     * regress `feature check` to `L4.scenario-unverified`. Also warns, in parity
     * with the `L4.verdict-rows-match-no-scenario` wording (0700 R3), when the
     * new artifact's rows match no feature scenario at all. Matching is owned by
     * feature-check's {@link matchedScenarioKeys} — no second normalization.
     */
    private async checkScenarioKeyRegression(
        wbs: string,
        taskFilePath: string,
        prevTestingBody: string,
        verdict: CanonicalVerifyVerdict,
    ): Promise<string[]> {
        try {
            const resolved = await this.featureLink.resolveFeatureAcBody(taskFilePath);
            if (resolved === null) return [];

            const prev = parseTesting(prevTestingBody, wbs);
            const prevRows =
                prev.kind === 'valid' ? [...prev.verdict.requirements, ...prev.verdict.acceptanceCriteria] : [];
            const newRows = [...verdict.requirements, ...(verdict.acceptanceCriteria ?? [])];

            const prevKeys = matchedScenarioKeys(prevRows, resolved.ac);
            const newKeys = matchedScenarioKeys(newRows, resolved.ac);

            const warnings: string[] = [];
            for (const key of prevKeys) {
                if (newKeys.includes(key)) continue;
                warnings.push(
                    `Task ${wbs} record drops scenario key "${key}": the previous ## Testing section matched it ` +
                        `with a MET row but the new verdict artifact has no MET row for it — re-key a row by ` +
                        `scenario title or AC-N alias to preserve the feature "${resolved.featureId}" ` +
                        `satisfaction edge (L4.scenario-unverified regresses otherwise).`,
                );
            }
            // No-match parity with `task verdict` / L4.verdict-rows-match-no-scenario — including
            // their covering scope: a task-local task's rows are not expected to name a scenario.
            if (
                newRows.length > 0 &&
                newKeys.length === 0 &&
                taskCoversAnyFeatureScenario(resolved.taskAc, resolved.ac)
            ) {
                warnings.push(
                    `Task ${wbs} verdict evidence carries ${newRows.length} row(s) matching no scenario of this ` +
                        `feature — key rows by scenario title or AC-N alias (repair: /sp:dev-verify ${wbs})`,
                );
            }
            return warnings;
        } catch {
            return [];
        }
    }

    /**
     * Rewrite unambiguous bare-basename anchors in a rendered section body to their repo-relative
     * form — the same pass `spur task migrate-anchors` runs over task sections, applied where `record`
     * creates the citation. Best-effort: an unreadable index or an ambiguous basename leaves the body
     * exactly as rendered (the check still reports the unresolved anchor; nothing is guessed).
     */
    private async qualifyRenderedAnchors(body: string): Promise<string> {
        try {
            const projectRoot = this.ctx.fs.resolve('.');
            const index = await buildTrackedBasenameIndex(projectRoot);
            return qualifySectionBody(body, index).newBody;
        } catch {
            return body;
        }
    }

    /** Implementation of {@link TaskService.record} (see its doc comment for the contract). */
    async record(wbs: string, opts: RecordOptions = {}): Promise<RecordResult> {
        const filePath = await this.files.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };

        // Read the current document to check section bareness for Solution backfill.
        const raw = await this.ctx.fs.readFile(filePath);
        const doc = MarkdownDocument.parse(raw, 'task');

        // Resolve verdict path. The default is rooted in the task tree this service was built for,
        // not in `process.cwd()`: a caller that injects a tree (a test fixture, an embedding app)
        // otherwise reads whatever project happens to be the process's working directory — a
        // coupling that silently made a fixture's own verdict invisible from the repo root.
        const verdictPath = opts.verdictFile ?? join(defaultVerdictRunDir(this.ctx.tasksDir), `${wbs}-verdict.json`);
        // 1040 R1/R4: classify the artifact read so the result can report
        // readable/missing/malformed (foreign explicit-WBS counts as missing)
        // instead of silently collapsing everything to UNKNOWN.
        const classified = await readVerdictClassified(this.ctx.fs, verdictPath, wbs);
        const verdict = classified.verdict;
        // 1043: a readable artifact is mirrored to the durable evidence plane.
        if (verdict.verdict !== 'UNKNOWN') {
            const paths = runStoragePaths(this.ctx.fs.resolve('.'));
            const durablePath = await resolveDurableArtifactPath(
                this.ctx.fs,
                paths.projectRoot,
                join(paths.evidenceDir, `${wbs}-verdict.json`),
                'evidence',
            );
            const bytes = await this.ctx.fs.readFile(verdictPath);
            ensureDurablePlaneIgnored(paths.projectRoot);
            await this.ctx.fs.ensureDir(dirname(durablePath));
            // 1156: a byte copy preserves whatever the run artifact held at this moment. The
            // confidence-row injection it used to carry was retired with the asserted level (F511).
            // `FileSystem.readFile` returns a string (not Buffer): the former `.toString('utf8')`
            // was a no-op that failed typecheck (TS2554) on main; the text is passed through.
            await atomicWriteAsync(durablePath, bytes, wbs, this.ctx.fs, this.ctx.projectName ?? 'spur');
        }

        const result: RecordResult = {
            testingWritten: false,
            reviewWritten: false,
            solutionBackfilled: false,
        };
        // 1040 R1: carry the artifact state + remedy onto the result (additive).
        result.verdictState = classified.state;
        if (classified.message !== undefined) result.verdictMessage = classified.message;

        // ── Testing section (R2) — authored-first (0619 F/U) ──
        // When the verify verdict is UNKNOWN (no artifact / verify step skipped),
        // an already-authored `## Testing` is preserved instead of being clobbered
        // by the "no requirements recorded" stub — the A3 batch hit this twice
        // (hand-written Testing overwritten before the verdict artifact existed).
        // Mirrors the Review fallback-only precedent (0593 R1): with a real verdict
        // (PASS/PARTIAL/FAIL) record still owns Testing.
        if (!(verdict.verdict === 'UNKNOWN' && !sectionIsBare(doc, 'Testing'))) {
            // 0936 R1: compare feature scenario keys before overwriting Testing so a
            // re-transcription that drops a previously-carried MET-matched key warns
            // at this write instead of at the next `feature check`.
            const scenarioWarnings = await this.checkScenarioKeyRegression(
                wbs,
                filePath,
                doc.getSection('Testing') ?? '',
                verdict,
            );
            if (scenarioWarnings.length > 0) result.scenarioWarnings = scenarioWarnings;
            // Session review 2026-10-19: the evidence cells are the reviewer's own text, transcribed
            // verbatim from the certification answer. A bare basename anchor in that prose failed the
            // `--as done` check (L4.anchor-unresolved) on tasks whose implementation had already
            // qualified its own anchors — twice in the 1254–1260 batch. Qualify at the transcription
            // point so the recorded Testing and the done gate share one anchor vocabulary.
            const testingBody = await this.qualifyRenderedAnchors(renderTesting(verdict));
            // R6 (1139): a rendered Testing citation must resolve in THIS tree's planes, so
            // teardown is never the first detector of a phantom `.spur/run/<name>` reference.
            await this.assertTestingCitationsResolved(verdict, testingBody);
            const currentTesting = doc.getSection('Testing');
            // 1040 R1: an identical generated section is not rewritten (no
            // spurious updated_at bump); authored-preservation gate above stands.
            if (currentTesting === null || currentTesting.trim() !== testingBody.trim()) {
                await this.writeService.updateSection(ref, 'Testing', testingBody);
                result.testingWritten = true;
            }
        }

        // ── Review section (R2) — fallback-only (F92 0593 R1) ──
        // The review coordinator (super-reviewer /dev-review) writes the authored
        // `## Review`. This backfill is a standalone compatibility fallback ONLY: it
        // fires when the section is bare (absent/placeholder) or still holds record's
        // own earlier output, never overwrites authored Review, and is not normal
        // ownership. Recognising its own output is what makes re-record idempotent
        // (0713 R2): before it, a stale FAIL header outlived the verdict that replaced it.
        if (sectionIsBare(doc, 'Review') || isRecordAuthoredReview(doc.getSection('Review'))) {
            const reviewBody = renderReview(verdict);
            const currentReview = doc.getSection('Review');
            // 1040 R1: identical generated Review is not rewritten either.
            if (currentReview === null || currentReview.trim() !== reviewBody.trim()) {
                await this.writeService.updateSection(ref, 'Review', reviewBody);
                result.reviewWritten = true;
            }
        }

        // ── Solution safety-net (R3) ──
        // 1090 follow-up: the gate covers record's OWN output, not just a bare section. A map
        // the pre-fix code wrote (`(no changes detected)`) is never bare, so a re-record left the
        // poisoned body and re-emitted the denial — the exact state run 9e8af77d left task 1089
        // in. Mirrors the Review precedent one block up (`isRecordAuthoredReview`).
        if (
            opts.solutionFromDiff &&
            (sectionIsBare(doc, 'Solution') || isRecordAuthoredSolution(doc.getSection('Solution')))
        ) {
            // The context root, not `process.cwd()`: under the programmatic `main(argv, {cwd})`
            // seam the base file must be read from — and `git diff` run in — the target project.
            const projectRoot = this.ctx.fs.resolve('.');
            // The recording task's own file is excluded: its post-record Testing/Review/Solution
            // writes are record's bookkeeping, not the implementation being described.
            const selfPath = relative(projectRoot, filePath).split(sep).join('/');
            const diffOptions = {
                cwd: projectRoot,
                ...(opts.solutionDiffBase !== undefined ? { base: opts.solutionDiffBase } : {}),
                excludePaths: [selfPath],
                wbs,
            };
            const diffText = await gitDiffU0(diffOptions);
            const solutionBody = renderSolutionFromDiff(diffText, listUntrackedFiles(diffOptions), diffOptions);
            await this.writeService.updateSection(ref, 'Solution', solutionBody);
            result.solutionBackfilled = true;
        }

        // ── Requirements/AC checkbox auto-flip (R2, 0692) ──
        // A verdict that marks a requirement MET proves its box; flip exactly the
        // proven boxes in Requirements and Acceptance Criteria, never on
        // PARTIAL/FAIL/UNKNOWN beyond the proven ids and never unmentioned boxes.
        // `AC-<n>` rows resolve through the linked feature's scenario order; a feature read miss only disables that form.
        // 1040 R4: only a readable artifact may prove boxes — the UNKNOWN stub a
        // missing/malformed/foreign artifact degrades to flips nothing.
        if (classified.state === 'readable') {
            const featureAc = await this.featureLink.resolveFeatureAcBody(filePath).catch(() => null);
            const scenarioTitles = featureScenarioTitles(featureAc?.ac ?? '');
            for (const section of ['Requirements', 'Acceptance Criteria']) {
                const body = doc.getSection(section);
                if (body === null || body.trim().length === 0) continue;
                const flipped = flipVerifiedCheckboxes(body, verdict, scenarioTitles);
                if (flipped !== body) {
                    await this.writeService.updateSection(ref, section, flipped);
                }
            }
        }

        // ── Optional transition (R4) ──
        // A request to transition to `done` auto-walks the forward FSM chain
        // (`wip → testing → done`) when the verify verdict is PASS, and
        // auto-creates the pipeline run-link the provenance gate requires —
        // **only immediately before the hop to `done`**, never before earlier
        // hops (avoids a stranded pipeline link when `wip→testing` fails).
        // A non-PASS verdict surfaces a single clear error instead of a
        // confusing multi-hop denial. Mid-walk hop failures rethrow with the
        // status reached so far (FSM per-hop atomicity; no silent rollback).
        if (opts.transition !== undefined) {
            const target = opts.transition;
            const current = ((doc.frontmatterData?.status as string | undefined) ?? '').toLowerCase();

            // 0980 R1: with the lifecycle FSM suppressed (`--no-lifecycle`), the YAML's
            // target-aware `spur task check --as <target>` guard would be silently lost
            // (the SchemaLifecyclePort fallback permits). The caller injects the same P3
            // backstop `task update` supplies (task 0130). The gate runs HERE — after the
            // section writes above, matching the adapter guard's timing, because the
            // matrix counts record's own Testing/Solution output as required at the
            // target status; a pre-record check would deny on placeholders record fills.
            // Same-status hops skip the gate: no status change means no lifecycle
            // request, so with the adapter attached no guard would run either.
            if (current !== target && opts.checkGate !== undefined && (target === 'testing' || target === 'done')) {
                await runTransitionCheckGate(opts.checkGate, wbs, filePath, target);
            }

            if (current === target) {
                // Already there — idempotent no-op (avoids an invalid self-transition).
                result.transitionedTo = current;
                // 1047 R2: no writeService transition runs on this branch, so the
                // composition's post-commit callback never fires. Reconcile the
                // bookkeeping row directly so an already-terminal re-record repairs
                // a stale lifecycle row idempotently (AC2 replay).
                result.bookkeepingError = await this.reconcileTerminalBookkeeping(wbs, target);
            } else if (target === 'done') {
                if (verdict.verdict !== 'PASS') {
                    throw new GuardDeniedError(
                        `Cannot transition task ${wbs} to done: verify verdict is ${verdict.verdict}, not PASS. ` +
                            `Re-run the pipeline to a PASS verdict, or use ` +
                            `\`spur task update ${wbs} done --force-done --reason "<why>"\` to override.`,
                    );
                }
                const startIdx = TASK_FORWARD_CHAIN.indexOf(current);
                const targetIdx = TASK_FORWARD_CHAIN.indexOf(target);
                if (startIdx !== -1 && targetIdx !== -1 && targetIdx > startIdx) {
                    // Walk each forward hop so the lifecycle FSM's per-step guards
                    // (e.g. `wip→testing` / `testing→done`) evaluate in order.
                    let reached = current;
                    for (let i = startIdx + 1; i <= targetIdx; i += 1) {
                        const hop = TASK_FORWARD_CHAIN[i] as string;
                        // Provenance is required only for the hop *to* done.
                        if (hop === 'done') {
                            await this.ensurePipelineRunLink(wbs);
                        }
                        try {
                            const hopResult = await this.writeService.transition(ref, hop);
                            reached = hopResult.toStatus ?? hop;
                            result.transitionedTo = reached;
                            // 1047 R3: a post-commit bookkeeping failure is carried,
                            // never thrown — the hop's file write is already committed.
                            if (hopResult.bookkeepingError !== undefined) {
                                result.bookkeepingError = hopResult.bookkeepingError;
                            }
                            // 1040 R2: successful done write → reconcile close
                            // audit fields (unforced here: clear stale forced
                            // flag, describe the accepted PASS artifact).
                            if (hop === 'done') {
                                result.closeAuditError = await reconcileDoneCloseAudit(this.host, wbs, {
                                    forced: false,
                                    passArtifactPath: verdictPath,
                                });
                            }
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            throw new GuardDeniedError(
                                `Record auto-walk for task ${wbs} stopped at '${reached}' ` +
                                    `(failed hop → '${hop}'): ${msg}. ` +
                                    `Re-run \`spur task record ${wbs} --transition done\` once the guard is green.`,
                            );
                        }
                    }
                } else {
                    // Outside the forward chain (e.g. cancelled/blocked) — single hop;
                    // the lifecycle FSM's own guard governs acceptance/denial.
                    await this.ensurePipelineRunLink(wbs);
                    const transitionResult = await this.writeService.transition(ref, target);
                    result.transitionedTo = transitionResult.toStatus;
                    // 1047 R3: carry a post-commit bookkeeping failure (reported, never thrown).
                    if (transitionResult.bookkeepingError !== undefined) {
                        result.bookkeepingError = transitionResult.bookkeepingError;
                    }
                    // 1040 R2: reconcile after the successful done write.
                    if (target === 'done') {
                        result.closeAuditError = await reconcileDoneCloseAudit(this.host, wbs, {
                            forced: false,
                            passArtifactPath: verdictPath,
                        });
                    }
                }
            } else {
                const transitionResult = await this.writeService.transition(ref, target);
                result.transitionedTo = transitionResult.toStatus;
                // 1047 R3: carry a post-commit bookkeeping failure (reported, never thrown).
                if (transitionResult.bookkeepingError !== undefined) {
                    result.bookkeepingError = transitionResult.bookkeepingError;
                }
            }
        }

        return result;
    }

    /**
     * Ensure a `pipeline` provenance run-link exists for the task so the
     * lifecycle adapter's `to === 'done'` provenance gate passes (task 0436 R4).
     * Delegates to the shared {@link ensurePipelineRunLink} helper. No-op when
     * the context has no DB access.
     */
    private async ensurePipelineRunLink(wbs: string): Promise<void> {
        const getDb = this.ctx.getDb;
        if (getDb === undefined) return;
        const db = await getDb();
        await ensurePipelineRunLink(db, wbs);
    }

    /**
     * 1047 R3: best-effort lifecycle-bookkeeping reconciliation for terminal
     * writes that bypass the write-service post-commit hook (record's
     * already-terminal replay). Finalizes only an EXISTING row — never allocates
     * one — and returns the failure message for the caller to report; never
     * throws (the task file is already committed). No-op without a DB owner or
     * for non-terminal targets.
     */
    private async reconcileTerminalBookkeeping(wbs: string, target: string): Promise<string | undefined> {
        if (target !== 'done' && target !== 'cancelled') return undefined;
        const getDb = this.ctx.getDb;
        if (getDb === undefined) return undefined;
        try {
            await reconcileExistingLifecycleRow(getDb, TASK_LIFECYCLE_PROFILE, wbs, target);
            return undefined;
        } catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    }

    /**
     * R6 (1139): refuse a rendered Testing section that cites a direct-child `.spur/run/<name>`
     * resolving in none of this tree's planes — `.spur/run/`, `.spur/memory/evidence/`,
     * `.spur/memory/runs/`. The producer must fix its evidence; synthesizing a citation would
     * invent evidence, so the record writes nothing and names the citation and its source row.
     */
    private async assertTestingCitationsResolved(verdict: CanonicalVerifyVerdict, testingBody: string): Promise<void> {
        const citations = extractRunCitations(testingBody);
        if (citations.length === 0) return;
        const projectRoot = this.ctx.fs.resolve('.');
        for (const citation of citations) {
            let resolved = false;
            for (const dir of RUN_CITATION_DIRS) {
                try {
                    await this.ctx.fs.readFile(join(projectRoot, dir, citation.name));
                    resolved = true;
                    break;
                } catch {
                    /* try the next plane */
                }
            }
            if (resolved) continue;
            const origin = citationOrigin(verdict, citation.name);
            throw new ValidationError(
                `record refuses an unresolved run citation: .spur/run/${citation.name} ` +
                    `(cited by ${origin}) resolves in neither .spur/run/ nor ` +
                    '.spur/memory/{evidence,runs}/ — fix the verdict evidence before recording; ' +
                    'no section was written',
            );
        }
    }
}
