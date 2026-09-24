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

/** Record-file suffixes — a `.spur/run` segment ending in one of these names a record FILE. */
const RECORD_SUFFIXES = ['.state.json', '.md', '.log'] as const;

/**
 * Pull every `.spur/run/<segment>` reference (doc prose included) from a
 * definition, reduced to its record-name form: the leading run-id placeholder
 * (`${vars.__runId}`, `$__runId`, `<runId>`, `<RUNID>`, `<run-id>`) is stripped.
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

/**
 * Is this `.spur/run/<segment>` reference a run-record FILE (as opposed to a declared
 * workflow artifact)?
 *
 * A workflow artifact is run-id-SUFFIXED: `<placeholder>-<name>.<ext>`, so after the
 * placeholder is stripped the remainder starts with `-` (e.g. `-idea-handoff.md`,
 * `-feature-verification.status`). A record reference either has the placeholder as its
 * entire stem (`<runId>.md` → `.md`) or names the file literally (`history-anatomy.md`),
 * so the remainder never starts with `-` and always ends in a record suffix.
 *
 * 0948 R8: the earlier rule matched the stripped-placeholder form ONLY (equality against
 * `RECORD_NAMES`), so a LITERALLY HARDCODED record name evaded the sweep entirely — the
 * one gap that made this catalogue attestation weaker than it claimed.
 */
function isRecordName(segment: string): boolean {
    if (segment.startsWith('-')) return false; // run-id-suffixed workflow artifact
    return RECORD_SUFFIXES.some((suffix) => segment.endsWith(suffix));
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
            const offenders = recordNameSegments(text).filter(isRecordName);
            expect(offenders).toEqual([]);
        });
    }

    // 0948 R8: the previous rule reduced only `<placeholder>.md` to `.md`, so a literally
    // hardcoded record name produced `history-anatomy.md` and slipped through. This mutation
    // check pins the strengthened rule from BOTH sides — a hardcoded name is caught, and a
    // run-id-suffixed declared artifact is still exempt.
    test('0948 R8: a literally hardcoded record name is caught, an artifact is not', () => {
        expect(recordNameSegments('echo x > .spur/run/history-anatomy.md').filter(isRecordName)).toEqual([
            'history-anatomy.md',
        ]);
        expect(recordNameSegments('echo x > .spur/run/history-anatomy.state.json').filter(isRecordName)).toEqual([
            'history-anatomy.state.json',
        ]);
        // Declared artifacts stay exempt: run-id-suffixed, and the pointer is not a record file.
        expect(recordNameSegments('echo x > .spur/run/$__runId-idea-handoff.md').filter(isRecordName)).toEqual([]);
        expect(recordNameSegments('echo x > .spur/run/$__runId-verdict.json').filter(isRecordName)).toEqual([]);
        expect(recordNameSegments('echo x > .spur/run/history-anatomy-run.id').filter(isRecordName)).toEqual([]);
    });

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
