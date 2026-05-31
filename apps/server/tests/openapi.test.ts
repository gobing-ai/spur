import { describe, expect, test } from 'bun:test';
import { generateOpenApiSpec } from '../src/openapi';

describe('openapi', () => {
    test('generates OpenAPI spec document', async () => {
        const spec = await generateOpenApiSpec();
        expect(spec.openapi).toBeTruthy();
        expect(spec.info).toBeDefined();
        expect(spec.paths).toBeDefined();
    });
});
