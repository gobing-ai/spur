import { describe, expect, it } from 'bun:test';
import { GATEWAY_FAVICON_SVG, renderGatewayIndex } from '../../src/services/project-gateway-html';

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
        expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
        expect(html).toContain('<meta name="theme-color" content="#031f3c">');
        expect(html).toContain('href="/alpha/board"');
        expect(html).not.toContain('card-footer');
        expect(html).not.toContain('Gateway route');
        expect(html).not.toContain('Open Board');
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

    it('exports a self-contained theme-aware Spur SVG favicon', () => {
        expect(GATEWAY_FAVICON_SVG).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
        expect(GATEWAY_FAVICON_SVG).toContain('<title>Spur</title>');
        expect(GATEWAY_FAVICON_SVG).toContain('@media (prefers-color-scheme: dark)');
    });
});

// ─── 1442 R1/R2: the root page's gateway MCP and routing snapshot ────────────────────────────
describe('renderGatewayIndex — gateway MCP and routing snapshot', () => {
    const routing = {
        since: '2026-11-23T00:00:00.000Z',
        requests: 12,
        status4xx: 3,
        status5xx: 1,
        upstreamRestarts: { '/alpha': 2 },
    };
    const project = { entry: { name: 'alpha', path: '/Users/dev/alpha', port: 3007 }, prefix: '/alpha' };

    it('reports MCP state, credential presence, namespaces, diagnostics and the counters', () => {
        const html = renderGatewayIndex({
            port: 3000,
            projects: [project],
            routing,
            mcp: {
                enabled: true,
                auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true },
                namespaces: [{ name: 'alpha', prefix: '/alpha', namespace: 'alphaspace' }],
                diagnostics: [
                    {
                        name: 'one, two',
                        reason: 'namespace-collision',
                        remedy: 'give each project a distinct plugin.json name',
                    },
                    {
                        name: 'remote-box',
                        reason: 'remote-not-proxied (ADR-151)',
                        remedy: 'run the project locally',
                    },
                ],
            },
        });
        expect(html).toContain('data-gateway-mcp="on"');
        expect(html).toContain('SPUR_MCP_TOKEN');
        expect(html).toContain('set');
        expect(html).toContain('data-gateway-namespace="alpha"');
        expect(html).toContain('alphaspace');
        expect(html).toContain('data-gateway-diagnostic="namespace-collision"');
        expect(html).toContain('data-gateway-diagnostic="remote-not-proxied (ADR-151)"');
        expect(html).toContain('give each project a distinct plugin.json name');
        expect(html).toContain('data-gateway-routing="requests">12<');
        expect(html).toContain('data-gateway-routing="errors">3 / 1<');
        expect(html).toContain('/alpha: 2');
        expect(html).toContain('2026-11-23T00:00:00.000Z');
    });

    it('escapes every dynamic value and never renders a credential value', () => {
        const html = renderGatewayIndex({
            port: 3000,
            projects: [project],
            routing,
            mcp: {
                enabled: true,
                auth: { envName: 'TOKEN<script>', tokenPresent: false },
                namespaces: [{ name: '<b>evil</b>', prefix: '/evil"', namespace: null }],
                diagnostics: [{ name: '<i>x</i>', reason: 'r&d', remedy: '<script>alert(1)</script>' }],
            },
        });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&#60;script&#62;');
        expect(html).toContain('&#60;b&#62;evil&#60;/b&#62;');
        expect(html).toContain('unassigned');
        expect(html).toContain('unset');
    });

    it('an MCP-off gateway shows the off state and no namespace list', () => {
        const html = renderGatewayIndex({
            port: 3000,
            projects: [project],
            routing,
            mcp: { enabled: false, auth: { envName: '', tokenPresent: false }, namespaces: [], diagnostics: [] },
        });
        expect(html).toContain('data-gateway-mcp="off"');
        expect(html).toContain('no variable configured');
        expect(html).not.toContain('data-gateway-namespaces');
        // The counters stay: "off" is not "no information".
        expect(html).toContain('data-gateway-routing="requests"');
    });

    it('an unavailable discovery keeps the cards and counters and says so', () => {
        const html = renderGatewayIndex({
            port: 3000,
            projects: [project],
            routing,
            mcp: {
                enabled: true,
                auth: { envName: 'SPUR_MCP_TOKEN', tokenPresent: true },
                namespaces: [],
                diagnostics: [],
                unavailable: true,
            },
        });
        expect(html).toContain('data-gateway-discovery="unavailable"');
        expect(html).toContain('Discovery unavailable');
        expect(html).toContain('class="project-grid"');
        expect(html).toContain('data-gateway-routing="requests"');
    });
});
