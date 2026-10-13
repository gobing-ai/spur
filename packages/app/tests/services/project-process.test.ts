import { afterEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    classifyPortBindError,
    findListeningPid,
    isPortAvailable,
    normalizeProjectPath,
    probePort,
    setPortProbeForTests,
    setProcessHelpersForTests,
} from '../../src/services/project-process';
import * as registry from '../../src/services/project-registry';

afterEach(() => {
    setPortProbeForTests(undefined);
    setProcessHelpersForTests(undefined);
});

describe('project-process helpers (leaf shared by registry and stop)', () => {
    test('the registry re-exports the same bindings', () => {
        expect(registry.findListeningPid).toBe(findListeningPid);
        expect(registry.setPortProbeForTests).toBe(setPortProbeForTests);
    });

    test('classifyPortBindError maps in-use codes and denies the rest', () => {
        expect(classifyPortBindError({ code: 'EADDRINUSE' })).toBe('in-use');
        expect(classifyPortBindError({ code: 'EADDRNOTAVAIL' })).toBe('in-use');
        expect(classifyPortBindError({ code: 'EACCES' })).toBe('denied');
        expect(classifyPortBindError(null)).toBe('denied');
    });

    test('normalizeProjectPath expands ~ and keeps a missing path as resolved', () => {
        expect(normalizeProjectPath('~')).toBe(normalizeProjectPath(homedir()));
        expect(normalizeProjectPath('  /definitely/not/here  ')).toBe('/definitely/not/here');
        expect(normalizeProjectPath('~/x-not-there')).toBe(join(homedir(), 'x-not-there'));
    });

    test('probe and pid seams short-circuit the real system calls', async () => {
        setPortProbeForTests(async (port) => (port === 1 ? 'in-use' : 'available'));
        expect(await probePort(1)).toBe('in-use');
        expect(await isPortAvailable(2)).toBe(true);
        setProcessHelpersForTests({ pidFinder: () => 4242 });
        expect(await findListeningPid(9999)).toBe(4242);
        setProcessHelpersForTests(undefined);
        expect(await findListeningPid(0)).toBeUndefined();
    });
});
