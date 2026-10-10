import { describe, expect, test } from 'bun:test';
import { asLiteralRunFileName, extractRunCitations, RUN_CITATION_RE } from '../../src/workflow/run-citation';

/**
 * Task 1139: the shared `.spur/run/<name>` citation extractor. Both persist-out (0984) and the
 * record step (R6) consume this module, so its literalization contract is pinned here once.
 */
describe('run-citation', () => {
    test('extracts literal direct-child citations', () => {
        const body = 'Evidence: `.spur/run/1139-verdict.json` and .spur/run/bb-base.sha.';
        expect(extractRunCitations(body).map((c) => c.name)).toEqual(['1139-verdict.json', 'bb-base.sha']);
    });

    test('dedupes repeated citations', () => {
        const body = '.spur/run/a.log then .spur/run/a.log again';
        expect(extractRunCitations(body)).toHaveLength(1);
    });

    test('skips subpath citations (1056 R1: the copy set owns direct children only)', () => {
        const body = 'see .spur/run/1139-run/agent-sessions/omp.jsonl for detail';
        expect(extractRunCitations(body)).toEqual([]);
    });

    test('template and glob references are not literal files', () => {
        for (const ref of ['.spur/run/fadca099-…', '.spur/run/run-*-ac87.log', '.spur/run/{a.md,b.md}']) {
            expect(asLiteralRunFileName(ref.replace('.spur/run/', ''))).toBeUndefined();
        }
    });

    test('trailing sentence punctuation is prose, not name', () => {
        expect(extractRunCitations('done (`.spur/run/x.json`).').map((c) => c.name)).toEqual(['x.json']);
        expect(extractRunCitations('see `.spur/run/x.json`, then').map((c) => c.name)).toEqual(['x.json']);
    });

    test('root-qualified paths are another project evidence and carry no obligation', () => {
        expect(extractRunCitations('see knowledge-kit/.spur/run/other.json')).toEqual([]);
    });

    test('the regex is stateless across consumers (no shared lastIndex drift)', () => {
        const body = '.spur/run/a.json';
        expect(extractRunCitations(body)).toHaveLength(1);
        expect(extractRunCitations(body)).toHaveLength(1);
        expect(RUN_CITATION_RE.lastIndex).toBe(0);
    });
});
