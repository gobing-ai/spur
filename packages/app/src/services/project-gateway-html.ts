import type { ProjectEntry } from '@gobing-ai/spur-config';
import type { GatewayEdgeOptions } from './project-gateway';

/** Escape one HTML text/attribute value — project names and paths come from the local registry. */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** One registry row rendered into the gateway landing page's project list. */
export interface GatewayIndexProject {
    entry: ProjectEntry;
    /** Gateway path prefix (`/slug`) for local projects; `null` for remote projects. */
    prefix: string | null;
}

/** One local project's gateway-root MCP namespace; `null` means the project claims none (1442 R1). */
export interface GatewayIndexNamespace {
    name: string;
    prefix: string;
    namespace: string | null;
}

/** One display-safe discovery diagnostic: the reason and remedy, never internal exception text. */
export interface GatewayIndexDiagnostic {
    name: string;
    reason: string;
    remedy: string;
}

/** The gateway-root MCP block the root page reports, sampled at render time. */
export interface GatewayIndexMcp {
    enabled: boolean;
    /** The credential variable NAME and whether it resolved — never the value. */
    auth: { envName: string; tokenPresent: boolean };
    namespaces: GatewayIndexNamespace[];
    diagnostics: GatewayIndexDiagnostic[];
    /** The discovery resolver failed: the page says so and keeps everything else usable. */
    unavailable?: boolean;
}

/** The since-creation routing snapshot `/api/health` and the root page share (1385, 1442). */
export interface GatewayIndexRouting {
    since: string;
    requests: number;
    status4xx: number;
    status5xx: number;
    upstreamRestarts: Record<string, number>;
}

/** Template inputs for the gateway landing page render. */
export interface GatewayIndexInput {
    port: number;
    edge?: GatewayEdgeOptions;
    projects: GatewayIndexProject[];
    /** Omitted by callers that render the page without a gateway MCP snapshot. */
    mcp?: GatewayIndexMcp;
    routing?: GatewayIndexRouting;
}

/** The MCP rows of the system-info popover: state, credential presence, namespaces, diagnostics. */
function mcpInfoRows(mcp: GatewayIndexMcp): string {
    const state = mcp.enabled ? 'Enabled' : 'Off';
    const credential =
        mcp.auth.envName === ''
            ? 'no variable configured'
            : `${mcp.auth.envName} ${mcp.auth.tokenPresent ? 'set' : 'unset'}`;
    const rows = [
        `<div class="sys-row"><dt>Gateway MCP</dt><dd data-gateway-mcp="${mcp.enabled ? 'on' : 'off'}">${state} &middot; ${escapeHtml(credential)}</dd></div>`,
    ];
    if (!mcp.enabled) return rows.join('');
    if (mcp.unavailable === true) {
        rows.push(
            '<div class="sys-row"><dt>Discovery</dt><dd data-gateway-discovery="unavailable">Discovery unavailable — namespace assignments and diagnostics could not be read</dd></div>',
        );
        return rows.join('');
    }
    const namespaces =
        mcp.namespaces.length === 0
            ? '<li data-gateway-namespace-empty>No local project claims a gateway MCP namespace.</li>'
            : mcp.namespaces
                  .map(
                      (entry) =>
                          `<li data-gateway-namespace="${escapeHtml(entry.name)}"><code>${escapeHtml(entry.prefix)}</code> &middot; ${escapeHtml(entry.name)} &middot; ${entry.namespace === null ? 'unassigned' : `<code>${escapeHtml(entry.namespace)}</code>`}</li>`,
                  )
                  .join('');
    const diagnostics =
        mcp.diagnostics.length === 0
            ? '<li data-gateway-diagnostic-empty>No discovery diagnostics.</li>'
            : mcp.diagnostics
                  .map(
                      (entry) =>
                          `<li data-gateway-diagnostic="${escapeHtml(entry.reason)}"><strong>${escapeHtml(entry.name)}</strong> &middot; ${escapeHtml(entry.reason)}<br>${escapeHtml(entry.remedy)}</li>`,
                  )
                  .join('');
    rows.push(
        `<div class="sys-row"><dt>Namespaces</dt><dd><ul class="sys-list" data-gateway-namespaces>${namespaces}</ul></dd></div>`,
        `<div class="sys-row"><dt>Discovery</dt><dd><ul class="sys-list" data-gateway-diagnostics>${diagnostics}</ul></dd></div>`,
    );
    return rows.join('');
}

/** The routing rows of the system-info popover, from the same snapshot `/api/health` reports. */
function routingInfoRows(routing: GatewayIndexRouting): string {
    const restarts = Object.entries(routing.upstreamRestarts);
    const restartText =
        restarts.length === 0 ? 'none' : restarts.map(([prefix, count]) => `${prefix}: ${count}`).join(', ');
    return [
        `<div class="sys-row"><dt>Requests</dt><dd data-gateway-routing="requests">${routing.requests}</dd></div>`,
        `<div class="sys-row"><dt>4xx / 5xx</dt><dd data-gateway-routing="errors">${routing.status4xx} / ${routing.status5xx}</dd></div>`,
        `<div class="sys-row"><dt>Counting since</dt><dd>${escapeHtml(routing.since)}</dd></div>`,
        `<div class="sys-row"><dt>Upstream restarts</dt><dd data-gateway-routing="restarts">${escapeHtml(restartText)}</dd></div>`,
    ].join('');
}

/**
 * Render the self-contained HTML landing page for `GET /` on the Spur gateway.
 *
 * Uses the dark surface tokens and typography stack from `DESIGN.md` with zero external
 * dependencies so the gateway works offline and behind strict CSP/tunnel origins.
 */
export function renderGatewayIndex(input: GatewayIndexInput): string {
    const { port, edge, projects, mcp, routing } = input;
    const localCount = projects.filter(({ prefix }) => prefix !== null).length;
    const remoteCount = projects.length - localCount;

    const edgeMode = edge ? `Edge (${edge.bindHost})` : 'Loopback only';
    const allowedHosts =
        edge && edge.allowedHosts.length > 0 ? edge.allowedHosts.join(', ') : edge ? edge.bindHost : 'localhost';

    const pillSummary = remoteCount > 0 ? `${localCount} local &middot; ${remoteCount} remote` : `${localCount} local`;

    const trashSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`;

    const cardsHtml =
        projects.length === 0
            ? `<div class="empty-state">
                <h2>No projects registered</h2>
                <p>Register a project directory with the Spur CLI to open its Board from this gateway.</p>
                <pre><code>spur projects add &lt;path&gt;</code></pre>
            </div>`
            : `<div class="project-grid" id="project-grid">
                ${projects
                    .map(({ entry, prefix }) => {
                        const safeName = escapeHtml(entry.name);
                        const safePath = escapeHtml(entry.path);
                        const isRemote = prefix === null;
                        const host = entry.host?.trim() || 'localhost';
                        const hostPort = entry.port > 0 ? `${host}:${entry.port}` : host;
                        const safeTag = escapeHtml(isRemote ? hostPort : prefix);
                        const href = escapeHtml(isRemote ? `http://${hostPort}/board` : `${prefix}/board`);
                        const targetAttrs = isRemote ? ' target="_blank" rel="noopener noreferrer"' : '';
                        const safeHostAttr = isRemote ? ` data-host="${escapeHtml(host)}"` : '';
                        const remoteBadge = isRemote ? '<span class="remote-pill">Remote</span>' : '';
                        const searchText = `${safeName.toLowerCase()} ${safeTag.toLowerCase()} ${safePath.toLowerCase()} ${isRemote ? 'remote' : 'local'}`;
                        return `<div class="project-card${isRemote ? ' is-remote' : ''}" data-search="${searchText}">
                    <div class="card-top">
                        <a class="card-link" href="${href}"${targetAttrs}>
                            <span class="card-title">${safeName}</span>
                        </a>
                        <div class="card-top-actions">
                            ${remoteBadge}
                            <button type="button" class="card-remove" data-name="${safeName}" data-path="${safePath}"${safeHostAttr} aria-label="Remove ${safeName} from projects.json" title="Remove project">${trashSvg}</button>
                        </div>
                    </div>
                    <div class="card-meta">
                        <code class="prefix-tag${isRemote ? ' is-remote-tag' : ''}">${safeTag}</code>
                        <span class="path-text" title="${safePath}">${safePath}</span>
                    </div>
                </div>`;
                    })
                    .join('\n                ')}
            </div>`;

    const filterHtml =
        projects.length > 4
            ? `<div class="filter-wrap">
                <input id="project-filter" class="filter-input" type="search" placeholder="Filter projects by name, prefix, host, or path…" aria-label="Filter projects" />
            </div>`
            : '';

    return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spur Gateway</title>
<script>
(() => {
    let theme = null;
    try {
        const stored = localStorage.getItem('spur-theme');
        if (stored === 'light' || stored === 'dark') theme = stored;
    } catch {}
    if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
})();
</script>
<style>
:root {
    --bg-canvas: #010102;
    --nav-bg: rgba(1, 1, 2, 0.88);
    --bg-surface-1: #0f1011;
    --bg-surface-2: #141516;
    --bg-surface-3: #18191a;
    --ink: #f7f8f8;
    --ink-muted: #d0d6e0;
    --ink-subtle: #8a8f98;
    --ink-tertiary: #62666d;
    --primary: #5e6ad2;
    --primary-hover: #828fff;
    --primary-focus: #5e69d1;
    --hairline: #23252a;
    --hairline-strong: #34343a;
    --card-top-edge: rgba(255, 255, 255, 0.06);
    --popover-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    --success: #27a644;
    --success-bg: rgba(39, 166, 68, 0.12);
    --success-border: rgba(39, 166, 68, 0.35);
    --font-sans: "Linear Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif;
    --font-mono: "Linear Mono", ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
}
:root[data-theme="light"] {
    --bg-canvas: #ffffff;
    --nav-bg: rgba(255, 255, 255, 0.88);
    --bg-surface-1: #f8fafc;
    --bg-surface-2: #f1f5f9;
    --bg-surface-3: #ffffff;
    --ink: #0f172a;
    --ink-muted: #334155;
    --ink-subtle: #64748b;
    --ink-tertiary: #7c8699;
    --primary: #4f46e5;
    --primary-hover: #6366f1;
    --primary-focus: #4f46e5;
    --hairline: #e2e8f0;
    --hairline-strong: #cbd5e1;
    --card-top-edge: #e2e8f0;
    --popover-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
    --success: #15803d;
    --success-bg: rgba(21, 128, 61, 0.1);
    --success-border: rgba(21, 128, 61, 0.3);
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
    margin: 0;
    padding: 0;
    min-height: 100%;
    background: var(--bg-canvas);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
}
.top-nav {
    position: sticky;
    top: 0;
    z-index: 20;
    height: 56px;
    background: var(--nav-bg);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--hairline);
}
.top-nav-inner {
    max-width: 1080px;
    height: 100%;
    margin: 0 auto;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}
.brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--ink);
    font-weight: 600;
    font-size: 15px;
    letter-spacing: -0.2px;
    text-decoration: none;
}
.brand-mark {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: var(--primary);
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
}
.brand-sub {
    color: var(--ink-subtle);
    font-weight: 400;
    font-size: 13px;
}
.nav-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}
.theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--hairline);
    background: var(--bg-surface-1);
    color: var(--ink-subtle);
    cursor: pointer;
    transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.theme-toggle:hover {
    background: var(--bg-surface-2);
    border-color: var(--hairline-strong);
    color: var(--primary-hover);
}
.theme-toggle:focus-visible {
    outline: 2px solid var(--primary-focus);
    outline-offset: 2px;
}
.theme-toggle .icon-moon { display: none; }
:root[data-theme="light"] .theme-toggle .icon-sun { display: none; }
:root[data-theme="light"] .theme-toggle .icon-moon { display: block; }
.sys-wrap {
    position: relative;
}
.sys-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 9999px;
    border: 1px solid var(--hairline);
    background: var(--bg-surface-1);
    color: var(--ink-muted);
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.sys-trigger:hover {
    background: var(--bg-surface-2);
    border-color: var(--hairline-strong);
    color: var(--ink);
}
.sys-trigger:focus-visible {
    outline: 2px solid var(--primary-focus);
    outline-offset: 2px;
}
.sys-trigger .mono {
    font-family: var(--font-mono);
    color: var(--ink);
}
.sys-dot {
    width: 7px;
    height: 7px;
    border-radius: 9999px;
    background: var(--success);
    flex-shrink: 0;
}
.sys-popover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 310px;
    max-width: calc(100vw - 32px);
    background: var(--bg-surface-3);
    border: 1px solid var(--hairline-strong);
    border-radius: 12px;
    padding: 14px 16px;
    box-shadow: var(--popover-shadow);
    z-index: 30;
}
.sys-popover[hidden] { display: none; }
.sys-popover-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--hairline);
}
.sys-popover-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
}
.sys-health-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
    color: var(--success);
    background: var(--success-bg);
    padding: 2px 8px;
    border-radius: 9999px;
}
.sys-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
}
.sys-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
}
.sys-row dt {
    color: var(--ink-subtle);
    flex-shrink: 0;
}
.sys-row dd {
    margin: 0;
    color: var(--ink-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sys-row dd .sys-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    white-space: normal;
    text-align: right;
    font-family: var(--font-sans);
}
.sys-popover-foot {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--hairline);
    display: flex;
    justify-content: flex-end;
}
.sys-popover-foot a {
    color: var(--primary-hover);
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
}
.sys-popover-foot a:hover {
    text-decoration: underline;
}
.main {
    max-width: 1080px;
    margin: 0 auto;
    padding: 48px 24px 72px;
}
.page-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 28px;
}
.eyebrow {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--ink-subtle);
    margin: 0 0 6px;
}
h1 {
    margin: 0 0 6px;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.6px;
    color: var(--ink);
}
.subtitle {
    margin: 0;
    color: var(--ink-subtle);
    font-size: 14px;
}
.filter-wrap {
    min-width: 240px;
    flex: 0 1 300px;
}
.filter-input {
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--hairline);
    background: var(--bg-surface-1);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 13px;
}
.filter-input::placeholder { color: var(--ink-tertiary); }
.filter-input:focus {
    outline: 2px solid var(--primary-focus);
    outline-offset: 0;
    border-color: var(--primary-focus);
}
.project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
}
.project-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 24px;
    background: var(--bg-surface-1);
    border: 1px solid var(--hairline);
    border-top-color: var(--card-top-edge);
    border-radius: 12px;
    color: inherit;
    transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
}
.project-card:hover {
    background: var(--bg-surface-2);
    border-color: var(--hairline-strong);
    transform: translateY(-1px);
}
.project-card:has(.card-link:focus-visible) {
    outline: 2px solid var(--primary-focus);
    outline-offset: 2px;
}
.project-card[hidden] { display: none; }
.card-link {
    text-decoration: none;
    color: inherit;
    min-width: 0;
}
.card-link:focus-visible { outline: none; }
.card-link::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: 12px;
}
.card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}
.card-top-actions {
    position: relative;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}
.card-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-tertiary);
    cursor: pointer;
    opacity: 0.65;
    transition: opacity 140ms ease, background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}
.project-card:hover .card-remove,
.card-remove:focus-visible {
    opacity: 1;
}
.card-remove:hover {
    background: rgba(220, 38, 38, 0.12);
    border-color: rgba(220, 38, 38, 0.35);
    color: #ef4444;
}
.card-remove:focus-visible {
    outline: 2px solid var(--primary-focus);
    outline-offset: 2px;
}
.card-title {
    font-size: 18px;
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: -0.3px;
    color: var(--ink);
    overflow-wrap: anywhere;
}
.remote-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;
    color: var(--primary-hover);
    background: rgba(94, 106, 210, 0.14);
    border: 1px solid rgba(94, 106, 210, 0.35);
}
.card-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}
.prefix-tag {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-muted);
    background: var(--bg-surface-2);
    border: 1px solid var(--hairline);
    padding: 2px 8px;
    border-radius: 6px;
}
.prefix-tag.is-remote-tag {
    color: var(--primary-hover);
    border-color: rgba(94, 106, 210, 0.3);
}
.path-text {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.empty-state {
    max-width: 520px;
    margin: 32px auto 0;
    padding: 32px;
    background: var(--bg-surface-1);
    border: 1px solid var(--hairline);
    border-radius: 12px;
    text-align: center;
}
.empty-state h2 {
    margin: 0 0 8px;
    font-size: 18px;
    font-weight: 500;
    color: var(--ink);
}
.empty-state p {
    margin: 0 0 16px;
    color: var(--ink-subtle);
    font-size: 14px;
}
.empty-state pre {
    margin: 0;
    display: inline-block;
    padding: 8px 14px;
    background: var(--bg-surface-2);
    border: 1px solid var(--hairline);
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-muted);
}
@media (max-width: 640px) {
    .main { padding: 32px 16px 48px; }
    .top-nav-inner { padding: 0 16px; }
    .brand-sub { display: none; }
}
.modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
}
.modal-backdrop[hidden] { display: none; }
.modal-card {
    width: 100%;
    max-width: 420px;
    padding: 24px;
    background: var(--bg-surface-3);
    border: 1px solid var(--hairline-strong);
    border-radius: 12px;
    box-shadow: var(--popover-shadow);
}
.modal-card h2 {
    margin: 0 0 8px;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
}
.modal-card p {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--ink-subtle);
    line-height: 1.5;
}
.modal-path {
    display: block;
    margin-bottom: 16px;
    padding: 8px 10px;
    background: var(--bg-surface-1);
    border: 1px solid var(--hairline);
    border-radius: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-muted);
    overflow-wrap: anywhere;
}
.modal-error {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(220, 38, 38, 0.12);
    border: 1px solid rgba(220, 38, 38, 0.35);
    color: #ef4444;
    font-size: 12px;
}
.modal-error[hidden] { display: none; }
.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
.btn-secondary, .btn-danger {
    padding: 8px 14px;
    border-radius: 8px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid var(--hairline);
}
.btn-secondary {
    background: var(--bg-surface-1);
    color: var(--ink);
}
.btn-secondary:hover { background: var(--bg-surface-2); }
.btn-danger {
    background: #dc2626;
    border-color: #dc2626;
    color: #ffffff;
}
.btn-danger:hover { background: #b91c1c; }
.btn-danger:disabled, .btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
</head>
<body>
<header class="top-nav">
    <div class="top-nav-inner">
        <a class="brand" href="/">
            <span class="brand-mark" aria-hidden="true">S</span>
            <span>Spur</span>
            <span class="brand-sub">Gateway</span>
        </a>
        <div class="nav-actions">
            <button type="button" class="theme-toggle" id="theme-toggle" aria-label="Switch theme" title="Switch theme">
                <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="4"></circle>
                    <path d="M12 2v2"></path><path d="M12 20v2"></path>
                    <path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path>
                    <path d="M2 12h2"></path><path d="M20 12h2"></path>
                    <path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>
                </svg>
                <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
                </svg>
            </button>
            <div class="sys-wrap" id="sys-wrap">
            <button type="button" class="sys-trigger" id="sys-trigger" aria-expanded="false" aria-controls="sys-popover">
                <span class="sys-dot" aria-hidden="true"></span>
                <span class="mono">:${port}</span>
                <span aria-hidden="true">&middot;</span>
                <span>${pillSummary}</span>
            </button>
            <div class="sys-popover" id="sys-popover" role="region" aria-label="Gateway system information" hidden>
                <div class="sys-popover-head">
                    <span class="sys-popover-title">Gateway System Info</span>
                    <span class="sys-health-badge"><span class="sys-dot" aria-hidden="true"></span>Healthy</span>
                </div>
                <dl class="sys-rows">
                    <div class="sys-row"><dt>Port</dt><dd>:${port}</dd></div>
                    <div class="sys-row"><dt>Mode</dt><dd>${escapeHtml(edgeMode)}</dd></div>
                    <div class="sys-row"><dt>Allowed hosts</dt><dd title="${escapeHtml(allowedHosts)}">${escapeHtml(allowedHosts)}</dd></div>
                    <div class="sys-row"><dt>Projects</dt><dd>${localCount} local / ${remoteCount} remote</dd></div>
                    <div class="sys-row"><dt>Runtime</dt><dd>Bun ${escapeHtml(Bun.version)}</dd></div>
                    ${routing === undefined ? '' : routingInfoRows(routing)}
                    ${mcp === undefined ? '' : mcpInfoRows(mcp)}
                </dl>
                <div class="sys-popover-foot">
                    <a href="/api/health">View /api/health &rarr;</a>
                </div>
            </div>
        </div>
        </div>
    </div>
</header>
<main class="main">
    <div class="page-header">
        <div>
            <p class="eyebrow">Workspaces</p>
            <h1>Projects</h1>
            <p class="subtitle">Select a local project to open its Board through this gateway, or open a remote host.</p>
        </div>
        ${filterHtml}
    </div>
    ${cardsHtml}
</main>
<div class="modal-backdrop" id="remove-modal" hidden>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="remove-title">
        <h2 id="remove-title">Remove project?</h2>
        <p id="remove-desc">Remove <strong id="remove-name"></strong> from <code>~/.config/spur/projects.json</code>? Files on disk will not be deleted.</p>
        <code class="modal-path" id="remove-path"></code>
        <p class="modal-error" id="remove-error" hidden></p>
        <div class="modal-actions">
            <button type="button" class="btn-secondary" id="remove-cancel">Cancel</button>
            <button type="button" class="btn-danger" id="remove-confirm">Remove</button>
        </div>
    </div>
</div>
<script>
(() => {
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        const syncLabel = (t) => {
            const label = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
            themeBtn.setAttribute('aria-label', label);
            themeBtn.setAttribute('title', label);
        };
        syncLabel(document.documentElement.getAttribute('data-theme') || 'dark');
        themeBtn.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('spur-theme', next); } catch {}
            syncLabel(next);
        });
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            let stored = null;
            try { stored = localStorage.getItem('spur-theme'); } catch {}
            if (!stored) {
                const next = e.matches ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', next);
                syncLabel(next);
            }
        });
    }
    const trigger = document.getElementById('sys-trigger');
    const popover = document.getElementById('sys-popover');
    const wrap = document.getElementById('sys-wrap');
    if (trigger && popover && wrap) {
        const setOpen = (open) => {
            popover.hidden = !open;
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(popover.hidden);
        });
        document.addEventListener('click', (e) => {
            if (!popover.hidden && !wrap.contains(e.target)) setOpen(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !popover.hidden) {
                setOpen(false);
                trigger.focus();
            }
        });
    }
    const filter = document.getElementById('project-filter');
    const grid = document.getElementById('project-grid');
    if (filter && grid) {
        const cards = Array.from(grid.querySelectorAll('.project-card'));
        filter.addEventListener('input', () => {
            const q = filter.value.trim().toLowerCase();
            for (const card of cards) {
                const hay = card.getAttribute('data-search') || '';
                card.hidden = q !== '' && !hay.includes(q);
            }
        });
    }
    const modal = document.getElementById('remove-modal');
    const modalName = document.getElementById('remove-name');
    const modalPath = document.getElementById('remove-path');
    const modalErr = document.getElementById('remove-error');
    const cancelBtn = document.getElementById('remove-cancel');
    const confirmBtn = document.getElementById('remove-confirm');
    if (modal && modalName && modalPath && modalErr && cancelBtn && confirmBtn) {
        let pending = null;
        let lastTrigger = null;
        const closeModal = () => {
            modal.hidden = true;
            pending = null;
            modalErr.hidden = true;
            modalErr.textContent = '';
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            if (lastTrigger) lastTrigger.focus();
        };
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.card-remove');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            lastTrigger = btn;
            pending = {
                path: btn.getAttribute('data-path') || '',
                host: btn.getAttribute('data-host') || undefined,
            };
            modalName.textContent = btn.getAttribute('data-name') || 'this project';
            modalPath.textContent = pending.path;
            modalErr.hidden = true;
            modal.hidden = false;
            cancelBtn.focus();
        });
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal && !confirmBtn.disabled) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.hidden && !confirmBtn.disabled) closeModal();
        });
        confirmBtn.addEventListener('click', async () => {
            if (!pending) return;
            confirmBtn.disabled = true;
            cancelBtn.disabled = true;
            modalErr.hidden = true;
            try {
                // Embedded page script — browser fetch is the only transport here (no client seam to route through).
                const res = await window.fetch('/api/projects/remove', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(pending),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data.error || ('Request failed (' + res.status + ')'));
                }
                window.location.reload();
            } catch (err) {
                modalErr.textContent = err instanceof Error ? err.message : String(err);
                modalErr.hidden = false;
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
            }
        });
    }
})();
</script>
</body>
</html>`;
}
