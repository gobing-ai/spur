import type { CheckResult, FeatureShowData, FeatureSummary } from './feature-types';
import { fetchWithTimeout, resolveApiUrl } from './rpc-client';

const API = `${resolveApiUrl()}/features`;

/** Fetch the feature list. */
export async function loadFeatures(signal: AbortSignal): Promise<FeatureSummary[]> {
    const res = await fetchWithTimeout(new Request(API, { signal }));
    if (!res.ok) throw new Error(`feature list fetch failed: ${res.status}`);
    const json: unknown = await res.json();
    const body = json as { ok?: boolean; data?: FeatureSummary[] };
    if (!body.ok || !Array.isArray(body.data)) throw new Error('feature list: invalid response shape');
    return body.data;
}

/** Fetch a single feature's detail (id, name, status, frontmatter, content, filePath). */
export async function loadFeatureShow(id: string, signal: AbortSignal): Promise<FeatureShowData> {
    const res = await fetchWithTimeout(new Request(`${API}/${encodeURIComponent(id)}`, { signal }));
    if (!res.ok) throw new Error(`feature show fetch failed: ${res.status}`);
    const json: unknown = await res.json();
    const body = json as { ok?: boolean; data?: FeatureShowData };
    if (!body.ok || !body.data) throw new Error('feature show: invalid response shape');
    return body.data;
}

/** Trigger a feature status transition. Returns the new status on success. */
export async function transitionFeature(id: string, toStatus: string, signal: AbortSignal): Promise<string> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(id)}/status`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, toStatus }),
            signal,
        }),
    );
    const json: unknown = await res.json();
    if (!res.ok) {
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `transition failed: ${res.status}`);
    }
    const body = json as { ok?: boolean; data?: { status: string } };
    return body.data?.status ?? toStatus;
}

/** Run a feature check and return the findings. */
export async function checkFeature(id: string, signal: AbortSignal): Promise<CheckResult> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(id)}/check`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
            signal,
        }),
    );
    if (!res.ok) throw new Error(`feature check fetch failed: ${res.status}`);
    const json: unknown = await res.json();
    const body = json as { ok?: boolean; data?: CheckResult };
    if (!body.ok || !body.data) throw new Error('feature check: invalid response shape');
    return body.data;
}
