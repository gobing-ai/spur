import { describe, expect, test } from 'bun:test';
import { allowedHostnames, isAllowedHost, rejectHost } from '../../src/middleware/host-guard';

const req = (host: string) => new Request(`http://${host}/api/processes/p1/stdin`, { method: 'POST' });

describe('host guard (DNS rebinding)', () => {
    const allowed = allowedHostnames('localhost', []);

    test('rejects an attacker-owned name that re-resolves to loopback', () => {
        // The exact shape of the rebinding probe: Host names the attacker domain.
        expect(isAllowedHost(req('evil.test:3000'), allowed)).toBe(false);
        expect(isAllowedHost(req('localhost.evil.test:3000'), allowed)).toBe(false);
    });

    test('accepts loopback names and any IP literal (rebinding cannot forge an IP Host)', () => {
        for (const host of ['localhost:3000', 'LOCALHOST.:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.1.5:3000']) {
            expect(isAllowedHost(req(host), allowed)).toBe(true);
        }
    });

    test('accepts the operator-chosen bind name and SPUR_CORS_ORIGINS hosts only', () => {
        const custom = allowedHostnames('mybox.local', ['https://board.example.com', 'not a url']);
        expect(isAllowedHost(req('mybox.local:3000'), custom)).toBe(true);
        expect(isAllowedHost(req('board.example.com'), custom)).toBe(true);
        expect(isAllowedHost(req('other.example.com'), custom)).toBe(false);
    });

    test('rejection is 421 and does not echo the Host', async () => {
        const res = rejectHost();
        expect(res.status).toBe(421);
        expect(await res.text()).not.toContain('evil');
    });

    test('end to end on Bun.serve: forged Host is refused before the app runs', async () => {
        let ran = 0;
        const server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch: (r) => {
                if (!isAllowedHost(r, allowed)) return rejectHost();
                ran++;
                return new Response('ran');
            },
        });
        try {
            const url = `http://127.0.0.1:${server.port}/x`;
            const evil = await fetch(url, { method: 'POST', headers: { Host: `evil.test:${server.port}` } });
            expect(evil.status).toBe(421);
            expect(ran).toBe(0);
            const ok = await fetch(url, { method: 'POST' });
            expect(ok.status).toBe(200);
        } finally {
            server.stop(true);
        }
    });
});
