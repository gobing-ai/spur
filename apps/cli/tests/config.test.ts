import { describe, expect, test } from 'bun:test';
import { CLI_CONFIG } from '../src/config';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

describe('CLI config', () => {
    test('CLI_CONFIG has expected shape', () => {
        expect(CLI_CONFIG.binaryName).toBe('spur');
        expect(CLI_CONFIG.binaryVersion).toMatch(SEMVER);
        expect(CLI_CONFIG.configDir).toBe('.spur');
        expect(CLI_CONFIG.databaseFile).toBe('.spur/spur.db');
    });
});
