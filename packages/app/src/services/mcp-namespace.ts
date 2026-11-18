import { join } from 'node:path';
import { MCP_NAMESPACE_PATTERN } from '@gobing-ai/spur-config';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/** Where a project's MCP namespace came from. */
export type McpNamespaceSource = 'config' | 'plugin-manifest' | 'none';

/** Resolved MCP namespace for a project and its provenance. */
export interface McpNamespace {
    namespace: string | null;
    source: McpNamespaceSource;
}

/**
 * Resolve a project's MCP namespace from explicit config, else a single depth-1
 * `plugins/<name>/plugin.json` manifest whose `name` passes the namespace grammar, else `none`.
 */
export async function resolveMcpNamespace(input: {
    configured: string | undefined;
    projectRoot: string;
    fs: FileSystem;
}): Promise<McpNamespace> {
    if (input.configured !== undefined && MCP_NAMESPACE_PATTERN.test(input.configured)) {
        return { namespace: input.configured, source: 'config' };
    }

    const pluginsDir = join(input.projectRoot, 'plugins');
    const pluginsStat = await input.fs.stat(pluginsDir);
    if (pluginsStat === null || !pluginsStat.isDirectory()) {
        return { namespace: null, source: 'none' };
    }

    const entries = await input.fs.readDir(pluginsDir);
    const manifests: string[] = [];
    for (const entry of entries) {
        const entryDir = join(pluginsDir, entry);
        const entryStat = await input.fs.stat(entryDir);
        if (entryStat === null || !entryStat.isDirectory()) continue;
        const manifestPath = join(entryDir, 'plugin.json');
        const manifestStat = await input.fs.stat(manifestPath);
        if (manifestStat?.isFile()) {
            manifests.push(manifestPath);
        }
    }

    if (manifests.length !== 1 || manifests[0] === undefined) {
        return { namespace: null, source: 'none' };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(await input.fs.readFile(manifests[0]));
    } catch {
        return { namespace: null, source: 'none' };
    }

    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        typeof (parsed as Record<string, unknown>).name !== 'string'
    ) {
        return { namespace: null, source: 'none' };
    }

    const name = (parsed as Record<string, unknown>).name as string;
    if (!MCP_NAMESPACE_PATTERN.test(name)) {
        return { namespace: null, source: 'none' };
    }

    return { namespace: name, source: 'plugin-manifest' };
}
