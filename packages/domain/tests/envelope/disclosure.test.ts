/**
 * Required vs optional-disclosure layer selection (feature O, spec 0284 R4/R7).
 *
 * R7 asks assemblies to select "required vs optional-disclosure layers per stage
 * mutation class and gate set". Before these, that split existed only as a
 * module docstring — every stage returned a flat, undifferentiated layer list.
 */
import { describe, expect, test } from 'bun:test';
import {
    appendDisclosurePlaceholders,
    buildStageLayers,
    type EnvelopeLayer,
    getStageLayerSelection,
} from '../../src/envelope';

const ISO = '2026-07-20T00:00:00.000Z';
const PROVENANCE: EnvelopeLayer['provenance'] = {
    owner: 'sp:spur-dev',
    schema_version: '1.0',
    source_revision: null,
    generated_at: ISO,
};

describe('getStageLayerSelection (R7)', () => {
    test('read-only refine stage marks nothing optional', () => {
        const { required, optional } = getStageLayerSelection('refine');
        expect(optional).toEqual([]);
        expect(required).toContain('task-state');
    });

    test('the verify gate requires run-state but never tool-observations', () => {
        const { required, optional } = getStageLayerSelection('verify');
        expect(required).toContain('run-state');
        expect(required).not.toContain('tool-observations');
        expect(optional).toEqual([]);
    });

    test('mutating stages defer evidence and tool output to disclosure', () => {
        for (const stage of ['implement', 'review', 'dogfood']) {
            const { required, optional } = getStageLayerSelection(stage);
            expect(required).toContain('run-state');
            expect(optional).toEqual(['indexed-evidence', 'tool-observations']);
        }
    });

    test('unknown stage conservatively treats the full stack as required', () => {
        const { required, optional } = getStageLayerSelection('no-such-stage');
        expect(required).toHaveLength(7);
        expect(optional).toEqual([]);
    });

    test('required and optional never overlap', () => {
        for (const stage of ['refine', 'implement', 'review', 'verify', 'dogfood']) {
            const { required, optional } = getStageLayerSelection(stage);
            expect(required.filter((r) => optional.includes(r))).toEqual([]);
        }
    });
});

describe('buildStageLayers sensitivity override (R1 redaction)', () => {
    test('defaults every layer to internal when no map is given', () => {
        const layers = buildStageLayers('refine', { 'harness-policy': 'p' }, 'sp:spur-dev', '1.0', ISO);
        expect(layers.every((l) => l.sensitivity === 'internal')).toBe(true);
    });

    test('a layer can be marked confidential without touching the others', () => {
        const layers = buildStageLayers(
            'refine',
            { 'harness-policy': 'p', 'task-state': 't' },
            'sp:spur-dev',
            '1.0',
            ISO,
            undefined,
            { 'task-state': 'confidential' },
        );
        expect(layers.find((l) => l.layer === 'task-state')?.sensitivity).toBe('confidential');
        expect(layers.find((l) => l.layer === 'harness-policy')?.sensitivity).toBe('internal');
    });
});

describe('appendDisclosurePlaceholders (R4)', () => {
    test('a missing optional layer becomes a resolvable handle, not a silent drop', () => {
        const built = buildStageLayers('implement', { 'harness-policy': 'p' }, 'sp:spur-dev', '1.0', ISO);
        const withHandles = appendDisclosurePlaceholders('implement', built, PROVENANCE);

        const evidence = withHandles.find((l) => l.layer === 'indexed-evidence');
        expect(evidence).toBeDefined();
        expect(evidence?.disclosure_handle).toBe('implement:indexed-evidence');
        expect(evidence?.content).toBe('');
        expect(evidence?.size_bytes).toBe(0);
    });

    test('a placeholder carries an explicit size budget bounding its resolved body (R4)', () => {
        const built = buildStageLayers('implement', { 'harness-policy': 'p' }, 'sp:spur-dev', '1.0', ISO);
        const withHandles = appendDisclosurePlaceholders('implement', built, PROVENANCE);

        const evidence = withHandles.find((l) => l.layer === 'indexed-evidence');
        expect(evidence?.size_budget?.max_bytes).toBeGreaterThan(0);
    });

    test('an optional layer that already has content is left alone', () => {
        const built = buildStageLayers(
            'implement',
            { 'harness-policy': 'p', 'indexed-evidence': 'real evidence' },
            'sp:spur-dev',
            '1.0',
            ISO,
        );
        const withHandles = appendDisclosurePlaceholders('implement', built, PROVENANCE);

        const evidence = withHandles.filter((l) => l.layer === 'indexed-evidence');
        expect(evidence).toHaveLength(1);
        expect(evidence[0]?.content).toBe('real evidence');
        expect(evidence[0]?.disclosure_handle).toBeUndefined();
    });

    test('placeholders keep canonical stable-first ordering', () => {
        const built = buildStageLayers('implement', { 'run-state': 'attempt: 1' }, 'sp:spur-dev', '1.0', ISO);
        const names = appendDisclosurePlaceholders('implement', built, PROVENANCE).map((l) => l.layer);
        // indexed-evidence (stable, position 5) must precede run-state (volatile, 6).
        expect(names.indexOf('indexed-evidence')).toBeLessThan(names.indexOf('run-state'));
    });

    test('stages with no optional layers are returned unchanged', () => {
        const built = buildStageLayers('refine', { 'harness-policy': 'p' }, 'sp:spur-dev', '1.0', ISO);
        expect(appendDisclosurePlaceholders('refine', built, PROVENANCE)).toHaveLength(built.length);
    });

    test('placeholder cacheability follows the layer, not the placeholder-ness', () => {
        const built = buildStageLayers('implement', {}, 'sp:spur-dev', '1.0', ISO);
        const withHandles = appendDisclosurePlaceholders('implement', built, PROVENANCE);
        expect(withHandles.find((l) => l.layer === 'indexed-evidence')?.cacheability).toBe('stable-prefix-eligible');
        expect(withHandles.find((l) => l.layer === 'tool-observations')?.cacheability).toBe('volatile');
    });
});
