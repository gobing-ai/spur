import type { DbAdapter } from '@gobing-ai/ts-db';

/** Raw planning event row returned by query. */
export interface PlanningEventRow {
    id: string;
    entity_kind: string;
    entity_id: string;
    event: string;
    from_status: string | null;
    to_status: string | null;
    payload: string | null;
    created_at: string;
}

/** Input for inserting a planning event. */
export interface CreatePlanningEventInput {
    id: string;
    entity_kind: string;
    entity_id: string;
    event: string;
    from_status?: string | null;
    to_status?: string | null;
    payload?: string | null;
    created_at: string;
}

/** DAO for the append-only planning_events table. */
export class PlanningEventDao {
    constructor(private readonly db: DbAdapter) {}

    /** Insert a single planning event. */
    async insert(input: CreatePlanningEventInput): Promise<void> {
        await this.db.run(
            `INSERT INTO planning_events (id, entity_kind, entity_id, event, from_status, to_status, payload, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                input.id,
                input.entity_kind,
                input.entity_id,
                input.event,
                input.from_status ?? null,
                input.to_status ?? null,
                input.payload ?? null,
                input.created_at,
            ],
        );
    }

    /** List events for an entity, newest first. */
    async listByEntity(entityKind: string, entityId: string, limit: number): Promise<PlanningEventRow[]> {
        try {
            return await this.db.queryAll<PlanningEventRow>(
                `SELECT id, entity_kind, entity_id, event, from_status, to_status, payload, created_at
                 FROM planning_events
                 WHERE entity_kind = ?1 AND entity_id = ?2
                 ORDER BY created_at DESC
                 LIMIT ?3`,
                entityKind,
                entityId,
                limit,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: planning_events')) {
                return [];
            }
            throw error;
        }
    }

    /** List all events, newest first. */
    async listAll(limit: number): Promise<PlanningEventRow[]> {
        try {
            return await this.db.queryAll<PlanningEventRow>(
                `SELECT id, entity_kind, entity_id, event, from_status, to_status, payload, created_at
                 FROM planning_events
                 ORDER BY created_at DESC
                 LIMIT ?1`,
                limit,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: planning_events')) {
                return [];
            }
            throw error;
        }
    }

    /** Count events for a given entity. */
    async countByEntity(entityKind: string, entityId: string): Promise<number> {
        try {
            const row = await this.db.queryFirst<{ cnt: number }>(
                `SELECT COUNT(*) as cnt FROM planning_events WHERE entity_kind = ?1 AND entity_id = ?2`,
                entityKind,
                entityId,
            );
            return row?.cnt ?? 0;
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: planning_events')) {
                return 0;
            }
            throw error;
        }
    }

    /** Delete all rows (test teardown only). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM planning_events');
    }
}
