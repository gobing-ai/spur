import { describe, expect, test } from 'bun:test';
import { serverBootstrapConfig } from '../src/server-config';

describe('serverBootstrapConfig', () => {
    test('disables runtime facilities in test mode', () => {
        const config = serverBootstrapConfig({ NODE_ENV: 'test' });

        expect(config.logging.enabled).toBe(false);
        expect(config.telemetry.enabled).toBe(false);
        expect(config.events.enabled).toBe(true);
        expect(config.jobqueue.enabled).toBe(false);
        expect(config.scheduler.enabled).toBe(false);
    });

    test('resolves logging and team autostart settings', () => {
        const config = serverBootstrapConfig({
            SPUR_LOG_LEVEL: 'debug',
            SPUR_TEAM_AUTOSTART: 'alpha, beta, ,gamma',
        });

        expect(config.logging).toEqual({ enabled: true, level: 'debug', console: false });
        expect(config.teamAutostart).toEqual(['alpha', 'beta', 'gamma']);
    });

    test('uses production defaults when optional settings are absent', () => {
        const config = serverBootstrapConfig({});

        expect(config.logging).toEqual({ enabled: true, level: 'info', console: false });
        expect(config.jobqueue.enabled).toBe(true);
        expect(config.scheduler.enabled).toBe(true);
        expect(config.teamAutostart).toEqual([]);
    });
});
