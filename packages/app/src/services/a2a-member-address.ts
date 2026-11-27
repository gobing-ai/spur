import {
    buildConfigFromEnv,
    isLocalHost,
    normalizePrefix,
    type ProjectEntry,
    resolveProjectPrefix,
    slugifyProjectName,
} from '@gobing-ai/spur-config';
import { ProjectRegistry } from './project-registry';

/** The card suffix every target serve answers under its member path (mirrors the A2A module). */
const CARD_SUFFIX = '.well-known/agent-card.json';

/** What a `project` + `member` declaration resolves to, or why it cannot (never a throw). */
export type ProjectCardTarget = { url: string } | { error: string };

/** Why a project cannot be addressed through the LOCAL gateway (1468 R1/R2). */
export type ProjectGatewayRefusal = 'no-entry' | 'remote-host' | 'ambiguous' | 'no-gateway';

/**
 * A registered project's base URL on the local gateway, or the refusal that stopped it.
 *
 * Extracted (1468 R1) so the Agent Card URL and the remote inbox read share ONE prefix rule: a
 * second derivation is how a card and a dialog drift onto different URLs.
 */
export type ProjectGatewayBase =
    | { base: string; prefix: string; name: string }
    | { error: string; reason: ProjectGatewayRefusal };

/** One `project` + `member` declaration plus the seams needed to resolve it (1395 R2). */
export interface ProjectCardTargetInput {
    /** Registry name or gateway prefix the member declaration named. */
    project: string;
    /** Target member's local id inside that project. */
    member: string;
    /** Gateway port; the resolved URL must point at the stable gateway, never an ephemeral serve. */
    gatewayPort: number;
    listProjects: () => Promise<ProjectEntry[]>;
    fetchImpl?: typeof fetch;
}

/**
 * Resolve a project-addressed fleet member to its Agent Card URL through the gateway (1395 R2).
 *
 * Resolution runs per dispatch, never cached: a re-prefixed project must keep working. Every failure
 * is an actionable message rather than a throw, because the caller reports it as a `not-started`
 * delivery. Only the ADVERTISED URL is derived from this path — never auth, which stays the member's
 * `authEnv` value passed through unchanged.
 */
export async function resolveProjectCardTarget(input: ProjectCardTargetInput): Promise<ProjectCardTarget> {
    const resolved = await resolveProjectGatewayBase(input);
    if ('error' in resolved) return { error: resolved.error };
    const instanceId = `${resolved.name}-${input.member}`;
    return { url: `${resolved.base}/a2a/members/${encodeURIComponent(instanceId)}/${CARD_SUFFIX}` };
}

/**
 * Resolve a registered LOCAL project to its gateway base (`http://localhost:<port><prefix>`).
 *
 * The single prefix rule (1468 R1): a name or prefix matches one local registry entry, a remote
 * entry is refused (project-addressed traffic is local-only), and the gateway must be answering on
 * its own port. Every refusal carries a machine-readable `reason` so a caller can distinguish
 * "belongs to another gateway" from "the gateway is down" without parsing prose.
 */
export async function resolveProjectGatewayBase(input: {
    project: string;
    gatewayPort: number;
    listProjects: () => Promise<ProjectEntry[]>;
    fetchImpl?: typeof fetch;
}): Promise<ProjectGatewayBase> {
    const wanted = input.project.trim();
    const asPrefix = normalizePrefix(wanted);
    const entries = await input.listProjects();
    const matches = entries.filter(
        (entry) => entry.name === wanted || resolveProjectPrefix(entry) === asPrefix || entry.prefix === asPrefix,
    );

    if (matches.length === 0) {
        const known = entries
            .map((entry) => `${entry.name} (${resolveProjectPrefix(entry) ?? entry.host ?? 'remote'})`)
            .join(', ');
        return {
            error: `no registered project "${wanted}" — run \`spur projects list\` (registered: ${known || 'none'})`,
            reason: 'no-entry',
        };
    }
    const remote = matches.find((entry) => !isLocalHost(entry.host));
    if (remote !== undefined) {
        return {
            error: `project "${wanted}" is registered on ${remote.host} — a project-addressed member is local-only; declare its card URL with \`a2a\` instead`,
            reason: 'remote-host',
        };
    }
    if (matches.length > 1) {
        const identities = matches
            .map((entry) => `${entry.name} (${resolveProjectPrefix(entry) ?? 'no prefix'})`)
            .join(', ');
        return {
            error: `project "${wanted}" is ambiguous: ${identities} — address it by its distinct name or prefix`,
            reason: 'ambiguous',
        };
    }

    const entry = matches[0] as ProjectEntry;
    // Remote entries were refused above, so a local entry always resolves a prefix (default: its slug).
    const prefix = resolveProjectPrefix(entry) ?? `/${slugifyProjectName(entry.name)}`;

    const gateway = await probeGateway(input.gatewayPort, input.fetchImpl ?? fetch);
    if (gateway !== null) return { error: gateway, reason: 'no-gateway' };

    return { base: `http://localhost:${input.gatewayPort}${prefix}`, prefix, name: entry.name };
}

/** A gateway must be answering on its own port, or the resolved URL would dead-end (R2). */
async function probeGateway(port: number, fetchImpl: typeof fetch): Promise<string | null> {
    let response: Response;
    try {
        response = await fetchImpl(`http://localhost:${port}/api/health`, {
            redirect: 'error',
            signal: AbortSignal.timeout(2_000),
        });
    } catch {
        return `no gateway is listening on localhost:${port} — start it with \`spur self serve --gateway\``;
    }
    const body = (await response.json().catch(() => null)) as { gateway?: unknown } | null;
    if (!response.ok || body?.gateway !== true) {
        return `localhost:${port} is held by a listener that is not the gateway — stop it or change \`server.gateway.port\``;
    }
    return null;
}

/**
 * The `A2aMemberTransport` card resolver for project-addressed members (1395 R2). Built by a
 * composition root that owns the project registry and the gateway port; a resolution failure throws
 * so the turn records it as a `failed` receipt with the actionable message intact.
 */
export function createProjectCardRefResolver(options: {
    listProjects: () => Promise<ProjectEntry[]>;
    gatewayPort: number;
    fetchImpl?: typeof fetch;
}): (member: { instanceId: string; project?: string; member?: string }) => Promise<string> {
    return async (member) => {
        if (member.project === undefined || member.member === undefined) {
            throw new Error(`member "${member.instanceId}" declares no project/member pair to resolve`);
        }
        const resolved = await resolveProjectCardTarget({
            project: member.project,
            member: member.member,
            gatewayPort: options.gatewayPort,
            listProjects: options.listProjects,
            ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        });
        if ('error' in resolved) throw new Error(resolved.error);
        return resolved.url;
    };
}

/**
 * The resolver a CLI/engine composition root needs, built from the process env: the project registry
 * and `server.gateway.port` both come from there, so the wiring stays one line at each call site.
 */
export function envProjectCardRefResolver(options: {
    env: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
}): (member: { instanceId: string; project?: string; member?: string }) => Promise<string> {
    const registry = new ProjectRegistry(options.env.SPUR_PROJECTS_FILE);
    // Lazy so a dispatch reads the registry as it is now, not as it was at composition time.
    return createProjectCardRefResolver({
        listProjects: async () => registry.peek().projects,
        gatewayPort: buildConfigFromEnv(options.env).server.gateway.port,
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    });
}
