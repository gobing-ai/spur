import type { PlanFileSummary } from '@gobing-ai/spur-contracts';
import { api } from './rpc-client';

/**
 * Plan document reads over the shared planning-documents contract (task 1300).
 *
 * The hand-written fetch + envelope parsing that used to live here moved to the validated
 * oRPC transport: one contract owns the response shape, one client owns cancellation, and a
 * refusal arrives as an actionable domain error instead of a bare status string.
 */

/** Metadata summary for a plan or roadmap file displayed in the Plans module. */
export type { PlanFileSummary };

/** Detail payload for a single plan document including its markdown content. */
export interface PlanFileDetail {
    ok: boolean;
    path: string;
    title: string;
    content: string;
}

/** Re-throw a transport refusal with the status the caller can act on. */
function rethrow(action: string, error: unknown): never {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(status === undefined ? `${action}: ${message}` : `${action}: ${status}`);
}

/** Fetch all registered plan documents (docs/02_ROADMAP.md, docs/plans/*.md). */
export async function loadPlanFiles(signal?: AbortSignal): Promise<PlanFileSummary[]> {
    try {
        const response = await api.planningDocuments.planList({ signal });
        if (!Array.isArray(response.files)) throw new Error('plan files: invalid response shape');
        return response.files;
    } catch (error) {
        rethrow('plan files fetch failed', error);
    }
}

/** Fetch the markdown content and title of a specific plan document. */
export async function loadPlanContent(path: string, signal?: AbortSignal): Promise<PlanFileDetail> {
    try {
        const response = await api.planningDocuments.planShow({ path }, { signal });
        if (!response.ok || typeof response.content !== 'string') throw new Error('plan file: invalid response shape');
        return response;
    } catch (error) {
        rethrow('plan file fetch failed', error);
    }
}
