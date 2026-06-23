import { describe, expect, test } from 'bun:test';
import { resolveSpurBin, resolveSpurBinFrom } from '../../src/workflow/resolve-spur-bin';

// resolveSpurBinFrom must hold across the three ways spur is launched, keying off HOW the
// process was started (execPath basename + mainModule) — NOT whether a source file exists
// on disk (the heuristic that silently broke the global-install path, where spur.js runs
// under the Bun runtime but no apps/cli/src tree is present).
describe('resolveSpurBinFrom', () => {
    test('global install (bun -g): runtime is bun, entry is the bundled spur.js → `<bun> <spur.js>`', () => {
        const r = resolveSpurBinFrom({
            execPath: '/home/u/.bun/bin/bun',
            mainModule: '/home/u/.bun/install/global/node_modules/@gobing-ai/spur/spur.js',
        });
        expect(r).toBe('/home/u/.bun/bin/bun /home/u/.bun/install/global/node_modules/@gobing-ai/spur/spur.js');
    });

    test('dev source run: runtime is bun, entry is the source index → `<bun> <index.ts>`', () => {
        const r = resolveSpurBinFrom({
            execPath: '/home/u/.proto/tools/bun/1.3.14/bun',
            mainModule: '/proj/apps/cli/src/index.ts',
        });
        expect(r).toBe('/home/u/.proto/tools/bun/1.3.14/bun /proj/apps/cli/src/index.ts');
    });

    test('node global install resolves the same way as bun', () => {
        const r = resolveSpurBinFrom({
            execPath: '/usr/local/bin/node',
            mainModule: '/usr/local/lib/node_modules/@gobing-ai/spur/spur.js',
        });
        expect(r).toBe('/usr/local/bin/node /usr/local/lib/node_modules/@gobing-ai/spur/spur.js');
    });

    test('compiled single-file binary: execPath is spur itself → invoke it directly', () => {
        // Not `bun`/`node`; it carries the task/feature commands inline, so there is no
        // separate entry module to re-invoke (mainModule is the binary itself).
        const r = resolveSpurBinFrom({ execPath: '/proj/dist/cli/spur', mainModule: '/proj/dist/cli/spur' });
        expect(r).toBe('/proj/dist/cli/spur');
    });

    test('Windows binary (spur.exe) is still treated as a compiled binary', () => {
        const r = resolveSpurBinFrom({ execPath: 'C:\\tools\\spur.exe', mainModule: 'C:\\tools\\spur.exe' });
        expect(r).toBe('C:\\tools\\spur.exe');
    });

    test('JS runtime with no resolvable main module falls back to the runtime path', () => {
        // Defensive: if mainModule is somehow undefined under a runtime, we cannot build
        // `<runtime> <entry>`, so fall back to execPath rather than emit a broken command.
        const r = resolveSpurBinFrom({ execPath: '/usr/bin/bun', mainModule: undefined });
        expect(r).toBe('/usr/bin/bun');
    });
});

describe('resolveSpurBin (live handles)', () => {
    test('produces a non-empty invocation string from the running process', () => {
        // Smoke test against the real process — under bun:test this is `<bun> <test-entry>`.
        const r = resolveSpurBin();
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
    });
});
