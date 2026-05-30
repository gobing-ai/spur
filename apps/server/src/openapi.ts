import { contract } from '@gobing-ai/spur-contracts';
import { OpenAPIGenerator } from '@orpc/openapi';
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4';

const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
});

/** Generate the OpenAPI 3.1 document from the oRPC contract. */
export async function generateOpenApiSpec() {
    return generator.generate(contract, {
        info: {
            title: 'Spur API',
            version: '0.0.0',
        },
        servers: [{ url: '/api' }],
    });
}
