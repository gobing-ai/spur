import { BaseDao, type DbAdapter } from '@gobing-ai/ts-db';

/** Shared DAO base that keeps access to ts-db's raw adapter and BaseDao utilities. */
export abstract class SpurDao extends BaseDao {
    protected constructor(protected readonly adapter: DbAdapter) {
        super(adapter.getDb());
    }

    /** Current timestamp in milliseconds for persisted audit columns. */
    protected timestamp(): number {
        return Date.now();
    }
}

/** Generate a compact opaque identifier for local Spur rows. */
export function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
}
