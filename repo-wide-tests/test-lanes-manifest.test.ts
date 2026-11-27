/**
 * Lane manifest drift guard (feature H161, task 1459 R2).
 *
 * Runs in `test-repo-wide`, hence in `spur-check-feature`: the committed
 * `config/test-lanes.json` must match what the generator derives from the current tree. A spawning
 * file that is missing lands in the full-fan-out lane and times out there; a listed file that no
 * longer spawns keeps paying the slow lane's serialization for nothing. Either way the failure
 * names the file, because the generator's `--check` output carries every drifting path.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readLaneManifest } from '@gobing-ai/spur-app';

const REPO_ROOT = resolve(import.meta.dir, '..');
const MANIFEST_PATH = resolve(REPO_ROOT, 'config/test-lanes.json');

describe('config/test-lanes.json', () => {
    test('names the subprocess lane it claims to', () => {
        // A manifest that silently emptied (or a scan that found nothing) would make the drift
        // check below pass vacuously; the lane is never legitimately empty in this repo.
        const manifest = readLaneManifest(readFileSync(MANIFEST_PATH, 'utf8'));
        expect(manifest.root.subprocess.length).toBeGreaterThan(0);
        expect(manifest.root.subprocess.every((entry) => entry.path.endsWith('.test.ts'))).toBe(true);
    });

    test('matches the tree classification', () => {
        const result = spawnSync(process.execPath, ['scripts/spur-dev.ts', 'test-lanes', '--check'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        // The whole output rides in the assertion value so a failure names the drifting file(s).
        expect({ status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }).toEqual({
            status: 0,
            output: expect.stringContaining('matches the tree'),
        });
    }, 60_000);
});
