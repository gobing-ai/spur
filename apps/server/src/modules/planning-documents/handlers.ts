import { PlanningDocumentError } from '@gobing-ai/spur-app';
import { contract } from '@gobing-ai/spur-contracts';
import { implement } from '@orpc/server';
import { HTTPException } from 'hono/http-exception';
import type { ServerContext } from '../../context';

const os = implement(contract);

/** One status per refusal code, so the oRPC procedure and the legacy alias agree. */
const STATUS_BY_CODE: Record<PlanningDocumentError['code'], number> = {
    unavailable: 503,
    'missing-path': 400,
    denied: 403,
    'not-found': 404,
    'read-failed': 500,
};

/** Re-throw a service refusal as the HTTP error the Board's error path already understands. */
function toHttpError(error: unknown): never {
    if (error instanceof PlanningDocumentError) {
        throw new HTTPException(STATUS_BY_CODE[error.code] as 400, { message: error.message });
    }
    throw error;
}

/** Plan/design read procedures over the shared application owner (task 1300). */
export function createPlanningDocumentHandlers(ctx: ServerContext) {
    const service = () => ctx.planningDocumentService();
    return {
        planList: os.planningDocuments.planList.handler(async () => service().listPlans()),
        planShow: os.planningDocuments.planShow.handler(async ({ input }) => {
            try {
                return await service().showPlan(input.path);
            } catch (error) {
                toHttpError(error);
            }
        }),
        designList: os.planningDocuments.designList.handler(async () => service().listDesigns()),
        designShow: os.planningDocuments.designShow.handler(async ({ input }) => {
            try {
                return await service().showDesign(input.path);
            } catch (error) {
                toHttpError(error);
            }
        }),
    };
}
