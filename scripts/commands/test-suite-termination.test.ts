import { expect, test } from 'bun:test';
import { windowsTestSuiteTermination } from './test-suite-termination';

test('Windows suite cleanup targets only the owned PID tree and bounds taskkill itself (1272)', () => {
    const pid = process.pid + process.ppid + 100;
    expect(windowsTestSuiteTermination(pid)).toEqual({
        cmd: ['taskkill', '/PID', String(pid), '/T', '/F'],
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        timeout: 1000,
    });
});

test('Windows suite cleanup refuses self, parent and special PIDs (1272)', () => {
    for (const pid of [-1, 0, 1, 1.5, Number.NaN, process.pid, process.ppid]) {
        expect(() => windowsTestSuiteTermination(pid)).toThrow(/owned child PID/);
    }
});
