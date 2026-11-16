/**
 * G76 1341 — lane path helpers and the declared-files extractor, in isolation.
 * Failure modes: a laneRoot inside the repo (lanes would nest in the tree), a non-fleet
 * or lane-mode-off key resolving a lane, a foreign path accepted as a project lane, and
 * prose / absolute / parent paths leaking into the overlap set.
 */
import { describe, expect, test } from 'bun:test';
import {
    isProjectLane,
    laneBranch,
    laneForRequestKey,
    lanePath,
    resolveLaneRoot,
} from '../../src/services/worktree-lane-service';
import { declaredTaskFiles } from '../../src/workflow/plan-projection';

const P = '/tmp/lanes-unit/repo';

describe('worktree lane helpers (G76 1341)', () => {
    test('laneRoot must lie outside the repository', () => {
        expect(() => resolveLaneRoot(P, 'lanes')).toThrow('agent.fleet.laneRoot must lie outside the repository');
        expect(() => resolveLaneRoot(P, '.')).toThrow();
        expect(resolveLaneRoot(P, undefined)).toBe('/tmp/lanes-unit/repo.spur-lanes');
    });

    test('lane names derive from wbs and attempt', () => {
        expect(laneBranch('0101', 2)).toBe('sp/run-0101-2');
        expect(lanePath(P, '../l', '0101', 2)).toEndWith('/l/repo-0101-2');
    });

    test('a request key resolves a lane only in lane mode and only for fleet task keys', () => {
        expect(laneForRequestKey(P, {}, 'fleet:task:0101:1')).toBeNull();
        expect(laneForRequestKey(P, { maxWriters: 2 }, 'chat:abc')).toBeNull();
        expect(laneForRequestKey(P, { maxWriters: 2 }, 'fleet:task:0101:3')).toEndWith('/repo.spur-lanes/repo-0101-3');
    });

    test('isProjectLane rejects foreign paths and lane-mode-off', () => {
        const lane = lanePath(P, undefined, '0101', 1);
        expect(isProjectLane(P, { maxWriters: 1 }, lane)).toBe(true);
        expect(isProjectLane(P, {}, lane)).toBe(false);
        expect(isProjectLane(P, { maxWriters: 1 }, '/tmp/lanes-unit/repo.spur-lanes/other-0101-1')).toBe(false);
        expect(isProjectLane(P, { maxWriters: 1 }, P)).toBe(false);
    });

    test('declaredTaskFiles reads Design/Plan backticked repo paths only', () => {
        const body = [
            '### Background',
            '`src/ignored.ts`',
            '### Design',
            'Touch `src/a.ts:12`, `./src/b.ts`, `bun test`, `/abs/x.ts`, `../up/y.ts`, `README`.',
            '### Plan',
            '1. Edit `packages/app/src/c.ts:3-9` and `src/a.ts`.',
            '### Solution',
            '`src/later.ts`',
        ].join('\n');
        expect(declaredTaskFiles(body).sort()).toEqual(['packages/app/src/c.ts', 'src/a.ts', 'src/b.ts']);
    });
});
