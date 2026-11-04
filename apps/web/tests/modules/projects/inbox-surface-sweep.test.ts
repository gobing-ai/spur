/**
 * G11 1269 — the Board's inbox surface is the typed contract and nothing else.
 *
 * The deletions this task makes are the sort that rot back in: a raw fetch to a retired route, the
 * `board-operator` literal, the retired request envelope. A convention held only by review does not
 * survive the next feature, so the sweep is executable.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dir, '..', '..', '..', 'src');

/** Drop comments: prose is allowed to name what it retired, code is not. */
function stripComments(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
        .join('\n');
}

/** Every `.ts`/`.tsx` under `apps/web/src`, with its repo-relative path. */
async function sources(): Promise<Array<{ path: string; text: string }>> {
    const files: Array<{ path: string; text: string }> = [];
    for await (const path of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: SRC })) {
        files.push({
            path: relative(process.cwd(), join(SRC, path)),
            text: stripComments(readFileSync(join(SRC, path), 'utf8')),
        });
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Identifiers and routes this task deletes (R3/R4). A hit is a regression, not a style note. */
const RETIRED = [
    '/api/messages',
    '/api/project/requests',
    'messagesUrl',
    'board-operator',
    'buildRecentMessagesThread',
    'classifyReceipt',
    'useProjectRequests',
];

describe('1269 AC4/R4 — the retired inbox surface is gone', () => {
    test('no source file names a retired route, identifier or helper', async () => {
        const offenders: string[] = [];
        for (const { path, text } of await sources()) {
            for (const needle of RETIRED) {
                if (text.includes(needle)) offenders.push(`${path}: ${needle}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the sweep actually sees the tree — an empty scan is not a pass', async () => {
        const files = await sources();
        expect(files.length).toBeGreaterThan(50);
        expect(files.some((file) => file.path.endsWith('GlobalAgentBar.tsx'))).toBe(true);
    });
});

describe('1269 AC3/R2 — the global input sends through the contract', () => {
    test('it calls api.inbox.send without a `from`, so the server owns the operator identity', async () => {
        const bar = (await sources()).find((file) => file.path.endsWith('GlobalAgentBar.tsx'));
        expect(bar).toBeDefined();
        const text = bar?.text ?? '';
        const call = text.slice(text.indexOf('await api.inbox.send('), text.indexOf('await api.inbox.send(') + 400);
        expect(call).toContain('api.inbox.send(');
        // The operator identity is the server's default; sending one here would let a stale client
        // impersonate a member.
        expect(call).not.toMatch(/\bfrom:\s/);
        // The body is the operator's text: no envelope is woven around it.
        expect(call).not.toContain('SPUR-REQUEST');
    });
});
