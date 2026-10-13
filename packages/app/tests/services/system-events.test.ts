import { describe, expect, test } from 'bun:test';
import * as catalog from '../../src/services/event-names';
import * as envelope from '../../src/services/system-event-envelope';
import * as surface from '../../src/services/system-events';

describe('system-events public surface', () => {
    test('re-exports the catalog and the envelope builders as the same bindings', () => {
        expect(surface.SYSTEM_EVENT_CATALOG).toBe(catalog.SYSTEM_EVENT_CATALOG);
        expect(surface.systemEventCatalogEntry).toBe(catalog.systemEventCatalogEntry);
        expect(surface.buildSystemEventEnvelope).toBe(envelope.buildSystemEventEnvelope);
        expect(surface.normalizeSystemEventPayload).toBe(envelope.normalizeSystemEventPayload);
        expect(surface.SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION).toBe(2);
    });
});
