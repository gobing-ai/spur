import { NodeProcessExecutor, type ProcessOptions, type ProcessResult } from '@gobing-ai/ts-runtime';

/**
 * Process executor that reports each dispatched subprocess's OS pid.
 *
 * `AiRunner` owns the `run()` options for an agent dispatch, so the pid sink
 * cannot be threaded through the call site — it is injected here instead, at
 * the one place Spur constructs the executor. Any `onSpawn` the caller supplied
 * still runs; this only appends an observer.
 */
export class PidObservingProcessExecutor extends NodeProcessExecutor {
    constructor(
        config: ConstructorParameters<typeof NodeProcessExecutor>[0],
        private readonly publishPid: (pid: number) => void,
    ) {
        super(config);
    }

    override async run(options: ProcessOptions): Promise<ProcessResult> {
        return super.run({
            ...options,
            onSpawn: (pid: number) => {
                options.onSpawn?.(pid);
                this.publishPid(pid);
            },
        });
    }
}

/**
 * Process executor that stamps the dispatching run's effective role into every
 * spawned subprocess environment as `SPUR_ROLE` (0551). Recursive by
 * construction: a child `spur agent run` reads it as its inherited role when it
 * declares none of its own. An empty value strips a parent's stale role
 * (stage/default/priority resolutions dispatch with no role). Preserves any
 * caller-supplied env (ai-runner correlation vars) — `SPUR_ROLE` is the only
 * key overridden.
 */
export class RolePropagatingProcessExecutor extends PidObservingProcessExecutor {
    private roleEnv = '';
    private specIdEnv = '';

    /** Set the role stamped into subsequent spawns; undefined strips. */
    setRoleEnv(role: string | undefined): void {
        this.roleEnv = role ?? '';
    }

    /**
     * Set the occupant spec id stamped into subsequent spawns (G73 R4, task 1080);
     * undefined strips. A drained `svc.run` member otherwise carries no fleet identity —
     * the supervisor path stamps persistent members, and this is the same stamp for a
     * member dispatched through `spur agent run --spec <id>`.
     */
    setSpecIdEnv(specId: string | undefined): void {
        this.specIdEnv = specId ?? '';
    }

    override async run(options: ProcessOptions): Promise<ProcessResult> {
        return super.run({
            ...options,
            env: { ...options.env, SPUR_ROLE: this.roleEnv, SPUR_SPEC_ID: this.specIdEnv },
        });
    }
}
