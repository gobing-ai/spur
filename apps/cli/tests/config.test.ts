import { describe, expect, test } from 'bun:test';
import { CLI_CONFIG } from '../src/config';

describe('CLI config', () => {
    test('CLI_CONFIG has expected shape', () => {
        expect(CLI_CONFIG.binaryName).toBe('spur');
        expect(CLI_CONFIG.binaryVersion).toBe('0.1.0');
        expect(CLI_CONFIG.configDir).toBe('.spur');
        expect(CLI_CONFIG.databaseFile).toBe('.spur/spur.db');
    });
});
