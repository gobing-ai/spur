/**
 * Contract-correspondence guard for `apps/web/src/lib/feature-types.ts`.
 *
 * That module hand-duplicates the feature DTOs from `packages/contracts/src/feature.ts`
 * (JSON-decoded: dates are strings, enums are narrow unions), so nothing caught the two
 * drifting apart. The assignability assignments below are the guard: they are checked by
 * `tsc --noEmit` (part of `bun run lint`, i.e. the quality gate), and each is paired with a
 * runtime assertion so the file is not vacuous when executed.
 *
 * Only the schemas `@gobing-ai/spur-contracts` actually re-exports can be pinned here; the
 * remaining client DTOs (body/action/child/task/link/sync) have no exported contract schema
 * to compare against.
 */
import { describe, expect, test } from 'bun:test';
import { featureListResponseSchema, featureShowResponseSchema } from '@gobing-ai/spur-contracts';
import type { FeatureShowData, FeatureSummary } from '../../src/lib/feature-types';

/** A minimal summary: every field the contract marks optional is omitted. */
const MINIMAL_SUMMARY = { id: 'G631', name: 'Projects Database tab', status: 'backlog' } as const;

/** A summary carrying every optional field the contract declares. */
const FULL_SUMMARY = {
    id: 'G631',
    name: 'Projects Database tab',
    status: 'backlog',
    priority: 'P2',
    parentId: 'G63',
    wbsCount: 2,
} as const;

const SHOW_DATA = {
    id: 'G631',
    name: 'Projects Database tab',
    status: 'backlog',
    frontmatter: { id: 'G631', status: 'backlog' },
    content: '# G631\n',
    filePath: '/tmp/G631_feature.md',
} as const;

describe('FeatureSummary mirrors featureListResponseSchema', () => {
    test('a contract-parsed summary is a FeatureSummary, and vice versa', () => {
        // contract → client (type error here if the contract gains a field the client lacks)
        const parsed = featureListResponseSchema.parse({ ok: true, data: [FULL_SUMMARY] });
        const fromContract: FeatureSummary[] = parsed.data;
        expect(fromContract).toEqual([FULL_SUMMARY]);

        // client → contract (type error here if the client gains a field the contract rejects)
        const fromClient: FeatureSummary = fromContract[0] as FeatureSummary;
        expect(featureListResponseSchema.parse({ ok: true, data: [fromClient] })).toEqual(parsed);
    });

    test('the client optionality mirrors the contract optionality', () => {
        const parsed = featureListResponseSchema.parse({ ok: true, data: [MINIMAL_SUMMARY] });
        const asClientType: FeatureSummary = parsed.data[0] as FeatureSummary;
        expect(asClientType).toEqual(MINIMAL_SUMMARY);
        expect('priority' in asClientType).toBe(false);
    });
});

describe('FeatureShowData mirrors featureShowResponseSchema', () => {
    test('a contract-parsed detail body is a FeatureShowData, and vice versa', () => {
        // contract → client
        const parsed = featureShowResponseSchema.parse({ ok: true, data: SHOW_DATA });
        const fromContract: FeatureShowData = parsed.data;
        expect(fromContract).toEqual(SHOW_DATA);

        // client → contract
        const fromClient: FeatureShowData = fromContract;
        expect(featureShowResponseSchema.parse({ ok: true, data: fromClient })).toEqual(parsed);
    });

    test('the client keeps frontmatter free-form, as the contract does', () => {
        const nested = { ...SHOW_DATA, frontmatter: { tags: ['board'], estimate: 4, nested: { a: 1 } } };
        const parsed: FeatureShowData = featureShowResponseSchema.parse({ ok: true, data: nested }).data;
        expect(parsed.frontmatter).toEqual({ tags: ['board'], estimate: 4, nested: { a: 1 } });
    });
});
