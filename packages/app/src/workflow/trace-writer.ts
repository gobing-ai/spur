import { dirname, join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { WorkflowObservabilityBus } from './observability';

/** Append-only, schema-versioned JSONL projection of the redacted workflow event bus. */
export class WorkflowTraceWriter {
    readonly path: string;
    private sequence = 0;
    private pending: Promise<void> = Promise.resolve();

    constructor(cwd: string, runId: string) {
        const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, '_');
        this.path = join(cwd, '.spur', 'runs', 'workflow', `${safeRunId}.jsonl`);
    }

    attach(bus: WorkflowObservabilityBus): void {
        bus.on('workflow.run.started', (event) => this.enqueue('workflow.run.started', event));
        bus.on('workflow.run.finalized', (event) => this.enqueue('workflow.run.finalized', event));
        bus.on('workflow.phase', (event) => this.enqueue('workflow.phase', event));
        bus.on('workflow.transition', (event) => this.enqueue('workflow.transition', event));
        bus.on('workflow.action.started', (event) => this.enqueue('workflow.action.started', event));
        bus.on('workflow.action.finished', (event) => this.enqueue('workflow.action.finished', event));
        bus.on('workflow.agent', (event) => this.enqueue('workflow.agent', event));
        bus.on('workflow.steering', (event) => this.enqueue('workflow.steering', event));
    }

    async flush(): Promise<void> {
        await this.pending;
    }

    private enqueue(type: string, event: unknown): void {
        this.sequence += 1;
        const line = `${JSON.stringify({
            traceSchemaVersion: 1,
            traceSequence: this.sequence,
            type,
            event,
        })}\n`;
        this.pending = this.pending.then(async () => {
            const fs = createNodeFileSystem();
            await fs.ensureDir(dirname(this.path));
            await fs.appendFile(this.path, line);
        });
    }
}
