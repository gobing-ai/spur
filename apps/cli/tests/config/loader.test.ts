import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpurConfig } from '../../src/config/loader';

describe('loadSpurConfig', () => {
    let cwd: string;
    let configPath: string;

    beforeAll(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'spur-loader-'));
        await Bun.write(join(cwd, 'package.json'), '{"name":"test","type":"module"}\n');
    });

    afterAll(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    test('loads a valid config with all sections', async () => {
        const configDir = join(cwd, '.spur');
        configPath = join(configDir, 'config.yaml');
        await Bun.write(
            configPath,
            [
                '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
                'version: "1"',
                'name: test-project',
                'bootstrap:',
                '  logging:',
                '    enabled: true',
                '    level: warn',
                '    console: true',
                '    json: true',
                '  telemetry:',
                '    enabled: false',
                '  database:',
                '    enabled: true',
                '    driver: bun-sqlite',
                '    url: .spur/spur.db',
                '  scheduler:',
                '    enabled: false',
                'agent:',
                '  default: claude',
                '',
            ].join('\n'),
        );

        // In test mode, schema validation is skipped (NODE_ENV=test).
        const config = await loadSpurConfig(configPath);
        expect(config.version).toBe('1');
        expect(config.name).toBe('test-project');
        expect((config.bootstrap as Record<string, unknown>)?.logging).toBeTruthy();
        expect((config.agent as Record<string, unknown>)?.default).toBe('claude');
    });

    test('rejects on malformed YAML', async () => {
        const configDir = join(cwd, '.spur');
        const badPath = join(configDir, 'bad.yaml');
        await Bun.write(badPath, ': invalid: yaml: [\n');

        await expect(loadSpurConfig(badPath)).rejects.toThrow();
    });

    test('validateSchema: true exercises resolveSchema path', async () => {
        const schemaPath = join(cwd, '.spur', 'schema.yaml');
        await Bun.write(
            schemaPath,
            [
                '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
                'version: "1"',
                'name: schema-test',
                '',
            ].join('\n'),
        );

        // With resolveSchema opted in, the resolver path is covered.
        // schema-test has no required `name` value set correctly — but
        // version+name are present, validation passes.
        const config = await loadSpurConfig(schemaPath, { validateSchema: true });
        expect(config.version).toBe('1');
        expect(config.name).toBe('schema-test');
    });

    test('rejects a non-spur $schema package instead of resolving via node_modules', async () => {
        // Spur only owns its embedded schema. A `$schema` pointing at another package must
        // NOT fall back to a node_modules lookup — that path is absent in a compiled binary
        // and would crash with ENOENT at runtime. The loader rejects it up front with a
        // clear, binary-safe error rather than depending on the dev tree's installed deps.
        const otherPath = join(cwd, '.spur', 'other-schema.yaml');
        await Bun.write(
            otherPath,
            [
                '$schema: "@gobing-ai/ts-rule-engine/schemas/rule-file.schema.json"',
                'version: "1"',
                'name: not-a-rule-file',
                '',
            ].join('\n'),
        );

        await expect(loadSpurConfig(otherPath, { validateSchema: true })).rejects.toThrow(
            /Unsupported \$schema package "@gobing-ai\/ts-rule-engine"/,
        );
    });
});
