import { describe, expect, it } from 'bun:test';
import { PluginService } from '../../src/services/plugin-service';

describe('PluginService (no-op — plugin discovery deferred)', () => {
    it('list returns empty array', async () => {
        const svc = new PluginService();
        const result = await svc.list();
        expect(result).toEqual([]);
    });

    it('info returns null for any name', async () => {
        const svc = new PluginService();
        const result = await svc.info('any-plugin');
        expect(result).toBeNull();
    });

    it('ensureBootstrapped is a no-op', async () => {
        const svc = new PluginService();
        await svc.ensureBootstrapped();
        // No throw means success — the method is a no-op.
    });

    it('list after ensureBootstrapped is still empty', async () => {
        const svc = new PluginService();
        await svc.ensureBootstrapped();
        const result = await svc.list();
        expect(result).toEqual([]);
    });
});
