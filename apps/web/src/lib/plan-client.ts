import { fetchWithTimeout, resolveApiUrl } from './rpc-client';

/** Metadata summary for a plan or roadmap file displayed in the Plans module. */
export interface PlanFileSummary {
    id: string;
    path: string;
    name: string;
    title: string;
    category: 'roadmap' | 'plan';
}

/** Detail payload for a single plan document including its markdown content. */
export interface PlanFileDetail {
    ok: boolean;
    path: string;
    title: string;
    content: string;
}

const apiBase = () => `${resolveApiUrl()}/project/plans`;

/** Fetch all registered plan documents (docs/02_ROADMAP.md, docs/plans/*.md). */
export async function loadPlanFiles(signal?: AbortSignal): Promise<PlanFileSummary[]> {
    const res = await fetchWithTimeout(new Request(apiBase(), { signal }));
    if (!res.ok) throw new Error(`plan files fetch failed: ${res.status}`);
    const json = (await res.json()) as { files?: PlanFileSummary[] };
    if (!Array.isArray(json.files)) throw new Error('plan files: invalid response shape');
    return json.files;
}

/** Fetch the markdown content and title of a specific plan document. */
export async function loadPlanContent(path: string, signal?: AbortSignal): Promise<PlanFileDetail> {
    const url = `${apiBase()}/file?path=${encodeURIComponent(path)}`;
    const res = await fetchWithTimeout(new Request(url, { signal }));
    if (!res.ok) throw new Error(`plan file fetch failed: ${res.status}`);
    const json = (await res.json()) as PlanFileDetail;
    if (!json.ok || typeof json.content !== 'string') throw new Error('plan file: invalid response shape');
    return json;
}
