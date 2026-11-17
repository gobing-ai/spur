import { describe, expect, it } from 'bun:test';
import { allowedHostnames, isAllowedHost, normalizeHostname, rejectHost } from '../../src/services/host-guard';

function req(host: string): Request {
    return new Request(`http://${host}/api/health`);
}

describe('host-guard (K4 R8, moved from apps/server)', () => {
    it('allows localhost, the bind name, configured origins and IP literals', () => {
        const allowed = allowedHostnames('127.0.0.1', ['https://board.example.com']);
        expect(allowed.has('localhost')).toBe(true);
        expect(allowed.has('127.0.0.1')).toBe(true);
        expect(allowed.has('board.example.com')).toBe(true);
        expect(isAllowedHost(req('localhost'), allowed)).toBe(true);
        expect(isAllowedHost(req('board.example.com'), allowed)).toBe(true);
        expect(isAllowedHost(req('[::1]'), allowed)).toBe(true);
        expect(isAllowedHost(req('evil.test'), allowed)).toBe(false);
    });

    it('ignores malformed allowlist entries and normalizes names', () => {
        const allowed = allowedHostnames('Local.Host.', ['not a url', 'https://Board.Example.com./']);
        expect(allowed.has('localhost')).toBe(true);
        expect(allowed.has('board.example.com')).toBe(true);
        expect(normalizeHostname('[::1]')).toBe('::1');
    });

    it('answers 421 without echoing the Host back', async () => {
        const res = rejectHost();
        expect(res.status).toBe(421);
        const body = await res.text();
        expect(body).toContain('Misdirected Request');
        expect(body).not.toContain('evil');
    });
});
