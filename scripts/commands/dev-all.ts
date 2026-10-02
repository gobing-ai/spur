import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { echoError } from '@gobing-ai/ts-utils';

/** Run server and web together; terminate only the process groups this invocation owns. */
export function devAll(): void {
    const managed = [
        { label: 'server', args: ['run', '--filter', '@gobing-ai/spur-server', 'dev'] },
        { label: 'web', args: ['run', '--filter', '@gobing-ai/spur-web', 'dev'] },
    ].map(({ label, args }) => ({ label, child: spawn('bun', args, { stdio: 'inherit', detached: true }) }));
    let shuttingDown = false;

    function signalOwned(signal: NodeJS.Signals): void {
        for (const { child } of managed) {
            if (!child.pid) continue;
            try {
                process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
            } catch {
                // The owned group has already exited.
            }
        }
    }

    function stopAll(code: number): void {
        if (shuttingDown) return;
        shuttingDown = true;
        echoError('[dev:all] Shutting down...');
        signalOwned('SIGTERM');
        // Roots may exit before their descendants; retain ownership until the bounded cleanup finishes.
        setTimeout(() => {
            signalOwned('SIGKILL');
            process.exit(code);
        }, 3000);
    }

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => stopAll(128 + constants.signals[signal]));
    }
    for (const { label, child } of managed) {
        child.on('error', (error) => {
            echoError(`[${label}] failed to start: ${error.message}`);
            stopAll(1);
        });
        child.on('exit', (code, signal) => {
            echoError(`[${label}] exited ${signal ? `via ${signal}` : `with code ${code}`}`);
            stopAll(signal ? 128 + constants.signals[signal] : (code ?? 1));
        });
    }
}
