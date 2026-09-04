/**
 * Escalation packet sink (task 0709).
 *
 * A read-only subscriber on the {@link WorkflowObservabilityBus} that projects
 * the canonical escalation packet (see `workflow/escalation-packet.ts`) when an
 * operational trip wire fires or a run settles into terminal failure. One
 * packet per run: the deterministic artifact path plus the artifacts-table row
 * make projection idempotent across retries and process restarts (R5).
 *
 * Reuses existing mechanisms only (R8): the shared bus, the artifacts table via
 * {@link ArtifactDao}, the run/task link stores, and the system-event catalog
 * (the CLI bridges this same bus into the `system_events` ledger). Projection
 * failure never erases the original failure — it emits a bounded secondary
 * diagnostic instead (R7).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { ArtifactDao, RunDao, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    buildEscalationPacket,
    ESCALATION_PACKET_SCHEMA_VERSION,
    type EscalationPacket,
    type EscalationPacketInput,
} from '../workflow/escalation-packet';
import type {
    WorkflowObservabilityBus,
    WorkflowRunFinalizedEvent,
    WorkflowTripwireFiredEvent,
} from '../workflow/observability';
import { bounded } from '../workflow/observability';

/** Artifact kind recorded for escalation packets. */
export const ESCALATION_PACKET_KIND = 'escalation-packet';

/**
 * Pure helper: parse a run row's `metadata_json` blob and return true when it
 * represents a dry-run probe (`metadata.dryRun === true`). Exported for direct
 * unit testing — 0753 R4 / R6 regression test runs without the DAO stack.
 *
 * Defensive contract: empty input, missing `dryRun`, non-boolean `dryRun`, and
 * malformed JSON all degrade to `false` (the safe default — a probe that
 * cannot be identified must not silently escalate).
 */
export function parseDryRunProbeMetadata(metadataJson: string): boolean {
    if (metadataJson === '') return false;
    try {
        const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
        return metadata.dryRun === true;
    } catch {
        return false;
    }
}

/** Structural locator dependency: resolve a task file path from a wbs. */
export interface EscalationTaskLocator {
    findByWbs(wbs: string): Promise<{ filePath: string } | null>;
}

/** Constructor options. All persistence deps are injected for hermetic tests. */
export interface EscalationPacketSinkOptions {
    bus: WorkflowObservabilityBus;
    /** Project root; the packet lands under `<cwd>/.spur/run/`. */
    cwd: string;
    fs: FileSystem;
    db: DbAdapter;
    /** Optional: enriches identity (task name, feature id) from the task corpus. */
    locator?: EscalationTaskLocator;
    /** Injectable clock for deterministic tests. */
    now?: () => string;
}

/**
 * Subscribe escalation projection to trip wires and terminal failures.
 * Handlers are fire-and-forget; call {@link EscalationPacketSink.flush} before
 * shutdown so an in-flight projection is not lost.
 */
export class EscalationPacketSink {
    private readonly seen = new Set<string>();
    private readonly inFlight = new Set<Promise<void>>();
    private readonly artifacts: ArtifactDao;
    private readonly links: TaskRunLinkDao;
    private readonly runs: RunDao;

    constructor(private readonly options: EscalationPacketSinkOptions) {
        this.artifacts = new ArtifactDao(options.db);
        this.links = new TaskRunLinkDao(options.db);
        this.runs = new RunDao(options.db);
        options.bus.on('workflow.tripwire.fired', (event) => {
            // 0753 R4: dry-run probes emit no human-inspect escalation packet.
            // The escalation channel that fires on probes is an escalation channel
            // nobody reads (59 packets across the 65-run dry sweep — d8 cost-attention
            // measurement). A real blocked/failed run still emits one; the gate is
            // probe-only and lives here, not downstream (no silent filtering).
            this.reserveAndDispatch(event.runId, async () => {
                if (await this.isDryRunProbe(event.runId)) return true;
                return this.onTripwire(event);
            });
        });
        options.bus.on('workflow.run.finalized', (event) => {
            if (event.status === 'failed') {
                this.reserveAndDispatch(event.runId, async () => {
                    if (await this.isDryRunProbe(event.runId)) return true;
                    return this.onFinalized(event);
                });
            }
        });
    }

    /** Await in-flight projections; safe to call more than once. */
    async flush(): Promise<void> {
        while (this.inFlight.size > 0) {
            await Promise.allSettled(this.inFlight);
        }
    }

    /** Read back the canonical packet JSON (test / inspection helper). */
    async readPacket(runId: string): Promise<EscalationPacket | undefined> {
        const path = join(this.options.cwd, '.spur', 'run', `${runId}-escalation.json`);
        if (!(await this.options.fs.exists(path))) return undefined;
        return JSON.parse(await this.options.fs.readFile(path)) as EscalationPacket;
    }

    /**
     * Reserve the run synchronously before the first await (R5): a
     * fail-response tripwire is followed shortly by a `failed` finalize, and
     * both projections would otherwise interleave across awaits and double-
     * emit. A failed projection releases its reservation so a later trigger
     * can still retry.
     */
    private reserveAndDispatch(runId: string, run: () => Promise<boolean>): void {
        if (this.seen.has(runId)) return;
        this.seen.add(runId);
        const p = run()
            .then((recorded) => {
                if (!recorded) this.seen.delete(runId);
            })
            .catch(() => {
                this.seen.delete(runId);
            });
        this.inFlight.add(p);
        p.finally(() => this.inFlight.delete(p));
    }

    private async onTripwire(event: WorkflowTripwireFiredEvent): Promise<boolean> {
        return this.project({
            trigger: 'tripwire',
            runId: event.runId,
            workflowName: await this.runWorkflowName(event.runId),
            node: event.node,
            actionId: event.actionId,
            gateId: event.policy.id,
            gateKind: event.kind,
            eventRef: event.eventId,
            observed: event.observed,
            threshold: event.threshold,
            response: event.response,
            evidenceRefs: event.evidenceRefs,
            decisionReason: event.nextDecision,
            wbs: event.task,
        });
    }

    private async onFinalized(event: WorkflowRunFinalizedEvent): Promise<boolean> {
        // Failure reason lives in run metadata (stampFailureReason); best-effort.
        let failureReason: string | undefined;
        try {
            const row = await this.runs.traceRowById(event.runId);
            if (row !== undefined && row.metadata_json !== '') {
                const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
                if (typeof metadata.failure_reason === 'string') failureReason = metadata.failure_reason;
            }
        } catch {
            // unresolvable metadata degrades to the generic decision reason
        }
        return this.project({
            trigger: 'terminal-failure',
            runId: event.runId,
            workflowName: event.workflowName ?? (await this.runWorkflowName(event.runId)),
            gateId: 'terminal-failure',
            gateKind: 'workflow.run.finalized',
            eventRef: event.eventId,
            observed: failureReason,
            decisionReason:
                failureReason !== undefined
                    ? failureReason
                    : 'The workflow run failed; inspect the run log and trace to decide the next action.',
            wbs: await this.wbsForRun(event.runId),
        });
    }

    private async project(input: Omit<EscalationPacketInput, 'now'> & { wbs?: string }): Promise<boolean> {
        const { wbs, ...packetInput } = input;
        try {
            // Idempotency (R5): the synchronous reservation lives in
            // reserveAndDispatch; here only the cross-sink artifact row matters.
            const existing = await this.artifacts.artifactsByRunId(input.runId);
            if (existing.some((row) => row.kind === ESCALATION_PACKET_KIND)) {
                return true;
            }
            const identity = await this.resolveIdentity(wbs);
            const now = (this.options.now ?? (() => new Date().toISOString()))();
            const packet = buildEscalationPacket({ ...packetInput, identity, now });
            const path = join(this.options.cwd, '.spur', 'run', `${input.runId}-escalation.json`);
            if (!(await this.options.fs.exists(path))) {
                await this.options.fs.writeFile(path, `${JSON.stringify(packet, null, 2)}\n`);
            }
            await this.artifacts.record({ path, kind: ESCALATION_PACKET_KIND, runId: input.runId });
            this.options.bus.emit('workflow.escalation.created', {
                schemaVersion: ESCALATION_PACKET_SCHEMA_VERSION,
                eventId: randomUUID(),
                runId: input.runId,
                ...(input.workflowName !== undefined && input.workflowName !== ''
                    ? { workflowName: input.workflowName }
                    : {}),
                at: now,
                fingerprint: packet.fingerprint,
                artifactPath: path,
                decision: packet.decision.kind,
            });
            return true;
        } catch (error) {
            // R7: the original failure is untouched; record only a bounded
            // secondary diagnostic on the same bus.
            this.options.bus.emit('workflow.escalation.projection_failed', {
                schemaVersion: ESCALATION_PACKET_SCHEMA_VERSION,
                eventId: randomUUID(),
                runId: input.runId,
                at: (this.options.now ?? (() => new Date().toISOString()))(),
                error: bounded(error instanceof Error ? error.message : String(error), 300),
            });
            return false;
        }
    }

    private async resolveIdentity(wbs: string | undefined): Promise<{ wbs?: string; task?: string; feature?: string }> {
        if (wbs === undefined || this.options.locator === undefined) {
            return wbs === undefined ? {} : { wbs };
        }
        try {
            const hit = await this.options.locator.findByWbs(wbs);
            if (hit === null) return { wbs };
            const head = await this.options.fs.readFile(hit.filePath);
            // Only the leading frontmatter block feeds the regexes: a
            // body-level `^name:` line must not leak into identity.
            const frontmatter = head.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
            const name = frontmatter.match(/^name:\s*"?(.+?)"?\s*$/m)?.[1];
            const feature = frontmatter.match(/^feature_id:\s*(\S+)/m)?.[1];
            return {
                wbs,
                ...(name !== undefined ? { task: name } : {}),
                ...(feature !== undefined ? { feature } : {}),
            };
        } catch {
            return { wbs };
        }
    }

    /**
     * Read the run row's metadata and return true when the run is a dry-run probe
     * (`WorkflowAppService.run` stamps `dryRun: true` into `metadata_json` for
     * probes — see workflow-service.ts). A probe is informational and must
     * never produce a human-inspect escalation packet; a real blocked/failed
     * run still produces one. The check is best-effort: a missing or malformed
     * metadata row degrades to "not a probe" (the safe default).
     */
    private async isDryRunProbe(runId: string): Promise<boolean> {
        try {
            const row = await this.runs.traceRowById(runId);
            if (row === undefined || row.metadata_json === '') return false;
            return parseDryRunProbeMetadata(row.metadata_json);
        } catch {
            return false;
        }
    }

    private async runWorkflowName(runId: string): Promise<string | undefined> {
        try {
            const row = await this.runs.traceRowById(runId);
            return row?.workflow_name ?? undefined;
        } catch {
            return undefined;
        }
    }

    private async wbsForRun(runId: string): Promise<string | undefined> {
        try {
            const links = await this.links.listByRun(runId, 1);
            return links[0]?.wbs;
        } catch {
            return undefined;
        }
    }
}
