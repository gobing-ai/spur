import { describe, expect, it } from 'bun:test';
import {
    directBoardUrl,
    markRemoteLiveness,
    projectDisplayName,
    type RegistryProject,
} from '@/components/ProjectSwitcher';

describe('projectDisplayName', () => {
    it('appends the host for remote entries', () => {
        expect(projectDisplayName({ name: 'knowledge-kit', host: '192.168.87.27' })).toBe(
            'knowledge-kit (192.168.87.27)',
        );
        expect(projectDisplayName({ name: 'kk', host: 'dev.example.com' })).toBe('kk (dev.example.com)');
    });

    it('keeps the bare name for local or missing hosts', () => {
        for (const host of [undefined, '', 'localhost', 'LOCALHOST', '127.0.0.1', '::1', ' localhost ']) {
            expect(projectDisplayName({ name: 'spur-new', host })).toBe('spur-new');
        }
    });
});

describe('directBoardUrl', () => {
    it('navigates to a remote entry even when the server-side probe reports it stopped', () => {
        // The serving process may be unable to reach the LAN host (macOS Local Network
        // privacy, firewall) while the browser can; the browser is the authority.
        expect(directBoardUrl({ host: '192.168.87.27', port: 3003, running: false })).toBe(
            'http://192.168.87.27:3003/board',
        );
    });

    it('navigates to a running local entry', () => {
        expect(directBoardUrl({ host: 'localhost', port: 3001, running: true })).toBe('http://localhost:3001/board');
    });

    it('returns null when a start is needed or no port is known', () => {
        expect(directBoardUrl({ host: 'localhost', port: 3001, running: false })).toBeNull();
        expect(directBoardUrl({ host: '192.168.87.27', port: 0, running: false })).toBeNull();
    });
});

describe('markRemoteLiveness', () => {
    const entry = (over: Partial<RegistryProject>): RegistryProject => ({
        name: 'p',
        path: '/p',
        host: 'localhost',
        port: 0,
        running: false,
        current: false,
        ...over,
    });

    it('marks a remote entry running when the browser can reach it', async () => {
        const probed: string[] = [];
        const out = await markRemoteLiveness(
            [entry({ name: 'kk', host: '192.168.87.27', port: 3003 })],
            async (url) => {
                probed.push(url);
                return true;
            },
        );
        expect(probed).toEqual(['http://192.168.87.27:3003/api/health']);
        expect(out[0]?.running).toBe(true);
    });

    it('leaves unreachable remotes stopped and never probes local or portless entries', async () => {
        const probed: string[] = [];
        const out = await markRemoteLiveness(
            [
                entry({ name: 'down', host: '10.0.0.9', port: 3003 }),
                entry({ name: 'local', port: 3001 }),
                entry({ name: 'noport', host: '10.0.0.9' }),
            ],
            async (url) => {
                probed.push(url);
                return false;
            },
        );
        expect(probed).toEqual(['http://10.0.0.9:3003/api/health']);
        expect(out.map((p) => p.running)).toEqual([false, false, false]);
    });
});
