import { mkdirSync, readdirSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Exclusive project runtime claim; live owners never expire. */
export interface ProjectServerOwner {
    release(): void;
}

/** Claim before any DB boot; keep until runtime shutdown has closed its DB. */
export function acquireProjectServerOwner(projectRoot: string): ProjectServerOwner {
    const directory = join(realpathSync(projectRoot), '.spur', 'server-owner.lock');
    mkdirSync(join(realpathSync(projectRoot), '.spur'), { recursive: true });
    const marker = `${process.pid}-${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            mkdirSync(directory);
            writeFileSync(join(directory, marker), '', { flag: 'wx' });
            let released = false;
            return {
                release() {
                    if (released) return;
                    released = true;
                    // Only the successful remover of our unique marker may remove
                    // the directory. A stale reaper can never remove a replacement.
                    try {
                        unlinkSync(join(directory, marker));
                        rmdirSync(directory);
                    } catch (error) {
                        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                    }
                },
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const owners = readdirSync(directory);
        const owner = owners.length === 1 ? owners[0] : undefined;
        const pid = owner?.match(/^(\d+)-[a-f0-9-]+$/)?.[1];
        // Incomplete/unknown claims fail closed; never erase a just-created claim.
        if (!pid || !owner) throw new Error(`Project server ownership claim is incomplete at ${directory}`);
        let dead = false;
        try {
            process.kill(Number(pid), 0);
        } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === 'ESRCH';
        }
        if (!dead)
            throw new Error(`Project already has a server owner (pid ${pid}). Close it before starting another one.`);
        try {
            unlinkSync(join(directory, owner));
            rmdirSync(directory);
        } catch (error) {
            // Another stale reaper won. Never rmdir a replacement claim.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    throw new Error('Project server ownership changed during startup; retry the launch.');
}
