import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * K4 R12 regression guard: HTTP/1.1 allows six connections per origin, and every local project now
 * shares the gateway origin — so a second planning EventSource per pane would starve the tab.
 * The planning stream must be opened only by the shared subscriber; per-process terminal streams
 * (MemberTerminal) stay on demand.
 */
describe('one planning EventSource per tab', () => {
    test('only lib/planning-events.ts opens the shared planning stream', async () => {
        const offenders: string[] = [];
        for await (const file of new Bun.Glob('src/**/*.{ts,tsx}').scan({ cwd: WEB_ROOT })) {
            if (file.endsWith('lib/planning-events.ts') || file.endsWith('MemberTerminal.tsx')) continue;
            const text = await Bun.file(join(WEB_ROOT, file)).text();
            if (/new EventSource\(/.test(text)) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });
});
