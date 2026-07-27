import { describe, expect, test } from 'bun:test';
import { defaultVerdictRunDir } from '../../src/services/feature-check';
import { extractBacktickLineAnchors, resolveProjectRootFromTasksDir } from '../../src/services/task-check';

describe('extractBacktickLineAnchors', () => {
    test('extracts path:line and path:range, skips URLs', () => {
        const body = [
            'Evidence: `packages/app/src/services/task-service.ts:319` and `apps/web/x.tsx:1-10`',
            'Skip `https://example.com:443` and bare `42`',
            'Also `handlers.ts:95-101`',
        ].join('\n');
        const cites = extractBacktickLineAnchors(body);
        expect(cites.map((c) => c.raw)).toContain('packages/app/src/services/task-service.ts:319');
        expect(cites.map((c) => c.raw)).toContain('apps/web/x.tsx:1-10');
        expect(cites.map((c) => c.raw)).toContain('handlers.ts:95-101');
        expect(cites.some((c) => c.raw.includes('https'))).toBe(false);
    });
});

describe('resolveProjectRootFromTasksDir', () => {
    test('docs/tasks3 → repo root (two levels up)', () => {
        expect(resolveProjectRootFromTasksDir('/repo/docs/tasks3')).toBe('/repo');
    });
    test('flat tasks → one level up', () => {
        expect(resolveProjectRootFromTasksDir('/repo/tasks')).toBe('/repo');
    });
});

describe('defaultVerdictRunDir', () => {
    test('docs/tasks3 → <repo>/.spur/run', () => {
        expect(defaultVerdictRunDir('/repo/docs/tasks3')).toBe('/repo/.spur/run');
    });
});
