import type {
    CheckResult,
    FeatureActionInput,
    FeatureActionResponse,
    FeatureBodyUpdateInput,
    FeatureCreateChildInput,
    FeatureCreateChildResponse,
    FeatureCreateTaskInput,
    FeatureCreateTaskResponse,
    FeatureLinkTaskInput,
    FeatureLinkTaskResponse,
    FeatureShowData,
    FeatureSummary,
    FeatureSyncInput,
    FeatureSyncResponse,
} from './feature-types';
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

/** Write feature body content. PATCH /features/{id}/body */
export async function saveFeatureBody(input: FeatureBodyUpdateInput, signal?: AbortSignal): Promise<void> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(input.id)}/body`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
        }),
    );
    if (!res.ok) {
        const json: unknown = await res.json();
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `body update failed: ${res.status}`);
    }
}

/** Dispatch a workflow action (brainstorm/plan) via spur agent run. POST /features/{id}/action */
export async function dispatchFeatureAction(
    input: FeatureActionInput,
    signal?: AbortSignal,
): Promise<FeatureActionResponse> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(input.id)}/action`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
        }),
    );
    if (!res.ok) {
        const json: unknown = await res.json();
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `action dispatch failed: ${res.status}`);
    }
    const json: unknown = await res.json();
    return json as FeatureActionResponse;
}

/** Create a child feature. POST /features/{id}/children */
export async function createChildFeature(
    input: FeatureCreateChildInput,
    signal?: AbortSignal,
): Promise<FeatureCreateChildResponse> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(input.id)}/children`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
        }),
    );
    if (!res.ok) {
        const json: unknown = await res.json();
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `create child failed: ${res.status}`);
    }
    const json: unknown = await res.json();
    return json as FeatureCreateChildResponse;
}

/** Create a root feature (no parent). POST /features */
export async function createRootFeature(name: string, signal?: AbortSignal): Promise<{ id: string; filePath: string }> {
    const res = await fetchWithTimeout(
        new Request(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
            signal,
        }),
    );
    if (!res.ok) {
        const json: unknown = await res.json();
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `create feature failed: ${res.status}`);
    }
    const json: unknown = await res.json();
    const body = json as { ok?: boolean; data?: { id: string; filePath: string } };
    if (!body.ok || !body.data) throw new Error('create feature: invalid response shape');
    return body.data;
}

/** Create a task linked to this feature. POST /features/{id}/tasks */
export async function createFeatureTask(
    input: FeatureCreateTaskInput,
    signal?: AbortSignal,
): Promise<FeatureCreateTaskResponse> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(input.id)}/tasks`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
        }),
    );
    if (!res.ok) {
        const json: unknown = await res.json();
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `create task failed: ${res.status}`);
    }
    const json: unknown = await res.json();
    return json as FeatureCreateTaskResponse;
}

/** Link an existing task to this feature. PATCH /features/{id}/link */
export async function linkTaskToFeature(
    input: FeatureLinkTaskInput,
    signal?: AbortSignal,
): Promise<FeatureLinkTaskResponse> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(input.id)}/link`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
        }),
    );
    if (!res.ok) {
        const json: unknown = await res.json();
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `link task failed: ${res.status}`);
    }
    const json: unknown = await res.json();
    return json as FeatureLinkTaskResponse;
}

/** Sync feature status with linked tasks. POST /features/{id}/sync */
export async function syncFeatureStatus(input: FeatureSyncInput, signal?: AbortSignal): Promise<FeatureSyncResponse> {
    const res = await fetchWithTimeout(
        new Request(`${API}/${encodeURIComponent(input.id)}/sync`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            signal,
        }),
    );
    if (!res.ok) {
        const json: unknown = await res.json();
        const body = json as { error?: { message?: string } };
        throw new Error(body.error?.message ?? `sync failed: ${res.status}`);
    }
    const json: unknown = await res.json();
    return json as FeatureSyncResponse;
}
