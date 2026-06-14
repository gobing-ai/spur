/**
 * Rebuild planning_events from corpus `## History` sections.
 *
 * Design §2.5 rebuild rule: delete the DB, recreate tables, replay history
 * lines from files → identical planning_events rows. This function proves the
 * derived-only invariant.
 *
 * History line format (canonical, written by `PlanningWriteService` step 7):
 *   `- ISO-timestamp old → new (actor)`
 */

import { createId } from '../dao/base';
import type { CreatePlanningEventInput } from '../dao/planning-event-dao';

/** Parsed history entry from a markdown `## History` line. */
export interface ParsedHistoryEntry {
    timestamp: string;
    entityKind: 'task' | 'feature';
    entityId: string;
    from: string;
    to: string;
}

/**
 * History line regex — matches the canonical line written by the single
 * mutation path (`PlanningWriteService.appendHistoryLine`, design §4.1 step 7):
 *
 *   `- 2026-06-13T01:00:00.000Z backlog → todo (system)`
 *
 * Captures timestamp, from-status, to-status. The `(actor)` suffix is matched
 * but not captured (events store the transition, not the actor). Non-transition
 * bullet seeds (e.g. `- Migrated from legacy format (2026-06-13)`) lack the
 * `from → to` shape and correctly fail to match.
 */
const HISTORY_LINE_RE = /^\s*-\s+(\S+)\s+(\S+)\s*→\s*(\S+)/;

/** Parse a single `## History` line into a structured entry. Returns null if not parseable. */
export function parseHistoryLine(
    line: string,
    entityKind: 'task' | 'feature',
    entityId: string,
): ParsedHistoryEntry | null {
    const match = line.match(HISTORY_LINE_RE);
    if (!match) return null;
    const ts = match[1];
    const from = match[2];
    const to = match[3];
    if (ts === undefined || from === undefined || to === undefined) return null;
    return {
        timestamp: ts,
        entityKind,
        entityId,
        from,
        to,
    };
}

/**
 * Convert a parsed history entry to a `CreatePlanningEventInput`.
 * Emits a `*.transitioned` event for each status change.
 */
export function historyEntryToEvent(entry: ParsedHistoryEntry): CreatePlanningEventInput {
    const event = `${entry.entityKind}.transitioned`;
    return {
        id: createId('pev'),
        entity_kind: entry.entityKind,
        entity_id: entry.entityId,
        event,
        from_status: entry.from,
        to_status: entry.to,
        payload: null,
        created_at: entry.timestamp,
    };
}

/**
 * Parse all history entries from a markdown document body.
 *
 * Extracts lines from `## History` sections and converts them to
 * planning event inputs. Returns an array suitable for batch insertion
 * into `planning_events`.
 */
export function extractHistoryEvents(
    markdownBody: string,
    entityKind: 'task' | 'feature',
    entityId: string,
): CreatePlanningEventInput[] {
    const events: CreatePlanningEventInput[] = [];
    let inHistory = false;

    for (const line of markdownBody.split('\n')) {
        // Start of History section
        if (/^##\s+History\s*$/.test(line)) {
            inHistory = true;
            continue;
        }
        // Next `##` section ends History
        if (inHistory && /^##\s/.test(line)) {
            inHistory = false;
            continue;
        }
        if (inHistory) {
            const entry = parseHistoryLine(line, entityKind, entityId);
            if (entry) {
                events.push(historyEntryToEvent(entry));
            }
        }
    }

    return events;
}
