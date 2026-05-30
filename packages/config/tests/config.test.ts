import { describe, expect, test } from 'bun:test';
import { buildConfigFromEnv, configSchema } from '../src';

describe('config', () => {
    test('builds defaults for a development scaffold', () => {
        expect(configSchema.parse({})).toEqual({
            database: { url: ':memory:' },
            server: { port: 3000 },
            telemetry: { enabled: false },
            logging: { level: 'info' },
        });
    });

    test('reads supported environment overrides', () => {
        expect(
            buildConfigFromEnv({
                DATABASE_URL: 'file:local.db',
                PORT: '4321',
                SPUR_LOG_LEVEL: 'debug',
                SPUR_TELEMETRY_ENABLED: 'true',
            }),
        ).toEqual({
            database: { url: 'file:local.db' },
            server: { port: 4321 },
            telemetry: { enabled: true },
            logging: { level: 'debug' },
        });
    });
});
