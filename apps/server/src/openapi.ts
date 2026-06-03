import { contract } from '@gobing-ai/spur-contracts';
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
});

/**
 * Generate the OpenAPI 3.1 document from the oRPC contract, merging any
 * plugin-contributed path fragments (already re-prefixed under /plugins/<prefix>).
 */
export async function generateOpenApiSpec(pluginPaths: Record<string, unknown> = {}) {
    const spec = await generator.generate(contract, {
        info: {
            title: 'Spur API',
            version: '0.0.0',
        },
        servers: [{ url: '/api' }],
    });

    if (Object.keys(pluginPaths).length > 0) {
        // Plugin fragments are validated OpenAPI 3.1 path items by contract; the
        // generator's PathsObject type is narrower than the plain JSON we carry.
        spec.paths = { ...spec.paths, ...pluginPaths } as typeof spec.paths;
    }

    return spec;
}
