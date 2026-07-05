import type { JobHandler, QueueConsumer, QueueStats } from '@gobing-ai/ts-infra';

/** Queue consumer surface required by Spur's worker lifecycle. */
export type JobWorkerConsumer<T = unknown> = QueueConsumer<T> & {
    /** Deterministic one-batch drain used by tests and manual drains. */
    processOnce(): Promise<number>;
};

/** Registry mapping queue job kinds to handlers. */
export class JobHandlerRegistry<T = unknown> {
    private readonly handlers = new Map<string, JobHandler<T>>();

    /** Register or replace the handler for a job kind. */
    register(kind: string, handler: JobHandler<T>): this {
        this.handlers.set(kind, handler);
        return this;
    }

    /** Copy all registered handlers onto a concrete queue consumer. */
    applyTo(consumer: QueueConsumer<T>): void {
        for (const [kind, handler] of this.handlers) {
            consumer.register(kind, handler);
        }
    }

    /** Number of registered job kinds. */
    size(): number {
        return this.handlers.size;
    }
}

/** Options for {@link JobWorkerService}. */
export interface JobWorkerServiceOptions<T = unknown> {
    consumer: JobWorkerConsumer<T>;
    registry?: JobHandlerRegistry<T>;
}

/**
 * Thin app-layer lifecycle wrapper around the upstream DB queue consumer.
 *
 * `@gobing-ai/ts-infra` owns claim/complete/fail/retry/release semantics; Spur owns
 * when the worker starts, which handlers are registered, and deterministic drains
 * for tests. Keeping this wrapper thin avoids duplicating queue SQL or retry policy.
 */
export class JobWorkerService<T = unknown> {
    private started = false;

    constructor(private readonly options: JobWorkerServiceOptions<T>) {}

    /** Start the polling worker after applying the current handler registry. */
    async start(): Promise<void> {
        if (this.started) return;
        this.options.registry?.applyTo(this.options.consumer);
        await this.options.consumer.start();
        this.started = true;
    }

    /** Stop the polling worker, letting the upstream consumer drain in-flight jobs. */
    async stop(): Promise<void> {
        if (!this.started) return;
        await this.options.consumer.stop();
        this.started = false;
    }

    /** Process one batch immediately without starting the polling loop. */
    async processOnce(): Promise<number> {
        this.options.registry?.applyTo(this.options.consumer);
        return this.options.consumer.processOnce();
    }

    /** Return queue counts by status. */
    stats(): Promise<QueueStats> {
        return this.options.consumer.stats();
    }
}
