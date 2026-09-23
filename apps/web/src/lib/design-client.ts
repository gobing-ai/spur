import { fetchWithTimeout, resolveApiUrl } from './rpc-client';

/** Metadata summary for a design specification file displayed in the Designs module. */
export interface DesignFileSummary {
    id: string;
    path: string;
    name: string;
    title: string;
    category: 'root' | 'architecture' | 'satellite';
}

/** Detail payload for a single design specification document including its markdown content. */
export interface DesignFileDetail {
    ok: boolean;
    path: string;
    title: string;
    content: string;
}

const apiBase = () => `${resolveApiUrl()}/project/designs`;

/** Fetch all registered design documents (DESIGN.md, docs/04_DESIGN.md, docs/design/*.md). */
export async function loadDesignFiles(signal?: AbortSignal): Promise<DesignFileSummary[]> {
    const res = await fetchWithTimeout(new Request(apiBase(), { signal }));
    if (!res.ok) throw new Error(`design files fetch failed: ${res.status}`);
    const json = (await res.json()) as { files?: DesignFileSummary[] };
    if (!Array.isArray(json.files)) throw new Error('design files: invalid response shape');
    return json.files;
}

/** Fetch the markdown content and title of a specific design document. */
export async function loadDesignContent(path: string, signal?: AbortSignal): Promise<DesignFileDetail> {
    const url = `${apiBase()}/file?path=${encodeURIComponent(path)}`;
    const res = await fetchWithTimeout(new Request(url, { signal }));
    if (!res.ok) throw new Error(`design file fetch failed: ${res.status}`);
    const json = (await res.json()) as DesignFileDetail;
    if (!json.ok || typeof json.content !== 'string') throw new Error('design file: invalid response shape');
    return json;
}
