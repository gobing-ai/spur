import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';

/** Minimal Git context reported by `spur status`. */
export interface GitContext {
    root: string | null;
    branch: string | null;
    dirty: boolean;
}

/** Resolve Git metadata without depending on the retired workspace package. */
export async function gitContext(cwd: string): Promise<GitContext> {
    const executor = new NodeProcessExecutor({ defaultTimeout: 5_000, defaultMaxOutput: 128_000 });
    const root = await executor.run({
        command: 'git',
        args: ['rev-parse', '--show-toplevel'],
        cwd,
        forceBuffered: true,
    });
    if (root.exitCode !== 0) {
        return { root: null, branch: null, dirty: false };
    }

    const branch = await executor.run({
        command: 'git',
        args: ['branch', '--show-current'],
        cwd,
        forceBuffered: true,
    });
    const status = await executor.run({
        command: 'git',
        args: ['status', '--short'],
        cwd,
        forceBuffered: true,
    });

    return {
        root: root.stdout.trim(),
        branch: branch.exitCode === 0 ? branch.stdout.trim() || null : null,
        dirty: status.exitCode === 0 && status.stdout.trim().length > 0,
    };
}
