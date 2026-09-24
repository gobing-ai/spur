/**
 * Post-D63 run-record catalog classification (task 0928, feature E7 R4).
 *
 * Attests the audited no-change disposition for the canonical workflows that
 * keep their `.spur/run` artifacts after the two-file run-record migration:
 *   R1 — every remaining `.spur/run` reference in the catalog names a
 *        workflow-owned artifact (run-scoped `<runId>-<name>`, WBS/feature-keyed
 *        proof, or the declared shared pointer), never the run record itself;
 *   R4 — no canonical workflow writes or reads a legacy single-file run state
 *        (`<runId>.log`) or an undeclared record sidecar: the two-file pair
 *        (`.spur/run/<runId>.md` + `.state.json`) stays owned by the engine
 *        log sink (0925) and the inline/plugin setup seam (0927).
 *
 * Independent proof (feature-verification receipts, history-anatomy reports,
 * WBS verdicts) and transient outputs are deliberately NOT counted as pair
 * violations — they keep their existing owners (0928 R3).
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '../../..');
const CATALOG_DIR = join(REPO_ROOT, 'config', 'workflows');

/** Run-record file names — owned by the engine sink / inline setup seam, never a workflow. */
const RECORD_NAMES = new Set(['.md', '.state.json', '.log']);

/**
 * Pull every `.spur/run/<segment>` reference (doc prose included) from a
 * definition, reduced to its record-name form: the leading run-id placeholder
 * (`${vars.__runId}`, `$__runId`, `<runId>`, `<RUNID>`, `<run-id>`) is stripped
 * so only an EXACT record file (no `-`-suffixed workflow artifact) matches.
 */
function recordNameSegments(text: string): string[] {
    const segments: string[] = [];
    for (const match of text.matchAll(/\.spur\/run\/([^\s"'`),:]+)/g)) {
        const segment = match[1];
        if (segment === undefined) continue;
        const name = segment.replace(/^\$\{vars\.[A-Za-z0-9_]+\}|^\$[A-Za-z0-9_]+|^<[A-Za-z0-9_-]+>/, '');
        segments.push(name.toLowerCase());
    }
    return segments;
}

describe('canonical workflow catalog run-record classification (0928)', () => {
    const files = readdirSync(CATALOG_DIR)
        .filter((name) => name.endsWith('.yaml'))
        .sort();

    test('post-D63 catalog is present', () => {
        expect(files.length).toBeGreaterThanOrEqual(9);
        for (const required of [
            'idea-pipeline.yaml',
            'feature-verification.yaml',
            'feature-lifecycle.yaml',
            'task-lifecycle.yaml',
            'wrapup-pipeline.yaml',
            'history-anatomy.yaml',
            'pr-review.yaml',
            'wayfinder-resolution.yaml',
        ]) {
            expect(files).toContain(required);
        }
    });

    for (const file of files) {
        test(`${file} never names the run record or a legacy single-file run state`, () => {
            const text = readFileSync(join(CATALOG_DIR, file), 'utf8');
            const offenders = recordNameSegments(text).filter((name) => RECORD_NAMES.has(name));
            expect(offenders).toEqual([]);
        });
    }

    test('idea-pipeline driver artifacts keep their declared owners (audited no-change)', () => {
        const text = readFileSync(join(CATALOG_DIR, 'idea-pipeline.yaml'), 'utf8');
        // The driver-owned status file the coverage script writes (declared seam).
        expect(text).toContain('-idea-coverage.status');
        // The handoff products the finalize stage consumes (idea-handoff.ts readers).
        for (const artifact of [
            '-idea-task-batch.json',
            '-idea-task-order.json',
            '-idea-ready.json',
            '-idea-handoff.md',
        ]) {
            expect(text).toContain(artifact);
        }
    });
});
