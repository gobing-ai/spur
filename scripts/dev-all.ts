#!/usr/bin/env bun
import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { echoError } from '@spur/core';

type ManagedProcess = {
    label: string;
    child: ChildProcess;
};

function writeLine(message: string): void {
    echoError(message);
}

/** Kill any process holding a given TCP port. */
function freePort(port: number, label: string): void {
    try {
        const pid = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim();
        if (pid) {
            const pids = pid.split('\n');
            for (const p of pids) {
                try {
                    process.kill(Number(p), 'SIGKILL');
                    writeLine(`[dev:all] Killed stale process PID ${p} on port ${port} (${label})`);
                } catch {
                    // Process already gone — fine
                }
            }
        }
    } catch {
        // lsof returned non-zero → no process on port
    }
}

function spawnManaged(label: string, args: string[]): ManagedProcess {
    const child = spawn('bun', args, {
        stdio: 'inherit',
        env: process.env,
    });

    child.on('error', (error) => {
        writeLine(`[${label}] failed to start: ${error.message}`);
    });

    return { label, child };
}

// Clean up any leftover processes from a previous dev:all session
freePort(3000, 'server');
freePort(4321, 'web');

const managed = [
    spawnManaged('server', ['run', '--filter', '@spur/server', 'dev']),
    spawnManaged('web', ['run', '--filter', '@spur/web', 'dev']),
];

let shuttingDown = false;

function stopAll(): void {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    writeLine('[dev:all] Shutting down...');

    for (const { label, child } of managed) {
        if (child.pid) {
            try {
                process.kill(child.pid, 'SIGTERM');
                writeLine(`[dev:all] Sent SIGTERM to ${label} (PID ${child.pid})`);
            } catch {
                // Process already gone
            }
        }
    }

    // Give 3s for graceful exit, then force-kill anything left on our ports
    setTimeout(() => {
        freePort(3000, 'server');
        freePort(4321, 'web');
    }, 3000);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
        writeLine(`[dev:all] Received ${signal}`);
        stopAll();
    });
}

let completed = 0;

for (const { label, child } of managed) {
    child.on('exit', (code, signal) => {
        completed += 1;

        if (!shuttingDown) {
            if (signal) {
                writeLine(`[${label}] exited via ${signal}`);
                stopAll();
            } else if (code && code !== 0) {
                writeLine(`[${label}] exited with code ${code}`);
                stopAll();
            }
        }

        if (completed === managed.length) {
            const failingProcess = managed.find(
                ({ child: managedChild }) => managedChild.exitCode && managedChild.exitCode !== 0,
            );
            process.exit(failingProcess?.child.exitCode ?? 0);
        }
    });
}
