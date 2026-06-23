import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { resolveSpurBin } from '../../src/workflow/resolve-spur-bin';

// resolveSpurBin must distinguish a Bun *runtime* (dev/source run, where
// `<bun> run <entry>` is valid) from a *compiled binary* (where execPath is the
// spur exe itself and has no `run` subcommand). The branch hinges on execPath's
// basename, NOT on whether the source entry exists — the dev entry is on disk even
// when the compiled binary runs from the project root (the bug this guards against).
describe('resolveSpurBin', () => {
    const spies: ReturnType<typeof spyOn>[] = [];
    const cwd = '/proj';
    const realExecPath = process.execPath;

    function stubExecPath(path: string): void {
        Object.defineProperty(process, 'execPath', { value: path, configurable: true, writable: true });
    }
    function stubEntryExists(exists: boolean): void {
        spies.push(spyOn(fs, 'existsSync').mockReturnValue(exists));
    }

    afterEach((): void => {
        Object.defineProperty(process, 'execPath', { value: realExecPath, configurable: true, writable: true });
        while (spies.length > 0) spies.pop()?.mockRestore();
    });

    test('uses `<bun> run <entry>` when running under the Bun runtime with the source entry present', () => {
        stubExecPath('/home/u/.bun/bin/bun');
        stubEntryExists(true);
        expect(resolveSpurBin(cwd)).toBe('/home/u/.bun/bin/bun run /proj/apps/cli/src/index.ts');
    });

    test('uses the executable directly for a compiled binary even when the source entry exists', () => {
        // The compiled binary runs from the project root: the dev entry is on disk,
        // but execPath is `spur`, not `bun` — must NOT emit `<spur> run …`.
        stubExecPath('/proj/dist/cli/spur');
        stubEntryExists(true);
        expect(resolveSpurBin(cwd)).toBe('/proj/dist/cli/spur');
    });

    test('falls back to the executable under Bun when the source entry is absent (installed package)', () => {
        stubExecPath('/home/u/.bun/bin/bun');
        stubEntryExists(false);
        expect(resolveSpurBin(cwd)).toBe('/home/u/.bun/bin/bun');
    });
});
