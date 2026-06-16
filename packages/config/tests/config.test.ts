import { describe, expect, test } from 'bun:test';
import { buildConfigFromEnv, configSchema, parseEnvBoolean } from '../src';

describe('config', () => {
    test('builds defaults for a development scaffold', () => {
        expect(configSchema.parse({})).toEqual({
            database: { url: ':memory:' },
            server: { port: 3000, host: 'localhost', openBrowser: true, webDistPath: null },
            telemetry: { enabled: false },
            logging: { level: 'info' },
        });
    });

    test('reads supported environment overrides', () => {
        expect(
            buildConfigFromEnv({
                DATABASE_URL: 'file:local.db',
                PORT: '4321',
                HOST: '0.0.0.0',
                SPUR_LOG_LEVEL: 'debug',
                SPUR_TELEMETRY_ENABLED: 'true',
            }),
        ).toEqual({
            database: { url: 'file:local.db' },
            server: { port: 4321, host: '0.0.0.0', openBrowser: true, webDistPath: null },
            telemetry: { enabled: true },
            logging: { level: 'debug' },
        });
    });

    test('parses boolean environment values explicitly', () => {
        expect(parseEnvBoolean('true')).toBe(true);
        expect(parseEnvBoolean('1')).toBe(true);
        expect(parseEnvBoolean('false')).toBe(false);
        expect(parseEnvBoolean('0')).toBe(false);
        expect(parseEnvBoolean(undefined)).toBeUndefined();
        expect(() => parseEnvBoolean('definitely')).toThrow('Invalid boolean environment value');
    });

    test('does not treat the string false as truthy', () => {
        expect(
            buildConfigFromEnv({
                SPUR_TELEMETRY_ENABLED: 'false',
            }).telemetry.enabled,
        ).toBe(false);
    });
});
