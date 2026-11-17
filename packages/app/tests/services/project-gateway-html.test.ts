import { describe, expect, it } from 'bun:test';
import { renderGatewayIndex } from '../../src/services/project-gateway-html';

describe('renderGatewayIndex', () => {
    it('renders local project cards without running/stopped tags and remote cards with host:port tags', () => {
        const html = renderGatewayIndex({
            port: 3000,
            projects: [
                {
                    entry: { name: 'alpha', path: '/Users/dev/alpha', port: 3007 },
                    prefix: '/alpha',
                },
                {
                    entry: { name: 'remote-box', path: '/srv/remote', host: '192.168.1.50', port: 4000 },
                    prefix: null,
                },
            ],
        });

        expect(html).toContain('class="project-grid"');
        expect(html).toContain('href="/alpha/board"');
        expect(html).toContain('Gateway route');
        expect(html).not.toContain('Running');
        expect(html).not.toContain('Stopped');
        expect(html).not.toContain('Starts on demand');
        expect(html).toContain('class="remote-pill">Remote</span>');
        expect(html).toContain('192.168.1.50:4000');
        expect(html).toContain('href="http://192.168.1.50:4000/board"');
        expect(html).toContain('1 local &middot; 1 remote');
        expect(html).toContain('1 local / 1 remote');
        expect(html).toContain('Loopback only');
        expect(html).toContain('/api/health');
        expect(html).toContain('id="theme-toggle"');
        expect(html).toContain('spur-theme');
        expect(html).toContain('[data-theme="light"]');
        expect(html).toContain('class="card-remove"');
        expect(html).toContain('data-path="/Users/dev/alpha"');
        expect(html).toContain('data-host="192.168.1.50"');
        expect(html).toContain('id="remove-modal"');
        expect(html).toContain('/api/projects/remove');
        expect(html).not.toContain('id="project-filter"');
    });

    it('renders empty state when no projects are registered', () => {
        const html = renderGatewayIndex({
            port: 3000,
            projects: [],
        });

        expect(html).toContain('No projects registered');
        expect(html).toContain('spur projects add');
        expect(html).toContain('0 local');
    });

    it('escapes HTML in project names, paths, hosts, and edge hosts, and enables filter above 4 projects', () => {
        const projects = Array.from({ length: 5 }, (_, i) => ({
            entry: {
                name: i === 0 ? '<script>alert(1)</script>' : `proj-${i}`,
                path: `/tmp/"quoted"/${i}`,
                port: 0,
            },
            prefix: `/proj-${i}`,
        }));

        const html = renderGatewayIndex({
            port: 3000,
            edge: { bindHost: '0.0.0.0', allowedHosts: ['gw.example.com'] },
            projects,
        });

        expect(html).not.toContain('<script>alert(1)');
        expect(html).toContain('&#60;script&#62;alert(1)&#60;/script&#62;');
        expect(html).toContain('&#34;quoted&#34;');
        expect(html).toContain('Edge (0.0.0.0)');
        expect(html).toContain('gw.example.com');
        expect(html).toContain('id="project-filter"');
    });
});
