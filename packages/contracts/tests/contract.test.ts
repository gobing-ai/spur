import { describe, expect, test } from 'bun:test';
import { contract, healthResponseSchema } from '../src';

describe('contracts', () => {
    test('defines a GET health route with the expected output shape', () => {
        expect(contract.health['~orpc'].route).toMatchObject({
            method: 'GET',
            path: '/health',
        });

        expect(
            healthResponseSchema.parse({
                status: 'ok',
                timestamp: '2026-05-30T00:00:00.000Z',
                service: 'spur',
                version: '0.0.0',
            }),
        ).toEqual({
            status: 'ok',
            timestamp: '2026-05-30T00:00:00.000Z',
            service: 'spur',
            version: '0.0.0',
        });
    });
});
