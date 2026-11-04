/** Bound Windows tree cleanup; only the suite PID captured from our own spawn may be passed here. */
export function windowsTestSuiteTermination(pid: number) {
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || pid === process.ppid) {
        throw new Error('test-suite termination requires an owned child PID');
    }
    return {
        cmd: ['taskkill', '/PID', String(pid), '/T', '/F'],
        stdin: 'ignore' as const,
        stdout: 'ignore' as const,
        stderr: 'ignore' as const,
        timeout: 1000,
    };
}
